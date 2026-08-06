import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import { ASSISTANT_PROMPT_EXAMPLES } from '../../../shared/assistant.prompts';
import {
  ASSISTANT_BASE_MCP_TOOL_NAMES,
  ASSISTANT_MCP_TOOL_NAMES,
  createAssistantMcpSession,
} from './mcp-session';
import { MCP_OAUTH_SCOPES } from '../mcp/oauth.service';
import type { AuthenticatedMcpRequest } from '../mcp/server';

function createTestServer(): McpServer {
  const server = new McpServer({
    name: 'assistant-test',
    version: '1.0.0',
  }, {
    instructions: 'Use the registered facts only.',
  });
  for (const name of ASSISTANT_MCP_TOOL_NAMES) {
    server.registerTool(name, {
      title: `Title ${name}`,
      description: `Description ${name}`,
      inputSchema: {
        query: z.string().optional(),
      },
      outputSchema: {
        source: z.literal(name),
      },
    }, async () => ({
      content: [{ type: 'text', text: JSON.stringify({ source: name }) }],
      structuredContent: { source: name },
    }));
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
      expect(session.tools.map(tool => tool.name)).not.toContain('get_activity_chart_data');
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
      expect(session.tools.find(tool => tool.name === 'list_routes')?.description)
        .toContain('Bounds are redacted');
      const dailyReportSchema = session.tools
        .find(tool => tool.name === 'get_daily_report')?.inputSchema;
      expect(dailyReportSchema?.required).toContain('timeZone');
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
});
