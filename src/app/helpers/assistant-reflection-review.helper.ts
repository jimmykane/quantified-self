import type { AssistantContentProposalPreview } from '@shared/assistant.types';
export function assistantReflectionReviewDetails(proposal: AssistantContentProposalPreview): string[] {
  const args = proposal.arguments as { target: string; note?: string | null };
  const before = proposal.reflectionReview?.before;
  const details = [`Target: ${args.target === 'recording' ? 'Whole recording' : 'This activity only'}`,
    `Current text: ${before?.note || 'None'}`];
  if (proposal.kind === 'delete_workout_reflection') {
    return [...details, 'The reflection text will be permanently deleted and cannot be restored.'];
  }
  return [...details, `New text: ${args.note || 'None'}`,
    'This does not change workout RPE, complete a workout or change a plan.'];
}
