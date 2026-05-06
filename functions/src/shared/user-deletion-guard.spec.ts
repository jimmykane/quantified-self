import { describe, expect, it, vi } from 'vitest';

import { isUserDeletionTombstoneActive } from './user-deletion-guard';

describe('user deletion guard', () => {
    it('treats a tombstone with no expireAt as active', () => {
        expect(isUserDeletionTombstoneActive({}, Date.UTC(2026, 4, 6))).toBe(true);
    });

    it('treats future expireAt as active', () => {
        expect(isUserDeletionTombstoneActive({
            expireAt: { toMillis: () => Date.UTC(2026, 4, 7) },
        }, Date.UTC(2026, 4, 6))).toBe(true);
    });

    it('treats expired tombstones as inactive without deleting them', () => {
        const deleteSpy = vi.fn();
        expect(isUserDeletionTombstoneActive({
            expireAt: {
                toMillis: () => Date.UTC(2026, 4, 5),
                delete: deleteSpy,
            },
        }, Date.UTC(2026, 4, 6))).toBe(false);
        expect(deleteSpy).not.toHaveBeenCalled();
    });
});
