import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { onRequest, Request } from 'firebase-functions/v2/https';
import * as logger from 'firebase-functions/logger';
import { isIP } from 'node:net';
import { z } from 'zod';
import { SLEEP_PROVIDERS } from '../../../shared/sleep';
import { createMcpDataService, McpDataError } from './data.service';
import {
  createMcpOAuthService,
  McpOAuthAuthorizationRedirectError,
  McpOAuthError,
  McpOAuthScope,
  MCP_OAUTH_SCOPES,
  rejectRepeatedOAuthParameters,
} from './oauth.service';

const dataService = createMcpDataService();
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
const MCP_SLEEP_PROVIDER_SCHEMA = z.enum([
  SLEEP_PROVIDERS.GarminAPI,
  SLEEP_PROVIDERS.SuuntoApp,
  SLEEP_PROVIDERS.COROSAPI,
]);

interface AuthenticatedMcpRequest {
  uid: string;
  clientId: string;
  connectionId: string;
  scopes: McpOAuthScope[];
  baseUrl: string;
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

function toolResult(value: unknown) {
  return {
    content: [{
      type: 'text' as const,
      text: JSON.stringify(value),
    }],
    structuredContent: value as Record<string, unknown>,
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

async function runReadOnlyTool(
  name: string,
  operation: () => Promise<unknown>,
) {
  try {
    return toolResult(await operation());
  } catch (error) {
    if (!(error instanceof McpDataError)) {
      logger.error('[MCP] Tool execution failed', {
        toolName: name,
        errorName: error instanceof Error ? error.name : 'unknown',
      });
    }
    return formatMcpToolError(error);
  }
}

export function createMcpServer(auth: AuthenticatedMcpRequest): McpServer {
  const server = new McpServer({
    name: 'quantified-self',
    version: '1.0.0',
  });

  if (auth.scopes.includes(MCP_OAUTH_SCOPES.MetricsRead)) {
    server.registerTool('list_metrics', {
      title: 'List available metrics',
      description: 'List numeric event metrics persisted for this account, Training-derived metric kinds, and sleep capabilities.',
      inputSchema: {
        search: z.string().max(120).optional(),
        cursor: z.string().max(256).optional(),
        limit: z.number().int().min(1).max(100).default(50),
      },
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
    }, input => runReadOnlyTool('list_metrics', () => dataService.listMetrics({
      uid: auth.uid,
      search: input.search,
      cursor: input.cursor,
      limit: input.limit,
    })));

    server.registerTool('query_metric', {
      title: 'Query an event metric',
      description: 'Aggregate one persisted numeric Sports Lib event metric over a bounded date range.',
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
      description: 'Read one ready Training-derived snapshot without event or activity identifiers and labels.',
      inputSchema: {
        metricKind: z.string().min(1).max(120),
      },
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
      description: 'List bounded activity summaries, including exact start and end coordinates when present, with opaque references and direct authenticated app links.',
      inputSchema: {
        start: MCP_ISO_DATE_TIME_SCHEMA,
        end: MCP_ISO_DATE_TIME_SCHEMA,
        cursor: MCP_CURSOR_SCHEMA.optional(),
        limit: z.number().int().min(1).max(100).default(25),
      },
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
    }, input => runReadOnlyTool('list_activities', () => dataService.listActivities({
      uid: auth.uid,
      connectionId: auth.connectionId,
      appBaseUrl: auth.baseUrl,
      startTimeMs: parseMcpDateTime(input.start, 'start'),
      endTimeMs: parseMcpDateTime(input.end, 'end'),
      cursor: input.cursor,
      limit: input.limit,
    })));

    server.registerTool('list_activity_laps', {
      title: 'List activity laps',
      description: 'List allowlisted lap timing and performance fields for one activity.',
      inputSchema: {
        activityRef: MCP_OPAQUE_REFERENCE_SCHEMA,
        cursor: MCP_CURSOR_SCHEMA.optional(),
        limit: z.number().int().min(1).max(100).default(50),
      },
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
      description: 'List MTB jump measurements for one activity, including exact coordinates when present.',
      inputSchema: {
        activityRef: MCP_OPAQUE_REFERENCE_SCHEMA,
        cursor: MCP_CURSOR_SCHEMA.optional(),
        limit: z.number().int().min(1).max(100).default(50),
      },
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
    }, input => runReadOnlyTool('list_activity_jumps', () => dataService.listActivityJumps({
      uid: auth.uid,
      connectionId: auth.connectionId,
      activityRef: input.activityRef,
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
  }

  if (auth.scopes.includes(MCP_OAUTH_SCOPES.RoutesRead)) {
    server.registerTool('list_routes', {
      title: 'List saved routes',
      description: 'List bounded saved-route summaries, exact bounds, opaque references, and direct authenticated app links.',
      inputSchema: {
        cursor: MCP_CURSOR_SCHEMA.optional(),
        limit: z.number().int().min(1).max(100).default(25),
      },
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
    }, input => runReadOnlyTool('list_routes', () => dataService.listRoutes({
      uid: auth.uid,
      connectionId: auth.connectionId,
      appBaseUrl: auth.baseUrl,
      cursor: input.cursor,
      limit: input.limit,
    })));

    server.registerTool('get_route_geometry', {
      title: 'Get saved-route geometry',
      description: 'Get the bounded polyline5 preview geometry and exact bounds for one saved route.',
      inputSchema: {
        routeRef: MCP_OPAQUE_REFERENCE_SCHEMA,
      },
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
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
    }, input => runReadOnlyTool('list_route_waypoints', () => dataService.listRouteWaypoints({
      uid: auth.uid,
      connectionId: auth.connectionId,
      routeRef: input.routeRef,
    })));
  }

  return server;
}

export function requiredScopeForRequest(body: unknown): McpOAuthScope | null {
  if (
    !body
    || typeof body !== 'object'
    || (body as Record<string, unknown>).method !== 'tools/call'
  ) {
    return null;
  }
  const params = (body as Record<string, unknown>).params;
  const toolName = params && typeof params === 'object'
    ? `${(params as Record<string, unknown>).name || ''}`
    : '';
  if (['list_sleep_sessions', 'query_sleep_summary'].includes(toolName)) {
    return MCP_OAUTH_SCOPES.SleepRead;
  }
  if ([
    'list_activities',
    'list_activity_laps',
    'list_activity_jumps',
    'list_activity_swim_lengths',
  ].includes(toolName)) {
    return MCP_OAUTH_SCOPES.ActivityDetailsRead;
  }
  if ([
    'list_routes',
    'get_route_geometry',
    'list_route_waypoints',
  ].includes(toolName)) {
    return MCP_OAUTH_SCOPES.RoutesRead;
  }
  if (['list_metrics', 'query_metric', 'get_training_metric'].includes(toolName)) {
    return MCP_OAUTH_SCOPES.MetricsRead;
  }
  return null;
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
    response.json({
      issuer: baseUrl,
      authorization_endpoint: `${baseUrl}/oauth/authorize`,
      token_endpoint: `${baseUrl}/oauth/token`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      token_endpoint_auth_methods_supported: ['none'],
      code_challenge_methods_supported: ['S256'],
      scopes_supported: Object.values(MCP_OAUTH_SCOPES),
      client_id_metadata_document_supported: true,
      resource_indicators_supported: true,
    });
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

  let auth: Omit<AuthenticatedMcpRequest, 'baseUrl'>;
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

  const requiredScope = requiredScopeForRequest(request.body);
  if (requiredScope && !auth.scopes.includes(requiredScope)) {
    response.set(
      'WWW-Authenticate',
      `Bearer error="insufficient_scope", scope="${requiredScope}", resource_metadata="${metadataUrl}"`,
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

  const server = createMcpServer({
    ...auth,
    baseUrl,
  });
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
