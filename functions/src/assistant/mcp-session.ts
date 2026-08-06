import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  createMcpServer,
  type AuthenticatedMcpRequest,
} from '../mcp/server';
import { MCP_OAUTH_SCOPES } from '../mcp/oauth.service';
import type { AssistantLocationAccess } from '../../../shared/assistant.types';

export const ASSISTANT_BASE_MCP_TOOL_NAMES = [
  'list_activity_types',
  'list_measurement_types',
  'query_measurements',
  'list_metrics',
  'query_metric',
  'query_metrics',
  'list_training_metrics',
  'get_training_metric',
  'list_sleep_vitals',
  'list_sleep_sessions',
  'get_sleep_trend',
  'get_today_readiness',
  'get_daily_report',
  'query_activities',
  'list_activity_laps',
  'list_activity_jumps',
  'list_activity_swim_lengths',
  'get_activity_overview',
  'list_activity_chart_metrics',
  'get_activity_chart_data',
  'get_activity_metrics',
  'rank_activities_by_metric',
  'list_routes',
] as const;

export const ASSISTANT_ACTIVITY_LOCATION_MCP_TOOL_NAMES = [
  'search_activities_near_location',
] as const;

export const ASSISTANT_MCP_TOOL_NAMES = [
  ...ASSISTANT_BASE_MCP_TOOL_NAMES,
  ...ASSISTANT_ACTIVITY_LOCATION_MCP_TOOL_NAMES,
] as const;

export type AssistantMcpToolName = typeof ASSISTANT_MCP_TOOL_NAMES[number];

export interface AssistantMcpToolDefinition {
  name: AssistantMcpToolName;
  title: string;
  description: string;
  inputSchema: Record<string, unknown> & { type: 'object' };
  outputSchema?: Record<string, unknown> & { type: 'object' };
}

export interface AssistantMcpToolResult {
  structuredContent: Record<string, unknown>;
}

export interface AssistantMcpSession {
  instructions: string;
  tools: AssistantMcpToolDefinition[];
  callTool: (
    name: AssistantMcpToolName,
    args: Record<string, unknown>,
  ) => Promise<AssistantMcpToolResult>;
  close: () => Promise<void>;
}

interface AssistantMcpSessionDependencies {
  createServer: (
    auth: AuthenticatedMcpRequest,
    publicBaseUrl: string,
  ) => McpServer;
}

const ASSISTANT_TOOL_NAME_SET = new Set<string>(ASSISTANT_MCP_TOOL_NAMES);
const ASSISTANT_CONNECTION_ID = 'first-party-assistant-v1';
const ASSISTANT_CLIENT_ID = 'https://quantified-self.io/internal/assistant';

const defaultDependencies: AssistantMcpSessionDependencies = {
  createServer: (auth, publicBaseUrl) => createMcpServer(auth, publicBaseUrl),
};

function isAssistantToolName(value: string): value is AssistantMcpToolName {
  return ASSISTANT_TOOL_NAME_SET.has(value);
}

export async function createAssistantMcpSession(
  uid: string,
  publicBaseUrl: string,
  dependencies: AssistantMcpSessionDependencies = defaultDependencies,
  locationAccess: AssistantLocationAccess = 'coordinate_free',
): Promise<AssistantMcpSession> {
  const activityLocationEnabled = locationAccess === 'precise_activity';
  const expectedToolNames: readonly AssistantMcpToolName[] = activityLocationEnabled
    ? ASSISTANT_MCP_TOOL_NAMES
    : ASSISTANT_BASE_MCP_TOOL_NAMES;
  const auth: AuthenticatedMcpRequest = {
    uid,
    clientId: ASSISTANT_CLIENT_ID,
    connectionId: ASSISTANT_CONNECTION_ID,
    scopes: [
      MCP_OAUTH_SCOPES.MetricsRead,
      MCP_OAUTH_SCOPES.MeasurementsRead,
      MCP_OAUTH_SCOPES.SleepRead,
      MCP_OAUTH_SCOPES.ActivityDetailsRead,
      ...(activityLocationEnabled
        ? [MCP_OAUTH_SCOPES.ActivityLocationRead]
        : []),
      MCP_OAUTH_SCOPES.RoutesRead,
    ],
  };
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = dependencies.createServer(auth, publicBaseUrl);
  const client = new Client({
    name: 'quantified-self-first-party-assistant',
    version: '1.0.0',
  });

  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const listedTools = (await client.listTools()).tools;
    const listedToolsByName = new Map(listedTools.map(tool => [tool.name, tool]));
    const tools = expectedToolNames.flatMap((name) => {
      const tool = listedToolsByName.get(name);
      return tool ? [{
        name: tool.name as AssistantMcpToolName,
        title: tool.title || tool.name,
        description: tool.description || tool.title || tool.name,
        inputSchema: tool.inputSchema as AssistantMcpToolDefinition['inputSchema'],
        ...(tool.outputSchema
          ? { outputSchema: tool.outputSchema as AssistantMcpToolDefinition['outputSchema'] }
          : {}),
      }] : [];
    });
    const listedToolNames = new Set(tools.map(tool => tool.name));
    const missingToolNames = expectedToolNames.filter(name => !listedToolNames.has(name));
    if (missingToolNames.length > 0) {
      throw new Error(`Assistant MCP tools are unavailable: ${missingToolNames.join(', ')}`);
    }

    return {
      instructions: client.getInstructions() || '',
      tools,
      callTool: async (name, args) => {
        if (!isAssistantToolName(name)) {
          throw new Error('The requested tool is not available to the Assistant.');
        }
        const result = await client.callTool({
          name,
          arguments: args,
        });
        if ('isError' in result && result.isError) {
          const content = 'content' in result && Array.isArray(result.content)
            ? result.content
            : [];
          const message = content
            .filter(item => item.type === 'text')
            .map(item => item.text)
            .join(' ')
            .trim();
          throw new Error(message || `The ${name} tool could not complete the request.`);
        }
        if (!('structuredContent' in result)
          || !result.structuredContent
          || typeof result.structuredContent !== 'object') {
          throw new Error(`The ${name} tool returned no structured result.`);
        }
        return {
          structuredContent: result.structuredContent as Record<string, unknown>,
        };
      },
      close: async () => {
        await Promise.allSettled([
          client.close(),
          server.close(),
        ]);
      },
    };
  } catch (error) {
    await Promise.allSettled([
      client.close(),
      server.close(),
    ]);
    throw error;
  }
}
