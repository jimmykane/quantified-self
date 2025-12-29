import { describe, it, expect } from 'vitest';
import { generateEventID, generateActivityID, generateIDFromParts } from './id-generator';

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

    it('should generate the same ID for events within the tolerance window (20s)', async () => {
        // Within the same 20s bucket (depending on where baseTime falls relative to the bucket boundary)
        // Let's pick a baseTime that is clearly in the middle of a bucket to test offsets
        // 20000 ms buckets start at 0.
        // 10000 is in the middle of 0-20000.
        const safeBaseDate = new Date(10000);
        const id1 = await generateEventID(userID, safeBaseDate);
        const id2 = await generateEventID(userID, new Date(safeBaseDate.getTime() + 5000)); // +5s

        expect(id1).toBe(id2);
    });

    it('should generate different IDs for events outside the tolerance window', async () => {
        const baseTime = 10000; // Middle of 0-20000 bucket
        const id1 = await generateEventID(userID, new Date(baseTime));
        const id2 = await generateEventID(userID, new Date(baseTime + 21000)); // +21s, definitely in next bucket

        expect(id1).not.toBe(id2);
    });

    it('should handle bucket boundaries correctly', async () => {
        // Bucket 1: 0 - 19999
        // Bucket 2: 20000 - 39999

        const endOfBucket1 = new Date(19999);
        const startOfBucket2 = new Date(20000);

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

    it('should generate valid SHA-256 hex strings', async () => {
        const id = await generateIDFromParts(['test']);
        // sha256('test') = 9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08
        expect(id).toBe('9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08');
    });
});
