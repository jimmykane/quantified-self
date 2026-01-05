import { describe, it, expect, vi } from 'vitest';
import { getExpireAtTimestamp, TTL_CONFIG } from './ttl-config';
import * as admin from 'firebase-admin';

// Mock firebase-admin
vi.mock('firebase-admin', () => ({
    firestore: {
        Timestamp: {
            fromDate: vi.fn((date: Date) => ({
                toDate: () => date,
                toMillis: () => date.getTime()
            }))
        }
    }
}));

describe('TTL Configuration', () => {
    it('should have correct configuration values', () => {
        expect(TTL_CONFIG.MAIL_IN_DAYS).toBe(90);
        expect(TTL_CONFIG.QUEUE_ITEM_IN_DAYS).toBe(7);
    });

    describe('getExpireAtTimestamp', () => {
        it('should return a timestamp for the future based on days provided', () => {
            const now = 1672531200000; // 2023-01-01T00:00:00.000Z
            vi.useFakeTimers();
            vi.setSystemTime(now);

            const days = 10;
            const expectedTime = now + (days * 24 * 60 * 60 * 1000);

            const timestamp = getExpireAtTimestamp(days);

            expect(timestamp.toMillis()).toBe(expectedTime);
            expect(admin.firestore.Timestamp.fromDate).toHaveBeenCalled(); // Verify mock usage

            vi.useRealTimers();
        });

        it('should correctly calculate MAIL expiration', () => {
            const now = Date.now();
            vi.useFakeTimers();
            vi.setSystemTime(now);

            const timestamp = getExpireAtTimestamp(TTL_CONFIG.MAIL_IN_DAYS);
            const expectedTime = now + (90 * 24 * 60 * 60 * 1000);

            expect(timestamp.toMillis()).toBe(expectedTime);

            vi.useRealTimers();
        });
    });
});
