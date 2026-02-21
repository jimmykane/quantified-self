/**
 * Firestore write sanitization policy for event/activity payloads.
 *
 * This helper must be used for every event/activity write path so stream
 * payloads never get persisted in Firestore documents.
 *
 * Policy:
 * - Activity/event payloads written to Firestore must not contain `streams`.
 * - Event documents written to Firestore must not contain top-level `activities`.
 * - Do not duplicate ad-hoc `delete payload.streams` / `delete payload.activities`;
 *   always use these helper exports at the final write boundary.
 */
type JsonObject = Record<string, unknown>;

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
 * Use this right before persisting activity payloads.
 */
export function sanitizeActivityFirestoreWritePayload<T extends object>(activityJson: T): T & JsonObject {
  const sanitizedPayload: JsonObject = { ...(activityJson as JsonObject) };
  stripStreamsRecursivelyInPlace(sanitizedPayload);
  return sanitizedPayload as T & JsonObject;
}

/**
 * Returns a sanitized event write payload with every nested `streams` field removed
 * and denormalized `activities` removed from the top-level event document.
 * Use this right before persisting event payloads.
 */
export function sanitizeEventFirestoreWritePayload<T extends object>(eventJson: T): Omit<T, 'activities'> & JsonObject {
  const sanitizedPayload: JsonObject = { ...(eventJson as JsonObject) };
  stripStreamsRecursivelyInPlace(sanitizedPayload);
  delete sanitizedPayload.activities;
  return sanitizedPayload as Omit<T, 'activities'> & JsonObject;
}
