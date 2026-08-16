export interface QueueRevisionFields {
  queueRevision?: unknown;
  processed?: unknown;
}

export interface QueueRevisionComparison {
  currentQueueItem: QueueRevisionFields;
  attemptedQueueItem: QueueRevisionFields;
  /** Provider/context-specific fallback used only when neither item has an explicit revision. */
  legacyIdentityMatches: boolean;
}

export function normalizeQueueRevision(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized || null;
}

export function getQueueRevisionIdentity(
  queueItem: Pick<QueueRevisionFields, 'queueRevision'>,
  legacyIdentity: string | null = null,
): string | null {
  const queueRevision = normalizeQueueRevision(queueItem.queueRevision);
  const normalizedLegacyIdentity = typeof legacyIdentity === 'string'
    ? legacyIdentity.trim()
    : '';
  return queueRevision
    ? `revision:${queueRevision}`
    : normalizedLegacyIdentity || null;
}

/** Explicit revisions always win; legacy identity can never match a revisioned row. */
export function hasMatchingQueueRevision(params: QueueRevisionComparison): boolean {
  const attemptedRevision = normalizeQueueRevision(params.attemptedQueueItem.queueRevision);
  const currentRevision = normalizeQueueRevision(params.currentQueueItem.queueRevision);
  return attemptedRevision
    ? currentRevision === attemptedRevision
    : currentRevision === null && params.legacyIdentityMatches;
}

export function isCurrentQueueRevision(params: QueueRevisionComparison): boolean {
  return params.currentQueueItem.processed !== true && hasMatchingQueueRevision(params);
}
