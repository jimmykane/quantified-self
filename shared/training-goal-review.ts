import { parseTrainingGoalFields, TRAINING_GOAL_FIELDS, type TrainingGoalFields } from './training-goals';
export type TrainingGoalReviewFields = Omit<TrainingGoalFields, 'planId'> & { planName: string | null };
export interface TrainingGoalReview { before: TrainingGoalReviewFields | null; after: TrainingGoalReviewFields }
export function parseTrainingGoalReview(value: unknown): TrainingGoalReview {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some(key => !['before', 'after'].includes(key))) throw Error('Invalid goal review.');
  const read = (value: unknown): TrainingGoalReviewFields => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Invalid goal review.');
    const v = value as Record<string, unknown>;
    if (Object.keys(v).some(key => ![...TRAINING_GOAL_FIELDS.filter(key => key !== 'planId'), 'planName'].includes(key))
      || (v.planName !== null && (typeof v.planName !== 'string' || !v.planName.trim() || v.planName.length > 120))) throw Error('Invalid goal plan.');
    const { planName, ...fields } = v;
    const { planId: _id, ...parsed } = parseTrainingGoalFields({ ...fields, planId: null });
    return { ...parsed, planName: planName as string | null };
  };
  const v = value as Record<string, unknown>;
  return { before: v.before === null ? null : read(v.before), after: read(v.after) };
}
