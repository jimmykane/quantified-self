import { AddressInfo } from 'node:net';
import { createServer as createHttpServer } from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { MCP_OAUTH_SCOPES } from './oauth.service';
import { requiredScopeForRequest, supportsMcpTransportMethod } from './server';

describe('MCP HTTP scope enforcement', () => {
  it('requires metrics scope for metrics tools', () => {
    expect(requiredScopeForRequest({
      method: 'tools/call',
      params: { name: 'query_metric' },
    })).toBe(MCP_OAUTH_SCOPES.MetricsRead);
  });

  it('requires sleep scope for sleep tools', () => {
    expect(requiredScopeForRequest({
      method: 'tools/call',
      params: { name: 'list_sleep_sessions' },
    })).toBe(MCP_OAUTH_SCOPES.SleepRead);
  });

  it('does not assign a scope to protocol messages or unknown tools', () => {
    expect(requiredScopeForRequest({ method: 'initialize' })).toBeNull();
    expect(requiredScopeForRequest({
      method: 'tools/call',
      params: { name: 'unknown' },
    })).toBeNull();
  });

  it('keeps the stateless JSON transport on bounded POST requests', () => {
    expect(supportsMcpTransportMethod('POST')).toBe(true);
    expect(supportsMcpTransportMethod('GET')).toBe(false);
    expect(supportsMcpTransportMethod('DELETE')).toBe(false);
  });

  it('handles an initialize request through the pinned stateless HTTP adapter', async () => {
    const httpServer = createHttpServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on('data', chunk => chunks.push(Buffer.from(chunk)));
      request.on('end', async () => {
        const server = new McpServer({ name: 'adapter-test', version: '1.0.0' });
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: undefined,
          enableJsonResponse: true,
        });
        try {
          await server.connect(transport);
          const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          await transport.handleRequest(request, response, body);
        } finally {
          await transport.close();
          await server.close();
        }
      });
    });
    await new Promise<void>(resolve => httpServer.listen(0, '127.0.0.1', resolve));

    try {
      const address = httpServer.address() as AddressInfo;
      const response = await fetch(`http://127.0.0.1:${address.port}`, {
        method: 'POST',
        headers: {
          accept: 'application/json, text/event-stream',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2025-11-25',
            capabilities: {},
            clientInfo: {
              name: 'adapter-test-client',
              version: '1.0.0',
            },
          },
        }),
      });
      const body = await response.json() as Record<string, unknown>;

      expect(response.status).toBe(200);
      expect(body).toEqual(expect.objectContaining({
        jsonrpc: '2.0',
        id: 1,
        result: expect.objectContaining({
          serverInfo: {
            name: 'adapter-test',
            version: '1.0.0',
          },
        }),
      }));
    } finally {
      await new Promise<void>((resolve, reject) => httpServer.close(error => error ? reject(error) : resolve()));
    }
  });
});
