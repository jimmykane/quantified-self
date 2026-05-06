import { describe, it, expect, vi } from 'vitest';
import { getExpireAtTimestamp, TTL_CONFIG } from './ttl-config';
import * as admin from 'firebase-admin';
import { Timestamp as FirestoreTimestamp } from 'firebase-admin/firestore';

const { mockNamespaceFromDate, mockFallbackFromDate } = vi.hoisted(() => ({
    mockNamespaceFromDate: vi.fn((date: Date) => ({
        toDate: () => date,
        toMillis: () => date.getTime()
    })),
    mockFallbackFromDate: vi.fn((date: Date) => ({
        toDate: () => date,
        toMillis: () => date.getTime()
    }))
}));

// Mock firebase-admin namespace API
vi.mock('firebase-admin', () => ({
    firestore: {
        Timestamp: {
            fromDate: mockNamespaceFromDate
        }
    }
}));

// Mock firebase-admin/firestore module API
vi.mock('firebase-admin/firestore', () => ({
    Timestamp: {
        fromDate: mockFallbackFromDate
    }
}));

describe('TTL Configuration', () => {
    it('should have correct configuration values', () => {
        expect(TTL_CONFIG.MAIL_IN_DAYS).toBe(90);
        expect(TTL_CONFIG.QUEUE_ITEM_IN_DAYS).toBe(7);
        expect(TTL_CONFIG.SPORTS_LIB_REPARSE_JOBS_IN_DAYS).toBe(30);
        expect(TTL_CONFIG.AI_INSIGHTS_PROMPT_REPAIRS_IN_DAYS).toBe(90);
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
            expect(admin.firestore.Timestamp.fromDate).toHaveBeenCalled(); // Verify namespace usage

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

        it('should fallback to firestore module Timestamp when namespace Timestamp is unavailable', () => {
            const now = 1672531200000; // 2023-01-01T00:00:00.000Z
            vi.useFakeTimers();
            vi.setSystemTime(now);
            mockNamespaceFromDate.mockClear();
            mockFallbackFromDate.mockClear();

            const originalTimestamp = (admin as any).firestore.Timestamp;
            (admin as any).firestore.Timestamp = undefined;
            try {
                const days = 1;
                const expectedTime = now + (days * 24 * 60 * 60 * 1000);
                const timestamp = getExpireAtTimestamp(days);
                expect(timestamp.toMillis()).toBe(expectedTime);
                expect(mockNamespaceFromDate).not.toHaveBeenCalled();
                expect(mockFallbackFromDate).toHaveBeenCalledOnce();
                expect((FirestoreTimestamp as any).fromDate).toBe(mockFallbackFromDate);
            } finally {
                (admin as any).firestore.Timestamp = originalTimestamp;
                vi.useRealTimers();
            }
        });
    });
});
