import { DataRPE, type UserUnitSettingsInterface } from '@sports-alliance/sports-lib';
import { resolveUnitAwareDisplayFromValue } from '@shared/unit-aware-display';
import type { AssistantContentProposalPreview } from '@shared/assistant.types';
export function assistantReflectionReviewDetails(proposal: AssistantContentProposalPreview,
  unitSettings?: UserUnitSettingsInterface): string[] {
  const args = proposal.arguments as { target: string; effort?: number | null; note?: string | null };
  const displayEffort = (value: number | null | undefined) => value == null ? 'Not reported'
    : resolveUnitAwareDisplayFromValue(DataRPE.type, value, unitSettings)?.text ?? 'Unavailable';
  const before = proposal.reflectionReview?.before;
  const details = [`Target: ${args.target === 'recording' ? 'Whole recording' : 'This activity only'}`,
    `Current reported effort: ${displayEffort(before?.effort)}`, `Current text: ${before?.note || 'None'}`];
  if (proposal.kind === 'delete_workout_reflection') {
    return [...details, 'The reported effort and text will be permanently deleted and cannot be restored.'];
  }
  return [...details, `New reported effort: ${displayEffort(args.effort)}`, `New text: ${args.note || 'None'}`,
    'Effort is your Borg CR10 report. This does not complete a workout or change a plan.'];
}
