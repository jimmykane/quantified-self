export const EVENT_TAG_LIMIT = 10;
export const EVENT_TAG_MAX_LENGTH = 32;
export const EVENT_TAG_BULK_LIMIT = 250;

export interface EventTagChanges {
  add: string[];
  remove: string[];
}

export interface EventTagsContainer {
  tags?: unknown;
  benchmarkReviewTags?: unknown;
}

function normalizeTagValues(value: unknown, limit: number): string[] {
  const source = Array.isArray(value) ? value : [];
  const seen = new Set<string>();
  const tags: string[] = [];

  for (const item of source) {
    if (typeof item !== 'string') {
      continue;
    }

    const normalizedTag = item.trim().replace(/\s+/g, ' ');
    let tag = normalizedTag.slice(0, EVENT_TAG_MAX_LENGTH);
    const finalCodeUnit = tag.charCodeAt(tag.length - 1);
    if (finalCodeUnit >= 0xD800 && finalCodeUnit <= 0xDBFF) {
      tag = tag.slice(0, -1);
    }
    tag = tag.trimEnd();
    const key = tag.toLowerCase();
    if (!tag || seen.has(key)) {
      continue;
    }

    seen.add(key);
    tags.push(tag);
    if (tags.length >= limit) {
      break;
    }
  }

  return tags;
}

export function normalizeEventTags(value: unknown): string[] {
  return normalizeTagValues(value, EVENT_TAG_LIMIT);
}

export function normalizeEventTagSuggestions(value: unknown): string[] {
  return normalizeTagValues(value, Number.MAX_SAFE_INTEGER);
}

export function getEventTags(event: EventTagsContainer | null | undefined): string[] {
  if (Array.isArray(event?.tags)) {
    return normalizeEventTags(event.tags);
  }
  return normalizeEventTags(event?.benchmarkReviewTags);
}

export function storedEventTagNames(event: EventTagsContainer | null | undefined): string[] {
  return normalizeEventTagSuggestions([
    ...normalizeEventTags(event?.tags),
    ...normalizeEventTags(event?.benchmarkReviewTags),
  ]);
}

export function newlyAssignedEventTags(
  before: EventTagsContainer | null | undefined,
  after: EventTagsContainer | null | undefined,
): string[] {
  const previous = new Set(storedEventTagNames(before).map(tag => tag.toLowerCase()));
  return storedEventTagNames(after).filter(tag => !previous.has(tag.toLowerCase()));
}

export async function eventTagCatalogKeyFromWebCrypto(tag: string): Promise<string> {
  const [normalized] = normalizeEventTagSuggestions([tag]);
  if (!normalized) throw new Error('An event tag is required for a catalog key.');
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error('Secure event tag storage is unavailable in this browser.');
  const digest = await subtle.digest('SHA-256', new TextEncoder().encode(normalized.toLowerCase()));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

export function preserveEventTagsOnRewrite(
  incomingEvent: Record<string, unknown>,
  existingEvent: EventTagsContainer | null | undefined,
): Record<string, unknown> {
  if (Array.isArray(existingEvent?.tags) || Array.isArray(existingEvent?.benchmarkReviewTags)) {
    return withCanonicalEventTags(incomingEvent, getEventTags(existingEvent));
  }
  if (Array.isArray(incomingEvent.tags)) {
    return withCanonicalEventTags(incomingEvent, normalizeEventTags(incomingEvent.tags));
  }
  if (Array.isArray(incomingEvent.benchmarkReviewTags)) {
    return withCanonicalEventTags(incomingEvent, normalizeEventTags(incomingEvent.benchmarkReviewTags));
  }
  return withoutEventTagFields(incomingEvent);
}

function withCanonicalEventTags(
  event: Record<string, unknown>,
  tags: string[],
): Record<string, unknown> {
  return { ...withoutEventTagFields(event), tags };
}

function withoutEventTagFields(event: Record<string, unknown>): Record<string, unknown> {
  const eventWithoutTags = { ...event };
  delete eventWithoutTags.tags;
  delete eventWithoutTags.benchmarkReviewTags;
  return eventWithoutTags;
}

export function applyEventTagChanges(currentTags: unknown, changes: EventTagChanges): string[] {
  const current = normalizeTagValues(currentTags, Number.MAX_SAFE_INTEGER);
  const additions = normalizeTagValues(changes?.add, Number.MAX_SAFE_INTEGER);
  const removals = new Set(
    normalizeTagValues(changes?.remove, Number.MAX_SAFE_INTEGER).map(tag => tag.toLowerCase()),
  );
  const nextTags = current.filter(tag => !removals.has(tag.toLowerCase()));
  const seen = new Set(nextTags.map(tag => tag.toLowerCase()));

  for (const tag of additions) {
    const key = tag.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    nextTags.push(tag);
  }

  if (nextTags.length > EVENT_TAG_LIMIT) {
    throw new Error(`Events can have up to ${EVENT_TAG_LIMIT} tags.`);
  }

  return nextTags;
}
