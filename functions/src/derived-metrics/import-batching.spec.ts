import { afterEach, describe, expect, it, vi } from 'vitest';
vi.unmock('@sports-alliance/sports-lib');
const mocks = vi.hoisted(() => ({ doc: vi.fn((path: string) => ({ path })) }));
vi.mock('firebase-admin', () => ({ firestore: () => ({ doc: mocks.doc }) }));
import { derivedImportBuildIntervalMs, isDerivedImportBatchingEnabled } from './import-batching';

const now = Date.parse('2026-10-22T06:00:00Z');
const history = { active: true, runId: '11111111-1111-4111-8111-111111111111', updatedAtMs: now };
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });
describe('derived history import batching policy', () => {
    it('is default-off and requires an exact pilot owner, with no wildcard', async () => {
        vi.stubEnv('DERIVED_METRICS_IMPORT_BATCH_UIDS', '');
        const getAll = vi.fn();
        expect(await derivedImportBuildIntervalMs({ getAll } as unknown as FirebaseFirestore.Transaction, 'owner', now, 120_000)).toBe(120_000);
        expect(getAll).not.toHaveBeenCalled();
        vi.stubEnv('DERIVED_METRICS_IMPORT_BATCH_UIDS', ' owner, other ');
        expect(isDerivedImportBatchingEnabled('owner')).toBe(true);
        expect(isDerivedImportBatchingEnabled('own')).toBe(false);
        expect(isDerivedImportBatchingEnabled('')).toBe(false);
        vi.stubEnv('DERIVED_METRICS_IMPORT_BATCH_UIDS', '*');
        expect(isDerivedImportBatchingEnabled('owner')).toBe(false);
        expect(isDerivedImportBatchingEnabled('*')).toBe(false);
    });
    it.each([0, 1, 2, 3])('recognizes a fresh active import at provider position %s with four masked reads', async position => {
        vi.stubEnv('DERIVED_METRICS_IMPORT_BATCH_UIDS', 'owner');
        const getAll = vi.fn(async () => Array.from({ length: 4 }, (_, i) => ({ data: () => i === position ? { connectionHistoryImport: history } : undefined })));
        expect(await derivedImportBuildIntervalMs({ getAll } as unknown as FirebaseFirestore.Transaction, 'owner', now, 120_000)).toBe(300_000);
        expect(mocks.doc.mock.calls.map(([path]) => path)).toEqual([
            'users/owner/meta/Suunto app', 'users/owner/meta/Garmin API', 'users/owner/meta/COROS API', 'users/owner/meta/Wahoo API',
        ]);
        expect(getAll).toHaveBeenCalledWith(...mocks.doc.mock.results.map(result => result.value),
            { fieldMask: ['connectionHistoryImport'] });
    });
    it.each([
        { active: false }, { runId: 'invalid' }, { updatedAtMs: now + 1 },
        { updatedAtMs: now - 15 * 60_000 - 1 }, { updatedAtMs: 'now' },
    ])('falls back for completed, stale or malformed import checkpoints: %j', async patch => {
        vi.stubEnv('DERIVED_METRICS_IMPORT_BATCH_UIDS', 'owner');
        const getAll = vi.fn(async () => [{ data: () => ({ connectionHistoryImport: { ...history, ...patch } }) }]);
        expect(await derivedImportBuildIntervalMs({ getAll } as unknown as FirebaseFirestore.Transaction, 'owner', now, 120_000)).toBe(120_000);
    });
    it('keeps a metadata read outage retryable', async () => {
        vi.stubEnv('DERIVED_METRICS_IMPORT_BATCH_UIDS', 'owner');
        const getAll = vi.fn().mockRejectedValue(new Error('synthetic outage'));
        await expect(derivedImportBuildIntervalMs({ getAll } as unknown as FirebaseFirestore.Transaction, 'owner', now, 120_000)).rejects.toThrow('synthetic outage');
    });
});
