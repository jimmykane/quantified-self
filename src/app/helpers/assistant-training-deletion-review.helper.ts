import type { AssistantTrainingProposalPreview } from '@shared/assistant.types';

/** Presentation only: the server's preview owns the cleanup choice and plan disposition. */
export function assistantTrainingDeletionReview(proposal: AssistantTrainingProposalPreview | null): {
  title: string;
  applyLabel: string;
  disclosure: string;
} | null {
  if (!proposal || proposal.changes.length !== 1) return null;
  const kind = proposal.changes[0].kind;
  if (kind !== 'delete-plan' && kind !== 'delete-workout') return null;
  return {
    title: kind === 'delete-plan' ? 'Review plan deletion' : 'Review workout deletion',
    applyLabel: kind === 'delete-plan' ? 'Delete plan' : 'Delete workout',
    disclosure: kind === 'delete-plan'
      ? 'The plan and its history will be permanently deleted. Review what happens to its workouts and service copies above. Service-copy removal runs in the background and is not confirmed here. Completed activities stay untouched.'
      : 'The workout moves to recoverable history. Review the service-copy choice above. Service-copy removal runs in the background and is not confirmed here. Completed activities stay untouched.',
  };
}
