/**
 * Shared ID generator for deterministic event and activity IDs.
 * Works in both browser and Node.js using SubtleCrypto for SHA-256.
 */

/**
 * Generates a deterministic ID for an event based on the user ID and start date.
 */
export async function generateEventID(userID: string, startDate: Date): Promise<string> {
    // Note: startDate.getTime() is used for consistency.
    const parts = [userID, startDate.getTime().toString()];
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
