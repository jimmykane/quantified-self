/**
 * Shared ID generator for deterministic event and activity IDs.
 * Works in both browser and Node.js using SubtleCrypto for SHA-256.
 */

/**
 * The threshold in milliseconds for detecting duplicate events based on start date.
 * Events starting within this window will generate the same ID.
 * 100 ms
 */
export const EVENT_DUPLICATE_THRESHOLD_MS = 100;

/**
 * Generates a deterministic ID for an event based on the user ID and start date.
 */
export async function generateEventID(userID: string, startDate: Date): Promise<string> {
    // Bucket the timestamp to allow for slight differences in start time (e.g. from different devices)
    const time = startDate.getTime();
    const bucketedTime = Math.floor(time / EVENT_DUPLICATE_THRESHOLD_MS) * EVENT_DUPLICATE_THRESHOLD_MS;

    // Note: bucketedTime is used for duplicate detection
    const parts = [userID, bucketedTime.toString()];
    return generateIDFromParts(parts);
}

/**
 * Generates a deterministic ID for an activity based on the event ID and its index.
 */
export async function generateActivityID(eventID: string, index: number): Promise<string> {
    const parts = [eventID, index.toString()];
    return generateIDFromParts(parts);
}

/**
 * Generates a SHA-256 hash from an array of strings.
 */
export async function generateIDFromParts(parts: string[]): Promise<string> {
    const msgUint8 = new TextEncoder().encode(parts.join(':'));

    // Use globalThis to access crypto in both environments
    const cryptoSubtle = globalThis.crypto?.subtle;

    if (!cryptoSubtle) {
        throw new Error('Crypto Subtle API is not available in this environment.');
    }

    const hashBuffer = await cryptoSubtle.digest('SHA-256', msgUint8);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}
