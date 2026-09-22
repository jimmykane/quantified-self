import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type {
  AssistantContentProposalKind,
  AssistantContentProposalPreview,
} from '../../../shared/assistant.types';
import { normalizeEventTags } from '../../../shared/event-tags';
import { MCP_CONTENT_WRITE_INPUTS } from '../mcp/content-write.schemas';

export const ASSISTANT_CONTENT_PROPOSAL_TTL_MS = 10 * 60 * 1_000;

export const ASSISTANT_CONTENT_PROPOSAL_TOOLS = [
  'prepare_activity_tag_change',
  'prepare_timeline_note_create',
  'prepare_timeline_note_update',
  'prepare_timeline_note_delete',
] as const;

export type AssistantContentProposalTool = typeof ASSISTANT_CONTENT_PROPOSAL_TOOLS[number];

const TOOL_TO_KIND = {
  prepare_activity_tag_change: 'update_activity_tags',
  prepare_timeline_note_create: 'create_timeline_note',
  prepare_timeline_note_update: 'update_timeline_note',
  prepare_timeline_note_delete: 'delete_timeline_note',
} as const satisfies Record<AssistantContentProposalTool, AssistantContentProposalKind>;

export const ASSISTANT_CONTENT_PROPOSAL_INPUTS = {
  prepare_activity_tag_change: MCP_CONTENT_WRITE_INPUTS.update_activity_tags,
  prepare_timeline_note_create: MCP_CONTENT_WRITE_INPUTS.create_timeline_note,
  prepare_timeline_note_update: MCP_CONTENT_WRITE_INPUTS.update_timeline_note,
  prepare_timeline_note_delete: MCP_CONTENT_WRITE_INPUTS.delete_timeline_note,
} as const satisfies Record<AssistantContentProposalTool, z.ZodType>;

export interface AssistantContentProposalDependencies {
  now(): number;
  createId(): string;
}

const defaultDependencies: AssistantContentProposalDependencies = {
  now: Date.now,
  createId: randomUUID,
};

function summaryFor(kind: AssistantContentProposalKind, args: Record<string, unknown>): string {
  switch (kind) {
    case 'update_activity_tags':
      return `Replace ${Array.isArray(args.expectedTags) ? args.expectedTags.length : 0} current activity tag${Array.isArray(args.expectedTags) && args.expectedTags.length === 1 ? '' : 's'} with ${Array.isArray(args.tags) ? args.tags.length : 0}.`;
    case 'create_timeline_note':
      return `Create Timeline note “${args.title}”.`;
    case 'update_timeline_note':
      return `Update Timeline note “${args.title}”.`;
    case 'delete_timeline_note':
      return 'Permanently delete the selected Timeline note.';
  }
}

function completeCreateArguments(args: z.infer<typeof MCP_CONTENT_WRITE_INPUTS.create_timeline_note>) {
  return {
    ...args,
    details: args.details ?? null,
    showOnCharts: args.showOnCharts ?? true,
    color: args.color ?? 'default' as const,
  };
}

function canonicalTagArguments(args: z.infer<typeof MCP_CONTENT_WRITE_INPUTS.update_activity_tags>) {
  return {
    ...args,
    expectedTags: normalizeEventTags(args.expectedTags),
    tags: normalizeEventTags(args.tags),
  };
}

export function createAssistantContentProposal(
  tool: AssistantContentProposalTool,
  value: unknown,
  overrides: Partial<AssistantContentProposalDependencies> = {},
): AssistantContentProposalPreview {
  const dependencies = { ...defaultDependencies, ...overrides };
  const parsed = ASSISTANT_CONTENT_PROPOSAL_INPUTS[tool].parse(value) as Record<string, unknown>;
  const kind = TOOL_TO_KIND[tool];
  const args = kind === 'create_timeline_note'
    ? completeCreateArguments(parsed as z.infer<typeof MCP_CONTENT_WRITE_INPUTS.create_timeline_note>)
    : kind === 'update_activity_tags'
      ? canonicalTagArguments(parsed as z.infer<typeof MCP_CONTENT_WRITE_INPUTS.update_activity_tags>)
      : parsed;
  return {
    proposalRef: dependencies.createId(),
    kind,
    expiresAtMs: dependencies.now() + ASSISTANT_CONTENT_PROPOSAL_TTL_MS,
    summary: summaryFor(kind, args),
    requiresConfirmation: true,
    arguments: args as AssistantContentProposalPreview['arguments'],
  };
}

export function isAssistantContentProposalTool(value: string): value is AssistantContentProposalTool {
  return (ASSISTANT_CONTENT_PROPOSAL_TOOLS as readonly string[]).includes(value);
}

export function assistantContentProposalInputJsonSchema(
  tool: AssistantContentProposalTool,
): Record<string, unknown> & { type: 'object' } {
  return z.toJSONSchema(ASSISTANT_CONTENT_PROPOSAL_INPUTS[tool], {
    target: 'draft-7',
    io: 'input',
    reused: 'ref',
  }) as Record<string, unknown> & { type: 'object' };
}
