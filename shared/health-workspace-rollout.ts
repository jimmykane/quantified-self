/**
 * Temporary presentation-only rollout for the authenticated Health workspace
 * navigation entry. This is not an authorization boundary: Health reads remain
 * owner-scoped, and the route can still be opened directly.
 */
export const HEALTH_WORKSPACE_NAVIGATION_ALLOWED_UIDS: readonly string[] = [
  'xcsAolLDDTWTgtRN9eYF3lW2YKL2',
];

export function isHealthWorkspaceNavigationUIDAllowed(uid: string | null | undefined): boolean {
  const normalizedUID = typeof uid === 'string' ? uid.trim() : '';
  return normalizedUID.length > 0
    && HEALTH_WORKSPACE_NAVIGATION_ALLOWED_UIDS.includes(normalizedUID);
}
