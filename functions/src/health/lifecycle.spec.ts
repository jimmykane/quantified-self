import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type * as admin from 'firebase-admin';
import { ACCOUNT_DELETION_ROOT_COLLECTIONS, deleteAccountFirestoreRoot } from '../users/data-cleanup';

describe('unified health account lifecycle', () => {
    it('uses native recursive user cleanup after extension retirement', async () => {
        const manifest = JSON.parse(readFileSync(
            resolve(__dirname, '../../../firebase.json'),
            'utf8',
        ));
        expect(manifest.extensions).not.toHaveProperty('delete-user-data');
        expect(ACCOUNT_DELETION_ROOT_COLLECTIONS).toContain('users');

        const db = {
            collection: (collection: string) => ({ doc: (id: string) => ({ path: `${collection}/${id}` }) }),
            recursiveDelete: vi.fn().mockResolvedValue(undefined),
        };
        // Deleting the complete user tree includes Health records, chunks, sync
        // state and deletion receipts, plus Timeline notes and their receipts.
        await deleteAccountFirestoreRoot(db as unknown as admin.firestore.Firestore, 'test-owner', 'users');
        expect(db.recursiveDelete).toHaveBeenCalledExactlyOnceWith({ path: 'users/test-owner' });
    });
});
