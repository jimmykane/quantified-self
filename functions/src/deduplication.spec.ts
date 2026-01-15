import { describe, it, expect } from 'vitest';
import { generateEventID } from './shared/id-generator';

describe('Cross-Service Deduplication', () => {
    const userID = 'user123';
    // Base time: 2026-01-14T10:00:00.000Z
    const baseDate = new Date('2026-01-14T10:00:00.000Z');

    it('should generate the same ID for dates within the same 100ms bucket', async () => {
        const date1 = new Date(baseDate.getTime() + 10); // 10:00:00.010
        const date2 = new Date(baseDate.getTime() + 50); // 10:00:00.050

        const id1 = await generateEventID(userID, date1);
        const id2 = await generateEventID(userID, date2);

        expect(id1).toBe(id2);
    });

    it('should generate different IDs for dates in different 100ms buckets', async () => {
        const date1 = new Date(baseDate.getTime() + 10);  // 10:00:00.010
        const date2 = new Date(baseDate.getTime() + 110); // 10:00:00.110

        const id1 = await generateEventID(userID, date1);
        const id2 = await generateEventID(userID, date2);

        expect(id1).not.toBe(id2);
    });

    it('should generate the same ID regardless of service if userID and bucketed time match', async () => {
        // This simulates a Garmin import and a Suunto import of the same activity
        const garminDate = new Date('2026-01-14T10:00:00.000Z');
        const suuntoDate = new Date('2026-01-14T10:00:00.050Z'); // 50ms drift

        const garminEventID = await generateEventID(userID, garminDate);
        const suuntoEventID = await generateEventID(userID, suuntoDate);

        expect(garminEventID).toBe(suuntoEventID);
    });
});
