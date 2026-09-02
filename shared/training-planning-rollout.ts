/**
 * Presentation-only rollout for the authenticated Training Planning navigation
 * entry. This is not an authorization boundary: owner-scoped APIs and the
 * `/plans` route remain available when opened directly. Broader rollout is
 * tracked by #655.
 */
export const TRAINING_PLANNING_NAVIGATION_ALLOWED_UIDS: readonly string[] = [
  'xcsAolLDDTWTgtRN9eYF3lW2YKL2',
];

export function isTrainingPlanningNavigationUIDAllowed(uid: string | null | undefined): boolean {
  const normalizedUID = typeof uid === 'string' ? uid.trim() : '';
  return normalizedUID.length > 0
    && TRAINING_PLANNING_NAVIGATION_ALLOWED_UIDS.includes(normalizedUID);
}
