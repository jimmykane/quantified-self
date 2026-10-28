/** Shared copy only; OAuth grants remain server-owned and are never inferred from UI state. */
export const WAHOO_TRAINING_PERMISSION_ISSUE = 'Wahoo Training permission is required. Reconnect Wahoo and allow plans and workouts.';
export const WAHOO_TRAINING_SCOPES = ['user_read', 'plans_read', 'plans_write', 'workouts_read', 'workouts_write'] as const;
export function hasWahooTrainingScopes(scope: unknown): boolean {
  if (typeof scope !== 'string') return false;
  const granted = new Set(scope.split(/\s+/).filter(Boolean));
  return WAHOO_TRAINING_SCOPES.every(value => granted.has(value));
}
