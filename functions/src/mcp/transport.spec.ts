import { describe, expect, it, vi } from 'vitest';
import { CLIENT_CAPABILITIES_META_KEY, CLIENT_INFO_META_KEY, McpServer,
  ProtocolError, ProtocolErrorCode, PROTOCOL_VERSION_META_KEY } from '@modelcontextprotocol/server';
import { createMcpTransportHandler, observeMcpBadRequest } from './transport';

describe('MCP bad-request diagnostics', () => {
  it.each([
    [ProtocolErrorCode.ParseError, 'invalid_json'],
    [ProtocolErrorCode.InvalidRequest, 'invalid_json_rpc'],
    [ProtocolErrorCode.InvalidParams, 'invalid_params'],
    [ProtocolErrorCode.MissingRequiredClientCapability, 'missing_client_capability'],
    [ProtocolErrorCode.UnsupportedProtocolVersion, 'unsupported_protocol_version'],
    [-123456, 'unclassified_bad_request'],
    ['private-code', 'unclassified_bad_request'],
  ])('logs only the allowlisted reason for code %s', async (code, reason) => {
    const body = { jsonrpc: '2.0', id: 'private-request-id', error: {
      code, message: 'private payload, token and URL', data: { uid: 'private-user', arguments: 'private-health-data' },
    } };
    const response = Response.json(body, { status: 400, headers: { 'x-test': 'unchanged' } });
    const observe = vi.fn();
    expect(await observeMcpBadRequest(response, observe)).toBe(response);
    expect(observe).toHaveBeenCalledExactlyOnceWith({ reason,
      rpcErrorCode: reason === 'unclassified_bad_request' ? null : code });
    expect(response.headers.get('x-test')).toBe('unchanged');
    expect(await response.json()).toEqual(body);
    expect(JSON.stringify(observe.mock.calls)).not.toMatch(/private|payload|token|URL/);
  });

  it('preserves a non-JSON 400 and tolerates failed logging', async () => {
    const response = new Response('private response', { status: 400 });
    const observe = vi.fn(() => { throw new Error('logger unavailable'); });
    expect(await observeMcpBadRequest(response, observe)).toBe(response);
    expect(observe).toHaveBeenCalledExactlyOnceWith({ reason: 'unclassified_bad_request', rpcErrorCode: null });
    expect(await response.text()).toBe('private response');
  });

  it.each([200, 202, 401, 403, 405, 500])('does not inspect or log HTTP %s', async status => {
    const response = new Response('private response', { status });
    const clone = vi.spyOn(response, 'clone');
    const observe = vi.fn();
    expect(await observeMcpBadRequest(response, observe)).toBe(response);
    expect(clone).not.toHaveBeenCalled();
    expect(observe).not.toHaveBeenCalled();
  });

  it('observes an SDK 400 even when its error callback is silent', async () => {
    const onerror = vi.fn();
    const observe = vi.fn();
    const handler = createMcpTransportHandler(() => {
      const server = new McpServer({ name: 'diagnostic-test', version: '1' });
      server.server.registerCapabilities({ tools: {} });
      server.server.setRequestHandler('tools/list', () => {
        throw new ProtocolError(ProtocolErrorCode.MissingRequiredClientCapability, 'private error data');
      });
      return server;
    }, onerror, observe);
    try {
      const response = await handler.fetch(new Request('https://example.test/mcp', {
        method: 'POST', headers: { 'content-type': 'application/json',
          accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2026-07-28', 'mcp-method': 'tools/list' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 'private-request', method: 'tools/list',
          params: { _meta: { [PROTOCOL_VERSION_META_KEY]: '2026-07-28',
            [CLIENT_CAPABILITIES_META_KEY]: {}, [CLIENT_INFO_META_KEY]: { name: 'diagnostic-test', version: '1' } } } }),
      }));
      expect(response.status).toBe(400);
      expect(onerror).not.toHaveBeenCalled();
      expect(observe).toHaveBeenCalledExactlyOnceWith({ reason: 'missing_client_capability',
        rpcErrorCode: ProtocolErrorCode.MissingRequiredClientCapability });
      expect((await response.json()).error.code).toBe(ProtocolErrorCode.MissingRequiredClientCapability);
    } finally { await handler.close(); }
  });
});
