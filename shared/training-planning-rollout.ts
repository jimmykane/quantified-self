/**
 * Presentation-only rollout for Training Planning routes, navigation, calendar
 * overlays/actions, and help. This is not a backend authorization boundary:
 * owner-scoped APIs are unchanged. Broader rollout is tracked by #655.
 */
export const TRAINING_PLANNING_UI_ALLOWED_UIDS: readonly string[] = [
  'xcsAolLDDTWTgtRN9eYF3lW2YKL2',
];

export function isTrainingPlanningUIAllowed(uid: string | null | undefined): boolean {
  const normalizedUID = typeof uid === 'string' ? uid.trim() : '';
  return normalizedUID.length > 0
    && TRAINING_PLANNING_UI_ALLOWED_UIDS.includes(normalizedUID);
}
