import { describe, expect, it } from 'vitest';
import { MCP_CONTENT_WRITE_INPUTS } from './content-write.schemas';

const note = {
  category: 'other' as const,
  title: 'Recovery context',
  details: 'User-authored text.',
  startDate: '2026-09-22',
  endDate: '2026-09-22',
  timeZone: 'Europe/Helsinki',
  showOnCharts: true,
  color: 'blue' as const,
};

describe('MCP focused content-write inputs', () => {
  it('accepts bounded explicit tag replacement and note mutations', () => {
    expect(MCP_CONTENT_WRITE_INPUTS.update_event_tags.safeParse({
      activityRef: 'opaque-activity', expectedTags: ['Easy'], tags: ['Easy', 'Trail'],
    }).success).toBe(true);
    expect(MCP_CONTENT_WRITE_INPUTS.create_timeline_note.safeParse({
      ...note, mutationId: '123e4567-e89b-42d3-a456-426614174000',
    }).success).toBe(true);
    expect(MCP_CONTENT_WRITE_INPUTS.update_timeline_note.safeParse({
      ...note, details: null, noteRef: 'opaque-note', expectedRevision: 2,
    }).success).toBe(true);
    expect(MCP_CONTENT_WRITE_INPUTS.delete_timeline_note.safeParse({
      noteRef: 'opaque-note', expectedRevision: 2,
    }).success).toBe(true);
  });

  it('rejects private identity fields, invalid zones, control characters and oversized tag lists', () => {
    expect(MCP_CONTENT_WRITE_INPUTS.create_timeline_note.safeParse({
      ...note, uid: 'attacker', mutationId: '123e4567-e89b-42d3-a456-426614174000',
    }).success).toBe(false);
    expect(MCP_CONTENT_WRITE_INPUTS.create_timeline_note.safeParse({
      ...note, timeZone: 'Not/A_Zone', mutationId: '123e4567-e89b-42d3-a456-426614174000',
    }).success).toBe(false);
    expect(MCP_CONTENT_WRITE_INPUTS.create_timeline_note.safeParse({
      ...note, title: 'Unsafe\u0000title', mutationId: '123e4567-e89b-42d3-a456-426614174000',
    }).success).toBe(false);
    expect(MCP_CONTENT_WRITE_INPUTS.update_event_tags.safeParse({
      activityRef: 'opaque-activity', expectedTags: [], tags: Array.from({ length: 11 }, (_, index) => `tag-${index}`),
    }).success).toBe(false);
    expect(MCP_CONTENT_WRITE_INPUTS.update_event_tags.safeParse({
      activityRef: 'opaque-activity', expectedTags: [], tags: ['Unsafe\u0000tag'],
    }).success).toBe(false);
  });

  it('requires every current authored field for a note replacement', () => {
    const complete = {
      ...note,
      details: null,
      noteRef: 'opaque-note',
      expectedRevision: 2,
    };
    expect(MCP_CONTENT_WRITE_INPUTS.update_timeline_note.safeParse(complete).success).toBe(true);
    for (const field of ['details', 'showOnCharts', 'color'] as const) {
      const incomplete = { ...complete };
      delete incomplete[field];
      expect(MCP_CONTENT_WRITE_INPUTS.update_timeline_note.safeParse(incomplete).success).toBe(false);
    }
  });

  it('bounds event title and description edits without normalizing authored whitespace', () => {
    expect(MCP_CONTENT_WRITE_INPUTS.update_event_title.parse({
      activityRef: 'opaque-activity', expectedTitle: null, title: '  Hill repeats  ',
    }).title).toBe('  Hill repeats  ');
    expect(MCP_CONTENT_WRITE_INPUTS.update_event_description.safeParse({
      activityRef: 'opaque-activity', expectedDescription: null,
      description: 'Windy descent\nFelt good.',
    }).success).toBe(true);
    expect(MCP_CONTENT_WRITE_INPUTS.update_event_title.safeParse({
      activityRef: 'opaque-activity', expectedTitle: null, title: 'Bad\nname',
    }).success).toBe(false);
    expect(MCP_CONTENT_WRITE_INPUTS.update_event_description.safeParse({
      activityRef: 'opaque-activity', expectedDescription: null,
      description: 'x'.repeat(65_537),
    }).success).toBe(false);
    expect(MCP_CONTENT_WRITE_INPUTS.update_event_description.safeParse({
      activityRef: 'opaque-activity', expectedDescription: null,
      description: '😀'.repeat(17_000),
    }).success).toBe(false);
    expect(MCP_CONTENT_WRITE_INPUTS.update_event_title.safeParse({
      activityRef: 'opaque-activity', expectedTitle: null, title: 'Run', uid: 'attacker',
    }).success).toBe(false);
  });
});
