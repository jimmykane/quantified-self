import { describe, expect, it } from 'vitest';
import {
  ASSISTANT_CONTENT_PROPOSAL_TTL_MS,
  createAssistantContentProposal,
} from './content-proposal';

describe('Assistant content proposals', () => {
  it('normalizes optional Timeline-note presentation fields into a complete review', () => {
    const proposal = createAssistantContentProposal('prepare_timeline_note_create', {
      mutationId: '11111111-1111-4111-8111-111111111111',
      category: 'travel',
      title: 'Altitude camp',
      startDate: '2026-09-22',
      endDate: '2026-09-25',
      timeZone: 'Europe/Helsinki',
    }, { now: () => 1_000, createId: () => 'proposal-1' });

    expect(proposal).toEqual(expect.objectContaining({
      proposalRef: 'proposal-1',
      kind: 'create_timeline_note',
      expiresAtMs: 1_000 + ASSISTANT_CONTENT_PROPOSAL_TTL_MS,
      requiresConfirmation: true,
      arguments: expect.objectContaining({ details: null, showOnCharts: true, color: 'default' }),
    }));
  });

  it('reuses the strict public write inputs and rejects extra or malformed fields', () => {
    expect(() => createAssistantContentProposal('prepare_activity_tag_change', {
      activityRef: 'activity-ref', expectedTags: ['Easy'], tags: ['Quality'], uid: 'attacker',
    })).toThrow();
    expect(() => createAssistantContentProposal('prepare_timeline_note_delete', {
      noteRef: 'note-ref', expectedRevision: 0,
    })).toThrow();
  });
});
