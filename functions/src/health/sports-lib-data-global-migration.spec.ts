import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as admin from 'firebase-admin';
import {
    type SportsLibDataMigrationSummary,
} from './sports-lib-data-migration';

const hoisted = vi.hoisted(() => ({
    loggerInfo: vi.fn(),
    loggerError: vi.fn(),
}));

vi.mock('firebase-functions/logger', () => ({
    info: hoisted.loggerInfo,
    error: hoisted.loggerError,
}));

import {
    hasBlockingSportsLibDataGlobalMigrationResult,
    listUsersForGlobalMigration,
    parseSportsLibDataGlobalMigrationOptions,
    runSportsLibDataGlobalMigration,
    sportsLibDataGlobalCheckpoint,
    type SportsLibDataGlobalMigrationDependencies,
} from './sports-lib-data-global-migration';

const fakeDb = {} as admin.firestore.Firestore;
const activeGuard = {
    userExists: true,
    deletionInProgress: false,
    shouldSkip: false,
};

function kindFromArgs(argv: readonly string[]) {
    return argv[argv.indexOf('--kind') + 1] as 'health' | 'sleep';
}

function migrationSummary(
    kind: 'health' | 'sleep',
    overrides: Partial<SportsLibDataMigrationSummary> = {},
): SportsLibDataMigrationSummary {
    return {
        dryRun: true,
        kind,
        concurrency: 5,
        scanned: 1,
        candidates: 0,
        migrated: 0,
        unchanged: 1,
        skippedInvalid: 0,
        skippedDeletedUser: 0,
        skippedMissing: 0,
        failed: 0,
        nextStartAfter: null,
        ...overrides,
    };
}

function dependencies(
    userIDs: string[],
    runMigration = vi.fn(async (argv: readonly string[]) => migrationSummary(kindFromArgs(argv))),
): SportsLibDataGlobalMigrationDependencies {
    return {
        db: fakeDb,
        listUsers: vi.fn(async () => ({ userIDs, hasMore: false })),
        getDeletionGuard: vi.fn(async () => activeGuard),
        hasUserData: vi.fn(async () => ({ health: true, sleep: true })),
        runMigration,
    };
}

function querySnapshot(ids: string[]) {
    return {
        docs: ids.map(id => ({ id })),
        size: ids.length,
    };
}

function fakeQuery(snapshot: ReturnType<typeof querySnapshot>) {
    const query = {
        orderBy: vi.fn(),
        limit: vi.fn(),
        startAfter: vi.fn(),
        select: vi.fn(),
        get: vi.fn(async () => snapshot),
    };
    query.orderBy.mockReturnValue(query);
    query.limit.mockReturnValue(query);
    query.startAfter.mockReturnValue(query);
    query.select.mockReturnValue(query);
    return query;
}

describe('global Health and Sleep Sports Lib data migration', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('parses safe bounded cohort options and defaults to a dry run', () => {
        expect(parseSportsLibDataGlobalMigrationOptions([
            '--max-users', '25',
            '--scan-limit=500',
            '--document-limit', '200',
            '--document-concurrency', '8',
            '--start-after', 'a'.repeat(64),
        ])).toEqual({
            execute: false,
            maxUsers: 25,
            scanLimit: 500,
            documentLimit: 200,
            documentConcurrency: 8,
            startAfter: 'a'.repeat(64),
        });
        expect(parseSportsLibDataGlobalMigrationOptions(['--execute'])).toEqual({
            execute: true,
            maxUsers: 5,
            scanLimit: 100,
            documentLimit: 100,
            documentConcurrency: 5,
            startAfter: undefined,
        });
    });

    it.each([
        ['--max-users', '0'],
        ['--max-users', '101'],
        ['--scan-limit', '5001'],
        ['--document-limit', '251'],
        ['--document-concurrency', '11'],
        ['--document-concurrency', '1.5'],
        ['--start-after', 'raw-user-id'],
        ['--execute=true'],
        ['--execute', '--execute'],
        ['--unknown'],
    ])('rejects unsafe or unbounded arguments %#', (...argv) => {
        expect(() => parseSportsLibDataGlobalMigrationOptions(argv)).toThrow();
    });

    it('creates a stable opaque checkpoint that does not contain the user ID', () => {
        const checkpoint = sportsLibDataGlobalCheckpoint('private-user-id', false);
        expect(checkpoint).toMatch(/^[a-f0-9]{64}$/);
        expect(checkpoint).toBe(sportsLibDataGlobalCheckpoint('private-user-id', false));
        expect(checkpoint).not.toContain('private-user-id');
        expect(checkpoint).not.toBe(sportsLibDataGlobalCheckpoint('other-user-id', false));
        expect(checkpoint).not.toBe(sportsLibDataGlobalCheckpoint('private-user-id', true));
    });

    it('resolves an opaque checkpoint using field-masked user document names', async () => {
        const lookup = fakeQuery(querySnapshot(['private-user-1', 'private-user-2']));
        const page = fakeQuery(querySnapshot(['private-user-2', 'private-user-3']));
        const queries = [lookup, page];
        const db = {
            collection: vi.fn(() => queries.shift()),
        } as unknown as admin.firestore.Firestore;

        const result = await listUsersForGlobalMigration(
            db,
            sportsLibDataGlobalCheckpoint('private-user-1', false),
            1,
            false,
        );

        expect(result).toEqual({ userIDs: ['private-user-2'], hasMore: true });
        expect(lookup.select).toHaveBeenCalledWith();
        expect(page.startAfter).toHaveBeenCalledWith('private-user-1');
        expect(page.select).toHaveBeenCalledWith();
    });

    it('rejects a dry-run checkpoint when starting an execution cohort', async () => {
        const lookup = fakeQuery(querySnapshot(['private-user-1']));
        const db = {
            collection: vi.fn(() => lookup),
        } as unknown as admin.firestore.Firestore;

        await expect(listUsersForGlobalMigration(
            db,
            sportsLibDataGlobalCheckpoint('private-user-1', false),
            1,
            true,
        )).rejects.toThrow('checkpoint could not be resolved');
        expect(lookup.select).toHaveBeenCalledWith();
    });

    it('runs a bounded dry-run cohort and exposes only an opaque user checkpoint', async () => {
        const runMigration = vi.fn(async (argv: readonly string[]) => migrationSummary(
            kindFromArgs(argv),
            { candidates: 1, unchanged: 0 },
        ));
        const deps = dependencies(
            ['private-user-1', 'private-user-2', 'private-user-3'],
            runMigration,
        );

        const summary = await runSportsLibDataGlobalMigration([
            '--max-users', '2',
        ], deps);

        expect(summary).toMatchObject({
            dryRun: true,
            scannedUsers: 2,
            usersWithData: 2,
            usersProcessed: 2,
            usersMigrated: 0,
            hasMoreUsers: true,
            nextStartAfter: sportsLibDataGlobalCheckpoint('private-user-2', false),
            health: { preflightCandidates: 2 },
            sleep: { preflightCandidates: 2 },
        });
        expect(runMigration).toHaveBeenCalledTimes(4);
        expect(runMigration.mock.calls.every(([, options]) => options?.db === fakeDb)).toBe(true);
        expect(runMigration.mock.calls.flatMap(([argv]) => argv)).not.toContain('--execute');
        const publicOutput = JSON.stringify({ summary, logs: hoisted.loggerInfo.mock.calls });
        expect(publicOutput).not.toContain('private-user-1');
        expect(publicOutput).not.toContain('private-user-2');
        expect(publicOutput).not.toContain('private-user-3');
    });

    it('executes Health then Sleep with zero-candidate postchecks before advancing', async () => {
        const responses = [
            migrationSummary('health', { candidates: 2, unchanged: 0 }),
            migrationSummary('sleep', { candidates: 3, unchanged: 0 }),
            migrationSummary('health', { dryRun: false, candidates: 2, migrated: 2, unchanged: 0 }),
            migrationSummary('health', { candidates: 0, unchanged: 1 }),
            migrationSummary('sleep', { dryRun: false, candidates: 3, migrated: 3, unchanged: 0 }),
            migrationSummary('sleep', { candidates: 0, unchanged: 1 }),
        ];
        const runMigration = vi.fn(async () => responses.shift()!);
        const deps = dependencies(['private-user-1'], runMigration);

        const summary = await runSportsLibDataGlobalMigration(['--execute'], deps);

        expect(runMigration.mock.calls.map(([argv]) => ({
            kind: kindFromArgs(argv),
            execute: argv.includes('--execute'),
        }))).toEqual([
            { kind: 'health', execute: false },
            { kind: 'sleep', execute: false },
            { kind: 'health', execute: true },
            { kind: 'health', execute: false },
            { kind: 'sleep', execute: true },
            { kind: 'sleep', execute: false },
        ]);
        expect(summary).toMatchObject({
            usersProcessed: 1,
            usersMigrated: 1,
            failedUsers: 0,
            health: { migrated: 2, postcheckCandidates: 0 },
            sleep: { migrated: 3, postcheckCandidates: 0 },
        });
        expect(hasBlockingSportsLibDataGlobalMigrationResult(summary)).toBe(false);
    });

    it('stops before the next user and retains the prior checkpoint on failure', async () => {
        const runMigration = vi.fn(async (argv: readonly string[]) => {
            const userID = argv[argv.indexOf('--uid') + 1];
            if (userID === 'private-user-2' && kindFromArgs(argv) === 'health') {
                return migrationSummary('health', { failed: 1, unchanged: 0 });
            }
            return migrationSummary(kindFromArgs(argv));
        });
        const deps = dependencies(
            ['private-user-1', 'private-user-2', 'private-user-3'],
            runMigration,
        );

        const summary = await runSportsLibDataGlobalMigration(['--max-users', '3'], deps);

        expect(summary).toMatchObject({
            usersProcessed: 1,
            failedUsers: 1,
            hasMoreUsers: true,
            nextStartAfter: sportsLibDataGlobalCheckpoint('private-user-1', false),
            health: { failed: 1 },
        });
        expect(JSON.stringify(runMigration.mock.calls)).not.toContain('private-user-3');
        expect(hasBlockingSportsLibDataGlobalMigrationResult(summary)).toBe(true);
    });

    it('does not start Sleep or advance after a nonzero Health postcheck', async () => {
        const responses = [
            migrationSummary('health'),
            migrationSummary('sleep'),
            migrationSummary('health', { candidates: 1, unchanged: 0 }),
            migrationSummary('sleep'),
            migrationSummary('health', {
                dryRun: false,
                candidates: 1,
                migrated: 1,
                unchanged: 0,
            }),
            migrationSummary('health', { candidates: 1, unchanged: 0 }),
        ];
        const runMigration = vi.fn(async () => responses.shift()!);
        const deps = dependencies(['private-user-1', 'private-user-2'], runMigration);

        const summary = await runSportsLibDataGlobalMigration([
            '--execute',
            '--max-users', '2',
        ], deps);

        expect(runMigration.mock.calls.map(([argv]) => ({
            kind: kindFromArgs(argv),
            execute: argv.includes('--execute'),
        }))).toEqual([
            { kind: 'health', execute: false },
            { kind: 'sleep', execute: false },
            { kind: 'health', execute: false },
            { kind: 'sleep', execute: false },
            { kind: 'health', execute: true },
            { kind: 'health', execute: false },
        ]);
        expect(summary).toMatchObject({
            usersProcessed: 1,
            usersMigrated: 0,
            failedUsers: 1,
            nextStartAfter: sportsLibDataGlobalCheckpoint('private-user-1', true),
            health: { migrated: 1, postcheckCandidates: 1 },
            sleep: { migrated: 0, postcheckCandidates: 0 },
        });
        expect(hasBlockingSportsLibDataGlobalMigrationResult(summary)).toBe(true);
    });

    it('reports user-inspection failures without logging or checkpointing that user', async () => {
        const deps = dependencies(['private-user-1']);
        vi.mocked(deps.getDeletionGuard!).mockRejectedValueOnce(new Error('private-user-1'));

        const summary = await runSportsLibDataGlobalMigration([], deps);

        expect(summary).toMatchObject({
            scannedUsers: 1,
            usersProcessed: 0,
            failedUsers: 1,
            hasMoreUsers: true,
            nextStartAfter: null,
        });
        expect(JSON.stringify({ summary, logs: hoisted.loggerError.mock.calls }))
            .not.toContain('private-user-1');
    });

    it('follows private document cursors internally without leaking them', async () => {
        const runMigration = vi.fn()
            .mockResolvedValueOnce(migrationSummary('health', {
                candidates: 1,
                unchanged: 0,
                nextStartAfter: 'private-document-cursor',
            }))
            .mockResolvedValueOnce(migrationSummary('health', { candidates: 1, unchanged: 0 }))
            .mockResolvedValueOnce(migrationSummary('sleep'));
        const deps = dependencies(['private-user-1'], runMigration);

        const summary = await runSportsLibDataGlobalMigration([], deps);

        expect(runMigration.mock.calls[1][0]).toEqual(expect.arrayContaining([
            '--start-after',
            'private-document-cursor',
        ]));
        expect(summary.health.preflightCandidates).toBe(2);
        expect(JSON.stringify(summary)).not.toContain('private-document-cursor');
        expect(JSON.stringify(hoisted.loggerInfo.mock.calls)).not.toContain('private-document-cursor');
    });

    it('skips inactive and empty users before processing a clean user', async () => {
        const runMigration = vi.fn(async (argv: readonly string[]) => migrationSummary(kindFromArgs(argv)));
        const deps = dependencies(
            ['private-user-1', 'private-user-2', 'private-user-3'],
            runMigration,
        );
        vi.mocked(deps.getDeletionGuard!)
            .mockResolvedValueOnce({ userExists: true, deletionInProgress: true, shouldSkip: true })
            .mockResolvedValue(activeGuard);
        vi.mocked(deps.hasUserData!)
            .mockResolvedValueOnce({ health: true, sleep: true })
            .mockResolvedValueOnce({ health: false, sleep: false })
            .mockResolvedValueOnce({ health: true, sleep: true });

        const summary = await runSportsLibDataGlobalMigration(['--max-users', '1'], deps);

        expect(summary).toMatchObject({
            scannedUsers: 3,
            skippedInactiveUsers: 1,
            usersWithData: 1,
            usersProcessed: 1,
            usersAlreadyCurrent: 1,
            hasMoreUsers: false,
        });
        expect(runMigration).toHaveBeenCalledTimes(2);
    });
});
