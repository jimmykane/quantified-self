/**
 * Firestore write sanitization policy for event/activity payloads.
 *
 * This helper must be used for every event/activity write path so stream
 * payloads never get persisted in Firestore documents.
 */
type JsonObject = Record<string, unknown>;

function isPlainObject(value: unknown): value is JsonObject {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function cloneWithoutStreams(value: unknown, visited: WeakMap<object, unknown>): unknown {
  if (!value || typeof value !== 'object') {
    return value;
  }

  if (value instanceof Date) {
    return new Date(value.getTime());
  }

  const cached = visited.get(value);
  if (cached) {
    return cached;
  }

  if (Array.isArray(value)) {
    const clonedArray: unknown[] = [];
    visited.set(value, clonedArray);
    for (const item of value) {
      clonedArray.push(cloneWithoutStreams(item, visited));
    }
    return clonedArray;
  }

  if (!isPlainObject(value)) {
    return value;
  }

  const source = value as JsonObject;
  const clonedObject: JsonObject = {};
  visited.set(value, clonedObject);
  for (const key of Object.keys(source)) {
    if (key === 'streams') {
      continue;
    }
    clonedObject[key] = cloneWithoutStreams(source[key], visited);
  }
  return clonedObject;
}

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
  const sanitizedPayload = cloneWithoutStreams(activityJson, new WeakMap<object, unknown>()) as JsonObject;
  return sanitizedPayload as T & JsonObject;
}

/**
 * Returns a sanitized event write payload with every nested `streams` field removed
 * and denormalized `activities` removed from the top-level event document.
 * Use this right before persisting event payloads.
 */
export function sanitizeEventFirestoreWritePayload<T extends object>(eventJson: T): Omit<T, 'activities'> & JsonObject {
  const sanitizedPayload = cloneWithoutStreams(eventJson, new WeakMap<object, unknown>()) as JsonObject;
  delete sanitizedPayload.activities;
  return sanitizedPayload as Omit<T, 'activities'> & JsonObject;
}
