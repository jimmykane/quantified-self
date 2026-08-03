import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import {
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
      expect(session.tools.map(tool => tool.name)).toEqual(ASSISTANT_MCP_TOOL_NAMES);
      expect(session.tools.map(tool => tool.name)).not.toContain('get_route_geometry');
      expect(session.tools.map(tool => tool.name)).not.toContain('get_activity_chart_data');
      expect(session.tools.map(tool => tool.name)).not.toContain(
        'search_activities_near_location',
      );
      expect(session.tools.find(tool => tool.name === 'list_activity_jumps')?.description)
        .toContain('coordinates redacted');
      const dailyReportSchema = session.tools
        .find(tool => tool.name === 'get_daily_report')?.inputSchema;
      expect(dailyReportSchema?.required).toContain('timeZone');
    } finally {
      await session.close();
    }
  });

  it('uses the MCP server in-process and exposes only the curated non-location tools', async () => {
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
      expect(session.tools.map(tool => tool.name)).toEqual(ASSISTANT_MCP_TOOL_NAMES);
      expect(session.tools.some(tool => tool.name === ('get_route_geometry' as never))).toBe(false);
      expect(capturedAuth).toMatchObject({
        uid: 'user-1',
        scopes: [
          MCP_OAUTH_SCOPES.MetricsRead,
          MCP_OAUTH_SCOPES.MeasurementsRead,
          MCP_OAUTH_SCOPES.SleepRead,
          MCP_OAUTH_SCOPES.ActivityDetailsRead,
        ],
      });
      expect(capturedAuth?.scopes).not.toContain(MCP_OAUTH_SCOPES.ActivityLocationRead);
      expect(capturedAuth?.scopes).not.toContain(MCP_OAUTH_SCOPES.RoutesRead);
      expect(capturedAuth?.scopes).not.toContain(MCP_OAUTH_SCOPES.RouteLocationRead);
      expect(capturedPublicBaseUrl).toBe('https://beta.quantified-self.io');
      await expect(session.callTool('get_daily_report', {})).resolves.toEqual({
        structuredContent: { source: 'get_daily_report' },
      });
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
