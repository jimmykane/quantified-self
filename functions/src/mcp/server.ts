import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { onRequest, Request } from 'firebase-functions/v2/https';
import * as logger from 'firebase-functions/logger';
import { z } from 'zod';
import { SLEEP_PROVIDERS } from '../../../shared/sleep';
import { createMcpDataService, McpDataError } from './data.service';
import {
  createMcpOAuthService,
  McpOAuthError,
  McpOAuthScope,
  MCP_OAUTH_SCOPES,
} from './oauth.service';

const dataService = createMcpDataService();
let oauthService: ReturnType<typeof createMcpOAuthService> | null = null;
const SUPPORTED_PUBLIC_HOSTS = new Set([
  'quantified-self.io',
  'www.quantified-self.io',
  'beta.quantified-self.io',
]);

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

function resolvePublicBaseUrl(request: Request): string {
  const forwardedHost = `${request.get('x-forwarded-host') || ''}`.split(',')[0].trim().toLowerCase();
  const requestHost = forwardedHost || `${request.get('host') || ''}`.trim().toLowerCase();
  const hostname = requestHost.replace(/:\d+$/, '');
  if (SUPPORTED_PUBLIC_HOSTS.has(hostname)) {
    return `https://${requestHost}`;
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

function noStore(response: {
  set: (name: string, value: string) => unknown;
}): void {
  response.set('Cache-Control', 'no-store');
  response.set('Pragma', 'no-cache');
}

function sendOAuthError(
  response: {
    status: (statusCode: number) => { json: (body: unknown) => unknown };
  },
  error: unknown,
): void {
  const oauthError = error instanceof McpOAuthError
    ? error
    : new McpOAuthError('temporarily_unavailable', 'The authorization service is unavailable.', 503);
  response.status(oauthError.statusCode).json({
    error: oauthError.code,
    error_description: oauthError.message,
  });
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
  return Object.fromEntries(new URLSearchParams(raw));
}

function parseDateTime(value: string, field: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new McpDataError('invalid_request', `${field} must be an ISO-8601 date-time.`);
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

function toolError(error: unknown) {
  const code = error instanceof McpDataError ? error.code : 'internal_error';
  const message = error instanceof Error ? error.message : 'The MCP tool could not complete the request.';
  return {
    isError: true,
    content: [{
      type: 'text' as const,
      text: JSON.stringify({ error: code, message }),
    }],
  };
}

function registerReadOnlyTool(
  server: McpServer,
  name: string,
  config: Record<string, unknown>,
  handler: (input: Record<string, unknown>) => Promise<unknown>,
): void {
  server.registerTool(name, {
    ...config,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    // The SDK's registerTool overload cannot infer a raw Zod shape after this
    // shared config wrapper spreads it; each call site still supplies Zod schemas.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any, async (input: Record<string, unknown>) => {
    try {
      return toolResult(await handler(input));
    } catch (error) {
      return toolError(error);
    }
  });
}

function createServer(auth: AuthenticatedMcpRequest): McpServer {
  const server = new McpServer({
    name: 'quantified-self',
    version: '1.0.0',
  });

  if (auth.scopes.includes(MCP_OAUTH_SCOPES.MetricsRead)) {
    registerReadOnlyTool(server, 'list_metrics', {
      title: 'List available metrics',
      description: 'List numeric event metrics persisted for this account, Training-derived metric kinds, and sleep capabilities.',
      inputSchema: {
        search: z.string().max(120).optional(),
        cursor: z.string().max(256).optional(),
        limit: z.number().int().min(1).max(100).default(50),
      },
    }, input => dataService.listMetrics({
      uid: auth.uid,
      search: input.search as string | undefined,
      cursor: input.cursor as string | undefined,
      limit: input.limit as number | undefined,
    }));

    registerReadOnlyTool(server, 'query_metric', {
      title: 'Query an event metric',
      description: 'Aggregate one persisted numeric Sports Lib event metric over a bounded date range.',
      inputSchema: {
        metric: z.string().min(1).max(160),
        start: z.string().min(1).max(64),
        end: z.string().min(1).max(64),
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
    }, input => dataService.queryMetric({
      uid: auth.uid,
      metric: input.metric as string,
      startTimeMs: parseDateTime(input.start as string, 'start'),
      endTimeMs: parseDateTime(input.end as string, 'end'),
      aggregation: input.aggregation as 'total' | 'average' | 'minimum' | 'maximum',
      groupBy: input.groupBy as 'date' | 'activity_type',
      interval: input.interval as 'auto' | 'hourly' | 'daily' | 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'semesterly' | 'yearly',
      timeZone: input.timeZone as string,
      activityTypes: input.activityTypes as string[] | undefined,
    }));

    registerReadOnlyTool(server, 'get_training_metric', {
      title: 'Get a Training metric',
      description: 'Read one ready Training-derived snapshot without event or activity identifiers and labels.',
      inputSchema: {
        metricKind: z.string().min(1).max(120),
      },
    }, input => dataService.getTrainingMetric(auth.uid, input.metricKind as string));
  }

  if (auth.scopes.includes(MCP_OAUTH_SCOPES.SleepRead)) {
    registerReadOnlyTool(server, 'list_sleep_sessions', {
      title: 'List sleep sessions',
      description: 'List redacted normalized sleep-session summaries. Raw samples and provider payloads are never returned.',
      inputSchema: {
        start: z.string().min(1).max(64),
        end: z.string().min(1).max(64),
        includeNaps: z.boolean().default(false),
        provider: z.enum(Object.values(SLEEP_PROVIDERS) as [string, ...string[]]).optional(),
        cursor: z.string().max(512).optional(),
        limit: z.number().int().min(1).max(100).default(25),
      },
    }, input => dataService.listSleepSessions({
      uid: auth.uid,
      startTimeMs: parseDateTime(input.start as string, 'start'),
      endTimeMs: parseDateTime(input.end as string, 'end'),
      includeNaps: input.includeNaps as boolean | undefined,
      provider: input.provider as typeof SLEEP_PROVIDERS[keyof typeof SLEEP_PROVIDERS] | undefined,
      cursor: input.cursor as string | undefined,
      limit: input.limit as number | undefined,
    }));

    registerReadOnlyTool(server, 'query_sleep_summary', {
      title: 'Query sleep summary',
      description: 'Aggregate redacted sleep sessions by local day, week, or month.',
      inputSchema: {
        start: z.string().min(1).max(64),
        end: z.string().min(1).max(64),
        includeNaps: z.boolean().default(false),
        provider: z.enum(Object.values(SLEEP_PROVIDERS) as [string, ...string[]]).optional(),
        groupBy: z.enum(['day', 'week', 'month']).default('day'),
        timeZone: z.string().min(1).max(80),
      },
    }, input => dataService.querySleepSummary({
      uid: auth.uid,
      startTimeMs: parseDateTime(input.start as string, 'start'),
      endTimeMs: parseDateTime(input.end as string, 'end'),
      includeNaps: input.includeNaps as boolean | undefined,
      provider: input.provider as typeof SLEEP_PROVIDERS[keyof typeof SLEEP_PROVIDERS] | undefined,
      groupBy: input.groupBy as 'day' | 'week' | 'month',
      timeZone: input.timeZone as string,
    }));
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
  if (['list_metrics', 'query_metric', 'get_training_metric'].includes(toolName)) {
    return MCP_OAUTH_SCOPES.MetricsRead;
  }
  return null;
}

export function supportsMcpTransportMethod(method: string): boolean {
  return method === 'POST';
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
      );
      response.redirect(302, started.consentUrl);
    } catch (error) {
      sendOAuthError(response, error);
    }
    return;
  }

  if (request.method === 'POST' && path === '/oauth/token') {
    noStore(response);
    try {
      const params = parseFormBody(request);
      const grantType = `${params.grant_type || ''}`;
      const result = grantType === 'authorization_code'
        ? await getOAuthService().exchangeAuthorizationCode(params, baseUrl)
        : grantType === 'refresh_token'
          ? await getOAuthService().exchangeRefreshToken(params, baseUrl)
          : (() => {
            throw new McpOAuthError('invalid_request', 'Unsupported grant_type.');
          })();
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
  const authorization = `${request.get('authorization') || ''}`;
  if (!authorization.startsWith('Bearer ')) {
    response.set(
      'WWW-Authenticate',
      `Bearer resource_metadata="${metadataUrl}", scope="${Object.values(MCP_OAUTH_SCOPES).join(' ')}"`,
    );
    response.status(401).json({ error: 'unauthorized' });
    return;
  }

  let auth: AuthenticatedMcpRequest;
  try {
    auth = await getOAuthService().authenticateBearer(authorization.slice('Bearer '.length), resource);
  } catch (error) {
    const oauthError = error instanceof McpOAuthError ? error : null;
    response.set(
      'WWW-Authenticate',
      `Bearer error="invalid_token", resource_metadata="${metadataUrl}"`,
    );
    response.status(oauthError?.statusCode === 429 ? 429 : 401).json({
      error: oauthError?.statusCode === 429 ? 'temporarily_unavailable' : 'invalid_token',
    });
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

  const server = createServer(auth);
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
