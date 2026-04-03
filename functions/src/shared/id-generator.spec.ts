import { describe, it, expect } from 'vitest';
import {
    generateEventID,
    generateActivityID,
    generateActivityIDFromSourceKey,
    generateIDFromParts,
    EVENT_DUPLICATE_THRESHOLD_MS,
} from './id-generator';

describe('ID Generator', () => {
    const userID = 'user123';
    const startDate = new Date('2025-12-28T12:00:00Z');
    const eventID = 'e75d5c1-8175-4807-a1fb-e17f8ead7b57'; // Mock/Example ID

    it('should generate a consistent event ID', async () => {
        const id1 = await generateEventID(userID, startDate);
        const id2 = await generateEventID(userID, startDate);

        expect(id1).toBe(id2);
        expect(typeof id1).toBe('string');
        expect(id1.length).toBeGreaterThan(0);
    });

    it(`should generate the same ID for events within the tolerance window (${EVENT_DUPLICATE_THRESHOLD_MS}ms)`, async () => {
        // Within the same bucket
        // Buckets start at 0.
        // baseTime is in the middle of 0-EVENT_DUPLICATE_THRESHOLD_MS.
        const baseTime = EVENT_DUPLICATE_THRESHOLD_MS / 2;
        const safeBaseDate = new Date(baseTime);
        const id1 = await generateEventID(userID, safeBaseDate);
        const id2 = await generateEventID(userID, new Date(safeBaseDate.getTime() + (EVENT_DUPLICATE_THRESHOLD_MS * 0.2))); // +20% of threshold

        expect(id1).toBe(id2);
    });

    it('should generate different IDs for events outside the tolerance window', async () => {
        const baseTime = EVENT_DUPLICATE_THRESHOLD_MS / 2; // Middle of bucket
        const id1 = await generateEventID(userID, new Date(baseTime));
        const id2 = await generateEventID(userID, new Date(baseTime + EVENT_DUPLICATE_THRESHOLD_MS + 10)); // +Threshold + 10ms, definitely in next bucket

        expect(id1).not.toBe(id2);
    });

    it('should handle bucket boundaries correctly', async () => {
        // Bucket 1: 0 - (THRESHOLD - 1)
        // Bucket 2: THRESHOLD - (2*THRESHOLD - 1)

        const endOfBucket1 = new Date(EVENT_DUPLICATE_THRESHOLD_MS - 1);
        const startOfBucket2 = new Date(EVENT_DUPLICATE_THRESHOLD_MS);

        const id1 = await generateEventID(userID, endOfBucket1);
        const id2 = await generateEventID(userID, startOfBucket2);

        expect(id1).not.toBe(id2);
    });

    it('should generate different IDs for different users', async () => {
        const id1 = await generateEventID('user1', startDate);
        const id2 = await generateEventID('user2', startDate);

        expect(id1).not.toBe(id2);
    });

    it('should generate different IDs for significantly different dates', async () => {
        const id1 = await generateEventID(userID, new Date('2025-12-28T12:00:00Z'));
        const id2 = await generateEventID(userID, new Date('2025-12-28T13:00:00Z'));

        expect(id1).not.toBe(id2);
    });

    it('should generate a consistent activity ID', async () => {
        const id1 = await generateActivityID(eventID, 0);
        const id2 = await generateActivityID(eventID, 0);

        expect(id1).toBe(id2);
    });

    it('should generate different IDs for different activity indices', async () => {
        const id1 = await generateActivityID(eventID, 0);
        const id2 = await generateActivityID(eventID, 1);

        expect(id1).not.toBe(id2);
    });

    it('should generate a consistent activity ID from source activity key', async () => {
        const key = 'sha256:key:0';
        const id1 = await generateActivityIDFromSourceKey(eventID, key);
        const id2 = await generateActivityIDFromSourceKey(eventID, key);

        expect(id1).toBe(id2);
    });

    it('should generate different activity IDs for different source activity keys', async () => {
        const id1 = await generateActivityIDFromSourceKey(eventID, 'sha256:key:0');
        const id2 = await generateActivityIDFromSourceKey(eventID, 'sha256:key:1');

        expect(id1).not.toBe(id2);
    });

    it('should generate valid SHA-256 hex strings', async () => {
        const id = await generateIDFromParts(['test']);
        // sha256('test') = 9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08
        expect(id).toBe('9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08');
    });

    // Zero-threshold tests (for frontend uploads)
    describe('with thresholdMs = 0 (no bucketing)', () => {
        it('should use exact timestamp when thresholdMs is 0', async () => {
            const date = new Date('2025-12-28T12:00:00.000Z');
            const id1 = await generateEventID(userID, date, 0);
            const id2 = await generateEventID(userID, date, 0);

            expect(id1).toBe(id2); // Same timestamp = same ID
        });

        it('should generate different IDs for events 1ms apart when thresholdMs is 0', async () => {
            const date1 = new Date('2025-12-28T12:00:00.000Z');
            const date2 = new Date('2025-12-28T12:00:00.001Z'); // 1ms later

            const id1 = await generateEventID(userID, date1, 0);
            const id2 = await generateEventID(userID, date2, 0);

            expect(id1).not.toBe(id2); // Different timestamps = different IDs
        });

        it('should generate same ID with default bucketing but different with thresholdMs=0', async () => {
            const date1 = new Date(50); // 50ms
            const date2 = new Date(60); // 60ms (within default 100ms bucket)

            // Default bucketing: same bucket
            const idDefault1 = await generateEventID(userID, date1);
            const idDefault2 = await generateEventID(userID, date2);
            expect(idDefault1).toBe(idDefault2);

            // No bucketing: different timestamps
            const idExact1 = await generateEventID(userID, date1, 0);
            const idExact2 = await generateEventID(userID, date2, 0);
            expect(idExact1).not.toBe(idExact2);
        });
    });
});
