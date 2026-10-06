import { describe, it, expect } from 'vitest';
import { DistanceUnits } from '@sports-alliance/sports-lib';
import type { AssistantContentProposalPreview } from '@shared/assistant.types';
import { assistantReflectionReviewDetails } from './assistant-reflection-review.helper';
const proposal: AssistantContentProposalPreview = { kind: 'save_workout_reflection', proposalRef: 'p', expiresAtMs: 100,
  requiresConfirmation: true, summary: 'Save Running on Oct 6 · this activity.', reflectionReview: { before: { effort: null, note: 'old' } },
  arguments: { activityRef: 'opaque', target: 'activity', expectedRevision: 1, mutationId: '11111111-1111-4111-8111-111111111111', effort: 0, note: 'new' } };
describe('Assistant reflection review', () => {
  it.each([undefined, { distanceUnits: [DistanceUnits.Miles] }])('uses Sports Lib display and keeps unknown separate from zero for %j', settings => {
    const details = assistantReflectionReviewDetails(proposal, settings as never).join('\n');
    expect(details).toContain('Current reported effort: Not reported');
    expect(details).toContain('No exertion'); expect(details).toContain('New text: new');
    expect(details).toContain('This activity only'); expect(details).not.toContain('opaque');
  });
  it('reviews permanent text and effort deletion with the exact current content', () => {
    const details = assistantReflectionReviewDetails({ ...proposal, kind: 'delete_workout_reflection' }).join();
    expect(details).toContain('Current text: old'); expect(details).toContain('permanently deleted');
    expect(details).not.toContain('New text');
  });
});
