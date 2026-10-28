import { describe, it, expect } from 'vitest';
import type { AssistantContentProposalPreview } from '@shared/assistant.types';
import { assistantReflectionReviewDetails } from './assistant-reflection-review.helper';
const proposal: AssistantContentProposalPreview = { kind: 'save_workout_reflection', proposalRef: 'p', expiresAtMs: 100,
  requiresConfirmation: true, summary: 'Save Running on Oct 6 · this activity.', reflectionReview: { before: { note: 'old' } },
  arguments: { activityRef: 'opaque', target: 'activity', expectedRevision: 1, mutationId: '11111111-1111-4111-8111-111111111111', note: 'new' } };
describe('Assistant reflection review', () => {
  it('reviews only current and new private text without exposing identifiers', () => {
    const details = assistantReflectionReviewDetails(proposal).join('\n');
    expect(details).toContain('Current text: old'); expect(details).toContain('New text: new');
    expect(details).not.toContain('reported effort'); expect(details).not.toContain('Borg');
    expect(details).toContain('does not change workout RPE');
    expect(details).toContain('This activity only'); expect(details).not.toContain('opaque');
  });
  it('reviews permanent text deletion with the exact current content', () => {
    const details = assistantReflectionReviewDetails({ ...proposal, kind: 'delete_workout_reflection' }).join();
    expect(details).toContain('Current text: old'); expect(details).toContain('permanently deleted');
    expect(details).not.toContain('New text');
  });
});
