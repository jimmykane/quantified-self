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
  rejectRepeatedOAuthParameters,
} from './oauth.service';
import {
  buildMcpAuthorizationServerMetadata,
  buildMcpProtectedResourceMetadata,
  classifyMcpBearerFailure,
  createMcpServer,
  formatMcpToolError,
  handleMcpRevocationRequest,
  isMcpFormUrlEncodedContentType,
  isMcpRequestBodyWithinLimit,
  parseMcpBearerToken,
  parseMcpDateTime,
  parseMcpFormEncodedBody,
  requiredScopesForRequest,
  resolveMcpAuthorizationRequesterKey,
  resolvePublicBaseUrl,
  requireMcpTokenGrantType,
  supportsMcpTransportMethod,
} from './server';

describe('MCP HTTP scope enforcement', () => {
  function buildRevocationHttpHarness(input?: {
    body?: unknown;
    contentType?: string;
    contentLength?: string;
    forwardedFor?: string;
  }) {
    const headers = new Map<string, string>();
    const json = vi.fn();
    const send = vi.fn();
    let statusCode: number | null = null;
    const response = {
      set: vi.fn((name: string, value: string) => {
        headers.set(name, value);
      }),
      status: vi.fn((value: number) => {
        statusCode = value;
        return { json, send };
      }),
    };
    const request = {
      body: input?.body ?? '',
      ip: '198.51.100.20',
      get: (name: string) => {
        const normalized = name.toLowerCase();
        if (normalized === 'content-type') {
          return input?.contentType ?? 'application/x-www-form-urlencoded';
        }
        if (normalized === 'content-length') {
          return input?.contentLength;
        }
        if (normalized === 'x-forwarded-for') {
          return input?.forwardedFor;
        }
        return undefined;
      },
    } as Parameters<typeof handleMcpRevocationRequest>[0];
    return {
      request,
      response: response as Parameters<typeof handleMcpRevocationRequest>[1],
      headers,
      json,
      send,
      statusCode: () => statusCode,
    };
  }

  it('advertises RFC 7009 revocation for public CIMD clients', () => {
    expect(buildMcpAuthorizationServerMetadata('https://quantified-self.io'))
      .toEqual(expect.objectContaining({
        issuer: 'https://quantified-self.io',
        token_endpoint: 'https://quantified-self.io/oauth/token',
        revocation_endpoint: 'https://quantified-self.io/oauth/revoke',
        token_endpoint_auth_methods_supported: ['none'],
        revocation_endpoint_auth_methods_supported: ['none'],
      }));
  });

  it('builds protected-resource metadata from the same public origin', () => {
    expect(buildMcpProtectedResourceMetadata('https://quantified-self.io'))
      .toEqual({
        resource: 'https://quantified-self.io/mcp',
        resource_name: 'Quantified Self MCP',
        authorization_servers: ['https://quantified-self.io'],
        scopes_supported: Object.values(MCP_OAUTH_SCOPES),
        bearer_methods_supported: ['header'],
      });
  });

  it('accepts a form-encoded server-to-server revocation request with an empty 200 response', async () => {
    const clientId = 'https://client.example/mcp.json';
    const harness = buildRevocationHttpHarness({
      body: new URLSearchParams({
        token: 'opaque-token',
        token_type_hint: 'refresh_token',
        client_id: clientId,
      }).toString(),
      forwardedFor: '203.0.113.10, 10.0.0.1',
    });
    const revokeToken = vi.fn().mockResolvedValue(undefined);

    await handleMcpRevocationRequest(
      harness.request,
      harness.response,
      { revokeToken },
    );

    expect(revokeToken).toHaveBeenCalledWith({
      token: 'opaque-token',
      token_type_hint: 'refresh_token',
      client_id: clientId,
    }, {
      requesterKey: '203.0.113.10',
    });
    expect(harness.statusCode()).toBe(200);
    expect(harness.send).toHaveBeenCalledWith('');
    expect(harness.json).not.toHaveBeenCalled();
    expect(harness.headers.get('Cache-Control')).toBe('no-store');
    expect(harness.headers.get('Pragma')).toBe('no-cache');
  });

  it('maps pre-auth revocation throttling to a bounded OAuth error response', async () => {
    const harness = buildRevocationHttpHarness({
      body: 'token=opaque-token&client_id=https%3A%2F%2Fclient.example%2Fmcp.json',
    });
    const revokeToken = vi.fn().mockRejectedValue(new McpOAuthError(
      'temporarily_unavailable',
      'The token revocation rate limit was exceeded.',
      429,
    ));

    await handleMcpRevocationRequest(
      harness.request,
      harness.response,
      { revokeToken },
    );

    expect(harness.statusCode()).toBe(429);
    expect(harness.headers.get('Retry-After')).toBe('60');
    expect(harness.json).toHaveBeenCalledWith({
      error: 'temporarily_unavailable',
      error_description: 'The token revocation rate limit was exceeded.',
    });
    expect(harness.send).not.toHaveBeenCalled();
  });

  it('rejects non-form revocation bodies before calling the OAuth service', async () => {
    const harness = buildRevocationHttpHarness({
      body: { token: 'opaque-token' },
      contentType: 'application/json',
    });
    const revokeToken = vi.fn();

    await handleMcpRevocationRequest(
      harness.request,
      harness.response,
      { revokeToken },
    );

    expect(harness.statusCode()).toBe(400);
    expect(harness.json).toHaveBeenCalledWith({
      error: 'invalid_request',
      error_description: 'The revocation request must use application/x-www-form-urlencoded.',
    });
    expect(revokeToken).not.toHaveBeenCalled();
  });

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

  it('uses the Cloud Functions client address for public authorization rate limits', () => {
    const request = (
      forwardedFor: string | undefined,
      ip?: string,
    ) => ({
      get: (name: string) => name.toLowerCase() === 'x-forwarded-for'
        ? forwardedFor
        : undefined,
      ip,
    });

    expect(resolveMcpAuthorizationRequesterKey(
      request('203.0.113.10, 10.0.0.1', '10.0.0.2'),
    )).toBe('203.0.113.10');
    expect(resolveMcpAuthorizationRequesterKey(
      request('not-an-ip', '2001:db8::10'),
    )).toBe('2001:db8::10');
    expect(resolveMcpAuthorizationRequesterKey(
      request(undefined, undefined),
    )).toBe('unknown');
  });

  it('requires independent metrics and measurement scopes', () => {
    expect(requiredScopesForRequest({
      method: 'tools/call',
      params: { name: 'query_metric' },
    })).toEqual([MCP_OAUTH_SCOPES.MetricsRead]);
    expect(requiredScopesForRequest({
      method: 'tools/call',
      params: { name: 'query_measurements' },
    })).toEqual([MCP_OAUTH_SCOPES.MeasurementsRead]);
    expect(requiredScopesForRequest({
      method: 'tools/call',
      params: { name: 'list_measurement_types' },
    })).toEqual([MCP_OAUTH_SCOPES.MeasurementsRead]);
  });

  it('requires sleep scope for sleep tools', () => {
    expect(requiredScopesForRequest({
      method: 'tools/call',
      params: { name: 'list_sleep_sessions' },
    })).toEqual([MCP_OAUTH_SCOPES.SleepRead]);
  });

  it('requires both metrics and sleep scopes for the daily briefing', () => {
    expect(requiredScopesForRequest({
      method: 'tools/call',
      params: { name: 'get_daily_briefing' },
    })).toEqual([
      MCP_OAUTH_SCOPES.MetricsRead,
      MCP_OAUTH_SCOPES.SleepRead,
    ]);
  });

  it('advertises the compact Training Summary in daily-briefing metadata', async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createMcpServer({
      uid: 'user-1',
      clientId: 'https://client.example/mcp.json',
      connectionId: 'connection-1',
      scopes: [
        MCP_OAUTH_SCOPES.MetricsRead,
        MCP_OAUTH_SCOPES.SleepRead,
      ],
    }, 'https://quantified-self.io');
    const client = new Client({
      name: 'daily-briefing-metadata-test-client',
      version: '1.0.0',
    });

    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);
      const dailyBriefing = (await client.listTools()).tools
        .find(tool => tool.name === 'get_daily_briefing');

      expect(client.getInstructions()).toContain(
        'current-versus-usual equivalent 28-day Training totals and sport mix',
      );
      expect(dailyBriefing?.description).toContain(
        'current-versus-usual equivalent 28-day Training totals',
      );
      expect(dailyBriefing?.description).toContain('Running/Cycling/Swimming mix');
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('makes the static activity-type catalog available to every authorized client', () => {
    expect(requiredScopesForRequest({
      method: 'tools/call',
      params: { name: 'list_activity_types' },
    })).toEqual([]);
  });

  it('requires separate activity-detail and route scopes for granular tools', () => {
    expect(requiredScopesForRequest({
      method: 'tools/call',
      params: { name: 'list_activity_jumps' },
    })).toEqual([MCP_OAUTH_SCOPES.ActivityDetailsRead]);
    expect(requiredScopesForRequest({
      method: 'tools/call',
      params: { name: 'get_route_geometry' },
    })).toEqual([
      MCP_OAUTH_SCOPES.RoutesRead,
      MCP_OAUTH_SCOPES.RouteLocationRead,
    ]);
    expect(requiredScopesForRequest({
      method: 'tools/call',
      params: { name: 'find_activities_near_location' },
    })).toEqual([
      MCP_OAUTH_SCOPES.ActivityDetailsRead,
      MCP_OAUTH_SCOPES.ActivityLocationRead,
    ]);
    expect(requiredScopesForRequest({
      method: 'tools/call',
      params: { name: 'find_routes_near_location' },
    })).toEqual([
      MCP_OAUTH_SCOPES.RoutesRead,
      MCP_OAUTH_SCOPES.RouteLocationRead,
    ]);
    expect(requiredScopesForRequest({
      method: 'tools/call',
      params: {
        name: 'get_activity_chart_data',
        arguments: { includeLocation: false },
      },
    })).toEqual([MCP_OAUTH_SCOPES.ActivityDetailsRead]);
    expect(requiredScopesForRequest({
      method: 'tools/call',
      params: {
        name: 'get_activity_chart_data',
        arguments: { includeLocation: true },
      },
    })).toEqual([
      MCP_OAUTH_SCOPES.ActivityDetailsRead,
      MCP_OAUTH_SCOPES.ActivityLocationRead,
    ]);
    expect(requiredScopesForRequest({
      method: 'tools/call',
      params: { name: 'get_activity_metrics' },
    })).toEqual([
      MCP_OAUTH_SCOPES.MetricsRead,
      MCP_OAUTH_SCOPES.ActivityDetailsRead,
    ]);
  });

  it('registers only the tools granted by the bearer scopes', async () => {
    const listToolNames = async (scopes: Array<typeof MCP_OAUTH_SCOPES[keyof typeof MCP_OAUTH_SCOPES]>) => {
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      const server = createMcpServer({
        uid: 'user-1',
        clientId: 'https://client.example/mcp.json',
        connectionId: 'connection-1',
        scopes,
      }, 'https://quantified-self.io');
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

    await expect(listToolNames([])).resolves.toEqual([
      'list_activity_types',
    ]);
    await expect(listToolNames([MCP_OAUTH_SCOPES.MetricsRead])).resolves.toEqual([
      'get_training_metric',
      'list_activity_types',
      'list_metrics',
      'query_metric',
    ]);
    await expect(listToolNames([
      MCP_OAUTH_SCOPES.MeasurementsRead,
    ])).resolves.toEqual([
      'list_activity_types',
      'list_measurement_types',
      'query_measurements',
    ]);
    await expect(listToolNames([MCP_OAUTH_SCOPES.SleepRead])).resolves.toEqual([
      'list_activity_types',
      'list_sleep_sessions',
      'query_sleep_summary',
    ]);
    await expect(listToolNames([
      MCP_OAUTH_SCOPES.MetricsRead,
      MCP_OAUTH_SCOPES.SleepRead,
    ])).resolves.toEqual([
      'get_daily_briefing',
      'get_training_metric',
      'list_activity_types',
      'list_metrics',
      'list_sleep_sessions',
      'query_metric',
      'query_sleep_summary',
    ]);
    await expect(listToolNames([MCP_OAUTH_SCOPES.ActivityDetailsRead])).resolves.toEqual([
      'get_activity_chart_data',
      'list_activities',
      'list_activity_chart_metrics',
      'list_activity_jumps',
      'list_activity_laps',
      'list_activity_swim_lengths',
      'list_activity_types',
    ]);
    await expect(listToolNames([
      MCP_OAUTH_SCOPES.MetricsRead,
      MCP_OAUTH_SCOPES.ActivityDetailsRead,
    ])).resolves.toEqual([
      'get_activity_chart_data',
      'get_activity_metrics',
      'get_training_metric',
      'list_activities',
      'list_activity_chart_metrics',
      'list_activity_jumps',
      'list_activity_laps',
      'list_activity_swim_lengths',
      'list_activity_types',
      'list_metrics',
      'query_metric',
    ]);
    await expect(listToolNames([MCP_OAUTH_SCOPES.RoutesRead])).resolves.toEqual([
      'list_activity_types',
      'list_routes',
    ]);
    await expect(listToolNames([
      MCP_OAUTH_SCOPES.RoutesRead,
      MCP_OAUTH_SCOPES.RouteLocationRead,
    ])).resolves.toEqual([
      'find_routes_near_location',
      'get_route_geometry',
      'list_activity_types',
      'list_route_waypoints',
      'list_routes',
    ]);
    await expect(listToolNames([
      MCP_OAUTH_SCOPES.ActivityDetailsRead,
      MCP_OAUTH_SCOPES.ActivityLocationRead,
    ])).resolves.toEqual([
      'find_activities_near_location',
      'get_activity_chart_data',
      'list_activities',
      'list_activity_chart_metrics',
      'list_activity_jumps',
      'list_activity_laps',
      'list_activity_swim_lengths',
      'list_activity_types',
    ]);
    await expect(listToolNames([
      MCP_OAUTH_SCOPES.ActivityDetailsRead,
      MCP_OAUTH_SCOPES.ActivityLocationRead,
      MCP_OAUTH_SCOPES.RoutesRead,
    ])).resolves.toEqual([
      'find_activities_near_location',
      'get_activity_chart_data',
      'list_activities',
      'list_activity_chart_metrics',
      'list_activity_jumps',
      'list_activity_laps',
      'list_activity_swim_lengths',
      'list_activity_types',
      'list_routes',
    ]);
  });

  it('advertises bounded saved-route type and name filters', async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createMcpServer({
      uid: 'user-1',
      clientId: 'https://client.example/mcp.json',
      connectionId: 'connection-1',
      scopes: [MCP_OAUTH_SCOPES.RoutesRead],
    }, 'https://quantified-self.io');
    const client = new Client({
      name: 'route-filter-test-client',
      version: '1.0.0',
    });

    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);
      const listRoutes = (await client.listTools()).tools
        .find(tool => tool.name === 'list_routes');
      const inputSchema = listRoutes?.inputSchema as {
        properties?: Record<string, Record<string, unknown>>;
        required?: string[];
      } | undefined;

      expect(client.getInstructions()).toContain(
        'list_routes with activityTypes or search',
      );
      expect(client.getInstructions()).toContain(
        'Repeat the filters with nextCursor until matched or scanComplete',
      );
      expect(listRoutes?.description).toContain('activityTypes');
      expect(listRoutes?.description).toContain(
        'case-insensitive route-name search',
      );
      expect(listRoutes?.description).toContain('scanComplete');
      expect(inputSchema?.required || []).not.toContain('activityTypes');
      expect(inputSchema?.required || []).not.toContain('search');
      expect(inputSchema?.properties?.activityTypes?.description).toContain(
        'list_activity_types',
      );
      expect(inputSchema?.properties?.search?.description).toContain(
        'case-insensitive',
      );
      expect(inputSchema?.properties?.cursor?.description).toContain(
        'Repeat the original activityTypes and search',
      );
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('advertises first-class body-measurement routing and safe tool metadata', async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createMcpServer({
      uid: 'user-1',
      clientId: 'https://client.example/mcp.json',
      connectionId: 'connection-1',
      scopes: [
        MCP_OAUTH_SCOPES.MeasurementsRead,
        MCP_OAUTH_SCOPES.MetricsRead,
      ],
    }, 'https://quantified-self.io');
    const client = new Client({
      name: 'measurement-metadata-test-client',
      version: '1.0.0',
    });

    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);
      const tools = (await client.listTools()).tools;
      const listMeasurements = tools.find(tool => tool.name === 'list_measurement_types');
      const queryMeasurements = tools.find(tool => tool.name === 'query_measurements');
      const queryMetric = tools.find(tool => tool.name === 'query_metric');
      const measurementCatalog = await client.callTool({
        name: 'list_measurement_types',
        arguments: {},
      });

      expect(client.getInstructions()).toContain('body weight, body mass, weigh-ins');
      expect(client.getInstructions()).toContain('not a medical or health assessment');
      expect(client.getInstructions()).toContain('Use list_metrics and query_metric for activity');
      expect(listMeasurements?.description).toContain('body weight');
      expect(queryMeasurements?.description).toContain('identity-free');
      expect(queryMeasurements?.description).toContain('provider, device, source, event, and activity identity are excluded');
      expect(queryMeasurements?.description).toContain('not a medical or health assessment');
      expect(queryMetric?.description).toContain('use query_measurements');
      expect(queryMeasurements?.inputSchema).toMatchObject({
        properties: {
          measurementType: {
            enum: ['body_weight'],
          },
          aggregation: {
            default: 'median',
          },
          interval: {
            default: 'day',
          },
          timeZone: {
            description: expect.stringContaining('Required IANA time zone'),
          },
        },
      });
      expect(measurementCatalog.structuredContent).toMatchObject({
        measurementTypes: [{
          id: 'body_weight',
          requiresExplicitIanaTimeZone: true,
          currentTrend: {
            requiredScope: 'metrics:read',
            dayBoundaryTimeZone: 'UTC',
          },
        }],
      });
      expect(queryMeasurements?.annotations).toMatchObject({
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      });
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('does not instruct connections to use tools outside their granted scopes', async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createMcpServer({
      uid: 'user-1',
      clientId: 'https://client.example/mcp.json',
      connectionId: 'connection-1',
      scopes: [MCP_OAUTH_SCOPES.SleepRead],
    }, 'https://quantified-self.io');
    const client = new Client({
      name: 'sleep-instructions-test-client',
      version: '1.0.0',
    });

    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);

      expect(client.getInstructions()).toContain(
        'tools exposed for the permissions this connection was granted',
      );
      expect(client.getInstructions()).not.toContain('query_measurements');
      expect(client.getInstructions()).not.toContain('list_metrics');
      expect(client.getInstructions()).not.toContain('list_activities');
      expect(client.getInstructions()).not.toContain('body weight');
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('routes specific and latest-workout requests to newest-first activity discovery', async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createMcpServer({
      uid: 'user-1',
      clientId: 'https://client.example/mcp.json',
      connectionId: 'connection-1',
      scopes: [
        MCP_OAUTH_SCOPES.ActivityDetailsRead,
        MCP_OAUTH_SCOPES.MetricsRead,
        MCP_OAUTH_SCOPES.MeasurementsRead,
      ],
    }, 'https://quantified-self.io');
    const client = new Client({
      name: 'activity-routing-test-client',
      version: '1.0.0',
    });

    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);
      const instructions = client.getInstructions() || '';
      const activityInstructionIndex = instructions.indexOf(
        'For a workout',
      );
      const cursorInstruction = 'Follow nextCursor until matched or scanComplete';
      const cursorInstructionIndex = instructions.indexOf(cursorInstruction);
      const tools = (await client.listTools()).tools;
      const listActivities = tools
        .find(tool => tool.name === 'list_activities');
      const listActivityTypes = tools
        .find(tool => tool.name === 'list_activity_types');
      const inputSchema = listActivities?.inputSchema as {
        properties?: Record<string, Record<string, unknown>>;
        required?: string[];
      } | undefined;

      expect(activityInstructionIndex).toBeGreaterThanOrEqual(0);
      expect(activityInstructionIndex).toBeLessThan(512);
      expect(cursorInstructionIndex).toBeGreaterThan(activityInstructionIndex);
      expect(cursorInstructionIndex + cursorInstruction.length)
        .toBeLessThanOrEqual(512);
      expect(instructions).toContain(
        'aggregate metrics do not contain individual records',
      );
      expect(instructions).toContain(
        'relativePeriod plus timeZone for today or yesterday',
      );
      expect(instructions).toContain(
        'add activityTypes and limit 1 when named',
      );
      expect(listActivityTypes).toBeDefined();
      expect(listActivities?.description).toContain('today or yesterday');
      expect(listActivities?.description).toContain('all history/latest');
      expect(listActivities?.description).toContain(
        'Repeat the original filters with nextCursor',
      );
      expect(inputSchema?.required || []).not.toContain('start');
      expect(inputSchema?.required || []).not.toContain('end');
      expect(inputSchema?.required || []).not.toContain('relativePeriod');
      expect(inputSchema?.required || []).not.toContain('timeZone');
      expect(inputSchema?.properties?.start?.description).toContain(
        'Provide start and end together',
      );
      expect(inputSchema?.properties?.activityTypes?.description).toContain(
        'list_activity_types',
      );
      expect(inputSchema?.properties?.relativePeriod?.description).toContain(
        'Requires timeZone',
      );
      expect(inputSchema?.properties?.timeZone?.description).toContain(
        'IANA timezone',
      );
      expect(inputSchema?.properties?.limit?.description).toContain(
        'server-filtered named activity type',
      );

      const partialRange = await client.callTool({
        name: 'list_activities',
        arguments: {
          start: '2026-07-27T00:00:00.000+03:00',
        },
      });
      expect(partialRange.isError).toBe(true);
      expect(JSON.stringify(partialRange)).toContain(
        'start and end must either both be provided or both be omitted',
      );

      const missingRelativeTimeZone = await client.callTool({
        name: 'list_activities',
        arguments: {
          relativePeriod: 'today',
        },
      });
      expect(missingRelativeTimeZone.isError).toBe(true);
      expect(JSON.stringify(missingRelativeTimeZone)).toContain(
        'A valid IANA timezone is required',
      );
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('does not advertise measurement routing to a metrics-only connection', async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createMcpServer({
      uid: 'user-1',
      clientId: 'https://client.example/mcp.json',
      connectionId: 'connection-1',
      scopes: [MCP_OAUTH_SCOPES.MetricsRead],
    }, 'https://quantified-self.io');
    const client = new Client({
      name: 'metrics-instructions-test-client',
      version: '1.0.0',
    });

    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);
      const advertisedMetadata = JSON.stringify({
        instructions: client.getInstructions(),
        tools: (await client.listTools()).tools,
      });

      expect(advertisedMetadata).not.toContain('query_measurements');
      expect(advertisedMetadata).not.toContain('list_measurement_types');
      expect(client.getInstructions()).toContain(
        'Use list_metrics and query_metric for activity',
      );
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('marks place-search tools as read-only operations that may call Mapbox', async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createMcpServer({
      uid: 'user-1',
      clientId: 'https://client.example/mcp.json',
      connectionId: 'connection-1',
      scopes: [
        MCP_OAUTH_SCOPES.ActivityDetailsRead,
        MCP_OAUTH_SCOPES.ActivityLocationRead,
        MCP_OAUTH_SCOPES.RoutesRead,
        MCP_OAUTH_SCOPES.RouteLocationRead,
      ],
    }, 'https://quantified-self.io');
    const client = new Client({
      name: 'metadata-test-client',
      version: '1.0.0',
    });
    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);
      const tools = (await client.listTools()).tools;
      for (const toolName of [
        'find_activities_near_location',
        'find_routes_near_location',
      ]) {
        expect(tools.find(tool => tool.name === toolName)?.annotations).toMatchObject({
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: true,
        });
      }
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('rejects ambiguous location objects before a nearby tool can execute', async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createMcpServer({
      uid: 'user-1',
      clientId: 'https://client.example/mcp.json',
      connectionId: 'connection-1',
      scopes: [
        MCP_OAUTH_SCOPES.ActivityDetailsRead,
        MCP_OAUTH_SCOPES.ActivityLocationRead,
      ],
    }, 'https://quantified-self.io');
    const client = new Client({
      name: 'schema-test-client',
      version: '1.0.0',
    });
    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);
      const result = await client.callTool({
        name: 'find_activities_near_location',
        arguments: {
          location: {
            query: 'Ioannina, Greece',
            latitudeDegrees: 39.665,
            longitudeDegrees: 20.8537,
          },
        },
      });

      expect(result.isError).toBe(true);
      expect(JSON.stringify(result)).toContain('Invalid input');
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('discloses exact start and end coordinates in the activity tool metadata', async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createMcpServer({
      uid: 'user-1',
      clientId: 'https://client.example/mcp.json',
      connectionId: 'connection-1',
      scopes: [
        MCP_OAUTH_SCOPES.ActivityDetailsRead,
        MCP_OAUTH_SCOPES.ActivityLocationRead,
      ],
    }, 'https://quantified-self.io');
    const client = new Client({
      name: 'metadata-test-client',
      version: '1.0.0',
    });
    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);
      const listActivities = (await client.listTools()).tools
        .find(tool => tool.name === 'list_activities');

      expect(listActivities?.description).toContain('exact start and end coordinates when present');
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('advertises compact hosted app icons for MCP clients', async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createMcpServer({
      uid: 'user-1',
      clientId: 'https://client.example/mcp.json',
      connectionId: 'connection-1',
      scopes: [MCP_OAUTH_SCOPES.MetricsRead],
    }, 'https://beta.quantified-self.io');
    const client = new Client({
      name: 'icon-test-client',
      version: '1.0.0',
    });

    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);

      expect(client.getServerVersion()).toEqual({
        name: 'quantified-self',
        title: 'Quantified Self',
        version: '1.2.0',
        description: 'Read-only activity metrics, body measurements, Training snapshots, and sleep-session summaries.',
        websiteUrl: 'https://beta.quantified-self.io',
        icons: [
          {
            src: 'https://beta.quantified-self.io/assets/favicons/android-chrome-96x96.png',
            mimeType: 'image/png',
            sizes: ['96x96'],
          },
          {
            src: 'https://beta.quantified-self.io/assets/favicons/android-chrome-192x192.png',
            mimeType: 'image/png',
            sizes: ['192x192'],
          },
          {
            src: 'https://beta.quantified-self.io/assets/favicons/android-chrome-512x512.png',
            mimeType: 'image/png',
            sizes: ['512x512'],
          },
        ],
      });
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('does not assign a scope to protocol messages or unknown tools', () => {
    expect(requiredScopesForRequest({ method: 'initialize' })).toEqual([]);
    expect(requiredScopesForRequest({
      method: 'tools/call',
      params: { name: 'unknown' },
    })).toEqual([]);
  });

  it('keeps the stateless JSON transport on bounded POST requests', () => {
    expect(supportsMcpTransportMethod('POST')).toBe(true);
    expect(supportsMcpTransportMethod('GET')).toBe(false);
    expect(supportsMcpTransportMethod('DELETE')).toBe(false);
    expect(isMcpRequestBodyWithinLimit({ method: 'initialize' }, '24')).toBe(true);
    expect(isMcpRequestBodyWithinLimit({ payload: 'x'.repeat(70_000) }, undefined)).toBe(false);
    expect(isMcpRequestBodyWithinLimit({}, 'not-a-number')).toBe(false);
  });

  it('preserves repeated form parameters for strict OAuth validation', () => {
    const parsed = parseMcpFormEncodedBody(
      'grant_type=refresh_token&scope=metrics%3Aread&scope=sleep%3Aread',
    );
    expect(parsed).toEqual({
      grant_type: 'refresh_token',
      scope: ['metrics:read', 'sleep:read'],
    });
    expect(() => rejectRepeatedOAuthParameters(parsed)).toThrow(
      expect.objectContaining({ code: 'invalid_request' }),
    );
  });

  it('accepts only form-encoded OAuth token requests', () => {
    expect(isMcpFormUrlEncodedContentType('application/x-www-form-urlencoded')).toBe(true);
    expect(isMcpFormUrlEncodedContentType(
      'Application/X-Www-Form-Urlencoded; charset=UTF-8',
    )).toBe(true);
    expect(isMcpFormUrlEncodedContentType(
      'application/x-www-form-urlencoded; charset="utf8"',
    )).toBe(true);
    expect(isMcpFormUrlEncodedContentType(
      'application/x-www-form-urlencoded; charset=ISO-8859-1',
    )).toBe(false);
    expect(isMcpFormUrlEncodedContentType(
      'application/x-www-form-urlencoded; charset=UTF-8; charset=UTF-8',
    )).toBe(false);
    expect(isMcpFormUrlEncodedContentType(
      'application/x-www-form-urlencoded; charset=""',
    )).toBe(false);
    expect(isMcpFormUrlEncodedContentType('application/json')).toBe(false);
    expect(isMcpFormUrlEncodedContentType(undefined)).toBe(false);
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
    expect(() => requireMcpTokenGrantType('')).toThrow(
      expect.objectContaining({ code: 'invalid_request' }),
    );
    expect(() => requireMcpTokenGrantType(['refresh_token', 'refresh_token'])).toThrow(
      expect.objectContaining({ code: 'invalid_request' }),
    );
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
