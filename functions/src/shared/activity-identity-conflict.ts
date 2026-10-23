/** A deterministic conflict requires review, not another download of the same source. */
export const ACTIVITY_IDENTITY_CONFLICT_MESSAGE = 'Cannot safely match the saved activities to the updated recording. The saved workout is preserved; review the source change.';
export class ActivityIdentityConflictError extends Error {
  readonly code = 'ACTIVITY_IDENTITY_CONFLICT';
  constructor() {
    super(ACTIVITY_IDENTITY_CONFLICT_MESSAGE);
    this.name = 'ActivityIdentityConflictError';
  }
}

/** Internal request to inspect the retained source outside a Firestore transaction. */
export class LegacyActivitySourceRequiredError extends ActivityIdentityConflictError {}

export function isActivityIdentityConflict(error: unknown): error is ActivityIdentityConflictError {
  return !!error && typeof error === 'object'
    && (error as { code?: unknown }).code === 'ACTIVITY_IDENTITY_CONFLICT';
}
