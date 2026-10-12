/**
 * Keep the canonical positive total selected by the fresh source-file parse.
 * A monotonic counter or moving GPS does not establish complete coverage and
 * cannot disprove a supplied total. Source corrections belong in sports-lib,
 * while regeneration fills missing/zero distances and rebuilds other stats.
 * The activity argument is retained for existing regeneration callers.
 */
export function shouldPreserveParsedDistance(_activity: unknown, distance: unknown): boolean {
    return typeof distance === 'number' && Number.isFinite(distance) && distance > 0;
}
