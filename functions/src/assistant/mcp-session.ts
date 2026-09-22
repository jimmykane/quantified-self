import { TRAINING_PREVIEW_TOOLS, TRAINING_READ_TOOLS } from '../mcp/training-plans.schemas';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import type { McpServer } from '@modelcontextprotocol/server';
import { Client } from '@modelcontextprotocol/client';
import {
  createMcpServer,
  MCP_ACTIVITY_SAMPLES_INSTRUCTIONS,
  type AuthenticatedMcpRequest,
} from '../mcp/server';
import type { McpDataErrorCode } from '../mcp/data.service';
import { MCP_OAUTH_SCOPES } from '../mcp/oauth.service';
import type { AssistantLocationAccess } from '../../../shared/assistant.types';
import {
  ASSISTANT_CONTENT_PROPOSAL_TOOLS,
  assistantContentProposalInputJsonSchema,
  createAssistantContentProposal,
  isAssistantContentProposalTool,
  type AssistantContentProposalTool,
} from './content-proposal';
import {
  AssistantMetricHistoryQueryError,
  mergeAssistantMetricHistoryResponses,
  splitAssistantMetricHistoryQuery,
} from './metric-history-query';

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
  'get_current_readiness',
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
  'query_timeline_notes',
  'query_activities_with_tags',
  'query_editable_timeline_notes',
  ...ASSISTANT_CONTENT_PROPOSAL_TOOLS,
  ...TRAINING_READ_TOOLS,
  ...TRAINING_PREVIEW_TOOLS,
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

const RECOVERABLE_ASSISTANT_TOOL_ERROR_CODES = [
  'invalid_request',
  'invalid_metric',
  'invalid_timezone',
  'metric_not_ready',
  'detail_not_available',
  'query_too_large',
] as const satisfies readonly Exclude<McpDataErrorCode, 'temporarily_unavailable'>[];

type RecoverableAssistantToolErrorCode =
  typeof RECOVERABLE_ASSISTANT_TOOL_ERROR_CODES[number];

const RECOVERABLE_ASSISTANT_TOOL_ERROR_CODE_SET = new Set<string>(
  RECOVERABLE_ASSISTANT_TOOL_ERROR_CODES,
);

const ASSISTANT_TOOL_ERROR_GUIDANCE: Record<
  RecoverableAssistantToolErrorCode,
  string
> = {
  invalid_request: 'Use the advertised input schema. Discover canonical activity types before filtering activity data.',
  invalid_metric: 'Discover the supported metric before selecting it.',
  invalid_timezone: 'Use the current IANA time zone supplied with this request.',
  metric_not_ready: 'Use a currently ready Training-derived metric or explain that it is not ready.',
  detail_not_available: 'Select another available record or explain that this detail is unavailable.',
  query_too_large: 'Use a valid, narrower date range. Long activity-metric histories are paged automatically by the Assistant.',
};

/**
 * A deliberately narrow, server-classified MCP error that the model may use
 * to correct a malformed query within the same bounded Assistant turn.
 * Unexpected backend errors never become model input.
 */
export class AssistantRecoverableMcpToolError extends Error {
  constructor(
    readonly code: RecoverableAssistantToolErrorCode,
    readonly guidance: string,
  ) {
    super('The Assistant MCP tool needs corrected input.');
    this.name = 'AssistantRecoverableMcpToolError';
  }
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

const ASSISTANT_CONTENT_TOOL_COPY: Record<AssistantContentProposalTool, { title: string; description: string }> = {
  prepare_activity_tag_change: {
    title: 'Prepare an activity tag change',
    description: 'Prepare a complete activity tag replacement for review in Quantified Self. First read the selected activity and pass its exact current tags as expectedTags. This never writes data.',
  },
  prepare_timeline_note_create: {
    title: 'Prepare a Timeline note',
    description: 'Prepare one new Timeline note from explicit user-provided content for review in Quantified Self. This never writes data.',
  },
  prepare_timeline_note_update: {
    title: 'Prepare a Timeline note edit',
    description: 'Prepare a complete replacement of one current Timeline note for review in Quantified Self. First read its current reference, revision and authored fields. This never writes data.',
  },
  prepare_timeline_note_delete: {
    title: 'Prepare Timeline note deletion',
    description: 'Prepare permanent deletion of one current Timeline note for review in Quantified Self. First read its current reference and revision. This never writes data.',
  },
};

function recoverableAssistantToolError(message: string): AssistantRecoverableMcpToolError | null {
  let payload: unknown;
  try {
    payload = JSON.parse(message);
  } catch {
    return null;
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return null;
  }
  const code = (payload as { error?: unknown }).error;
  if (typeof code !== 'string' || !RECOVERABLE_ASSISTANT_TOOL_ERROR_CODE_SET.has(code)) {
    return null;
  }
  return new AssistantRecoverableMcpToolError(
    code as RecoverableAssistantToolErrorCode,
    ASSISTANT_TOOL_ERROR_GUIDANCE[code as RecoverableAssistantToolErrorCode],
  );
}

const defaultDependencies: AssistantMcpSessionDependencies = {
  createServer: (auth, publicBaseUrl) => createMcpServer(auth, publicBaseUrl),
};

function isAssistantToolName(value: string): value is AssistantMcpToolName {
  return ASSISTANT_TOOL_NAME_SET.has(value);
}

async function callAssistantMcpTool(
  client: Client,
  name: AssistantMcpToolName,
  args: Record<string, unknown>,
): Promise<AssistantMcpToolResult> {
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
    const recoverableError = recoverableAssistantToolError(message);
    if (recoverableError) {
      throw recoverableError;
    }
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
}

function projectAssistantInputSchema(
  name: AssistantMcpToolName,
  inputSchema: AssistantMcpToolDefinition['inputSchema'],
  activityLocationEnabled: boolean,
): AssistantMcpToolDefinition['inputSchema'] {
  let projectedSchema = inputSchema;
  if (name === 'search_activities_near_location') {
    const properties = inputSchema.properties;
    if (properties && typeof properties === 'object' && !Array.isArray(properties)) {
      const schemaWithoutExclusiveRangeMetadata = { ...inputSchema };
      delete schemaWithoutExclusiveRangeMetadata.oneOf;
      projectedSchema = {
        ...schemaWithoutExclusiveRangeMetadata,
        properties: {
          ...(properties as Record<string, unknown>),
          // Gemini function declarations accept a narrower JSON Schema subset
          // than MCP. Keep the authoritative MCP union at execution time, but
          // present the model with one object whose description states the
          // same mutually exclusive location modes.
          location: {
            type: 'object',
            description: 'Provide either query alone, or both latitudeDegrees and longitudeDegrees. Do not combine place text with coordinates.',
            properties: {
              query: {
                type: 'string',
                minLength: 1,
                maxLength: 200,
              },
              latitudeDegrees: {
                type: 'number',
                minimum: -90,
                maximum: 90,
              },
              longitudeDegrees: {
                type: 'number',
                minimum: -180,
                maximum: 180,
              },
            },
            additionalProperties: false,
          },
        },
      };
    }
  }
  if (activityLocationEnabled || name !== 'get_activity_chart_data') {
    return projectedSchema;
  }
  const properties = projectedSchema.properties;
  if (!properties || typeof properties !== 'object' || Array.isArray(properties)) {
    return projectedSchema;
  }
  const coordinateFreeProperties = {
    ...(properties as Record<string, unknown>),
  };
  delete coordinateFreeProperties.includeLocation;
  delete coordinateFreeProperties.maxLocationPoints;
  return {
    ...projectedSchema,
    properties: coordinateFreeProperties,
    ...(Array.isArray(projectedSchema.required)
      ? {
          required: projectedSchema.required.filter(field => (
            field !== 'includeLocation' && field !== 'maxLocationPoints'
          )),
        }
      : {}),
  };
}

export async function createAssistantMcpSession(
  uid: string,
  publicBaseUrl: string,
  dependencies: AssistantMcpSessionDependencies = defaultDependencies,
  locationAccess: AssistantLocationAccess = 'coordinate_free',
  timelineNotesEnabled = false,
  trainingPlansEnabled = false,
  trainingPlanChangesEnabled = false,
  trainingDeliveryEnabled = false,
  conversationId?: string,
  activityTagChangesEnabled = false,
  timelineNoteChangesEnabled = false,
): Promise<AssistantMcpSession> {
  if ((activityTagChangesEnabled || timelineNoteChangesEnabled) && !conversationId) {
    throw new Error('Assistant content changes require a current conversation.');
  }
  if (timelineNoteChangesEnabled && !timelineNotesEnabled) {
    throw new Error('Assistant Timeline note changes require Timeline notes access.');
  }
  const activityLocationEnabled = locationAccess === 'precise_activity';
  const expectedToolNames: readonly AssistantMcpToolName[] = [
    ...ASSISTANT_BASE_MCP_TOOL_NAMES,
    ...(activityLocationEnabled ? ASSISTANT_ACTIVITY_LOCATION_MCP_TOOL_NAMES : []),
    ...(timelineNotesEnabled ? ['query_timeline_notes' as const] : []),
    ...(activityTagChangesEnabled
      ? ['query_activities_with_tags' as const, 'prepare_activity_tag_change' as const]
      : []),
    ...(timelineNoteChangesEnabled
      ? ['query_editable_timeline_notes' as const, 'prepare_timeline_note_create' as const,
          'prepare_timeline_note_update' as const, 'prepare_timeline_note_delete' as const]
      : []),
    ...(trainingPlansEnabled ? TRAINING_READ_TOOLS : []),
    ...(trainingPlanChangesEnabled
      ? TRAINING_PREVIEW_TOOLS
      : trainingDeliveryEnabled ? ['preview_training_changes' as const] : []),
  ];
  const auth: AuthenticatedMcpRequest = {
    uid,
    clientId: ASSISTANT_CLIENT_ID,
    connectionId: conversationId
      ? `${ASSISTANT_CONNECTION_ID}:${conversationId}`
      : ASSISTANT_CONNECTION_ID,
    scopes: [
      MCP_OAUTH_SCOPES.MetricsRead,
      MCP_OAUTH_SCOPES.MeasurementsRead,
      MCP_OAUTH_SCOPES.SleepRead,
      MCP_OAUTH_SCOPES.ActivityDetailsRead,
      ...(activityLocationEnabled
        ? [MCP_OAUTH_SCOPES.ActivityLocationRead]
        : []),
      MCP_OAUTH_SCOPES.RoutesRead,
      ...(timelineNotesEnabled ? [MCP_OAUTH_SCOPES.TimelineNotesRead] : []),
      ...(activityTagChangesEnabled ? [MCP_OAUTH_SCOPES.ActivityTagsWrite] : []),
      ...(timelineNoteChangesEnabled ? [MCP_OAUTH_SCOPES.TimelineNotesWrite] : []),
      ...(trainingPlansEnabled ? [MCP_OAUTH_SCOPES.TrainingPlansRead] : []),
      ...(trainingPlanChangesEnabled ? [MCP_OAUTH_SCOPES.TrainingPlansWrite] : []),
      ...(trainingDeliveryEnabled ? [MCP_OAUTH_SCOPES.TrainingDeliveryWrite] : []),
    ],
    ...(conversationId ? { assistantConversationId: conversationId } : {}),
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
      if (isAssistantContentProposalTool(name)) {
        const copy = ASSISTANT_CONTENT_TOOL_COPY[name];
        return [{
          name,
          title: copy.title,
          description: copy.description,
          inputSchema: assistantContentProposalInputJsonSchema(name),
        }];
      }
      const tool = listedToolsByName.get(name);
      return tool ? [{
        name: tool.name as AssistantMcpToolName,
        title: tool.title || tool.name,
        description: tool.description || tool.title || tool.name,
        inputSchema: projectAssistantInputSchema(
          name,
          tool.inputSchema as AssistantMcpToolDefinition['inputSchema'],
          activityLocationEnabled,
        ),
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

    let preparedContentProposalRef: string | null = null;
    return {
      // The Assistant keeps its compact evidence budget; detailed sample pagination is an external-client workflow.
      instructions: (client.getInstructions() || '').replace(MCP_ACTIVITY_SAMPLES_INSTRUCTIONS, '').trim(),
      tools,
      callTool: async (name, args) => {
        if (!isAssistantToolName(name) || !expectedToolNames.includes(name)) {
          throw new Error('The requested tool is not available to the Assistant.');
        }
        if (isAssistantContentProposalTool(name)) {
          if (preparedContentProposalRef) {
            throw new Error('The Assistant can prepare only one content change per response.');
          }
          const proposal = createAssistantContentProposal(name, args);
          preparedContentProposalRef = proposal.proposalRef;
          return { structuredContent: proposal as unknown as Record<string, unknown> };
        }
        let metricHistoryPages: Record<string, unknown>[] | null;
        try {
          metricHistoryPages = splitAssistantMetricHistoryQuery(name, args);
        } catch (error) {
          if (error instanceof AssistantMetricHistoryQueryError) {
            throw new AssistantRecoverableMcpToolError(
              'query_too_large',
              'Choose an explicit historical range within the Assistant processing limit.',
            );
          }
          throw error;
        }
        if (!metricHistoryPages) {
          return callAssistantMcpTool(client, name, args);
        }
        const responses: Record<string, unknown>[] = [];
        for (const page of metricHistoryPages) {
          responses.push((await callAssistantMcpTool(client, name, page)).structuredContent);
        }
        return {
          structuredContent: mergeAssistantMetricHistoryResponses(name, responses),
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
