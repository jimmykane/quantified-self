import { beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => {
    const shouldEventBeReparsed = vi.fn();
    const hasPaidOrGraceAccess = vi.fn();
    const extractSourceFiles = vi.fn();
    const reparseEventFromOriginalFiles = vi.fn();
    const resolveTargetSportsLibVersion = vi.fn(() => '9.0.99');
    const writeReparseStatus = vi.fn();
    const parseUidAndEventIdFromEventPath = vi.fn((path: string) => {
        const parts = path.split('/');
        return { uid: parts[1], eventId: parts[3] };
    });

    const collectionGet = vi.fn();
    const collectionGroupGet = vi.fn();
    const collection = vi.fn(() => ({
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        startAfter: vi.fn().mockReturnThis(),
        get: collectionGet,
    }));
    const collectionGroup = vi.fn(() => ({
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        startAfter: vi.fn().mockReturnThis(),
        get: collectionGroupGet,
    }));

    const firestoreDoc = vi.fn((path: string) => ({ path }));
    const initializeApp = vi.fn();

    const serverTimestamp = vi.fn(() => 'SERVER_TIMESTAMP');

    return {
        shouldEventBeReparsed,
        hasPaidOrGraceAccess,
        extractSourceFiles,
        reparseEventFromOriginalFiles,
        resolveTargetSportsLibVersion,
        writeReparseStatus,
        parseUidAndEventIdFromEventPath,
        collectionGet,
        collectionGroupGet,
        collection,
        collectionGroup,
        firestoreDoc,
        initializeApp,
        serverTimestamp,
    };
});

vi.mock('../reparse/sports-lib-reparse.service', () => ({
    SPORTS_LIB_REPARSE_SKIP_REASON_NO_ORIGINAL_FILES: 'NO_ORIGINAL_FILES',
    shouldEventBeReparsed: hoisted.shouldEventBeReparsed,
    hasPaidOrGraceAccess: hoisted.hasPaidOrGraceAccess,
    extractSourceFiles: hoisted.extractSourceFiles,
    reparseEventFromOriginalFiles: hoisted.reparseEventFromOriginalFiles,
    resolveTargetSportsLibVersion: hoisted.resolveTargetSportsLibVersion,
    writeReparseStatus: hoisted.writeReparseStatus,
    parseUidAndEventIdFromEventPath: hoisted.parseUidAndEventIdFromEventPath,
}));

vi.mock('firebase-admin', () => {
    const firestoreFn = vi.fn(() => ({
        collection: hoisted.collection,
        collectionGroup: hoisted.collectionGroup,
        doc: hoisted.firestoreDoc,
    }));
    Object.assign(firestoreFn, {
        FieldValue: {
            serverTimestamp: hoisted.serverTimestamp,
        },
        FieldPath: {
            documentId: () => '__name__',
        },
    });

    return {
        apps: [],
        initializeApp: hoisted.initializeApp,
        firestore: firestoreFn,
    };
});

import { parseScriptOptions, runSportsLibReparseScript } from './reparse-sports-lib-events';

function makeEventDoc(path: string, data: Record<string, unknown> = {}): any {
    return {
        ref: { path },
        data: () => data,
    };
}

describe('reparse-sports-lib-events script', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        hoisted.shouldEventBeReparsed.mockResolvedValue(true);
        hoisted.hasPaidOrGraceAccess.mockResolvedValue(true);
        hoisted.extractSourceFiles.mockReturnValue([{ path: 'users/u1/events/e1/original.fit' }]);
        hoisted.reparseEventFromOriginalFiles.mockResolvedValue({
            status: 'completed',
            sourceFilesCount: 1,
            parsedActivitiesCount: 1,
            staleActivitiesDeleted: 0,
        });

        hoisted.collectionGet.mockResolvedValue({
            docs: [makeEventDoc('users/u1/events/e1', { originalFile: { path: 'x.fit' } })],
        });
        hoisted.collectionGroupGet.mockResolvedValue({
            docs: [makeEventDoc('users/u1/events/e1', { originalFile: { path: 'x.fit' } })],
        });
    });

    it('parseScriptOptions should default to dry-run', () => {
        const options = parseScriptOptions([]);
        expect(options.execute).toBe(false);
        expect(options.limit).toBe(200);
    });

    it('runSportsLibReparseScript should not write in dry-run mode', async () => {
        const summary = await runSportsLibReparseScript(['--uid', 'u1']);
        expect(summary.dryRun).toBe(true);
        expect(summary.candidates).toBe(1);
        expect(summary.completed).toBe(0);
        expect(hoisted.reparseEventFromOriginalFiles).not.toHaveBeenCalled();
        expect(hoisted.writeReparseStatus).not.toHaveBeenCalled();
    });

    it('runSportsLibReparseScript should execute reparse when --execute is provided', async () => {
        const summary = await runSportsLibReparseScript(['--execute', '--uid', 'u1']);
        expect(summary.dryRun).toBe(false);
        expect(summary.completed).toBe(1);
        expect(hoisted.reparseEventFromOriginalFiles).toHaveBeenCalledWith('u1', 'e1', {
            targetSportsLibVersion: '9.0.99',
        });
        expect(hoisted.writeReparseStatus).toHaveBeenCalledWith('u1', 'e1', expect.objectContaining({
            status: 'completed',
        }));
    });

    it('runSportsLibReparseScript should mark missing-source events as skipped when executing', async () => {
        hoisted.extractSourceFiles.mockReturnValue([]);

        const summary = await runSportsLibReparseScript(['--execute', '--uid', 'u1']);

        expect(summary.skippedNoSourceFiles).toBe(1);
        expect(hoisted.writeReparseStatus).toHaveBeenCalledWith('u1', 'e1', expect.objectContaining({
            status: 'skipped',
            reason: 'NO_ORIGINAL_FILES',
        }));
        expect(hoisted.reparseEventFromOriginalFiles).not.toHaveBeenCalled();
    });
});
