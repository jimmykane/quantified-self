import { AddressInfo } from 'node:net';
import { createServer as createHttpServer } from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { McpDataError } from './data.service';
import {
  McpOAuthError,
  MCP_OAUTH_SCOPES,
} from './oauth.service';
import {
  classifyMcpBearerFailure,
  createMcpServer,
  formatMcpToolError,
  isMcpRequestBodyWithinLimit,
  parseMcpBearerToken,
  parseMcpDateTime,
  requiredScopeForRequest,
  resolvePublicBaseUrl,
  requireMcpTokenGrantType,
  supportsMcpTransportMethod,
} from './server';

describe('MCP HTTP scope enforcement', () => {
  it('uses only canonical allowlisted origins for OAuth issuer and audience URLs', () => {
    const requestWithHost = (host: string) => ({
      get: (name: string) => name.toLowerCase() === 'x-forwarded-host' ? host : undefined,
    }) as unknown as Parameters<typeof resolvePublicBaseUrl>[0];

    expect(resolvePublicBaseUrl(requestWithHost('beta.quantified-self.io')))
      .toBe('https://beta.quantified-self.io');
    expect(resolvePublicBaseUrl(requestWithHost('quantified-self.io:444')))
      .toBe('https://quantified-self.io');
    expect(resolvePublicBaseUrl(requestWithHost('attacker.example')))
      .toBe('https://quantified-self.io');
  });

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

  it('registers only the tools granted by the bearer scopes', async () => {
    const listToolNames = async (scopes: Array<typeof MCP_OAUTH_SCOPES[keyof typeof MCP_OAUTH_SCOPES]>) => {
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      const server = createMcpServer({
        uid: 'user-1',
        clientId: 'https://client.example/mcp.json',
        connectionId: 'connection-1',
        scopes,
      });
      const client = new Client({
        name: 'scope-test-client',
        version: '1.0.0',
      });
      try {
        await server.connect(serverTransport);
        await client.connect(clientTransport);
        return (await client.listTools()).tools.map(tool => tool.name).sort();
      } finally {
        await client.close();
        await server.close();
      }
    };

    await expect(listToolNames([MCP_OAUTH_SCOPES.MetricsRead])).resolves.toEqual([
      'get_training_metric',
      'list_metrics',
      'query_metric',
    ]);
    await expect(listToolNames([MCP_OAUTH_SCOPES.SleepRead])).resolves.toEqual([
      'list_sleep_sessions',
      'query_sleep_summary',
    ]);
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
    expect(isMcpRequestBodyWithinLimit({ method: 'initialize' }, '24')).toBe(true);
    expect(isMcpRequestBodyWithinLimit({ payload: 'x'.repeat(70_000) }, undefined)).toBe(false);
    expect(isMcpRequestBodyWithinLimit({}, 'not-a-number')).toBe(false);
  });

  it('requires unambiguous ISO date-times with a UTC offset', () => {
    expect(parseMcpDateTime('2024-01-01T00:00:00Z', 'start'))
      .toBe(Date.parse('2024-01-01T00:00:00Z'));
    expect(parseMcpDateTime('2024-01-01T02:00:00+02:00', 'start'))
      .toBe(Date.parse('2024-01-01T00:00:00Z'));
    expect(() => parseMcpDateTime('01/02/2024', 'start')).toThrow(McpDataError);
    expect(() => parseMcpDateTime('2024-01-01', 'start')).toThrow(McpDataError);
  });

  it('does not disclose unexpected backend error messages through tool results', () => {
    expect(formatMcpToolError(new Error('users/private-user/secret-path'))).toEqual({
      isError: true,
      content: [{
        type: 'text',
        text: JSON.stringify({
          error: 'internal_error',
          message: 'The MCP tool could not complete the request.',
        }),
      }],
    });
    expect(formatMcpToolError(new McpDataError('invalid_metric', 'Unknown metric.')))
      .toEqual(expect.objectContaining({
        content: [{
          type: 'text',
          text: JSON.stringify({
            error: 'invalid_metric',
            message: 'Unknown metric.',
          }),
        }],
      }));
  });

  it('distinguishes invalid tokens, rate limits, and backend authentication failures', () => {
    expect(classifyMcpBearerFailure(
      new McpOAuthError('invalid_grant', 'expired', 401),
    )).toEqual({
      statusCode: 401,
      error: 'invalid_token',
      challengeError: 'invalid_token',
    });
    expect(classifyMcpBearerFailure(
      new McpOAuthError('temporarily_unavailable', 'limited', 429),
    )).toEqual({
      statusCode: 429,
      error: 'temporarily_unavailable',
      retryAfterSeconds: 60,
    });
    expect(classifyMcpBearerFailure(new Error('firestore unavailable'))).toEqual({
      statusCode: 503,
      error: 'temporarily_unavailable',
    });
  });

  it('reports unsupported OAuth token grants with the standard error code', () => {
    expect(requireMcpTokenGrantType('authorization_code')).toBe('authorization_code');
    expect(requireMcpTokenGrantType('refresh_token')).toBe('refresh_token');
    expect(() => requireMcpTokenGrantType('client_credentials')).toThrow(
      expect.objectContaining({ code: 'unsupported_grant_type' }),
    );
  });

  it('parses the case-insensitive Bearer authorization scheme strictly', () => {
    expect(parseMcpBearerToken('Bearer token-value')).toBe('token-value');
    expect(parseMcpBearerToken('bearer token-value')).toBe('token-value');
    expect(parseMcpBearerToken('BEARER   token-value')).toBe('token-value');
    expect(parseMcpBearerToken('Basic token-value')).toBeNull();
    expect(parseMcpBearerToken('Bearer token value')).toBeNull();
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
