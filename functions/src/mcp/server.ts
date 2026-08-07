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
  MCP_ACTIVITY_RELATIVE_PERIODS,
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
import { FUNCTION_SECRET_BINDINGS } from '../secrets';

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
)
  .max(20)
  .describe('Optional canonical Sports Lib activity types or recognized aliases. Use list_activity_types to discover canonical values.')
  .optional();
const MCP_ACTIVITY_RELATIVE_PERIOD_SCHEMA = z.enum(
  MCP_ACTIVITY_RELATIVE_PERIODS,
);
const MCP_ACTIVITY_TIME_ZONE_SCHEMA = z.string()
  .min(1)
  .max(80);
const MCP_ACTIVITY_LIST_INPUT_SCHEMA = z.object({
  start: MCP_ISO_DATE_TIME_SCHEMA
    .describe('Inclusive explicit-range start. Provide together with end; omit for relative or unbounded mode.')
    .optional(),
  end: MCP_ISO_DATE_TIME_SCHEMA
    .describe('Inclusive explicit-range end. Provide together with start; omit for relative or unbounded mode.')
    .optional(),
  activityTypes: MCP_ACTIVITY_TYPES_SCHEMA,
  relativePeriod: MCP_ACTIVITY_RELATIVE_PERIOD_SCHEMA
    .describe('Local calendar period: today or yesterday. Requires timeZone; omit for explicit or unbounded mode.')
    .optional(),
  timeZone: MCP_ACTIVITY_TIME_ZONE_SCHEMA
    .describe('IANA time zone required with relativePeriod; omit for explicit or unbounded mode.')
    .optional(),
  cursor: MCP_CURSOR_SCHEMA
    .describe('Continuation cursor. Repeat the original activityTypes and date-selection inputs when using it.')
    .optional(),
  limit: z.number()
    .int()
    .min(1)
    .max(100)
    .default(25)
    .describe('Maximum matching activities to return. Use 1 for a latest or last request, including a server-filtered named activity type.'),
}).superRefine((input, context) => {
  const explicitRange = input.start !== undefined || input.end !== undefined;
  const relativeRange = input.relativePeriod !== undefined || input.timeZone !== undefined;
  const validExplicitRange = input.start !== undefined
    && input.end !== undefined
    && !relativeRange;
  const validRelativeRange = input.relativePeriod !== undefined
    && input.timeZone !== undefined
    && !explicitRange;
  if (!validExplicitRange && !validRelativeRange && (explicitRange || relativeRange)) {
    context.addIssue({
      code: 'custom',
      message: 'Choose exactly one date mode: both start and end, both relativePeriod and timeZone, or no date selectors.',
    });
  }
}).describe(
  'Choose exactly one date mode: an explicit start/end range, a relativePeriod/timeZone range, or no date selectors for unbounded newest-first history.',
).meta({
  oneOf: [
    {
      title: 'Explicit date range',
      required: ['start', 'end'],
      not: {
        anyOf: [
          { required: ['relativePeriod'] },
          { required: ['timeZone'] },
        ],
      },
    },
    {
      title: 'Relative date range',
      required: ['relativePeriod', 'timeZone'],
      not: {
        anyOf: [
          { required: ['start'] },
          { required: ['end'] },
        ],
      },
    },
    {
      title: 'Unbounded newest-first history',
      not: {
        anyOf: [
          { required: ['start'] },
          { required: ['end'] },
          { required: ['relativePeriod'] },
          { required: ['timeZone'] },
        ],
      },
    },
  ],
});
const MCP_ACTIVITY_RANKING_INPUT_SCHEMA = z.object({
  metric: z.string().min(1).max(160),
  start: MCP_ISO_DATE_TIME_SCHEMA.optional(),
  end: MCP_ISO_DATE_TIME_SCHEMA.optional(),
  activityTypes: MCP_ACTIVITY_TYPES_SCHEMA,
  activityGroup: z.string().min(1).max(80)
    .describe('Exact activityGroup from list_activity_types; expands to its canonical types.')
    .optional(),
  order: z.enum(['highest', 'lowest']).default('highest'),
  limit: z.number().int().min(1).max(25).default(10),
}).superRefine((input, context) => {
  if ((input.start === undefined) !== (input.end === undefined)) {
    context.addIssue({
      code: 'custom',
      message: 'Provide both start and end for an explicit date range, or omit both for all available history.',
    });
  }
}).meta({
  oneOf: [
    {
      title: 'Explicit date range',
      required: ['start', 'end'],
    },
    {
      title: 'All available history',
      not: {
        anyOf: [
          { required: ['start'] },
          { required: ['end'] },
        ],
      },
    },
  ],
});
const MCP_NEARBY_ACTIVITY_INPUT_SCHEMA = z.object({
  location: MCP_NEARBY_LOCATION_SCHEMA,
  radiusMeters: MCP_NEARBY_RADIUS_SCHEMA,
  start: MCP_ISO_DATE_TIME_SCHEMA
    .describe('Inclusive explicit-range start. Provide together with end, or omit both for unbounded mode.')
    .optional(),
  end: MCP_ISO_DATE_TIME_SCHEMA
    .describe('Inclusive explicit-range end. Provide together with start, or omit both for unbounded mode.')
    .optional(),
  activityTypes: MCP_ACTIVITY_TYPES_SCHEMA,
  cursor: MCP_CURSOR_SCHEMA.optional(),
  limit: z.number().int().min(1).max(25).default(10),
}).superRefine((input, context) => {
  if ((input.start === undefined) !== (input.end === undefined)) {
    context.addIssue({
      code: 'custom',
      message: 'Provide both start and end for an explicit date range, or omit both for unbounded mode.',
    });
  }
}).describe(
  'Choose either an explicit start/end range or an unbounded newest-first history scan.',
).meta({
  oneOf: [
    {
      title: 'Explicit date range',
      required: ['start', 'end'],
    },
    {
      title: 'Unbounded newest-first history',
      not: {
        anyOf: [
          { required: ['start'] },
          { required: ['end'] },
        ],
      },
    },
  ],
});
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

export interface AuthenticatedMcpRequest {
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

export function buildMcpProtectedResourceMetadata(baseUrl: string) {
  return {
    resource: `${baseUrl}/mcp`,
    resource_name: 'Quantified Self MCP',
    authorization_servers: [baseUrl],
    scopes_supported: Object.values(MCP_OAUTH_SCOPES),
    bearer_methods_supported: ['header'],
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
        const validationIssues = summarizeMcpOutputValidationIssues(error);
        logger.error('[MCP] Tool execution failed', {
          toolName: name,
          errorName: error instanceof Error ? error.name : 'unknown',
          ...(validationIssues ? { validationIssues } : {}),
        });
      }
      return formatMcpToolError(error);
    }
  };
}

export function summarizeMcpOutputValidationIssues(
  error: unknown,
): Array<{ code: string; path: Array<string | number> }> | null {
  if (!(error instanceof z.ZodError)) {
    return null;
  }
  return error.issues.slice(0, 8).map(issue => ({
    code: issue.code,
    path: issue.path.slice(0, 8).map(part => {
      if (typeof part === 'number') {
        return part;
      }
      return typeof part === 'string'
        && /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(part)
        ? part
        : '<dynamic>';
    }),
  }));
}

function buildMcpServerInstructions(auth: AuthenticatedMcpRequest): string {
  const instructions = [
    'Use only the read-only tools exposed for the permissions this connection was granted.',
  ];
  if (
    auth.scopes.includes(MCP_OAUTH_SCOPES.MetricsRead)
    && auth.scopes.includes(MCP_OAUTH_SCOPES.SleepRead)
  ) {
    instructions.push(
      'For a good-morning request or current daily report, use get_daily_report. For multi-day sleep, HRV, heart-rate, SpO2, or respiration trends, use get_sleep_trend. Use get_today_readiness only for the current recovery score and its evidence. Supply the requested IANA time zone.',
    );
  } else if (auth.scopes.includes(MCP_OAUTH_SCOPES.SleepRead)) {
    instructions.push(
      'For sleep trends—including HRV, heart rate, SpO2, or respiration—use get_sleep_trend with the requested period and an explicit IANA time zone.',
    );
  }
  if (auth.scopes.includes(MCP_OAUTH_SCOPES.ActivityDetailsRead)) {
    instructions.push(
      'For a workout, use list_activity_types if needed, then query_activities; aggregate metrics do not contain individual records. Use relativePeriod plus timeZone for today or yesterday. For latest, omit dates; add activityTypes and limit 1 when named. For nearby history, use search_activities_near_location. Follow nextCursor until matched or scanComplete.',
    );
  }
  if (
    auth.scopes.includes(MCP_OAUTH_SCOPES.MetricsRead)
    && auth.scopes.includes(MCP_OAUTH_SCOPES.ActivityDetailsRead)
  ) {
    instructions.push(
      'Use get_activity_overview before granular activity reads. For highest or lowest activities by one metric, use rank_activities_by_metric. For an MTB jump superlative, discover the Mountain Biking activityGroup, pass it to rank_activities_by_metric, and use the corresponding persisted Maximum Jump Distance, Height, Hang Time, Speed, or Score metric. The server expands the group to every canonical type. Treat the ranked metric value as authoritative. When stating when the record happened, use that ranked activity\'s exact ISO startTime; never substitute the current date. Read list_activity_jumps only when jump-level details are requested and preserve pagination completeness. Never rank jump quality by jumpCount.',
    );
  }
  if (auth.scopes.includes(MCP_OAUTH_SCOPES.RoutesRead)) {
    instructions.push(
      'For saved routes by sport or name, use list_activity_types when needed, then list_routes with activityTypes or search. Use search_routes_near_location for nearby saved routes. Repeat the filters with nextCursor until matched or scanComplete.',
    );
  }
  if (auth.scopes.includes(MCP_OAUTH_SCOPES.MeasurementsRead)) {
    instructions.push(
      'Use list_measurement_types and query_measurements for body weight, body mass, weigh-ins, measurement history, and measurement trends. query_measurements returns bounded identity-free day, week, or month values; its default body-weight aggregation is the median. Treat body measurements as recorded values, not a medical or health assessment.',
    );
  }
  if (auth.scopes.includes(MCP_OAUTH_SCOPES.MetricsRead)) {
    instructions.push(
      'Use list_training_metrics before assuming a Training-derived metric is unavailable, then use get_training_metric only when its status is ready. Use list_metrics and query_metric for activity and other numeric event metrics; use query_metrics to compare up to four over one bounded range. Use get_training_metric with body_weight_trend only for the ready 28-day Training snapshot.',
    );
  }
  if (auth.scopes.includes(MCP_OAUTH_SCOPES.SleepRead)) {
    instructions.push(
      'get_sleep_trend returns recorded-vital coverage and local day, week, or month values in one call. Never conclude that sleep HRV, heart rate, SpO2, or respiration is unavailable before checking get_sleep_trend or list_sleep_vitals. Use list_sleep_vitals only for availability questions and list_sleep_sessions for individual nights. Missing values remain null rather than zero. Raw sensor samples are unavailable, and recorded values are not medical advice.',
    );
  }
  if (
    auth.scopes.includes(MCP_OAUTH_SCOPES.MetricsRead)
    && auth.scopes.includes(MCP_OAUTH_SCOPES.SleepRead)
  ) {
    instructions.push(
      'get_today_readiness calculates the live UTC-day readiness used by Dashboard Today from current Form/ramp and bounded same-provider sleep baselines. For get_daily_report, lead with sleep and its recorded aggregate HRV/heart-rate values, summarize readiness in one sentence using at most the two most relevant available drivers, then summarize the current-versus-usual Training context. Keep get_daily_briefing only for clients that explicitly request its legacy physiology-free projection. These tools are not workout plans or medical advice.',
    );
  }
  instructions.push(
    'Absolute output fields ending in TimeMs, DateMs, DayMs, or AtMs, plus bucketStartMs, are Unix epoch milliseconds; convert them exactly before stating a calendar date and never substitute the current date. Measurement values such as HRV milliseconds and relative offsets such as jump timestampMs are not calendar timestamps.',
  );
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
    version: '1.3.0',
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

  server.registerTool('list_activity_types', {
    title: 'List activity types',
    description: 'Discover the unique canonical Sports Lib activity types accepted by activity and route filters, with activity-group and indoor hints. Common aliases are normalized by filtered tools, but canonical values are preferred. This static catalog contains no account data.',
    inputSchema: {},
    outputSchema: outputSchemas.list_activity_types,
    annotations: READ_ONLY_TOOL_ANNOTATIONS,
  }, () => runReadOnlyTool(
    'list_activity_types',
    async () => dataService.listActivityTypes(),
  ));

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

    server.registerTool('query_metrics', {
      title: 'Query several activity or event metrics',
      description: measurementToolsAvailable
        ? 'Query up to four activity metrics over one range; use query_measurements for body measurements.'
        : 'Query up to four activity metrics over one range.',
      inputSchema: {
        metrics: z.array(z.object({
          metric: z.string().min(1).max(160),
          aggregation: z.enum([
            'total',
            'average',
            'minimum',
            'maximum',
          ]).default('average'),
        }).strict()).min(1).max(4),
        start: MCP_ISO_DATE_TIME_SCHEMA,
        end: MCP_ISO_DATE_TIME_SCHEMA,
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
      outputSchema: outputSchemas.query_metrics,
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
    }, input => runReadOnlyTool('query_metrics', () => dataService.queryMetrics({
      uid: auth.uid,
      metrics: input.metrics,
      startTimeMs: parseMcpDateTime(input.start, 'start'),
      endTimeMs: parseMcpDateTime(input.end, 'end'),
      groupBy: input.groupBy,
      interval: input.interval,
      timeZone: input.timeZone,
      activityTypes: input.activityTypes,
    })));

    server.registerTool('list_training_metrics', {
      title: 'List Training metrics',
      description: 'List Training metric descriptions and current snapshot status.',
      inputSchema: {
        search: z.string().max(120).optional(),
      },
      outputSchema: outputSchemas.list_training_metrics,
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
    }, input => runReadOnlyTool(
      'list_training_metrics',
      () => dataService.listTrainingMetrics({
        uid: auth.uid,
        search: input.search,
      }),
    ));

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
    server.registerTool('get_sleep_trend', {
      title: 'Get sleep and HRV trend',
      description: 'Get sleep duration, score, stages, HRV, heart rate, blood oxygen saturation, and respiration trends in one bounded call, with explicit coverage for every recorded safe aggregate vital. Prefer this for recent sleep changes, poor-sleep questions, or recovery-oriented sleep trends. It cannot diagnose illness and never returns raw sensor samples or provider payloads.',
      inputSchema: {
        start: MCP_ISO_DATE_TIME_SCHEMA,
        end: MCP_ISO_DATE_TIME_SCHEMA,
        includeNaps: z.boolean().default(false),
        provider: MCP_SLEEP_PROVIDER_SCHEMA.optional(),
        groupBy: z.enum(['day', 'week', 'month']).default('day'),
        timeZone: z.string().min(1).max(80),
      },
      outputSchema: outputSchemas.get_sleep_trend,
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
    }, input => runReadOnlyTool('get_sleep_trend', () => dataService.getSleepTrend({
      uid: auth.uid,
      startTimeMs: parseMcpDateTime(input.start, 'start'),
      endTimeMs: parseMcpDateTime(input.end, 'end'),
      includeNaps: input.includeNaps,
      provider: input.provider,
      groupBy: input.groupBy,
      timeZone: input.timeZone,
    })));

    server.registerTool('list_sleep_vitals', {
      title: 'Discover available sleep vitals',
      description: 'Discover which redacted aggregate sleep vital types have recorded values in a bounded period, including average or overnight HRV when available. Use this for data-availability questions; use get_sleep_trend for readings and trends. Raw sensor samples and provider payloads are never returned.',
      inputSchema: {
        start: MCP_ISO_DATE_TIME_SCHEMA,
        end: MCP_ISO_DATE_TIME_SCHEMA,
        includeNaps: z.boolean().default(false),
        provider: MCP_SLEEP_PROVIDER_SCHEMA.optional(),
      },
      outputSchema: outputSchemas.list_sleep_vitals,
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
    }, input => runReadOnlyTool('list_sleep_vitals', () => dataService.listSleepVitals({
      uid: auth.uid,
      startTimeMs: parseMcpDateTime(input.start, 'start'),
      endTimeMs: parseMcpDateTime(input.end, 'end'),
      includeNaps: input.includeNaps,
      provider: input.provider,
    })));

    server.registerTool('list_sleep_sessions', {
      title: 'List sleep sessions and nightly vitals',
      description: 'List redacted normalized sleep-session summaries with safe aggregate vitals, including average or overnight HRV when recorded. Raw sensor samples and provider payloads are never returned.',
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
      title: 'Summarize sleep and recorded vitals',
      description: 'Aggregate redacted sleep sessions by local day, week, or month. Each bucket includes averages for available safe vitals; prefer get_sleep_trend when the question asks for coverage and a trend together. Raw samples are never returned.',
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

  if (
    auth.scopes.includes(MCP_OAUTH_SCOPES.MetricsRead)
    && auth.scopes.includes(MCP_OAUTH_SCOPES.SleepRead)
  ) {
    server.registerTool('get_today_readiness', {
      title: 'Get today readiness',
      description: 'Calculate the same live recovery-aware readiness shown by Dashboard Today from current UTC-day Form/ramp and a bounded 30-day sleep query. Returns the score plus explicit Load, Sleep, HRV, and Overnight HR drivers, including latest safe aggregate values, same-provider baseline medians, evidence counts, ratios, and freshness. Provider identity, raw samples, activities, locations, workout plans, diagnosis, and medical advice are excluded.',
      inputSchema: {
        timeZone: z.string()
          .min(1)
          .max(80)
          .describe('Required IANA time zone used only for local-day context; readiness itself uses the documented UTC day boundary.'),
      },
      outputSchema: outputSchemas.get_today_readiness,
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
    }, input => runReadOnlyTool(
      'get_today_readiness',
      () => dataService.getTodayReadiness({
        uid: auth.uid,
        timeZone: input.timeZone,
      }),
    ));

    server.registerTool('get_daily_report', {
      title: 'Get daily health and training report',
      description: 'Return one current report for an explicit IANA time zone. It combines the latest completed non-nap sleep with an explicit allowlist of aggregate average/overnight HRV and average/minimum sleep heart rate, the live Dashboard Today readiness and its safe same-provider evidence, and current-versus-usual equivalent 28-day Training totals and sport mix. In the answer, lead with sleep and recorded HRV/heart-rate values, keep readiness to one sentence using at most two relevant available drivers, then summarize Training. Provider identity, raw samples, SpO2, respiration, locations, activity records, body measurements, workout plans, diagnosis, and medical advice are excluded.',
      inputSchema: {
        timeZone: z.string()
          .min(1)
          .max(80)
          .describe('Required IANA time zone used for local-day report context; readiness itself retains its documented UTC day boundary.'),
      },
      outputSchema: outputSchemas.get_daily_report,
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
    }, input => runReadOnlyTool('get_daily_report', () => dataService.getDailyReport({
      uid: auth.uid,
      timeZone: input.timeZone,
    })));

    server.registerTool('get_daily_briefing', {
      title: 'Get daily briefing',
      description: 'Return a compact morning readout for an explicit IANA time zone. It includes only the latest completed non-nap sleep, current-versus-usual equivalent 28-day Training totals and Running/Cycling/Swimming mix, and a current UTC-day Training readiness signal. It never returns provider identity, physiology, locations, activity records, body measurements, a workout plan, or medical advice.',
      inputSchema: {
        timeZone: z.string()
          .min(1)
          .max(80)
          .describe('Required IANA time zone used for the local-day boundaries in this briefing.'),
      },
      outputSchema: outputSchemas.get_daily_briefing,
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
    }, input => runReadOnlyTool('get_daily_briefing', () => dataService.getDailyBriefing({
      uid: auth.uid,
      timeZone: input.timeZone,
    })));
  }

  if (auth.scopes.includes(MCP_OAUTH_SCOPES.ActivityDetailsRead)) {
    server.registerTool('list_activities', {
      title: 'List activities',
      description: activityLocationAvailable
        ? 'Find, list, or inspect individual workouts newest first. Filter server-side with activityTypes; use list_activity_types for canonical values. For today or yesterday, provide relativePeriod and an IANA timeZone. Otherwise provide start and end together for an explicit range, or omit all date selectors for all history/latest. Repeat the original filters with nextCursor until a match or scanComplete. Returns bounded scan counts, safe summaries, exact start and end coordinates when present, opaque references, and authenticated app links.'
        : 'Find, list, or inspect individual workouts newest first. Filter server-side with activityTypes; use list_activity_types for canonical values. For today or yesterday, provide relativePeriod and an IANA timeZone. Otherwise provide start and end together for an explicit range, or omit all date selectors for all history/latest. Repeat the original filters with nextCursor until a match or scanComplete. Returns bounded scan counts, safe non-location summaries, opaque references, and authenticated app links; location fields are redacted.',
      inputSchema: {
        start: MCP_ISO_DATE_TIME_SCHEMA
          .describe('Optional inclusive period start. Provide start and end together; do not combine them with relativePeriod.')
          .optional(),
        end: MCP_ISO_DATE_TIME_SCHEMA
          .describe('Optional inclusive period end. Provide start and end together; do not combine them with relativePeriod.')
          .optional(),
        activityTypes: MCP_ACTIVITY_TYPES_SCHEMA,
        relativePeriod: MCP_ACTIVITY_RELATIVE_PERIOD_SCHEMA
          .describe('Optional local calendar period. Requires timeZone and cannot be combined with start or end.')
          .optional(),
        timeZone: z.string()
          .min(1)
          .max(80)
          .describe('IANA timezone required with relativePeriod; omit otherwise.')
          .optional(),
        cursor: MCP_CURSOR_SCHEMA
          .describe('Continuation cursor. Repeat the original activityTypes and date-selection inputs when using it.')
          .optional(),
        limit: z.number()
          .int()
          .min(1)
          .max(100)
          .default(25)
          .describe('Maximum matching activities to return. Use 1 for a latest or last request, including a server-filtered named activity type.'),
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
      activityTypes: input.activityTypes,
      relativePeriod: input.relativePeriod,
      timeZone: input.timeZone,
      includeLocation: activityLocationAvailable,
      cursor: input.cursor,
      limit: input.limit,
    })));

    server.registerTool('query_activities', {
      title: 'Query activities',
      description: activityLocationAvailable
        ? 'Query individual workouts newest first with one explicit date mode: start/end, relativePeriod/timeZone, or unbounded history. Filter server-side with activityTypes; use list_activity_types for canonical values. Returns bounded scan counts, safe summaries, exact start and end coordinates when present, opaque references, and authenticated app links.'
        : 'Query individual workouts newest first with one explicit date mode: start/end, relativePeriod/timeZone, or unbounded history. Filter server-side with activityTypes; use list_activity_types for canonical values. Returns bounded scan counts, safe non-location summaries, opaque references, and authenticated app links; location fields are redacted.',
      inputSchema: MCP_ACTIVITY_LIST_INPUT_SCHEMA,
      outputSchema: outputSchemas.query_activities,
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
    }, input => runReadOnlyTool('query_activities', () => dataService.listActivities({
      uid: auth.uid,
      connectionId: auth.connectionId,
      appBaseUrl: publicBaseUrl,
      startTimeMs: input.start
        ? parseMcpDateTime(input.start, 'start')
        : undefined,
      endTimeMs: input.end
        ? parseMcpDateTime(input.end, 'end')
        : undefined,
      activityTypes: input.activityTypes,
      relativePeriod: input.relativePeriod,
      timeZone: input.timeZone,
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

      server.registerTool('search_activities_near_location', {
        title: 'Search activities near a location',
        description: 'Search activities whose exact start or end coordinate is within a radius, using either a complete start/end range or unbounded newest-first history. Place text is resolved with a read-only Mapbox lookup; direct coordinates do not call Mapbox.',
        inputSchema: MCP_NEARBY_ACTIVITY_INPUT_SCHEMA,
        outputSchema: outputSchemas.search_activities_near_location,
        annotations: READ_ONLY_TOOL_ANNOTATIONS,
      }, input => runReadOnlyTool(
        'search_activities_near_location',
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
    server.registerTool('get_activity_overview', {
      title: 'Get activity overview',
      description: 'Inspect coordinate-free activity capabilities before granular reads.',
      inputSchema: {
        activityRef: MCP_OPAQUE_REFERENCE_SCHEMA,
      },
      outputSchema: outputSchemas.get_activity_overview,
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
    }, input => runReadOnlyTool(
      'get_activity_overview',
      () => dataService.getActivityOverview({
        uid: auth.uid,
        connectionId: auth.connectionId,
        activityRef: input.activityRef,
      }),
    ));

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

    server.registerTool('rank_activities_by_metric', {
      title: 'Rank activities by metric',
      description: 'Rank one persisted metric over a range or all history. Oversized scans fail. A ranked Maximum Jump metric is authoritative; read jump details only when requested.',
      inputSchema: MCP_ACTIVITY_RANKING_INPUT_SCHEMA,
      outputSchema: outputSchemas.rank_activities_by_metric,
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
    }, input => runReadOnlyTool(
      'rank_activities_by_metric',
      () => dataService.rankActivitiesByMetric({
        uid: auth.uid,
        connectionId: auth.connectionId,
        metric: input.metric,
        startTimeMs: input.start === undefined
          ? undefined
          : parseMcpDateTime(input.start, 'start'),
        endTimeMs: input.end === undefined
          ? undefined
          : parseMcpDateTime(input.end, 'end'),
        activityTypes: input.activityTypes,
        activityGroup: input.activityGroup,
        order: input.order,
        limit: input.limit,
      }),
    ));
  }

  if (auth.scopes.includes(MCP_OAUTH_SCOPES.RoutesRead)) {
    server.registerTool('list_routes', {
      title: 'List saved routes',
      description: routeLocationAvailable
        ? 'List saved routes newest first. Filter server-side with activityTypes or a case-insensitive route-name search; use list_activity_types for canonical values. Repeat the original filters with nextCursor until a match or scanComplete. Returns bounded scan counts, exact bounds, opaque references, and direct authenticated app links.'
        : 'List saved routes newest first. Filter server-side with activityTypes or a case-insensitive route-name search; use list_activity_types for canonical values. Repeat the original filters with nextCursor until a match or scanComplete. Returns bounded scan counts, non-location summaries, opaque references, and direct authenticated app links. Bounds are redacted.',
      inputSchema: {
        activityTypes: MCP_ACTIVITY_TYPES_SCHEMA,
        search: z.string()
          .max(120)
          .describe('Optional case-insensitive text contained in the saved route name.')
          .optional(),
        cursor: MCP_CURSOR_SCHEMA
          .describe('Continuation cursor. Repeat the original activityTypes and search inputs when using it.')
          .optional(),
        limit: z.number().int().min(1).max(100).default(25),
      },
      outputSchema: outputSchemas.list_routes,
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
    }, input => runReadOnlyTool('list_routes', () => dataService.listRoutes({
      uid: auth.uid,
      connectionId: auth.connectionId,
      appBaseUrl: publicBaseUrl,
      activityTypes: input.activityTypes,
      search: input.search,
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

      server.registerTool('search_routes_near_location', {
        title: 'Search saved routes near a location',
        description: 'Search saved routes whose persisted preview passes within a radius. Place text is resolved with a read-only Mapbox lookup; direct coordinates do not call Mapbox. Results are returned newest first in bounded scan pages.',
        inputSchema: {
          location: MCP_NEARBY_LOCATION_SCHEMA,
          radiusMeters: MCP_NEARBY_RADIUS_SCHEMA,
          activityTypes: MCP_ACTIVITY_TYPES_SCHEMA,
          cursor: MCP_CURSOR_SCHEMA.optional(),
          limit: z.number().int().min(1).max(10).default(10),
        },
        outputSchema: outputSchemas.search_routes_near_location,
        annotations: READ_ONLY_TOOL_ANNOTATIONS,
      }, input => runReadOnlyTool(
        'search_routes_near_location',
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
  if ([
    'get_activity_metrics',
    'get_activity_overview',
    'rank_activities_by_metric',
  ].includes(toolName)) {
    return [
      MCP_OAUTH_SCOPES.MetricsRead,
      MCP_OAUTH_SCOPES.ActivityDetailsRead,
    ];
  }
  if ([
    'get_sleep_trend',
    'list_sleep_vitals',
    'list_sleep_sessions',
    'query_sleep_summary',
  ].includes(toolName)) {
    return [MCP_OAUTH_SCOPES.SleepRead];
  }
  if ([
    'get_today_readiness',
    'get_daily_report',
    'get_daily_briefing',
  ].includes(toolName)) {
    return [
      MCP_OAUTH_SCOPES.MetricsRead,
      MCP_OAUTH_SCOPES.SleepRead,
    ];
  }
  if ([
    'find_activities_near_location',
    'search_activities_near_location',
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
    'query_activities',
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
    'search_routes_near_location',
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
    'query_metrics',
    'list_training_metrics',
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
  secrets: FUNCTION_SECRET_BINDINGS.mcpApi,
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
    response.json(buildMcpProtectedResourceMetadata(baseUrl));
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
