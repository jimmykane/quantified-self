import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Request } from 'firebase-functions/v2/https';
import {
  CLIENT_CAPABILITIES_META_KEY,
  CLIENT_INFO_META_KEY,
  DEFAULT_NEGOTIATED_PROTOCOL_VERSION,
  PROTOCOL_VERSION_META_KEY,
} from '@modelcontextprotocol/server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { MCP_OAUTH_SCOPES, McpOAuthError } from './oauth.service';
import { mcpApi } from './server';

const { authenticateBearer, warn, logError, info } = vi.hoisted(() => ({
  authenticateBearer: vi.fn(),
  warn: vi.fn(),
  logError: vi.fn(),
  info: vi.fn(),
}));
vi.mock('./oauth.service', async importOriginal => ({
  ...await importOriginal<typeof import('./oauth.service')>(),
  createMcpOAuthService: () => ({ authenticateBearer }),
}));
vi.mock('firebase-functions/logger', () => ({ warn, error: logError, info }));

const VERSION = '2026-07-28';
function modernRequest(method = 'server/discover', args: Record<string, unknown> = {}) {
  return {
    jsonrpc: '2.0', id: 1, method,
    params: {
      ...args,
      _meta: {
        [PROTOCOL_VERSION_META_KEY]: VERSION,
        [CLIENT_INFO_META_KEY]: { name: 'protocol-test', version: '1.0.0' },
        [CLIENT_CAPABILITIES_META_KEY]: {},
      },
    },
  };
}

// Exercise the real Function boundary and Node adapter, including Firebase's
// already-consumed body. Only OAuth persistence is replaced with a fixture.
describe('MCP Function protocol compatibility', () => {
  const httpServer = createServer(async (incoming, outgoing) => {
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of incoming) chunks.push(Buffer.from(chunk));
      const raw = Buffer.concat(chunks).toString('utf8');
      let body: unknown = raw;
      try { body = JSON.parse(raw); } catch { /* Preserve malformed JSON. */ }
      const request = Object.assign(incoming, {
        body,
        get(name: string) { return incoming.headers[name.toLowerCase()]; },
      }) as Request;
      const response = Object.assign(outgoing, {
        set(name: string, value: string) { outgoing.setHeader(name, value); return response; },
        status(code: number) { outgoing.statusCode = code; return response; },
        json(value: unknown) {
          outgoing.setHeader('content-type', 'application/json');
          outgoing.end(JSON.stringify(value));
          return response;
        },
      });
      await mcpApi(request, response as Parameters<typeof mcpApi>[1]);
    } catch {
      outgoing.statusCode = 500;
      outgoing.end('Harness failure');
    }
  });
  let url: string;
  beforeAll(async () => {
    await new Promise<void>(resolve => httpServer.listen(0, '127.0.0.1', resolve));
    url = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}/mcp`;
  });
  afterAll(async () => {
    await new Promise<void>((resolve, reject) => httpServer.close(error => error ? reject(error) : resolve()));
  });
  beforeEach(() => {
    vi.clearAllMocks();
    authenticateBearer.mockResolvedValue({
      uid: 'protocol-user', clientId: 'https://client.example/client.json',
      connectionId: 'protocol-connection', scopes: Object.values(MCP_OAUTH_SCOPES),
    });
  });
  function post(body: unknown, headers: Record<string, string | null> = {}) {
    const record = body as { method?: string; params?: { name?: string } };
    const requestHeaders = new Headers({
      authorization: 'Bearer fixture-token',
      'user-agent': 'Claude-User',
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'mcp-protocol-version': VERSION,
      'mcp-method': record.method ?? '',
      ...(record.params?.name ? { 'mcp-name': record.params.name } : {}),
    });
    for (const [name, value] of Object.entries(headers)) {
      if (value === null) requestHeaders.delete(name);
      else requestHeaders.set(name, value);
    }
    return fetch(url, {
      method: 'POST',
      headers: requestHeaders,
      body: JSON.stringify(body),
    });
  }

  it('serves discovery and stateless tool calls for 2026 without initialize or warnings', async () => {
    const discovery = await post(modernRequest());
    expect(discovery.status).toBe(200);
    expect(discovery.headers.get('content-type')).toContain('application/json');
    expect(discovery.headers.get('mcp-session-id')).toBeNull();
    expect(discovery.headers.get('cache-control')).toBe('no-store');
    expect(await discovery.json()).toMatchObject({ id: 1, result: {
      supportedVersions: [VERSION], resultType: 'complete', ttlMs: 0, cacheScope: 'private',
      capabilities: { tools: { listChanged: false } },
      _meta: { 'io.modelcontextprotocol/serverInfo': { name: 'quantified-self' } },
    } });
    const tools = await post(modernRequest('tools/list'));
    const listing = await tools.json() as { result: { tools: Array<{ name: string; execution?: unknown }> } };
    expect(listing.result.tools).toHaveLength(34);
    expect(listing.result.tools.every(tool => tool.execution === undefined)).toBe(true);
    const call = await post(modernRequest('tools/call', { name: 'list_activity_types', arguments: {} }));
    expect(call.status).toBe(200);
    expect(call.headers.get('cache-control')).toBe('no-store');
    expect(await call.json()).toMatchObject({ result: { structuredContent: { activityTypes: expect.any(Array) } } });
    expect(authenticateBearer).toHaveBeenCalledTimes(3);
    expect(warn).not.toHaveBeenCalled();
    expect(logError).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledTimes(3);
    expect(info).toHaveBeenCalledWith('[MCP] Streamable HTTP request served', {
      clientFamily: 'claude', protocolVersion: VERSION, protocolVersionSource: 'sdk',
    });
    expect(JSON.stringify(info.mock.calls)).not.toMatch(/fixture-token|protocol-user|protocol-connection|protocol-test/);
  });

  it.each(['2024-11-05', '2025-03-26', '2025-06-18', '2025-11-25'])('keeps %s legacy initialize and JSON calls working', async version => {
    const initialization = await post({
      jsonrpc: '2.0', id: 2, method: 'initialize',
      params: { protocolVersion: version, clientInfo: { name: 'legacy', version: '1' }, capabilities: {} },
    }, { 'mcp-protocol-version': version });
    expect(initialization.status).toBe(200);
    expect(initialization.headers.get('content-type')).toContain('application/json');
    expect(await initialization.json()).toMatchObject({ result: { protocolVersion: version } });
    const call = await post({
      jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'list_activity_types', arguments: {} },
    }, { 'mcp-protocol-version': version });
    expect(call.status).toBe(200);
    expect(await call.json()).toHaveProperty('result.structuredContent');
    expect(warn).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledTimes(2);
    expect(info).toHaveBeenNthCalledWith(1, '[MCP] Streamable HTTP request served', {
      clientFamily: 'claude', protocolVersion: version, protocolVersionSource: 'sdk',
    });
    expect(info).toHaveBeenNthCalledWith(2, '[MCP] Streamable HTTP request served', {
      clientFamily: 'claude', protocolVersion: version, protocolVersionSource: 'request_header',
    });
  });

  it('logs the actual legacy initialize result when the requested version is unsupported', async () => {
    const response = await post({
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '2099-01-01', clientInfo: { name: 'legacy', version: '1' }, capabilities: {} },
    }, { 'mcp-protocol-version': null });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ result: { protocolVersion: '2025-11-25' } });
    expect(info).toHaveBeenCalledExactlyOnceWith('[MCP] Streamable HTTP request served', {
      clientFamily: 'claude', protocolVersion: '2025-11-25', protocolVersionSource: 'sdk',
    });
  });

  it('logs modern envelope negotiation without copying client-controlled metadata', async () => {
    const body = modernRequest('server/discover', { privatePayload: 'private-payload-canary' });
    body.params._meta[CLIENT_INFO_META_KEY].name = 'private-client-canary';
    const response = await post(body, {
      'mcp-protocol-version': null, 'user-agent': 'private-agent-canary',
    });
    expect(response.status).toBe(200);
    expect(info).toHaveBeenCalledExactlyOnceWith('[MCP] Streamable HTTP request served', {
      clientFamily: 'other', protocolVersion: VERSION, protocolVersionSource: 'sdk',
    });
    expect(JSON.stringify(info.mock.calls)).not.toContain('canary');
  });

  it('labels the legacy default explicitly when a stateless call omits the version header', async () => {
    const response = await post({
      jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'list_activity_types', arguments: {} },
    }, { 'mcp-protocol-version': null });
    expect(response.status).toBe(200);
    expect(info).toHaveBeenCalledExactlyOnceWith('[MCP] Streamable HTTP request served', {
      clientFamily: 'claude', protocolVersion: DEFAULT_NEGOTIATED_PROTOCOL_VERSION,
      protocolVersionSource: 'legacy_default',
    });
  });

  it('does not claim a successful protocol negotiation for an invalid initialize', async () => {
    const response = await post({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }, {
      'mcp-protocol-version': '2025-11-25',
    });
    expect(await response.json()).toHaveProperty('error');
    expect(info).not.toHaveBeenCalled();
  });

  it.each(['server/discover', 'tools/list', 'tools/call'])('authenticates modern %s before transport work', async method => {
    const response = await post(modernRequest(method), { authorization: '' });
    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toContain('resource_metadata=');
    expect(authenticateBearer).not.toHaveBeenCalled();
    expect(info).not.toHaveBeenCalled();
  });

  it('preserves revoked-token, rate-limit, and scope rejection responses', async () => {
    authenticateBearer.mockRejectedValueOnce(new McpOAuthError('invalid_grant', 'revoked', 401));
    expect((await post(modernRequest())).status).toBe(401);
    authenticateBearer.mockRejectedValueOnce(new McpOAuthError('temporarily_unavailable', 'limited', 429));
    const limited = await post(modernRequest());
    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).toBe('60');
    authenticateBearer.mockResolvedValueOnce({ scopes: [MCP_OAUTH_SCOPES.ActivityDetailsRead] });
    const denied = await post(modernRequest('tools/call', {
      name: 'get_activity_chart_data', arguments: { includeLocation: true },
    }));
    expect(denied.status).toBe(403);
    expect(denied.headers.get('www-authenticate')).toContain('activity-location:read');
    expect(info).not.toHaveBeenCalled();
  });

  it('rejects ungranted Health and body-composition reads before transport dispatch', async () => {
    authenticateBearer.mockResolvedValueOnce({ scopes: [MCP_OAUTH_SCOPES.MetricsRead] });
    const healthDenied = await post(modernRequest('tools/call', { name: 'list_health_metrics', arguments: {} }));
    expect(healthDenied.status).toBe(403);
    expect(healthDenied.headers.get('www-authenticate')).toContain('health:read');
    authenticateBearer.mockResolvedValueOnce({ scopes: [MCP_OAUTH_SCOPES.HealthRead] });
    const measurementsDenied = await post(modernRequest('tools/call', {
      name: 'query_health_metric', arguments: { metricId: 'body_fat', startDate: '2026-09-01', endDate: '2026-09-02' },
    }));
    expect(measurementsDenied.status).toBe(403);
    expect(measurementsDenied.headers.get('www-authenticate')).toContain('measurements:read');
    expect(info).not.toHaveBeenCalled();
  });

  it('rejects unknown revisions without downgrading and logs only the sanitized version', async () => {
    const body = modernRequest();
    body.params._meta[PROTOCOL_VERSION_META_KEY] = '2099-01-01';
    const response = await post(body, { 'mcp-protocol-version': '2099-01-01' });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: -32022 } });
    expect(warn).toHaveBeenCalledWith('[MCP] Streamable HTTP request rejected', {
      reason: 'unsupported_protocol_version', clientFamily: 'claude', protocolVersion: '2099-01-01',
    });
    expect(JSON.stringify(warn.mock.calls)).not.toMatch(/fixture-token|protocol-user|protocol-connection/);
    expect(info).not.toHaveBeenCalled();
  });

  it('rejects missing envelopes and mismatched protocol or method headers', async () => {
    const missing = await post({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} });
    expect(missing.status).toBe(400);
    const mismatches: Array<Record<string, string>> = [
      { 'mcp-protocol-version': '2025-11-25' }, { 'mcp-method': 'tools/list' },
    ];
    for (const headers of mismatches) {
      const response = await post(modernRequest(), headers);
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ error: { code: -32020 } });
    }
    expect(warn).toHaveBeenCalledWith('[MCP] Streamable HTTP request rejected', {
      reason: 'invalid_protocol_envelope', clientFamily: 'claude',
    });
    expect(logError).not.toHaveBeenCalled();
    expect(info).not.toHaveBeenCalled();
  });

  it('logs safe rejected envelope versions when the optional protocol header is absent', async () => {
    const body = modernRequest();
    body.params._meta[PROTOCOL_VERSION_META_KEY] = '2099-01-01';
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        authorization: 'Bearer fixture-token', 'user-agent': 'Claude-User',
        accept: 'application/json, text/event-stream', 'content-type': 'application/json',
        'mcp-method': 'server/discover',
      },
      body: JSON.stringify(body),
    });
    expect(response.status).toBe(400);
    expect(warn).toHaveBeenCalledWith('[MCP] Streamable HTTP request rejected', {
      reason: 'unsupported_protocol_version', clientFamily: 'claude', protocolVersion: '2099-01-01',
    });
  });

  it('keeps request-size, content-type, and session-method limits', async () => {
    expect((await post(modernRequest('tools/list', { padding: 'x'.repeat(65 * 1024) }))).status).toBe(413);
    expect((await post(modernRequest(), { 'content-type': 'text/plain' })).status).toBe(415);
    for (const method of ['GET', 'DELETE']) {
      const response = await fetch(url, { method, headers: { authorization: 'Bearer fixture-token' } });
      expect(response.status).toBe(405);
      expect(response.headers.get('allow')).toBe('POST');
    }
    const subscription = await post(modernRequest('subscriptions/listen', { notifications: { toolsListChanged: true } }));
    expect(subscription.headers.get('content-type')).not.toContain('text/event-stream');
    expect(await subscription.json()).toMatchObject({ error: { message: 'Subscription limit reached' } });
  });

  it.each([
    { label: 'invalid message', body: { jsonrpc: '1.0', method: 'tools/list', id: 1 } },
    { label: 'empty batch', body: [] },
    { label: 'invalid batch member', body: [null] },
    { label: 'modern batch member', body: [modernRequest()] },
  ])('distinguishes $label from protocol-envelope failures', async ({ body }) => {
    const response = await post(body, { 'mcp-protocol-version': '2025-11-25' });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: -32600 } });
    expect(logError).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith('[MCP] Streamable HTTP request rejected', {
      reason: 'invalid_json_rpc', clientFamily: 'claude',
    });
  });

  it('keeps Zod input refinements on modern calls and hides tools without their grants', async () => {
    const invalid = await post(modernRequest('tools/call', {
      name: 'query_activities', arguments: { relativePeriod: 'today' },
    }));
    expect(await invalid.json()).toMatchObject({ result: { isError: true } });
    authenticateBearer.mockResolvedValueOnce({
      uid: 'protocol-user', clientId: 'https://client.example/client.json',
      connectionId: 'protocol-connection', scopes: [],
    });
    const response = await post(modernRequest('tools/list'));
    const body = await response.json() as { result: { tools: Array<{ name: string }> } };
    expect(body.result.tools.map(tool => tool.name)).toEqual(['list_activity_types']);
  });
});
