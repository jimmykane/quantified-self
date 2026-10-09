import { describe, expect, it, vi } from 'vitest';
import type { Bucket } from '@google-cloud/storage';
import type * as admin from 'firebase-admin';
import { assertAccountCleanupQueryEmpty, assertAccountStorageAbsent, deleteAccountStorageFiles } from './data-cleanup';

function file(name: string, failure?: number) {
    return { name, metadata: { generation: '12345678901234567' }, delete: vi.fn(async () => {
        if (failure) throw { code: failure };
    }) };
}

function bucketWith(getFiles: ReturnType<typeof vi.fn>, exactObject = {
    getMetadata: vi.fn().mockRejectedValue({ code: 404 }), delete: vi.fn(),
}): Bucket {
    return { getFiles, file: vi.fn(() => exactObject) } as unknown as Bucket;
}

describe('account Storage cleanup', () => {
    it('pages the exact UID folder, pins generations and permits repeated missing-object deletion', async () => {
        const first = file('users/test-owner/events/one.fit');
        const missing = file('users/test-owner/routes/two.gpx', 404);
        const getFiles = vi.fn().mockResolvedValueOnce([[first], { pageToken: 'next' }])
            .mockResolvedValueOnce([[missing], undefined]);
        await deleteAccountStorageFiles('test-owner', bucketWith(getFiles));
        expect(getFiles.mock.calls).toEqual([
            [{ prefix: 'users/test-owner/', maxResults: 100, autoPaginate: false, pageToken: undefined }],
            [{ prefix: 'users/test-owner/', maxResults: 100, autoPaginate: false, pageToken: 'next' }],
        ]);
        expect(first.delete).toHaveBeenCalledWith({ ifGenerationMatch: '12345678901234567' });
        expect(missing.delete).toHaveBeenCalled();
    });

    it('deletes an exact bare UID object without using a collision-prone bare-prefix listing', async () => {
        const getFiles = vi.fn().mockResolvedValue([[], undefined]);
        const exact = { getMetadata: vi.fn().mockResolvedValue([{ generation: '456' }]), delete: vi.fn().mockResolvedValue(undefined) };
        const bucket = bucketWith(getFiles, exact);
        await deleteAccountStorageFiles('test-owner', bucket);
        expect(bucket.file).toHaveBeenCalledWith('users/test-owner');
        expect(exact.delete).toHaveBeenCalledWith({ ifGenerationMatch: '456' });
        expect(getFiles).toHaveBeenCalledWith(expect.objectContaining({ prefix: 'users/test-owner/' }));
        await expect(assertAccountStorageAbsent('test-owner', bucket)).rejects.toThrow('objects remain');
    });

    it.each(["$'", '$&', '$$', '$`'])('treats replacement-pattern UID %s literally in Storage targets', async uid => {
        const owned = file(`users/${uid}/owned.fit`);
        const getFiles = vi.fn().mockResolvedValue([[owned], undefined]);
        const bucket = bucketWith(getFiles);

        await deleteAccountStorageFiles(uid, bucket);

        expect(bucket.file).toHaveBeenCalledWith(`users/${uid}`);
        expect(getFiles).toHaveBeenCalledWith({ prefix: `users/${uid}/`, maxResults: 100, autoPaginate: false, pageToken: undefined });
        expect(owned.delete).toHaveBeenCalledWith({ ifGenerationMatch: '12345678901234567' });
    });

    it('continues independent objects but retries a replaced generation and never deletes a prefix collision', async () => {
        const changed = file('users/test-owner/changed.fit', 412);
        const sibling = file('users/test-owner-extra/private.fit');
        const good = file('users/test-owner/good.fit');
        const bucket = bucketWith(vi.fn().mockResolvedValue([[changed, sibling, good], undefined]));
        await expect(deleteAccountStorageFiles('test-owner', bucket)).rejects.toThrow('did not complete');
        expect(good.delete).toHaveBeenCalled();
        expect(sibling.delete).not.toHaveBeenCalled();
    });

    it('rejects a late upload during absence verification and propagates an unavailable listing', async () => {
        const getFiles = vi.fn().mockResolvedValueOnce([[file('users/test-owner/late.fit')]])
            .mockRejectedValueOnce(new Error('unavailable'));
        await expect(assertAccountStorageAbsent('test-owner', bucketWith(getFiles))).rejects.toThrow('objects remain');
        await expect(assertAccountStorageAbsent('test-owner', bucketWith(getFiles))).rejects.toThrow('unavailable');
    });

    it('fails closed before default Storage I/O outside the configured project', async () => {
        // The test setup uses test-project; only injected synthetic buckets are allowed here.
        await expect(deleteAccountStorageFiles('test-owner')).rejects.toThrow('outside the configured scope');
        await expect(assertAccountStorageAbsent('test-owner')).rejects.toThrow('outside the configured scope');
    });

    it('rejects an invalid UID before privileged Storage I/O', async () => {
        const getFiles = vi.fn();
        await expect(deleteAccountStorageFiles('../another', bucketWith(getFiles))).rejects.toThrow('Invalid');
        expect(getFiles).not.toHaveBeenCalled();
    });
});

describe('operational absence verification', () => {
    it('fails on remaining owned rows but preserves rows excluded by the existing owner filter', async () => {
        const query = { get: vi.fn().mockResolvedValue({ docs: [{ id: 'other' }, { id: 'owned' }] }), limit: vi.fn(() => query) };
        const filtered = (doc: { id: string }) => Promise.resolve(doc.id === 'owned');
        await expect(assertAccountCleanupQueryEmpty(query as unknown as admin.firestore.Query, filtered)).rejects.toThrow('remains');
        await expect(assertAccountCleanupQueryEmpty(query as unknown as admin.firestore.Query, async () => false)).resolves.toBeUndefined();
    });
});
