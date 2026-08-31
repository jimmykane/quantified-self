import { createHash } from 'node:crypto';
import * as admin from 'firebase-admin';
import { FieldPath } from 'firebase-admin/firestore';
import * as logger from 'firebase-functions/logger';
import { HEALTH_SOURCE_RECORDS_COLLECTION_ID } from '../../../shared/health';
import { SLEEP_SESSIONS_COLLECTION_ID } from '../../../shared/sleep';
import {
    getUserDeletionGuardState,
    type UserDeletionGuardState,
} from '../shared/user-deletion-guard';
import {
    SPORTS_LIB_DATA_MIGRATION_KINDS,
    runSportsLibDataMigration,
    type SportsLibDataMigrationKind,
    type SportsLibDataMigrationSummary,
} from './sports-lib-data-migration';

const LOG_PREFIX = '[sports-lib-health-sleep-global-migration]';
const CHECKPOINT_DOMAIN = 'sports-lib-health-sleep-global-v1';
const DEFAULT_MAX_USERS = 5;
const MAX_MAX_USERS = 100;
const DEFAULT_SCAN_LIMIT = 100;
const MAX_SCAN_LIMIT = 5_000;
const DEFAULT_DOCUMENT_LIMIT = 100;
const MAX_DOCUMENT_LIMIT = 250;
const DEFAULT_DOCUMENT_CONCURRENCY = 5;
const MAX_DOCUMENT_CONCURRENCY = 10;
const CHECKPOINT_PATTERN = /^[a-f0-9]{64}$/;
const CHECKPOINT_LOOKUP_PAGE_SIZE = 500;
const MAX_DOCUMENT_PAGES_PER_KIND = 100_000;

export interface SportsLibDataGlobalMigrationOptions {
    execute: boolean;
    maxUsers: number;
    scanLimit: number;
    documentLimit: number;
    documentConcurrency: number;
    startAfter?: string;
}

export interface SportsLibDataGlobalKindSummary {
    preflightScanned: number;
    preflightCandidates: number;
    preflightUnchanged: number;
    migrated: number;
    executionUnchanged: number;
    postcheckCandidates: number;
    skippedInvalid: number;
    skippedDeletedUser: number;
    skippedMissing: number;
    failed: number;
}

export interface SportsLibDataGlobalMigrationSummary {
    dryRun: boolean;
    maxUsers: number;
    documentConcurrency: number;
    scannedUsers: number;
    usersWithData: number;
    usersProcessed: number;
    usersMigrated: number;
    usersAlreadyCurrent: number;
    skippedInactiveUsers: number;
    failedUsers: number;
    health: SportsLibDataGlobalKindSummary;
    sleep: SportsLibDataGlobalKindSummary;
    hasMoreUsers: boolean;
    nextStartAfter: string | null;
}

interface UserInventoryPage {
    userIDs: string[];
    hasMore: boolean;
}

interface UserDataPresence {
    health: boolean;
    sleep: boolean;
}

interface KindPassTotals {
    scanned: number;
    candidates: number;
    migrated: number;
    unchanged: number;
    skippedInvalid: number;
    skippedDeletedUser: number;
    skippedMissing: number;
    failed: number;
}

interface KindPassResult {
    clean: boolean;
    totals: KindPassTotals;
}

interface UserMigrationResult {
    clean: boolean;
    alreadyCurrent: boolean;
    migrated: number;
    health: {
        preflight: KindPassTotals;
        execution?: KindPassTotals;
        postcheck?: KindPassTotals;
    };
    sleep: {
        preflight: KindPassTotals;
        execution?: KindPassTotals;
        postcheck?: KindPassTotals;
    };
}

export interface SportsLibDataGlobalMigrationDependencies {
    db?: admin.firestore.Firestore;
    getDeletionGuard?: (
        db: admin.firestore.Firestore,
        userID: string,
    ) => Promise<UserDeletionGuardState>;
    hasUserData?: (
        db: admin.firestore.Firestore,
        userID: string,
    ) => Promise<UserDataPresence>;
    listUsers?: (
        db: admin.firestore.Firestore,
        startAfter: string | undefined,
        scanLimit: number,
    ) => Promise<UserInventoryPage>;
    runMigration?: typeof runSportsLibDataMigration;
}

function parseBoundedInteger(
    values: ReadonlyMap<string, string>,
    argument: string,
    defaultValue: number,
    maximum: number,
): number {
    const raw = values.get(argument);
    const value = raw === undefined ? defaultValue : Number(raw);
    if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
        throw new Error(`${argument} must be an integer from 1 to ${maximum}.`);
    }
    return value;
}

export function parseSportsLibDataGlobalMigrationOptions(
    argv: readonly string[],
): SportsLibDataGlobalMigrationOptions {
    const knownValueArguments = new Set([
        '--max-users',
        '--scan-limit',
        '--document-limit',
        '--document-concurrency',
        '--start-after',
    ]);
    const values = new Map<string, string>();
    let execute = false;
    for (let index = 0; index < argv.length; index += 1) {
        const argument = argv[index];
        const name = argument.split('=', 1)[0];
        if (name === '--execute') {
            if (argument !== name || execute) {
                throw new Error('--execute is a boolean flag and may be specified only once.');
            }
            execute = true;
            continue;
        }
        if (!knownValueArguments.has(name)) {
            throw new Error(`Unknown global migration argument: ${name}`);
        }
        if (values.has(name)) throw new Error(`${name} may be specified only once.`);
        const inlineValue = argument.includes('=')
            ? argument.slice(argument.indexOf('=') + 1)
            : undefined;
        const nextValue = inlineValue === undefined ? argv[index + 1] : undefined;
        if (inlineValue === undefined && (nextValue === undefined || nextValue.startsWith('--'))) {
            throw new Error(`${name} requires a value.`);
        }
        const value = inlineValue ?? nextValue!;
        if (value.length === 0) throw new Error(`${name} requires a value.`);
        values.set(name, value);
        if (inlineValue === undefined) index += 1;
    }

    const startAfter = values.get('--start-after');
    if (startAfter !== undefined && !CHECKPOINT_PATTERN.test(startAfter)) {
        throw new Error('--start-after must be an opaque 64-character checkpoint.');
    }
    return {
        execute,
        maxUsers: parseBoundedInteger(values, '--max-users', DEFAULT_MAX_USERS, MAX_MAX_USERS),
        scanLimit: parseBoundedInteger(values, '--scan-limit', DEFAULT_SCAN_LIMIT, MAX_SCAN_LIMIT),
        documentLimit: parseBoundedInteger(
            values,
            '--document-limit',
            DEFAULT_DOCUMENT_LIMIT,
            MAX_DOCUMENT_LIMIT,
        ),
        documentConcurrency: parseBoundedInteger(
            values,
            '--document-concurrency',
            DEFAULT_DOCUMENT_CONCURRENCY,
            MAX_DOCUMENT_CONCURRENCY,
        ),
        startAfter,
    };
}

export function sportsLibDataGlobalCheckpoint(userID: string): string {
    return createHash('sha256')
        .update(`${CHECKPOINT_DOMAIN}\0${userID}`, 'utf8')
        .digest('hex');
}

async function resolveCheckpointUserID(
    db: admin.firestore.Firestore,
    checkpoint: string,
): Promise<string> {
    let lastUserID: string | undefined;
    while (true) {
        let query = db.collection('users')
            .orderBy(FieldPath.documentId())
            .limit(CHECKPOINT_LOOKUP_PAGE_SIZE);
        if (lastUserID) query = query.startAfter(lastUserID);
        const snapshot = await query.select().get();
        const match = snapshot.docs.find(document => (
            sportsLibDataGlobalCheckpoint(document.id) === checkpoint
        ));
        if (match) return match.id;
        if (snapshot.size < CHECKPOINT_LOOKUP_PAGE_SIZE) break;
        lastUserID = snapshot.docs[snapshot.docs.length - 1].id;
    }
    throw new Error('The opaque global migration checkpoint could not be resolved.');
}

export async function listUsersForGlobalMigration(
    db: admin.firestore.Firestore,
    startAfter: string | undefined,
    scanLimit: number,
): Promise<UserInventoryPage> {
    const startAfterUserID = startAfter
        ? await resolveCheckpointUserID(db, startAfter)
        : undefined;
    let query = db.collection('users')
        .orderBy(FieldPath.documentId())
        .limit(scanLimit + 1);
    if (startAfterUserID) query = query.startAfter(startAfterUserID);
    const snapshot = await query.select().get();
    return {
        userIDs: snapshot.docs.slice(0, scanLimit).map(document => document.id),
        hasMore: snapshot.size > scanLimit,
    };
}

async function userDataPresence(
    db: admin.firestore.Firestore,
    userID: string,
): Promise<UserDataPresence> {
    const userRef = db.collection('users').doc(userID);
    const [health, sleep] = await Promise.all([
        userRef.collection(HEALTH_SOURCE_RECORDS_COLLECTION_ID).limit(1).select().get(),
        userRef.collection(SLEEP_SESSIONS_COLLECTION_ID).limit(1).select().get(),
    ]);
    return { health: !health.empty, sleep: !sleep.empty };
}

function emptyPassTotals(): KindPassTotals {
    return {
        scanned: 0,
        candidates: 0,
        migrated: 0,
        unchanged: 0,
        skippedInvalid: 0,
        skippedDeletedUser: 0,
        skippedMissing: 0,
        failed: 0,
    };
}

function mergePassSummary(
    totals: KindPassTotals,
    summary: SportsLibDataMigrationSummary,
): void {
    totals.scanned += summary.scanned;
    totals.candidates += summary.candidates;
    totals.migrated += summary.migrated;
    totals.unchanged += summary.unchanged;
    totals.skippedInvalid += summary.skippedInvalid;
    totals.skippedDeletedUser += summary.skippedDeletedUser;
    totals.skippedMissing += summary.skippedMissing;
    totals.failed += summary.failed;
}

function passIsClean(totals: KindPassTotals): boolean {
    return totals.skippedInvalid === 0
        && totals.skippedDeletedUser === 0
        && totals.skippedMissing === 0
        && totals.failed === 0;
}

async function runKindPass(
    userID: string,
    kind: SportsLibDataMigrationKind,
    execute: boolean,
    options: SportsLibDataGlobalMigrationOptions,
    runMigration: typeof runSportsLibDataMigration,
): Promise<KindPassResult> {
    const totals = emptyPassTotals();
    let startAfter: string | undefined;
    const seenCursors = new Set<string>();
    for (let page = 0; page < MAX_DOCUMENT_PAGES_PER_KIND; page += 1) {
        const argv = [
            '--uid', userID,
            '--kind', kind,
            '--limit', `${options.documentLimit}`,
            '--concurrency', `${options.documentConcurrency}`,
        ];
        if (execute) argv.unshift('--execute');
        if (startAfter) argv.push('--start-after', startAfter);
        let summary: SportsLibDataMigrationSummary;
        try {
            summary = await runMigration(argv);
        } catch {
            totals.failed += 1;
            return { clean: false, totals };
        }
        mergePassSummary(totals, summary);
        if (!passIsClean(totals)) return { clean: false, totals };
        if (!summary.nextStartAfter) return { clean: true, totals };
        if (seenCursors.has(summary.nextStartAfter)) {
            totals.failed += 1;
            return { clean: false, totals };
        }
        seenCursors.add(summary.nextStartAfter);
        startAfter = summary.nextStartAfter;
    }
    totals.failed += 1;
    return { clean: false, totals };
}

function emptyGlobalKindSummary(): SportsLibDataGlobalKindSummary {
    return {
        preflightScanned: 0,
        preflightCandidates: 0,
        preflightUnchanged: 0,
        migrated: 0,
        executionUnchanged: 0,
        postcheckCandidates: 0,
        skippedInvalid: 0,
        skippedDeletedUser: 0,
        skippedMissing: 0,
        failed: 0,
    };
}

function collectPassFailures(
    target: SportsLibDataGlobalKindSummary,
    pass: KindPassTotals | undefined,
): void {
    if (!pass) return;
    target.skippedInvalid += pass.skippedInvalid;
    target.skippedDeletedUser += pass.skippedDeletedUser;
    target.skippedMissing += pass.skippedMissing;
    target.failed += pass.failed;
}

function collectUserKindResult(
    target: SportsLibDataGlobalKindSummary,
    result: UserMigrationResult['health'],
): void {
    target.preflightScanned += result.preflight.scanned;
    target.preflightCandidates += result.preflight.candidates;
    target.preflightUnchanged += result.preflight.unchanged;
    target.migrated += result.execution?.migrated || 0;
    target.executionUnchanged += result.execution?.unchanged || 0;
    target.postcheckCandidates += result.postcheck?.candidates || 0;
    collectPassFailures(target, result.preflight);
    collectPassFailures(target, result.execution);
    collectPassFailures(target, result.postcheck);
}

async function migrateOneUser(
    userID: string,
    options: SportsLibDataGlobalMigrationOptions,
    runMigration: typeof runSportsLibDataMigration,
): Promise<UserMigrationResult> {
    const healthPreflight = await runKindPass(
        userID,
        SPORTS_LIB_DATA_MIGRATION_KINDS.Health,
        false,
        options,
        runMigration,
    );
    const sleepPreflight = healthPreflight.clean
        ? await runKindPass(
            userID,
            SPORTS_LIB_DATA_MIGRATION_KINDS.Sleep,
            false,
            options,
            runMigration,
        )
        : { clean: false, totals: emptyPassTotals() };
    const result: UserMigrationResult = {
        clean: healthPreflight.clean && sleepPreflight.clean,
        alreadyCurrent: healthPreflight.totals.candidates === 0
            && sleepPreflight.totals.candidates === 0,
        migrated: 0,
        health: { preflight: healthPreflight.totals },
        sleep: { preflight: sleepPreflight.totals },
    };
    if (!result.clean || !options.execute || result.alreadyCurrent) return result;

    const healthExecution = healthPreflight.totals.candidates > 0
        ? await runKindPass(
            userID,
            SPORTS_LIB_DATA_MIGRATION_KINDS.Health,
            true,
            options,
            runMigration,
        )
        : { clean: true, totals: emptyPassTotals() };
    result.health.execution = healthExecution.totals;
    if (!healthExecution.clean) {
        result.clean = false;
        return result;
    }
    const healthPostcheck = await runKindPass(
        userID,
        SPORTS_LIB_DATA_MIGRATION_KINDS.Health,
        false,
        options,
        runMigration,
    );
    result.health.postcheck = healthPostcheck.totals;
    if (!healthPostcheck.clean || healthPostcheck.totals.candidates !== 0) {
        result.clean = false;
        return result;
    }

    const sleepExecution = sleepPreflight.totals.candidates > 0
        ? await runKindPass(
            userID,
            SPORTS_LIB_DATA_MIGRATION_KINDS.Sleep,
            true,
            options,
            runMigration,
        )
        : { clean: true, totals: emptyPassTotals() };
    result.sleep.execution = sleepExecution.totals;
    if (!sleepExecution.clean) {
        result.clean = false;
        return result;
    }
    const sleepPostcheck = await runKindPass(
        userID,
        SPORTS_LIB_DATA_MIGRATION_KINDS.Sleep,
        false,
        options,
        runMigration,
    );
    result.sleep.postcheck = sleepPostcheck.totals;
    if (!sleepPostcheck.clean || sleepPostcheck.totals.candidates !== 0) {
        result.clean = false;
        return result;
    }
    result.migrated = healthExecution.totals.migrated + sleepExecution.totals.migrated;
    return result;
}

export function hasBlockingSportsLibDataGlobalMigrationResult(
    summary: SportsLibDataGlobalMigrationSummary,
): boolean {
    return summary.failedUsers > 0
        || summary.health.skippedInvalid > 0
        || summary.health.skippedDeletedUser > 0
        || summary.health.skippedMissing > 0
        || summary.health.failed > 0
        || summary.health.postcheckCandidates > 0
        || summary.sleep.skippedInvalid > 0
        || summary.sleep.skippedDeletedUser > 0
        || summary.sleep.skippedMissing > 0
        || summary.sleep.failed > 0
        || summary.sleep.postcheckCandidates > 0;
}

export async function runSportsLibDataGlobalMigration(
    argv: readonly string[],
    dependencies: SportsLibDataGlobalMigrationDependencies = {},
): Promise<SportsLibDataGlobalMigrationSummary> {
    const options = parseSportsLibDataGlobalMigrationOptions(argv);
    if (!dependencies.db && !admin.apps.length) admin.initializeApp();
    const db = dependencies.db || admin.firestore();
    const listUsers = dependencies.listUsers || listUsersForGlobalMigration;
    const hasUserData = dependencies.hasUserData || userDataPresence;
    const getDeletionGuard = dependencies.getDeletionGuard || getUserDeletionGuardState;
    const runMigration = dependencies.runMigration || runSportsLibDataMigration;
    const inventory = await listUsers(db, options.startAfter, options.scanLimit);
    const summary: SportsLibDataGlobalMigrationSummary = {
        dryRun: !options.execute,
        maxUsers: options.maxUsers,
        documentConcurrency: options.documentConcurrency,
        scannedUsers: 0,
        usersWithData: 0,
        usersProcessed: 0,
        usersMigrated: 0,
        usersAlreadyCurrent: 0,
        skippedInactiveUsers: 0,
        failedUsers: 0,
        health: emptyGlobalKindSummary(),
        sleep: emptyGlobalKindSummary(),
        hasMoreUsers: false,
        nextStartAfter: null,
    };
    let lastSafeUserID: string | null = null;
    let stoppedForCohort = false;

    for (const userID of inventory.userIDs) {
        if (summary.usersWithData >= options.maxUsers) {
            stoppedForCohort = true;
            break;
        }
        summary.scannedUsers += 1;
        let guard: UserDeletionGuardState;
        let presence: UserDataPresence;
        try {
            [guard, presence] = await Promise.all([
                getDeletionGuard(db, userID),
                hasUserData(db, userID),
            ]);
        } catch {
            summary.failedUsers += 1;
            logger.error(`${LOG_PREFIX} Failed to inspect one user.`, {
                failure: 'global_user_inspection_failed',
            });
            break;
        }
        if (guard.shouldSkip) {
            summary.skippedInactiveUsers += 1;
            lastSafeUserID = userID;
            continue;
        }
        if (!presence.health && !presence.sleep) {
            lastSafeUserID = userID;
            continue;
        }
        summary.usersWithData += 1;
        const userResult = await migrateOneUser(userID, options, runMigration);
        collectUserKindResult(summary.health, userResult.health);
        collectUserKindResult(summary.sleep, userResult.sleep);
        if (!userResult.clean) {
            summary.failedUsers += 1;
            logger.error(`${LOG_PREFIX} Stopped at one unclean user.`, {
                failure: 'global_user_migration_failed',
            });
            break;
        }
        summary.usersProcessed += 1;
        if (userResult.alreadyCurrent) summary.usersAlreadyCurrent += 1;
        if (userResult.migrated > 0) summary.usersMigrated += 1;
        lastSafeUserID = userID;
    }

    summary.hasMoreUsers = hasBlockingSportsLibDataGlobalMigrationResult(summary)
        || stoppedForCohort
        || inventory.hasMore;
    if (summary.hasMoreUsers) {
        summary.nextStartAfter = lastSafeUserID
            ? sportsLibDataGlobalCheckpoint(lastSafeUserID)
            : options.startAfter ?? null;
    }
    logger.info(`${LOG_PREFIX} ${options.execute ? 'Execution' : 'Dry run'} complete.`, {
        ...summary,
        nextStartAfter: summary.nextStartAfter ? 'available' : null,
    });
    return summary;
}
