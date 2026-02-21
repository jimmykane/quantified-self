/**
 * Firestore write sanitization policy for event/activity payloads.
 *
 * This helper must be used for every event/activity write path so stream
 * payloads never get persisted in Firestore documents.
 */

/**
 * Removes every key named `streams` from nested object/array structures.
 * Mutates the provided value in place.
 */
export function stripStreamsRecursivelyInPlace(value: unknown): void {
  const visited = new WeakSet<object>();

  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') {
      return;
    }

    if (visited.has(node)) {
      return;
    }
    visited.add(node);

    if (Array.isArray(node)) {
      for (const item of node) {
        walk(item);
      }
      return;
    }

    const record = node as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      if (key === 'streams') {
        delete record[key];
        continue;
      }
      walk(record[key]);
    }
  };

  walk(value);
}

/**
 * Returns a sanitized activity write payload with every nested `streams` field removed.
 */
export function sanitizeActivityFirestoreWritePayload(activityJson: Record<string, unknown>): Record<string, unknown> {
  const sanitizedPayload: Record<string, unknown> = { ...activityJson };
  stripStreamsRecursivelyInPlace(sanitizedPayload);
  return sanitizedPayload;
}

/**
 * Returns a sanitized event write payload with every nested `streams` field removed
 * and denormalized `activities` removed from the top-level event document.
 */
export function sanitizeEventFirestoreWritePayload(eventJson: Record<string, unknown>): Record<string, unknown> {
  const sanitizedPayload: Record<string, unknown> = { ...eventJson };
  stripStreamsRecursivelyInPlace(sanitizedPayload);
  delete sanitizedPayload.activities;
  return sanitizedPayload;
}
