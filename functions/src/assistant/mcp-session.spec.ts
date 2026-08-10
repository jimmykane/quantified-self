import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import { ASSISTANT_PROMPT_EXAMPLES } from '../../../shared/assistant.prompts';
import {
  ASSISTANT_BASE_MCP_TOOL_NAMES,
  ASSISTANT_MCP_TOOL_NAMES,
  AssistantRecoverableMcpToolError,
  createAssistantMcpSession,
} from './mcp-session';
import { MCP_OAUTH_SCOPES } from '../mcp/oauth.service';
import type { AuthenticatedMcpRequest } from '../mcp/server';

function createTestServer(options: {
  errorTool?: typeof ASSISTANT_MCP_TOOL_NAMES[number];
  errorCode?: 'query_too_large' | 'temporarily_unavailable';
  metricQueryResponse?: (input: Record<string, unknown>) => Record<string, unknown>;
} = {}): McpServer {
  const server = new McpServer({
    name: 'assistant-test',
    version: '1.0.0',
  }, {
    instructions: 'Use the registered facts only.',
  });
  for (const name of ASSISTANT_MCP_TOOL_NAMES) {
    const usesMetricHistoryResponse = name === 'query_metric' && options.metricQueryResponse;
    server.registerTool(name, {
      title: `Title ${name}`,
      description: `Description ${name}`,
      inputSchema: usesMetricHistoryResponse
        ? z.object({}).passthrough()
        : { query: z.string().optional() },
      outputSchema: usesMetricHistoryResponse
        ? z.object({}).passthrough()
        : { source: z.literal(name) },
    }, async (input) => options.errorTool === name
      ? {
        isError: true,
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            error: options.errorCode ?? 'query_too_large',
            message: 'The MCP tool could not complete the request.',
          }),
        }],
      }
      : usesMetricHistoryResponse
        ? {
          content: [{ type: 'text' as const, text: '{}' }],
          structuredContent: options.metricQueryResponse!(input as Record<string, unknown>),
        }
        : {
        content: [{ type: 'text', text: JSON.stringify({ source: name }) }],
        structuredContent: { source: name },
      });
  }
  server.registerTool('get_route_geometry', {
    description: 'Must never be available internally.',
    inputSchema: {},
  }, async () => ({ content: [{ type: 'text', text: 'unexpected' }] }));
  return server;
}

describe('Assistant MCP session', () => {
  it('resolves the complete curated boundary from the production MCP server', async () => {
    const session = await createAssistantMcpSession(
      'user-1',
      'https://quantified-self.io',
    );

    try {
      expect(session.tools.map(tool => tool.name)).toEqual(ASSISTANT_BASE_MCP_TOOL_NAMES);
      const productionToolNames = new Set(session.tools.map(tool => tool.name));
      for (const example of ASSISTANT_PROMPT_EXAMPLES) {
        expect(
          example.toolWorkflow.filter(toolName => !productionToolNames.has(
            toolName as typeof ASSISTANT_MCP_TOOL_NAMES[number],
          )),
          `published Assistant example ${example.id} has an unavailable workflow`,
        ).toEqual([]);
      }
      expect(session.tools.map(tool => tool.name)).not.toContain('get_route_geometry');
      expect(session.tools.map(tool => tool.name)).toContain('list_routes');
      expect(session.tools.map(tool => tool.name)).toContain('get_activity_chart_data');
      expect(session.tools.map(tool => tool.name)).toContain('list_activity_chart_metrics');
      expect(session.tools.map(tool => tool.name)).not.toContain(
        'search_activities_near_location',
      );
      expect(session.tools.find(tool => tool.name === 'list_activity_jumps')?.description)
        .toContain('coordinates redacted');
      expect(session.instructions).toContain('server expands the group to every canonical type');
      expect(session.instructions).toContain('Maximum Jump Distance');
      expect(session.instructions).toContain('Treat the ranked metric value as authoritative');
      expect(session.instructions).toContain('only when jump-level details are requested');
      expect(session.instructions).toContain('Never rank jump quality by jumpCount');
      expect(session.instructions).toContain('select the first activity with jumpCount greater than zero');
      expect(session.tools.find(tool => tool.name === 'list_routes')?.description)
        .toContain('Bounds are redacted');
      const dailyReportSchema = session.tools
        .find(tool => tool.name === 'get_daily_report')?.inputSchema;
      expect(dailyReportSchema?.required).toContain('timeZone');
      const chartSchema = session.tools
        .find(tool => tool.name === 'get_activity_chart_data')?.inputSchema;
      expect(chartSchema?.properties).not.toHaveProperty('includeLocation');
      expect(chartSchema?.properties).not.toHaveProperty('maxLocationPoints');
    } finally {
      await session.close();
    }
  });

  it('uses the MCP server in-process and exposes curated non-location tools plus route summaries', async () => {
    let capturedAuth: AuthenticatedMcpRequest | null = null;
    let capturedPublicBaseUrl = '';
    const session = await createAssistantMcpSession('user-1', 'https://beta.quantified-self.io', {
      createServer: (auth, publicBaseUrl) => {
        capturedAuth = auth;
        capturedPublicBaseUrl = publicBaseUrl;
        return createTestServer();
      },
    });

    try {
      expect(session.instructions).toBe('Use the registered facts only.');
      expect(session.tools.map(tool => tool.name)).toEqual(ASSISTANT_BASE_MCP_TOOL_NAMES);
      expect(session.tools.some(tool => tool.name === ('get_route_geometry' as never))).toBe(false);
      expect(capturedAuth).toMatchObject({
        uid: 'user-1',
        scopes: [
          MCP_OAUTH_SCOPES.MetricsRead,
          MCP_OAUTH_SCOPES.MeasurementsRead,
          MCP_OAUTH_SCOPES.SleepRead,
          MCP_OAUTH_SCOPES.ActivityDetailsRead,
          MCP_OAUTH_SCOPES.RoutesRead,
        ],
      });
      expect(capturedAuth?.scopes).not.toContain(MCP_OAUTH_SCOPES.ActivityLocationRead);
      expect(capturedAuth?.scopes).not.toContain(MCP_OAUTH_SCOPES.RouteLocationRead);
      expect(capturedPublicBaseUrl).toBe('https://beta.quantified-self.io');
      await expect(session.callTool('get_daily_report', {})).resolves.toEqual({
        structuredContent: { source: 'get_daily_report' },
      });
    } finally {
      await session.close();
    }
  });

  it('adds only the activity-location scope and nearby activity tool after explicit consent', async () => {
    let capturedAuth: AuthenticatedMcpRequest | null = null;
    const session = await createAssistantMcpSession(
      'user-1',
      'https://quantified-self.io',
      {
        createServer: (auth) => {
          capturedAuth = auth;
          return createTestServer();
        },
      },
      'precise_activity',
    );

    try {
      expect(session.tools.map(tool => tool.name)).toEqual(ASSISTANT_MCP_TOOL_NAMES);
      expect(session.tools.map(tool => tool.name)).toContain(
        'search_activities_near_location',
      );
      expect(capturedAuth?.scopes).toContain(MCP_OAUTH_SCOPES.ActivityLocationRead);
      expect(capturedAuth?.scopes).not.toContain(MCP_OAUTH_SCOPES.RouteLocationRead);
      expect(session.tools.map(tool => tool.name)).not.toContain('get_route_geometry');
    } finally {
      await session.close();
    }
  });

  it('uses the production location-aware projections only in a precise activity chat', async () => {
    const session = await createAssistantMcpSession(
      'user-1',
      'https://quantified-self.io',
      undefined,
      'precise_activity',
    );

    try {
      expect(session.tools.find(tool => tool.name === 'query_activities')?.description)
        .toContain('exact start and end coordinates');
      expect(session.tools.find(tool => tool.name === 'list_activity_jumps')?.description)
        .toContain('including exact coordinates');
      expect(session.tools.find(
        tool => tool.name === 'search_activities_near_location',
      )?.description).toContain('Mapbox');
      const nearbySchema = session.tools.find(
        tool => tool.name === 'search_activities_near_location',
      )?.inputSchema;
      expect(nearbySchema).not.toHaveProperty('oneOf');
      expect(nearbySchema?.properties).toMatchObject({
        location: {
          type: 'object',
          properties: {
            query: { type: 'string' },
            latitudeDegrees: { type: 'number' },
            longitudeDegrees: { type: 'number' },
          },
        },
      });
      expect(
        (nearbySchema?.properties as Record<string, unknown>)?.location,
      ).not.toHaveProperty('anyOf');
      const chartSchema = session.tools
        .find(tool => tool.name === 'get_activity_chart_data')?.inputSchema;
      expect(chartSchema?.properties).toHaveProperty('includeLocation');
      expect(chartSchema?.properties).toHaveProperty('maxLocationPoints');
      expect(session.tools.map(tool => tool.name)).not.toContain('get_route_geometry');
    } finally {
      await session.close();
    }
  });

  it('fails closed when a required internal tool is missing', async () => {
    const createPartialServer = () => {
      const server = new McpServer({ name: 'partial', version: '1.0.0' });
      server.registerTool('list_activity_types', {
        description: 'Only one tool.',
        inputSchema: {},
      }, async () => ({ content: [{ type: 'text', text: '{}' }] }));
      return server;
    };

    await expect(createAssistantMcpSession('user-1', 'https://quantified-self.io', {
      createServer: createPartialServer,
    })).rejects.toThrow('Assistant MCP tools are unavailable');
  });

  it('exposes only server-classified query errors for in-turn Assistant correction', async () => {
    const session = await createAssistantMcpSession('user-1', 'https://quantified-self.io', {
      createServer: () => createTestServer({ errorTool: 'query_metric' }),
    });

    try {
      await expect(session.callTool('query_metric', {})).rejects.toEqual(
        expect.objectContaining({
          name: 'AssistantRecoverableMcpToolError',
          code: 'query_too_large',
          guidance: 'Use a valid, narrower date range. Long activity-metric histories are paged automatically by the Assistant.',
        }) satisfies Partial<AssistantRecoverableMcpToolError>,
      );
    } finally {
      await session.close();
    }
  });

  it('pages an all-history metric request through the unchanged MCP tool and merges it once', async () => {
    const queryInputs: Record<string, unknown>[] = [];
    const session = await createAssistantMcpSession('user-1', 'https://quantified-self.io', {
      createServer: () => createTestServer({
        metricQueryResponse: (input) => {
          queryInputs.push(input);
          const value = (queryInputs.length * 1_000) + 1_000;
          return {
            metric: {
              type: 'Distance',
              displayType: 'Distance',
              unit: 'm',
              unitSystem: 'metric',
            },
            matchedEventCount: 1,
            aggregation: {
              dataType: 'Distance',
              valueType: 'Total',
              categoryType: 'Date',
              resolvedTimeInterval: 'Yearly',
              buckets: [{
                bucketKey: Date.parse('2024-01-01T00:00:00.000Z'),
                time: Date.parse('2024-01-01T00:00:00.000Z'),
                totalCount: 1,
                aggregateValue: value,
                seriesValues: { Running: value },
                seriesCounts: { Running: 1 },
              }],
            },
          };
        },
      }),
    });

    try {
      const response = await session.callTool('query_metric', {
        metric: 'Distance',
        start: '2023-01-01T00:00:00.000Z',
        end: '2025-01-03T00:00:00.000Z',
        aggregation: 'total',
        groupBy: 'date',
        interval: 'auto',
        timeZone: 'UTC',
      });

      expect(response.structuredContent).toMatchObject({
        matchedEventCount: 3,
        aggregation: {
          buckets: [{
            totalCount: 3,
            aggregateValue: 9_000,
            seriesValues: { Running: 9_000 },
          }],
        },
      });
      expect(queryInputs).toHaveLength(3);
      expect(queryInputs).toEqual([
        expect.objectContaining({
          start: '2023-01-01T00:00:00.000Z',
          interval: 'yearly',
        }),
        expect.objectContaining({
          interval: 'yearly',
        }),
        expect.objectContaining({
          end: '2025-01-03T00:00:00.000Z',
          interval: 'yearly',
        }),
      ]);
      expect(Date.parse(queryInputs[1].start as string)).toBe(
        Date.parse(queryInputs[0].end as string) + 1,
      );
      expect(response.structuredContent).not.toHaveProperty('results');
    } finally {
      await session.close();
    }
  });

  it('keeps temporary MCP failures out of model-visible recovery signals', async () => {
    const session = await createAssistantMcpSession('user-1', 'https://quantified-self.io', {
      createServer: () => createTestServer({
        errorTool: 'query_metric',
        errorCode: 'temporarily_unavailable',
      }),
    });

    try {
      await expect(session.callTool('query_metric', {})).rejects.not.toBeInstanceOf(
        AssistantRecoverableMcpToolError,
      );
    } finally {
      await session.close();
    }
  });
});
