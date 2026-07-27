import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { onRequest, Request } from 'firebase-functions/v2/https';
import * as logger from 'firebase-functions/logger';
import { isIP } from 'node:net';
import { z } from 'zod';
import { SLEEP_PROVIDERS } from '../../../shared/sleep';
import {
  createMcpDataService,
  MAX_ACTIVITY_METRICS_PER_REQUEST,
  McpDataError,
} from './data.service';
import {
  MCP_ACTIVITY_CHART_DEFAULT_LOCATION_POINTS,
  MCP_ACTIVITY_CHART_DEFAULT_POINTS,
  MCP_ACTIVITY_CHART_MAX_LOCATION_POINTS,
  MCP_ACTIVITY_CHART_MAX_POINTS,
} from './activity-chart.service';
import {
  MCP_MEASUREMENT_TYPE_IDS,
} from './measurement-catalog';
import {
  createMcpOAuthService,
  McpOAuthAuthorizationRedirectError,
  McpOAuthError,
  McpOAuthScope,
  MCP_OAUTH_SCOPES,
  rejectRepeatedOAuthParameters,
} from './oauth.service';
import {
  createMcpOutputSchemaRegistry,
  McpOutputSchemaRegistry,
  PublicMcpToolName,
} from './tool-output-schemas';

const defaultDataService = createMcpDataService();
let oauthService: ReturnType<typeof createMcpOAuthService> | null = null;
const SUPPORTED_PUBLIC_HOSTS = new Set([
  'quantified-self.io',
  'www.quantified-self.io',
  'beta.quantified-self.io',
]);
const MAX_MCP_REQUEST_BYTES = 64 * 1024;
const MCP_ISO_DATE_TIME_SCHEMA = z.iso.datetime({ offset: true }).max(64);
const MCP_OPAQUE_REFERENCE_SCHEMA = z.string().min(1).max(512);
const MCP_CURSOR_SCHEMA = z.string().min(1).max(512);
const MCP_NEARBY_LOCATION_SCHEMA = z.union([
  z.object({
    query: z.string().min(1).max(200),
  }).strict(),
  z.object({
    latitudeDegrees: z.number().min(-90).max(90),
    longitudeDegrees: z.number().min(-180).max(180),
  }).strict(),
]);
const MCP_NEARBY_RADIUS_SCHEMA = z.number()
  .min(100)
  .max(500_000)
  .default(25_000);
const MCP_ACTIVITY_TYPES_SCHEMA = z.array(
  z.string().min(1).max(120),
).max(20).optional();
const MCP_SERVER_ICON_VARIANTS = [
  {
    path: '/assets/favicons/android-chrome-96x96.png',
    sizes: ['96x96'],
  },
  {
    path: '/assets/favicons/android-chrome-192x192.png',
    sizes: ['192x192'],
  },
  {
    path: '/assets/favicons/android-chrome-512x512.png',
    sizes: ['512x512'],
  },
] as const;
const MCP_SLEEP_PROVIDER_SCHEMA = z.enum([
  SLEEP_PROVIDERS.GarminAPI,
  SLEEP_PROVIDERS.SuuntoApp,
  SLEEP_PROVIDERS.COROSAPI,
]);
const MCP_MEASUREMENT_TYPE_SCHEMA = z.enum(MCP_MEASUREMENT_TYPE_IDS);

interface AuthenticatedMcpRequest {
  uid: string;
  clientId: string;
  connectionId: string;
  scopes: McpOAuthScope[];
}

function getOAuthService(): ReturnType<typeof createMcpOAuthService> {
  oauthService ||= createMcpOAuthService();
  return oauthService;
}

export function resolvePublicBaseUrl(request: Request): string {
  const forwardedHost = `${request.get('x-forwarded-host') || ''}`.split(',')[0].trim().toLowerCase();
  const requestHost = forwardedHost || `${request.get('host') || ''}`.trim().toLowerCase();
  const hostname = requestHost.replace(/:\d+$/, '');
  if (SUPPORTED_PUBLIC_HOSTS.has(hostname)) {
    return `https://${hostname}`;
  }
  if (
    process.env.FUNCTIONS_EMULATOR === 'true'
    && (hostname === 'localhost' || hostname === '127.0.0.1')
  ) {
    return `http://${requestHost}`;
  }
  return 'https://quantified-self.io';
}

function requestPath(request: Request): string {
  return `${request.path || request.url || '/'}`.split('?')[0].replace(/\/+$/, '') || '/';
}

export function resolveMcpAuthorizationRequesterKey(request: {
  get: (name: string) => string | undefined;
  ip?: string;
}): string {
  const forwardedClient = `${request.get('x-forwarded-for') || ''}`
    .split(',')[0]
    .trim()
    .toLowerCase();
  if (isIP(forwardedClient)) {
    return forwardedClient;
  }
  const requestIp = `${request.ip || ''}`.trim().toLowerCase();
  return isIP(requestIp) ? requestIp : 'unknown';
}

function noStore(response: {
  set: (name: string, value: string) => unknown;
}): void {
  response.set('Cache-Control', 'no-store');
  response.set('Pragma', 'no-cache');
}

function sendOAuthError(
  response: {
    set: (name: string, value: string) => unknown;
    status: (statusCode: number) => { json: (body: unknown) => unknown };
  },
  error: unknown,
): void {
  const oauthError = error instanceof McpOAuthError
    ? error
    : new McpOAuthError('temporarily_unavailable', 'The authorization service is unavailable.', 503);
  if (!(error instanceof McpOAuthError)) {
    logger.error('[MCP OAuth] Request failed unexpectedly', {
      errorName: error instanceof Error ? error.name : 'unknown',
    });
  }
  if (oauthError.statusCode === 429) {
    response.set('Retry-After', '60');
  }
  response.status(oauthError.statusCode).json({
    error: oauthError.code,
    error_description: oauthError.message,
  });
}

export function parseMcpFormEncodedBody(raw: string): Record<string, unknown> {
  const values = new Map<string, string | string[]>();
  for (const [key, value] of new URLSearchParams(raw)) {
    const existing = values.get(key);
    if (existing === undefined) {
      values.set(key, value);
    } else if (Array.isArray(existing)) {
      existing.push(value);
    } else {
      values.set(key, [existing, value]);
    }
  }
  return Object.fromEntries(values);
}

export function isMcpFormUrlEncodedContentType(value: string | undefined): boolean {
  const [mediaType, ...parameters] = `${value || ''}`.split(';');
  if (mediaType.trim().toLowerCase() !== 'application/x-www-form-urlencoded') {
    return false;
  }
  const charsetParameters = parameters
    .map(parameter => parameter.trim())
    .filter(parameter => /^charset\b/i.test(parameter));
  if (charsetParameters.length === 0) {
    return true;
  }
  if (charsetParameters.length !== 1) {
    return false;
  }
  const match = charsetParameters[0].match(
    /^charset\s*=\s*(?:"([^"]+)"|([^";\s]+))\s*$/i,
  );
  const charset = match?.[1] || match?.[2];
  return Boolean(charset && /^utf-?8$/i.test(charset));
}

function parseFormBody(request: Request): Record<string, unknown> {
  if (request.body && typeof request.body === 'object' && !Buffer.isBuffer(request.body)) {
    return request.body as Record<string, unknown>;
  }
  const raw = Buffer.isBuffer(request.body)
    ? request.body.toString('utf8')
    : typeof request.body === 'string'
      ? request.body
      : '';
  return parseMcpFormEncodedBody(raw);
}

export function buildMcpAuthorizationServerMetadata(baseUrl: string) {
  return {
    issuer: baseUrl,
    authorization_endpoint: `${baseUrl}/oauth/authorize`,
    token_endpoint: `${baseUrl}/oauth/token`,
    revocation_endpoint: `${baseUrl}/oauth/revoke`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    token_endpoint_auth_methods_supported: ['none'],
    revocation_endpoint_auth_methods_supported: ['none'],
    code_challenge_methods_supported: ['S256'],
    scopes_supported: Object.values(MCP_OAUTH_SCOPES),
    client_id_metadata_document_supported: true,
    resource_indicators_supported: true,
  };
}

interface McpRevocationHttpResponse {
  set(name: string, value: string): unknown;
  status(statusCode: number): {
    json(body: unknown): unknown;
    send(body?: unknown): unknown;
  };
}

export async function handleMcpRevocationRequest(
  request: Request,
  response: McpRevocationHttpResponse,
  service: Pick<ReturnType<typeof createMcpOAuthService>, 'revokeToken'> = getOAuthService(),
): Promise<void> {
  noStore(response);
  if (!isMcpFormUrlEncodedContentType(request.get('content-type'))) {
    response.status(400).json({
      error: 'invalid_request',
      error_description: 'The revocation request must use application/x-www-form-urlencoded.',
    });
    return;
  }
  if (!isMcpRequestBodyWithinLimit(request.body, request.get('content-length'))) {
    response.status(413).json({
      error: 'invalid_request',
      error_description: 'The revocation request body is too large.',
    });
    return;
  }
  try {
    const params = parseFormBody(request);
    await service.revokeToken(params, {
      requesterKey: resolveMcpAuthorizationRequesterKey(request),
    });
    response.status(200).send('');
  } catch (error) {
    sendOAuthError(response, error);
  }
}

export function parseMcpDateTime(value: string, field: string): number {
  if (!MCP_ISO_DATE_TIME_SCHEMA.safeParse(value).success) {
    throw new McpDataError(
      'invalid_request',
      `${field} must be an ISO-8601 date-time with a UTC offset.`,
    );
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new McpDataError(
      'invalid_request',
      `${field} must be an ISO-8601 date-time with a UTC offset.`,
    );
  }
  return parsed;
}

function toolResult(value: Record<string, unknown>) {
  const serialized = JSON.stringify(value);
  const structuredContent = JSON.parse(serialized) as Record<string, unknown>;
  return {
    content: [{
      type: 'text' as const,
      text: serialized,
    }],
    structuredContent,
  };
}

export function formatMcpToolError(error: unknown) {
  const code = error instanceof McpDataError ? error.code : 'internal_error';
  const message = error instanceof McpDataError
    ? error.message
    : 'The MCP tool could not complete the request.';
  return {
    isError: true,
    content: [{
      type: 'text' as const,
      text: JSON.stringify({ error: code, message }),
    }],
  };
}

const READ_ONLY_TOOL_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

const READ_ONLY_LOCATION_TOOL_ANNOTATIONS = {
  ...READ_ONLY_TOOL_ANNOTATIONS,
  openWorldHint: true,
} as const;

function createReadOnlyToolRunner(outputSchemas: McpOutputSchemaRegistry) {
  return async (
    name: PublicMcpToolName,
    operation: () => Promise<unknown>,
  ) => {
    try {
      const projected = await operation();
      const validated = await outputSchemas[name].parseAsync(projected);
      return toolResult(validated as Record<string, unknown>);
    } catch (error) {
      if (!(error instanceof McpDataError)) {
        logger.error('[MCP] Tool execution failed', {
          toolName: name,
          errorName: error instanceof Error ? error.name : 'unknown',
        });
      }
      return formatMcpToolError(error);
    }
  };
}

function buildMcpServerInstructions(auth: AuthenticatedMcpRequest): string {
  const instructions = [
    'Use only the read-only tools exposed for the permissions this connection was granted.',
  ];
  if (auth.scopes.includes(MCP_OAUTH_SCOPES.ActivityDetailsRead)) {
    instructions.push(
      'For a specific workout, activity, or exercise session—including today’s, yesterday’s, latest, last, or most recent—call list_activities before concluding it is unavailable; aggregate metrics and Training snapshots do not contain individual activity records. Omit dates and use limit 1 for the latest activity; use explicit local-day bounds for a calendar date.',
    );
  }
  if (auth.scopes.includes(MCP_OAUTH_SCOPES.MeasurementsRead)) {
    instructions.push(
      'Use list_measurement_types and query_measurements for body weight, body mass, weigh-ins, measurement history, and measurement trends. query_measurements returns bounded identity-free day, week, or month values; its default body-weight aggregation is the median. Treat body measurements as recorded values, not a medical or health assessment.',
    );
  }
  if (auth.scopes.includes(MCP_OAUTH_SCOPES.MetricsRead)) {
    instructions.push(
      'Use get_training_metric with body_weight_trend only for the ready 28-day Training snapshot. Use list_metrics and query_metric for activity and other numeric event metrics.',
    );
  }
  return instructions.join(' ');
}

export function createMcpServer(
  auth: AuthenticatedMcpRequest,
  publicBaseUrl: string,
  dataService: ReturnType<typeof createMcpDataService> = defaultDataService,
): McpServer {
  const measurementToolsAvailable = auth.scopes.includes(
    MCP_OAUTH_SCOPES.MeasurementsRead,
  );
  const activityLocationAvailable = auth.scopes.includes(
    MCP_OAUTH_SCOPES.ActivityLocationRead,
  );
  const routeLocationAvailable = auth.scopes.includes(
    MCP_OAUTH_SCOPES.RouteLocationRead,
  );
  const outputSchemas = createMcpOutputSchemaRegistry({
    activityLocation: activityLocationAvailable,
    routeLocation: routeLocationAvailable,
  });
  const runReadOnlyTool = createReadOnlyToolRunner(outputSchemas);
  const server = new McpServer({
    name: 'quantified-self',
    title: 'Quantified Self',
    version: '1.1.1',
    description: 'Read-only activity metrics, body measurements, Training snapshots, and sleep-session summaries.',
    websiteUrl: publicBaseUrl,
    icons: MCP_SERVER_ICON_VARIANTS.map(icon => ({
      src: `${publicBaseUrl}${icon.path}`,
      mimeType: 'image/png',
      sizes: [...icon.sizes],
    })),
  }, {
    instructions: buildMcpServerInstructions(auth),
  });

  if (measurementToolsAvailable) {
    server.registerTool('list_measurement_types', {
      title: 'List body measurement types',
      description: 'List first-class personal measurement capabilities such as body weight, including units, supported trend aggregations, date intervals, range limits, and the optional current Training snapshot.',
      inputSchema: {},
      outputSchema: outputSchemas.list_measurement_types,
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
    }, () => runReadOnlyTool(
      'list_measurement_types',
      () => dataService.listMeasurementTypes(),
    ));

    server.registerTool('query_measurements', {
      title: 'Query body measurement history',
      description: 'Query recorded body measurements such as weight or body mass over a bounded date range. Returns an identity-free day, week, or month time series and change summary; provider, device, source, event, and activity identity are excluded. Recorded values are not a medical or health assessment.',
      inputSchema: {
        measurementType: MCP_MEASUREMENT_TYPE_SCHEMA,
        start: MCP_ISO_DATE_TIME_SCHEMA,
        end: MCP_ISO_DATE_TIME_SCHEMA,
        aggregation: z.enum([
          'median',
          'average',
          'minimum',
          'maximum',
          'latest',
        ]).default('median'),
        interval: z.enum(['day', 'week', 'month']).default('day'),
        timeZone: z.string()
          .min(1)
          .max(80)
          .describe('Required IANA time zone used for day, week, and month boundaries.'),
      },
      outputSchema: outputSchemas.query_measurements,
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
    }, input => runReadOnlyTool(
      'query_measurements',
      () => dataService.queryMeasurements({
        uid: auth.uid,
        measurementType: input.measurementType,
        startTimeMs: parseMcpDateTime(input.start, 'start'),
        endTimeMs: parseMcpDateTime(input.end, 'end'),
        aggregation: input.aggregation,
        interval: input.interval,
        timeZone: input.timeZone,
      }),
    ));
  }

  if (auth.scopes.includes(MCP_OAUTH_SCOPES.MetricsRead)) {
    server.registerTool('list_metrics', {
      title: 'List available activity and Training metrics',
      description: measurementToolsAvailable
        ? 'List numeric event metrics persisted for this account, Training-derived metric kinds, and sleep capabilities. For body weight or other personal measurements, use list_measurement_types.'
        : 'List numeric event metrics persisted for this account, Training-derived metric kinds, and sleep capabilities.',
      inputSchema: {
        search: z.string().max(120).optional(),
        cursor: z.string().max(256).optional(),
        limit: z.number().int().min(1).max(100).default(50),
      },
      outputSchema: outputSchemas.list_metrics,
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
    }, input => runReadOnlyTool('list_metrics', () => dataService.listMetrics({
      uid: auth.uid,
      search: input.search,
      cursor: input.cursor,
      limit: input.limit,
    })));

    server.registerTool('query_metric', {
      title: 'Query an activity or event metric',
      description: measurementToolsAvailable
        ? 'Aggregate one persisted numeric Sports Lib activity or event metric over a bounded date range. For body weight, body mass, weigh-ins, or measurement trends, use query_measurements.'
        : 'Aggregate one persisted numeric Sports Lib activity or event metric over a bounded date range.',
      inputSchema: {
        metric: z.string().min(1).max(160),
        start: MCP_ISO_DATE_TIME_SCHEMA,
        end: MCP_ISO_DATE_TIME_SCHEMA,
        aggregation: z.enum(['total', 'average', 'minimum', 'maximum']).default('average'),
        groupBy: z.enum(['date', 'activity_type']).default('date'),
        interval: z.enum([
          'auto',
          'hourly',
          'daily',
          'weekly',
          'biweekly',
          'monthly',
          'quarterly',
          'semesterly',
          'yearly',
        ]).default('daily'),
        timeZone: z.string().min(1).max(80),
        activityTypes: z.array(z.string().min(1).max(120)).max(20).optional(),
      },
      outputSchema: outputSchemas.query_metric,
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
    }, input => runReadOnlyTool('query_metric', () => dataService.queryMetric({
      uid: auth.uid,
      metric: input.metric,
      startTimeMs: parseMcpDateTime(input.start, 'start'),
      endTimeMs: parseMcpDateTime(input.end, 'end'),
      aggregation: input.aggregation,
      groupBy: input.groupBy,
      interval: input.interval,
      timeZone: input.timeZone,
      activityTypes: input.activityTypes,
    })));

    server.registerTool('get_training_metric', {
      title: 'Get a Training metric',
      description: measurementToolsAvailable
        ? 'Read one ready Training-derived snapshot without event or activity identifiers and labels. The body_weight_trend kind is a current 28-day Training snapshot; use query_measurements for explicit body-weight history.'
        : 'Read one ready Training-derived snapshot without event or activity identifiers and labels. The body_weight_trend kind is a current 28-day Training snapshot.',
      inputSchema: {
        metricKind: z.string().min(1).max(120),
      },
      outputSchema: outputSchemas.get_training_metric,
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
    }, input => runReadOnlyTool(
      'get_training_metric',
      () => dataService.getTrainingMetric(auth.uid, input.metricKind),
    ));
  }

  if (auth.scopes.includes(MCP_OAUTH_SCOPES.SleepRead)) {
    server.registerTool('list_sleep_sessions', {
      title: 'List sleep sessions',
      description: 'List redacted normalized sleep-session summaries. Raw samples and provider payloads are never returned.',
      inputSchema: {
        start: MCP_ISO_DATE_TIME_SCHEMA,
        end: MCP_ISO_DATE_TIME_SCHEMA,
        includeNaps: z.boolean().default(false),
        provider: MCP_SLEEP_PROVIDER_SCHEMA.optional(),
        cursor: z.string().max(512).optional(),
        limit: z.number().int().min(1).max(100).default(25),
      },
      outputSchema: outputSchemas.list_sleep_sessions,
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
    }, input => runReadOnlyTool('list_sleep_sessions', () => dataService.listSleepSessions({
      uid: auth.uid,
      connectionId: auth.connectionId,
      startTimeMs: parseMcpDateTime(input.start, 'start'),
      endTimeMs: parseMcpDateTime(input.end, 'end'),
      includeNaps: input.includeNaps,
      provider: input.provider,
      cursor: input.cursor,
      limit: input.limit,
    })));

    server.registerTool('query_sleep_summary', {
      title: 'Query sleep summary',
      description: 'Aggregate redacted sleep sessions by local day, week, or month.',
      inputSchema: {
        start: MCP_ISO_DATE_TIME_SCHEMA,
        end: MCP_ISO_DATE_TIME_SCHEMA,
        includeNaps: z.boolean().default(false),
        provider: MCP_SLEEP_PROVIDER_SCHEMA.optional(),
        groupBy: z.enum(['day', 'week', 'month']).default('day'),
        timeZone: z.string().min(1).max(80),
      },
      outputSchema: outputSchemas.query_sleep_summary,
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
    }, input => runReadOnlyTool('query_sleep_summary', () => dataService.querySleepSummary({
      uid: auth.uid,
      startTimeMs: parseMcpDateTime(input.start, 'start'),
      endTimeMs: parseMcpDateTime(input.end, 'end'),
      includeNaps: input.includeNaps,
      provider: input.provider,
      groupBy: input.groupBy,
      timeZone: input.timeZone,
    })));
  }

  if (auth.scopes.includes(MCP_OAUTH_SCOPES.ActivityDetailsRead)) {
    server.registerTool('list_activities', {
      title: 'List activities',
      description: activityLocationAvailable
        ? 'Use when the user asks to find, list, or inspect workouts, activities, or exercise sessions—including today’s, yesterday’s, latest, last, or most recent workout. Results are newest first; omit both dates and use limit 1 for the latest activity, or provide both dates for a bounded period. Returns safe summaries, exact start and end coordinates when present, opaque references, and direct authenticated app links.'
        : 'Use when the user asks to find, list, or inspect workouts, activities, or exercise sessions—including today’s, yesterday’s, latest, last, or most recent workout. Results are newest first; omit both dates and use limit 1 for the latest activity, or provide both dates for a bounded period. Returns safe non-location summaries with opaque references and direct authenticated app links; location fields are redacted.',
      inputSchema: {
        start: MCP_ISO_DATE_TIME_SCHEMA
          .describe('Optional inclusive period start. Provide start and end together; omit both for newest-first activity history.')
          .optional(),
        end: MCP_ISO_DATE_TIME_SCHEMA
          .describe('Optional inclusive period end. Provide start and end together; omit both for newest-first activity history.')
          .optional(),
        cursor: MCP_CURSOR_SCHEMA.optional(),
        limit: z.number()
          .int()
          .min(1)
          .max(100)
          .default(25)
          .describe('Maximum activities to return. Use 1 when the user asks for the latest or last workout.'),
      },
      outputSchema: outputSchemas.list_activities,
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
    }, input => runReadOnlyTool('list_activities', () => dataService.listActivities({
      uid: auth.uid,
      connectionId: auth.connectionId,
      appBaseUrl: publicBaseUrl,
      startTimeMs: input.start
        ? parseMcpDateTime(input.start, 'start')
        : undefined,
      endTimeMs: input.end
        ? parseMcpDateTime(input.end, 'end')
        : undefined,
      includeLocation: activityLocationAvailable,
      cursor: input.cursor,
      limit: input.limit,
    })));

    if (activityLocationAvailable) {
      server.registerTool('find_activities_near_location', {
        title: 'Find activities near a location',
        description: 'Find activities whose exact start or end coordinate is within a radius. Place text is resolved with Mapbox; direct coordinates do not call Mapbox. Dates are optional, and results are returned newest first in bounded scan pages.',
        inputSchema: {
          location: MCP_NEARBY_LOCATION_SCHEMA,
          radiusMeters: MCP_NEARBY_RADIUS_SCHEMA,
          start: MCP_ISO_DATE_TIME_SCHEMA.optional(),
          end: MCP_ISO_DATE_TIME_SCHEMA.optional(),
          activityTypes: MCP_ACTIVITY_TYPES_SCHEMA,
          cursor: MCP_CURSOR_SCHEMA.optional(),
          limit: z.number().int().min(1).max(25).default(10),
        },
        outputSchema: outputSchemas.find_activities_near_location,
        annotations: READ_ONLY_LOCATION_TOOL_ANNOTATIONS,
      }, input => runReadOnlyTool(
        'find_activities_near_location',
        () => dataService.findActivitiesNearLocation({
          uid: auth.uid,
          connectionId: auth.connectionId,
          appBaseUrl: publicBaseUrl,
          location: input.location,
          radiusMeters: input.radiusMeters,
          startTimeMs: input.start
            ? parseMcpDateTime(input.start, 'start')
            : undefined,
          endTimeMs: input.end
            ? parseMcpDateTime(input.end, 'end')
            : undefined,
          activityTypes: input.activityTypes,
          cursor: input.cursor,
          limit: input.limit,
        }),
      ));
    }

    server.registerTool('list_activity_laps', {
      title: 'List activity laps',
      description: 'List allowlisted lap timing and performance fields for one activity.',
      inputSchema: {
        activityRef: MCP_OPAQUE_REFERENCE_SCHEMA,
        cursor: MCP_CURSOR_SCHEMA.optional(),
        limit: z.number().int().min(1).max(100).default(50),
      },
      outputSchema: outputSchemas.list_activity_laps,
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
    }, input => runReadOnlyTool('list_activity_laps', () => dataService.listActivityLaps({
      uid: auth.uid,
      connectionId: auth.connectionId,
      activityRef: input.activityRef,
      cursor: input.cursor,
      limit: input.limit,
    })));

    server.registerTool('list_activity_jumps', {
      title: 'List activity jumps',
      description: activityLocationAvailable
        ? 'List MTB jump measurements for one activity, including exact coordinates when present.'
        : 'List MTB jump measurements for one activity with coordinates redacted.',
      inputSchema: {
        activityRef: MCP_OPAQUE_REFERENCE_SCHEMA,
        cursor: MCP_CURSOR_SCHEMA.optional(),
        limit: z.number().int().min(1).max(100).default(50),
      },
      outputSchema: outputSchemas.list_activity_jumps,
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
    }, input => runReadOnlyTool('list_activity_jumps', () => dataService.listActivityJumps({
      uid: auth.uid,
      connectionId: auth.connectionId,
      activityRef: input.activityRef,
      includeLocation: activityLocationAvailable,
      cursor: input.cursor,
      limit: input.limit,
    })));

    server.registerTool('list_activity_swim_lengths', {
      title: 'List activity swim lengths',
      description: 'List allowlisted pool length, stroke, timing, and performance fields for one activity.',
      inputSchema: {
        activityRef: MCP_OPAQUE_REFERENCE_SCHEMA,
        cursor: MCP_CURSOR_SCHEMA.optional(),
        limit: z.number().int().min(1).max(100).default(50),
      },
      outputSchema: outputSchemas.list_activity_swim_lengths,
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
    }, input => runReadOnlyTool(
      'list_activity_swim_lengths',
      () => dataService.listActivitySwimLengths({
        uid: auth.uid,
        connectionId: auth.connectionId,
        activityRef: input.activityRef,
        cursor: input.cursor,
        limit: input.limit,
      }),
    ));

    server.registerTool('list_activity_chart_metrics', {
      title: 'List activity chart metrics',
      description: 'List the static chart-stream catalog, canonical units, axes, and point limits. This does not read an activity or original source file.',
      inputSchema: {
        activityType: z.string().min(1).max(120).optional(),
      },
      outputSchema: outputSchemas.list_activity_chart_metrics,
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
    }, input => runReadOnlyTool(
      'list_activity_chart_metrics',
      async () => dataService.listActivityChartMetrics(input.activityType),
    ));

    server.registerTool('get_activity_chart_data', {
      title: 'Get activity chart data',
      description: 'Parse the existing original source on demand and return bounded, whole-activity chart series. Original files, full-resolution recordings, absolute sample timestamps, and unrequested streams are never returned. Breadcrumb coordinates require activity-location access.',
      inputSchema: {
        activityRef: MCP_OPAQUE_REFERENCE_SCHEMA,
        metrics: z.array(z.string().min(1).max(120)).min(1).max(4),
        xAxis: z.enum(['elapsed_time', 'distance']).default('elapsed_time'),
        maxPoints: z.number().int().min(2).max(MCP_ACTIVITY_CHART_MAX_POINTS)
          .default(MCP_ACTIVITY_CHART_DEFAULT_POINTS),
        includeLocation: z.boolean().default(false),
        maxLocationPoints: z.number().int().min(2)
          .max(MCP_ACTIVITY_CHART_MAX_LOCATION_POINTS)
          .default(MCP_ACTIVITY_CHART_DEFAULT_LOCATION_POINTS),
      },
      outputSchema: outputSchemas.get_activity_chart_data,
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
    }, input => runReadOnlyTool(
      'get_activity_chart_data',
      () => {
        if (input.includeLocation && !activityLocationAvailable) {
          throw new McpDataError(
            'invalid_request',
            'Activity breadcrumb coordinates require activity-location:read.',
          );
        }
        return dataService.getActivityChartData({
          uid: auth.uid,
          connectionId: auth.connectionId,
          activityRef: input.activityRef,
          metrics: input.metrics,
          xAxis: input.xAxis,
          maxPoints: input.maxPoints,
          includeLocation: input.includeLocation,
          maxLocationPoints: input.maxLocationPoints,
        });
      },
    ));
  }

  if (
    auth.scopes.includes(MCP_OAUTH_SCOPES.MetricsRead)
    && auth.scopes.includes(MCP_OAUTH_SCOPES.ActivityDetailsRead)
  ) {
    server.registerTool('get_activity_metrics', {
      title: 'Get activity metrics',
      description: `Read up to ${MAX_ACTIVITY_METRICS_PER_REQUEST} explicitly selected canonical numeric Sports Lib metrics for one referenced activity. Requires both metric and activity-detail access.`,
      inputSchema: {
        activityRef: MCP_OPAQUE_REFERENCE_SCHEMA,
        metrics: z.array(z.string().min(1).max(120))
          .min(1)
          .max(MAX_ACTIVITY_METRICS_PER_REQUEST),
      },
      outputSchema: outputSchemas.get_activity_metrics,
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
    }, input => runReadOnlyTool(
      'get_activity_metrics',
      () => dataService.getActivityMetrics({
        uid: auth.uid,
        connectionId: auth.connectionId,
        activityRef: input.activityRef,
        metrics: input.metrics,
      }),
    ));
  }

  if (auth.scopes.includes(MCP_OAUTH_SCOPES.RoutesRead)) {
    server.registerTool('list_routes', {
      title: 'List saved routes',
      description: routeLocationAvailable
        ? 'List bounded saved-route summaries, exact bounds, opaque references, and direct authenticated app links.'
        : 'List bounded non-location saved-route summaries, opaque references, and direct authenticated app links. Bounds are redacted.',
      inputSchema: {
        cursor: MCP_CURSOR_SCHEMA.optional(),
        limit: z.number().int().min(1).max(100).default(25),
      },
      outputSchema: outputSchemas.list_routes,
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
    }, input => runReadOnlyTool('list_routes', () => dataService.listRoutes({
      uid: auth.uid,
      connectionId: auth.connectionId,
      appBaseUrl: publicBaseUrl,
      includeLocation: routeLocationAvailable,
      cursor: input.cursor,
      limit: input.limit,
    })));

    if (routeLocationAvailable) {
      server.registerTool('find_routes_near_location', {
        title: 'Find saved routes near a location',
        description: 'Find saved routes whose persisted preview passes within a radius. Place text is resolved with Mapbox; direct coordinates do not call Mapbox. Results are returned newest first in bounded scan pages.',
        inputSchema: {
          location: MCP_NEARBY_LOCATION_SCHEMA,
          radiusMeters: MCP_NEARBY_RADIUS_SCHEMA,
          activityTypes: MCP_ACTIVITY_TYPES_SCHEMA,
          cursor: MCP_CURSOR_SCHEMA.optional(),
          limit: z.number().int().min(1).max(10).default(10),
        },
        outputSchema: outputSchemas.find_routes_near_location,
        annotations: READ_ONLY_LOCATION_TOOL_ANNOTATIONS,
      }, input => runReadOnlyTool(
        'find_routes_near_location',
        () => dataService.findRoutesNearLocation({
          uid: auth.uid,
          connectionId: auth.connectionId,
          appBaseUrl: publicBaseUrl,
          location: input.location,
          radiusMeters: input.radiusMeters,
          activityTypes: input.activityTypes,
          cursor: input.cursor,
          limit: input.limit,
        }),
      ));

      server.registerTool('get_route_geometry', {
        title: 'Get saved-route geometry',
        description: 'Get the bounded polyline5 preview geometry, exact bounds, and explicit start and end coordinates for each segment of one saved route.',
        inputSchema: {
          routeRef: MCP_OPAQUE_REFERENCE_SCHEMA,
        },
        outputSchema: outputSchemas.get_route_geometry,
        annotations: READ_ONLY_TOOL_ANNOTATIONS,
      }, input => runReadOnlyTool('get_route_geometry', () => dataService.getRouteGeometry({
        uid: auth.uid,
        connectionId: auth.connectionId,
        routeRef: input.routeRef,
      })));

      server.registerTool('list_route_waypoints', {
        title: 'List saved-route waypoints',
        description: 'List bounded, allowlisted waypoint coordinates parsed from one saved FIT or GPX route source.',
        inputSchema: {
          routeRef: MCP_OPAQUE_REFERENCE_SCHEMA,
        },
        outputSchema: outputSchemas.list_route_waypoints,
        annotations: READ_ONLY_TOOL_ANNOTATIONS,
      }, input => runReadOnlyTool('list_route_waypoints', () => dataService.listRouteWaypoints({
        uid: auth.uid,
        connectionId: auth.connectionId,
        routeRef: input.routeRef,
      })));
    }
  }

  return server;
}

export function requiredScopesForRequest(body: unknown): McpOAuthScope[] {
  if (
    !body
    || typeof body !== 'object'
    || (body as Record<string, unknown>).method !== 'tools/call'
  ) {
    return [];
  }
  const params = (body as Record<string, unknown>).params;
  const toolName = params && typeof params === 'object'
    ? `${(params as Record<string, unknown>).name || ''}`
    : '';
  const toolArguments = params && typeof params === 'object'
    && (params as Record<string, unknown>).arguments
    && typeof (params as Record<string, unknown>).arguments === 'object'
    ? (params as Record<string, unknown>).arguments as Record<string, unknown>
    : {};
  if (toolName === 'get_activity_metrics') {
    return [
      MCP_OAUTH_SCOPES.MetricsRead,
      MCP_OAUTH_SCOPES.ActivityDetailsRead,
    ];
  }
  if (['list_sleep_sessions', 'query_sleep_summary'].includes(toolName)) {
    return [MCP_OAUTH_SCOPES.SleepRead];
  }
  if ([
    'find_activities_near_location',
  ].includes(toolName)) {
    return [
      MCP_OAUTH_SCOPES.ActivityDetailsRead,
      MCP_OAUTH_SCOPES.ActivityLocationRead,
    ];
  }
  if (
    toolName === 'get_activity_chart_data'
    && toolArguments.includeLocation === true
  ) {
    return [
      MCP_OAUTH_SCOPES.ActivityDetailsRead,
      MCP_OAUTH_SCOPES.ActivityLocationRead,
    ];
  }
  if ([
    'list_activities',
    'list_activity_laps',
    'list_activity_jumps',
    'list_activity_swim_lengths',
    'list_activity_chart_metrics',
    'get_activity_chart_data',
  ].includes(toolName)) {
    return [MCP_OAUTH_SCOPES.ActivityDetailsRead];
  }
  if ([
    'find_routes_near_location',
    'get_route_geometry',
    'list_route_waypoints',
  ].includes(toolName)) {
    return [
      MCP_OAUTH_SCOPES.RoutesRead,
      MCP_OAUTH_SCOPES.RouteLocationRead,
    ];
  }
  if (toolName === 'list_routes') {
    return [MCP_OAUTH_SCOPES.RoutesRead];
  }
  if ([
    'list_measurement_types',
    'query_measurements',
  ].includes(toolName)) {
    return [MCP_OAUTH_SCOPES.MeasurementsRead];
  }
  if ([
    'list_metrics',
    'query_metric',
    'get_training_metric',
  ].includes(toolName)) {
    return [MCP_OAUTH_SCOPES.MetricsRead];
  }
  return [];
}

export function supportsMcpTransportMethod(method: string): boolean {
  return method === 'POST';
}

export function isMcpRequestBodyWithinLimit(
  body: unknown,
  contentLength: string | undefined,
): boolean {
  const declaredLength = Number(contentLength);
  if (contentLength && (!Number.isFinite(declaredLength) || declaredLength < 0)) {
    return false;
  }
  if (declaredLength > MAX_MCP_REQUEST_BYTES) {
    return false;
  }

  try {
    const serialized = typeof body === 'string'
      ? body
      : JSON.stringify(body ?? null);
    return Buffer.byteLength(serialized, 'utf8') <= MAX_MCP_REQUEST_BYTES;
  } catch {
    return false;
  }
}

export interface McpBearerFailure {
  statusCode: 401 | 429 | 503;
  error: 'invalid_token' | 'temporarily_unavailable';
  challengeError?: 'invalid_token';
  retryAfterSeconds?: number;
}

export function classifyMcpBearerFailure(error: unknown): McpBearerFailure {
  if (error instanceof McpOAuthError && error.statusCode === 429) {
    return {
      statusCode: 429,
      error: 'temporarily_unavailable',
      retryAfterSeconds: 60,
    };
  }
  if (error instanceof McpOAuthError && error.statusCode === 401) {
    return {
      statusCode: 401,
      error: 'invalid_token',
      challengeError: 'invalid_token',
    };
  }
  return {
    statusCode: 503,
    error: 'temporarily_unavailable',
  };
}

export function requireMcpTokenGrantType(
  value: unknown,
): 'authorization_code' | 'refresh_token' {
  if (value === undefined || value === null || value === '') {
    throw new McpOAuthError('invalid_request', 'grant_type is required.');
  }
  if (typeof value !== 'string') {
    throw new McpOAuthError('invalid_request', 'grant_type must not be repeated.');
  }
  if (value === 'authorization_code' || value === 'refresh_token') {
    return value;
  }
  throw new McpOAuthError(
    'unsupported_grant_type',
    'Only authorization_code and refresh_token grants are supported.',
  );
}

export function parseMcpBearerToken(value: unknown): string | null {
  const authorization = typeof value === 'string' ? value.trim() : '';
  const match = authorization.match(/^Bearer[ \t]+(\S+)$/i);
  return match?.[1] || null;
}

export const mcpApi = onRequest({
  region: 'europe-west2',
  cors: false,
  timeoutSeconds: 120,
  memory: '512MiB',
}, async (request, response) => {
  const baseUrl = resolvePublicBaseUrl(request);
  const resource = `${baseUrl}/mcp`;
  const metadataUrl = `${baseUrl}/.well-known/oauth-protected-resource`;
  const path = requestPath(request);

  if (
    request.method === 'GET'
    && (
      path === '/.well-known/oauth-protected-resource'
      || path === '/.well-known/oauth-protected-resource/mcp'
    )
  ) {
    response.set('Cache-Control', 'public, max-age=300');
    response.json({
      resource,
      resource_name: 'Quantified Self MCP',
      authorization_servers: [baseUrl],
      scopes_supported: Object.values(MCP_OAUTH_SCOPES),
      bearer_methods_supported: ['header'],
    });
    return;
  }

  if (request.method === 'GET' && path === '/.well-known/oauth-authorization-server') {
    response.set('Cache-Control', 'public, max-age=300');
    response.json(buildMcpAuthorizationServerMetadata(baseUrl));
    return;
  }

  if (request.method === 'GET' && path === '/oauth/authorize') {
    noStore(response);
    try {
      const started = await getOAuthService().startAuthorization(
        request.query as Record<string, unknown>,
        baseUrl,
        {
          requesterKey: resolveMcpAuthorizationRequesterKey(request),
        },
      );
      response.redirect(302, started.consentUrl);
    } catch (error) {
      if (error instanceof McpOAuthAuthorizationRedirectError) {
        response.redirect(302, error.redirectUri);
        return;
      }
      sendOAuthError(response, error);
    }
    return;
  }

  if (request.method === 'POST' && path === '/oauth/revoke') {
    await handleMcpRevocationRequest(request, response);
    return;
  }

  if (request.method === 'POST' && path === '/oauth/token') {
    noStore(response);
    if (!isMcpFormUrlEncodedContentType(request.get('content-type'))) {
      response.status(400).json({
        error: 'invalid_request',
        error_description: 'The token request must use application/x-www-form-urlencoded.',
      });
      return;
    }
    if (!isMcpRequestBodyWithinLimit(request.body, request.get('content-length'))) {
      response.status(413).json({
        error: 'invalid_request',
        error_description: 'The token request body is too large.',
      });
      return;
    }
    try {
      const params = parseFormBody(request);
      rejectRepeatedOAuthParameters(params);
      const grantType = requireMcpTokenGrantType(params.grant_type);
      const result = grantType === 'authorization_code'
        ? await getOAuthService().exchangeAuthorizationCode(params, baseUrl)
        : await getOAuthService().exchangeRefreshToken(params, baseUrl);
      response.json(result);
    } catch (error) {
      sendOAuthError(response, error);
    }
    return;
  }

  if (path !== '/mcp') {
    response.status(404).json({ error: 'not_found' });
    return;
  }
  noStore(response);
  if (
    request.method === 'POST'
    && !isMcpRequestBodyWithinLimit(request.body, request.get('content-length'))
  ) {
    response.status(413).json({
      jsonrpc: '2.0',
      error: {
        code: -32000,
        message: 'Request body is too large.',
      },
      id: null,
    });
    return;
  }
  const bearerToken = parseMcpBearerToken(request.get('authorization'));
  if (!bearerToken) {
    response.set(
      'WWW-Authenticate',
      `Bearer resource_metadata="${metadataUrl}", scope="${Object.values(MCP_OAUTH_SCOPES).join(' ')}"`,
    );
    response.status(401).json({ error: 'unauthorized' });
    return;
  }

  let auth: AuthenticatedMcpRequest;
  try {
    auth = await getOAuthService().authenticateBearer(bearerToken, resource);
  } catch (error) {
    const failure = classifyMcpBearerFailure(error);
    if (failure.challengeError) {
      response.set(
        'WWW-Authenticate',
        `Bearer error="${failure.challengeError}", resource_metadata="${metadataUrl}"`,
      );
    }
    if (failure.retryAfterSeconds) {
      response.set('Retry-After', `${failure.retryAfterSeconds}`);
    }
    if (failure.statusCode === 503) {
      logger.error('[MCP] Bearer authentication failed unexpectedly', {
        errorName: error instanceof Error ? error.name : 'unknown',
      });
    }
    response.status(failure.statusCode).json({ error: failure.error });
    return;
  }

  const requiredScopes = requiredScopesForRequest(request.body);
  if (requiredScopes.some(scope => !auth.scopes.includes(scope))) {
    response.set(
      'WWW-Authenticate',
      `Bearer error="insufficient_scope", scope="${requiredScopes.join(' ')}", resource_metadata="${metadataUrl}"`,
    );
    response.status(403).json({ error: 'insufficient_scope' });
    return;
  }
  if (!supportsMcpTransportMethod(request.method)) {
    response.set('Allow', 'POST');
    response.status(405).json({
      jsonrpc: '2.0',
      error: {
        code: -32000,
        message: 'Method not allowed.',
      },
      id: null,
    });
    return;
  }

  const server = createMcpServer(auth, baseUrl);
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  try {
    await server.connect(transport);
    await transport.handleRequest(request, response, request.body);
  } catch (error) {
    logger.error('[MCP] Streamable HTTP request failed', {
      errorName: error instanceof Error ? error.name : 'unknown',
    });
    if (!response.headersSent) {
      response.status(500).json({
        jsonrpc: '2.0',
        error: {
          code: -32603,
          message: 'Internal server error',
        },
        id: null,
      });
    }
  } finally {
    await transport.close().catch(() => undefined);
    await server.close().catch(() => undefined);
  }
});
