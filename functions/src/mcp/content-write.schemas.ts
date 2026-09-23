import { z } from 'zod';
import {
  EVENT_TAG_LIMIT,
  EVENT_TAG_MAX_LENGTH,
} from '../../../shared/event-tags';
import {
  TIMELINE_NOTE_CATEGORIES,
  TIMELINE_NOTE_COLORS,
  TIMELINE_NOTE_LIMITS,
} from '../../../shared/timeline-notes';

export const EVENTS_WRITE_SCOPE = 'events:write';
export const TIMELINE_NOTES_WRITE_SCOPE = 'timeline-notes:write';

export const MCP_CONTENT_WRITE_TOOLS = [
  'update_event_tags',
  'query_editable_timeline_notes',
  'create_timeline_note',
  'update_timeline_note',
  'delete_timeline_note',
] as const;

export type McpContentWriteTool = typeof MCP_CONTENT_WRITE_TOOLS[number];

const opaqueReference = z.string().min(1).max(512);
const date = z.iso.date();
const hasSupportedText = (value: string) => ![...value].some(character => {
  const code = character.charCodeAt(0);
  return (code < 32 && code !== 9 && code !== 10 && code !== 13) || code === 127;
});
const tag = z.string().trim().min(1).max(EVENT_TAG_MAX_LENGTH)
  .refine(hasSupportedText, 'Tags contain unsupported characters.');
const tags = z.array(tag).max(EVENT_TAG_LIMIT);
const revision = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER - 1);
const mutationId = z.uuid();
const title = z.string().max(TIMELINE_NOTE_LIMITS.title)
  .refine(value => Boolean(value.trim()), 'A note title is required.')
  .refine(hasSupportedText, 'The note title contains unsupported characters.');
const details = z.string().max(TIMELINE_NOTE_LIMITS.details)
  .refine(hasSupportedText, 'The note details contain unsupported characters.');
const timeZone = z.string().min(1).max(100).refine(value => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format(0);
    return true;
  } catch {
    return false;
  }
}, 'Choose a valid IANA time zone.');

const MCP_TIMELINE_NOTE_REQUIRED_FIELDS_INPUT = {
  category: z.enum(TIMELINE_NOTE_CATEGORIES),
  title,
  startDate: date,
  endDate: date.nullable(),
  timeZone,
} as const;

export const MCP_TIMELINE_NOTE_FIELDS_INPUT = {
  ...MCP_TIMELINE_NOTE_REQUIRED_FIELDS_INPUT,
  details: details.nullable().optional(),
  showOnCharts: z.boolean().optional(),
  color: z.enum(TIMELINE_NOTE_COLORS).optional(),
} as const;

const MCP_TIMELINE_NOTE_COMPLETE_FIELDS_INPUT = {
  ...MCP_TIMELINE_NOTE_REQUIRED_FIELDS_INPUT,
  details: details.nullable(),
  showOnCharts: z.boolean(),
  color: z.enum(TIMELINE_NOTE_COLORS),
} as const;

const timelineNoteFieldsOutput = z.strictObject({
  category: z.enum(TIMELINE_NOTE_CATEGORIES),
  title: z.string().min(1).max(TIMELINE_NOTE_LIMITS.title),
  details: z.string().max(TIMELINE_NOTE_LIMITS.details).nullable(),
  startDate: date,
  endDate: date.nullable(),
  timeZone: z.string().min(1).max(100),
  showOnCharts: z.boolean(),
  color: z.enum(TIMELINE_NOTE_COLORS),
});

const timelineNoteMutationOutput = z.strictObject({
  noteRef: opaqueReference,
  revision,
  note: timelineNoteFieldsOutput,
});

export const MCP_CONTENT_WRITE_INPUTS = {
  update_event_tags: z.strictObject({
    activityRef: opaqueReference,
    expectedTags: tags.describe('Current tags from query_activities_with_tags. The write fails if they changed.'),
    tags: tags.describe(`Complete replacement list of at most ${EVENT_TAG_LIMIT} event tags.`),
  }),
  query_editable_timeline_notes: z.strictObject({
    startDate: date,
    endDate: date,
    limit: z.number().int().min(1).max(64).default(32),
    cursor: z.string().min(1).max(16_384).optional(),
  }),
  create_timeline_note: z.strictObject({
    ...MCP_TIMELINE_NOTE_FIELDS_INPUT,
    mutationId: mutationId.describe('Stable UUID for this create attempt. Reuse it only when retrying the same note.'),
  }),
  update_timeline_note: z.strictObject({
    noteRef: opaqueReference,
    expectedRevision: revision,
    ...MCP_TIMELINE_NOTE_COMPLETE_FIELDS_INPUT,
  }),
  delete_timeline_note: z.strictObject({
    noteRef: opaqueReference,
    expectedRevision: revision,
  }),
} satisfies Record<McpContentWriteTool, z.ZodType>;

export const MCP_CONTENT_WRITE_OUTPUTS = {
  update_event_tags: z.strictObject({
    activityRef: opaqueReference,
    tags,
    changed: z.boolean(),
  }),
  query_editable_timeline_notes: z.strictObject({
    startDate: date,
    endDate: date,
    notes: z.array(z.strictObject({
      noteRef: opaqueReference,
      revision,
      ...timelineNoteFieldsOutput.shape,
      effectiveEndDate: date,
    })).max(64),
    scanComplete: z.boolean(),
    recordsScanned: z.number().int().nonnegative().max(512),
    skippedRecords: z.number().int().nonnegative().max(512),
    limitsReached: z.array(z.enum(['limit', 'records', 'input_bytes', 'output_bytes'])).max(4),
    nextCursor: z.string().max(16_384).nullable(),
  }),
  create_timeline_note: z.strictObject({
    operation: z.literal('created'),
    ...timelineNoteMutationOutput.shape,
  }),
  update_timeline_note: z.strictObject({
    operation: z.literal('updated'),
    ...timelineNoteMutationOutput.shape,
  }),
  delete_timeline_note: z.strictObject({
    operation: z.literal('deleted'),
    noteRef: opaqueReference,
    deleted: z.boolean(),
  }),
} satisfies Record<McpContentWriteTool, z.ZodType>;
