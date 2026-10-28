import { describe, expect, it } from 'vitest';
import type { AssistantTrainingProposalPreview } from '@shared/assistant.types';
import { assistantTrainingDeletionReview } from './assistant-training-deletion-review.helper';

const proposal: AssistantTrainingProposalPreview = {
  proposalRef: 'opaque-deletion', permissionMode: 'combined', expiresAtMs: 1, scheduleRevision: 1,
  requiresConfirmation: true, summary: 'Review one deletion.', providerPreviews: [],
  changes: [{ index: 0, kind: 'delete-workout', summary: 'Keep older copies.' }],
};

describe('Assistant Training deletion review', () => {
  it('labels a recoverable workout deletion without interpreting the service-copy choice', () => {
    for (const permissionMode of ['schedule', 'combined'] as const) {
      const review = assistantTrainingDeletionReview({ ...proposal, permissionMode });
      expect(review).toMatchObject({ title: 'Review workout deletion', applyLabel: 'Delete workout' });
      expect(review!.disclosure).toContain('recoverable history');
      expect(review!.disclosure).toContain('Review the service-copy choice above');
      expect(review!.disclosure).toContain('not confirmed here');
      expect(review!.disclosure).not.toContain('permanently');
    }
  });

  it('warns about permanent plan/history deletion without inferring the workout disposition', () => {
    const review = assistantTrainingDeletionReview({ ...proposal,
      changes: [{ index: 0, kind: 'delete-plan', summary: 'Keep workouts as standalone.' }] });
    expect(review).toMatchObject({ title: 'Review plan deletion', applyLabel: 'Delete plan' });
    expect(review!.disclosure).toContain('plan and its history will be permanently deleted');
    expect(review!.disclosure).toContain('Review what happens to its workouts and service copies above');
    expect(review!.disclosure).toContain('Completed activities stay untouched');
    expect(review!.disclosure).not.toContain('workouts will be permanently deleted');
  });

  it('leaves absent, library, and mixed proposals on their existing review path', () => {
    expect(assistantTrainingDeletionReview(null)).toBeNull();
    for (const changes of [[], [{ index: 0, kind: 'delete', summary: 'Delete a saved recipe.' }],
      [{ index: 0, kind: 'create-workout', summary: 'Create a run.' }, ...proposal.changes]]) {
      expect(assistantTrainingDeletionReview({ ...proposal, changes })).toBeNull();
    }
  });
});
