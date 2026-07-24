import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { SLEEP_PROVIDERS } from '../../../shared/sleep';
import { COROS_DAILY_MAX_WINDOW_DAYS } from '../sleep/constants';
import { chunkSleepBackfillRange } from '../sleep/backfill';
import { isSleepProviderEnabled, isSleepSyncUserAllowed } from '../sleep/provider-flags';
import { addSleepSyncQueueItem } from '../sleep/queue';
import { isServiceUnavailableForSyncForUser } from '../service-connection-meta';
import { getUserDeletionGuardState } from '../shared/user-deletion-guard';
import { isProviderQueueUserDeletedOrDeletingError } from '../queue/provider-queue-errors';

const LOG_PREFIX = '[coros-sleep-backfill]';
const COROS_SLEEP_MAX_LOOKBACK_MONTHS = 3;
const DEFAULT_TOKEN_LIMIT = 100;
const MAX_TOKEN_LIMIT = 1_000;

interface CorosSleepBackfillOptions {
    execute: boolean;
    confirmAllUsers: boolean;
    userID?: string;
    startMs?: number;
    endMs?: number;
    tokenLimit: number;
}

interface CorosSleepBackfillRange {
    startMs: number;
    endMs: number;
    clampedToProviderLookback: boolean;
}

interface CorosSleepBackfillTarget {
    userID: string;
    providerUserID: string;
}

type TargetEligibility =
    | { eligible: true }
    | { eligible: false; reason: string };

export interface CorosSleepBackfillSummary {
    dryRun: boolean;
    start: string;
    end: string;
    tokenRecordsScanned: number;
    uniqueAccountsFound: number;
    eligibleAccounts: number;
    accountsQueued: number;
    queueItemsPlanned: number;
    queueItemsQueued: number;
    skipped: Record<string, number>;
    failed: number;
}

function readArgValue(argv: string[], key: string): string | undefined {
    const equalsPrefix = `${key}=`;
    for (let index = 0; index < argv.length; index += 1) {
        const value = argv[index];
        if (value === key) {
            return argv[index + 1];
        }
        if (value.startsWith(equalsPrefix)) {
            return value.slice(equalsPrefix.length);
        }
    }
    return undefined;
}

function parseUtcDateMs(value: string | undefined, optionName: string): number | undefined {
    if (!value) {
        return undefined;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        throw new Error(`${optionName} must use YYYY-MM-DD.`);
    }
    const parsed = new Date(`${value}T00:00:00.000Z`);
    if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
        throw new Error(`${optionName} is not a valid date.`);
    }
    return parsed.getTime();
}

function parseTokenLimit(value: string | undefined): number {
    if (!value) {
        return DEFAULT_TOKEN_LIMIT;
    }
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed < 1 || parsed > MAX_TOKEN_LIMIT) {
        throw new Error(`--limit must be an integer between 1 and ${MAX_TOKEN_LIMIT}.`);
    }
    return parsed;
}

export function parseCorosSleepBackfillOptions(argv: string[]): CorosSleepBackfillOptions {
    const execute = argv.includes('--execute');
    const confirmAllUsers = argv.includes('--confirm-all-users');
    const userID = readArgValue(argv, '--uid');
    if (execute && !userID && !confirmAllUsers) {
        throw new Error('Global execution requires --confirm-all-users. Run without --execute first to inspect the plan.');
    }

    return {
        execute,
        confirmAllUsers,
        userID,
        startMs: parseUtcDateMs(readArgValue(argv, '--start'), '--start'),
        endMs: parseUtcDateMs(readArgValue(argv, '--end'), '--end'),
        tokenLimit: parseTokenLimit(readArgValue(argv, '--limit')),
    };
}

function subtractUtcMonthsClamped(timestampMs: number, months: number): number {
    const date = new Date(timestampMs);
    const targetYear = date.getUTCFullYear();
    const targetMonth = date.getUTCMonth() - months;
    const targetMonthLastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
    return Date.UTC(
        targetYear,
        targetMonth,
        Math.min(date.getUTCDate(), targetMonthLastDay),
        date.getUTCHours(),
        date.getUTCMinutes(),
        date.getUTCSeconds(),
        date.getUTCMilliseconds(),
    );
}

export function resolveCorosSleepBackfillRange(
    options: Pick<CorosSleepBackfillOptions, 'startMs' | 'endMs'>,
    nowMs = Date.now(),
): CorosSleepBackfillRange {
    const earliestProviderStartMs = subtractUtcMonthsClamped(nowMs, COROS_SLEEP_MAX_LOOKBACK_MONTHS);
    const requestedEndMs = options.endMs ?? nowMs;
    const endMs = Math.min(requestedEndMs, nowMs);
    const requestedStartMs = options.startMs ?? earliestProviderStartMs;
    const startMs = Math.max(requestedStartMs, earliestProviderStartMs);
    if (endMs <= startMs) {
        throw new Error('The requested backfill range is empty after applying the COROS three-month retention limit.');
    }
    return {
        startMs,
        endMs,
        clampedToProviderLookback: requestedStartMs < earliestProviderStartMs,
    };
}

function incrementSkipped(summary: CorosSleepBackfillSummary, reason: string): void {
    summary.skipped[reason] = (summary.skipped[reason] || 0) + 1;
}

function getTargetFromTokenSnapshot(tokenSnapshot: admin.firestore.QueryDocumentSnapshot): CorosSleepBackfillTarget | null {
    const userID = tokenSnapshot.ref.parent.parent?.id;
    const tokenData = tokenSnapshot.data();
    const providerUserID = typeof tokenData.openId === 'string' ? tokenData.openId.trim() : '';
    return userID && providerUserID ? { userID, providerUserID } : null;
}

async function getTargetEligibility(userID: string): Promise<TargetEligibility> {
    if (!isSleepSyncUserAllowed(userID)) {
        return { eligible: false, reason: 'user_outside_sleep_rollout' };
    }
    try {
        const deletionGuard = await getUserDeletionGuardState(admin.firestore(), userID);
        if (deletionGuard.shouldSkip) {
            return { eligible: false, reason: 'user_deleted_or_deleting' };
        }
    } catch {
        return { eligible: false, reason: 'deletion_guard_unavailable' };
    }
    try {
        if (await isServiceUnavailableForSyncForUser(userID, ServiceNames.COROSAPI)) {
            return { eligible: false, reason: 'service_unavailable_for_sync' };
        }
    } catch {
        return { eligible: false, reason: 'service_state_unavailable' };
    }
    return { eligible: true };
}

export async function runCorosSleepBackfillScript(argv: string[]): Promise<CorosSleepBackfillSummary> {
    const options = parseCorosSleepBackfillOptions(argv);
    if (!isSleepProviderEnabled(SLEEP_PROVIDERS.COROSAPI)) {
        throw new Error('COROS sleep sync is disabled. Enable it before running this backfill.');
    }
    if (!admin.apps.length) {
        admin.initializeApp();
    }

    const range = resolveCorosSleepBackfillRange(options);
    const windows = chunkSleepBackfillRange(range.startMs, range.endMs, COROS_DAILY_MAX_WINDOW_DAYS);
    const summary: CorosSleepBackfillSummary = {
        dryRun: !options.execute,
        start: new Date(range.startMs).toISOString(),
        end: new Date(range.endMs).toISOString(),
        tokenRecordsScanned: 0,
        uniqueAccountsFound: 0,
        eligibleAccounts: 0,
        accountsQueued: 0,
        queueItemsPlanned: 0,
        queueItemsQueued: 0,
        skipped: {},
        failed: 0,
    };

    const tokenSnapshot = await admin.firestore()
        .collectionGroup('tokens')
        .where('serviceName', '==', ServiceNames.COROSAPI)
        .limit(options.tokenLimit)
        .get();
    summary.tokenRecordsScanned = tokenSnapshot.size;

    const seenAccounts = new Set<string>();
    const targetEligibilityByUserID = new Map<string, Promise<TargetEligibility>>();
    for (const tokenDoc of tokenSnapshot.docs) {
        const target = getTargetFromTokenSnapshot(tokenDoc);
        if (!target || (options.userID && target.userID !== options.userID)) {
            incrementSkipped(summary, 'missing_or_out_of_scope_provider_account');
            continue;
        }
        const accountKey = `${target.userID}:${target.providerUserID}`;
        if (seenAccounts.has(accountKey)) {
            incrementSkipped(summary, 'duplicate_provider_account');
            continue;
        }
        seenAccounts.add(accountKey);
        summary.uniqueAccountsFound += 1;

        let eligibility = targetEligibilityByUserID.get(target.userID);
        if (!eligibility) {
            eligibility = getTargetEligibility(target.userID);
            targetEligibilityByUserID.set(target.userID, eligibility);
        }
        const resolvedEligibility = await eligibility;
        if (!resolvedEligibility.eligible) {
            incrementSkipped(summary, resolvedEligibility.reason);
            continue;
        }
        summary.eligibleAccounts += 1;
        summary.queueItemsPlanned += windows.length;
        if (!options.execute) {
            continue;
        }

        let queuedForAccount = 0;
        for (const window of windows) {
            try {
                await addSleepSyncQueueItem({
                    type: 'coros_poll',
                    provider: SLEEP_PROVIDERS.COROSAPI,
                    userID: target.userID,
                    providerUserId: target.providerUserID,
                    rangeStartMs: window.startMs,
                    rangeEndMs: window.endMs,
                    dedupeKey: `coros-sleep-backfill-v1:${target.userID}:${target.providerUserID}:${window.startMs}:${window.endMs}`,
                    dispatchImmediately: true,
                });
                summary.queueItemsQueued += 1;
                queuedForAccount += 1;
            } catch (error) {
                if (isProviderQueueUserDeletedOrDeletingError(error)) {
                    incrementSkipped(summary, 'user_deleted_or_deleting_during_enqueue');
                } else {
                    summary.failed += 1;
                    logger.error(`${LOG_PREFIX} Failed to enqueue a COROS sleep backfill window.`, {
                        failure: 'queue_enqueue_failed',
                    });
                }
            }
        }
        if (queuedForAccount > 0) {
            summary.accountsQueued += 1;
        }
    }

    logger.info(`${LOG_PREFIX} ${options.execute ? 'Queueing complete' : 'Dry run complete'}.`, {
        ...summary,
        clampedToProviderLookback: range.clampedToProviderLookback,
    });
    return summary;
}

async function main(): Promise<void> {
    const summary = await runCorosSleepBackfillScript(process.argv.slice(2));
    process.stdout.write(`${LOG_PREFIX} Summary ${JSON.stringify(summary)}\n`);
    if (!summary.dryRun && summary.failed > 0) {
        process.exitCode = 1;
    }
}

if (require.main === module) {
    main().catch(() => {
        process.exitCode = 1;
    });
}
