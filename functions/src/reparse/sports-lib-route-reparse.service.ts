import * as admin from 'firebase-admin';
import { createHash } from 'node:crypto';
import semver from 'semver';

import { FirestoreRouteJSON, OriginalRouteFileMetaData } from '../../../shared/app-route.interface';
import {
    SPORTS_LIB_REPARSE_RUNTIME_DEFAULTS,
    SPORTS_LIB_REPARSE_TARGET_VERSION,
} from './sports-lib-reparse.config';
import {
    assertSportsLibRuntimeVersionMatchesTarget,
    SPORTS_LIB_REPARSE_SKIP_REASON_NO_ORIGINAL_FILES,
    SPORTS_LIB_REPARSE_STATUS_DOC_ID,
    sportsLibVersionToCode,
} from './sports-lib-reparse.service';
import {
    getUserDeletionGuardStateInTransaction,
    UserDeletionGuardReadError,
} from '../shared/user-deletion-guard';

export const SPORTS_LIB_ROUTE_REPARSE_CHECKPOINT_PATH = 'systemJobs/sportsLibRouteReparse';
export const SPORTS_LIB_ROUTE_REPARSE_JOBS_COLLECTION = 'sportsLibRouteReparseJobs';
export const SPORTS_LIB_ROUTE_REPARSE_RUNTIME_DEFAULTS = {
    enabled: true,
    scanLimit: SPORTS_LIB_REPARSE_RUNTIME_DEFAULTS.scanLimit,
    enqueueLimit: SPORTS_LIB_REPARSE_RUNTIME_DEFAULTS.enqueueLimit,
    uidAllowlist: [] as string[],
} as const;

export type SportsLibRouteReparseJobStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'skipped';

export interface SportsLibRouteReparseCheckpoint {
    cursorProcessingDocPath?: string | null;
    cursorProcessingVersionCode?: number | null;
    overrideCursorByUid?: Record<string, string | null>;
    lastScanAt?: unknown;
    lastPassStartedAt?: unknown;
    lastPassCompletedAt?: unknown;
    lastScanCount?: number;
    lastEnqueuedCount?: number;
    targetSportsLibVersion?: string;
}

export interface SportsLibRouteReparseJob {
    uid: string;
    routeId: string;
    routePath: string;
    targetSportsLibVersion: string;
    status: SportsLibRouteReparseJobStatus;
    attemptCount: number;
    lastError?: string;
    terminalFailure?: boolean;
    terminalFailureAt?: unknown;
    createdAt: unknown;
    updatedAt: unknown;
    enqueuedAt?: unknown;
    processedAt?: unknown;
    expireAt?: unknown;
}

export interface RouteReparseStatusWrite {
    status: 'skipped' | 'completed' | 'failed';
    reason?: string;
    targetSportsLibVersion: string;
    checkedAt: unknown;
    processedAt?: unknown;
    lastError?: string;
    terminalFailure?: unknown;
    terminalFailureAt?: unknown;
}

class RouteReparsePersistenceSkippedForDeletedUserError extends Error {
    readonly name = 'RouteReparsePersistenceSkippedForDeletedUserError';
    readonly code = 'user_deleted_or_deleting';

    constructor(
        readonly uid: string,
        readonly phase: string,
    ) {
        super(`Skipping sports-lib route reparse persistence for user ${uid} during ${phase} because the user is missing or deletion is in progress.`);
    }
}

const SPORTS_LIB_ROUTE_REPARSE_TERMINAL_ERROR_PATTERNS = [
    /^\[sports-lib-reparse\] Reparse target sports-lib version ".*" does not match runtime sports-lib version ".*"$/,
    /^Route .* was not found/,
] as const;

export function isRouteReparsePersistenceSkippedForUserDeletionError(error: unknown): boolean {
    return error instanceof Error && error.name === 'RouteReparsePersistenceSkippedForDeletedUserError';
}

export function isSportsLibRouteReparseTerminalFailureMessage(errorMessage: string): boolean {
    return SPORTS_LIB_ROUTE_REPARSE_TERMINAL_ERROR_PATTERNS.some((pattern) => pattern.test(errorMessage));
}

export function resolveRouteReparseTargetSportsLibVersion(): string {
    return SPORTS_LIB_REPARSE_TARGET_VERSION;
}

export function resolveRouteReparseTargetSportsLibVersionCode(): number {
    return sportsLibVersionToCode(resolveRouteReparseTargetSportsLibVersion());
}

export function assertRouteReparseRuntimeVersionMatchesTarget(targetSportsLibVersion: string): void {
    assertSportsLibRuntimeVersionMatchesTarget(targetSportsLibVersion);
}

export function buildSportsLibRouteReparseJobId(uid: string, routeId: string, targetSportsLibVersion: string): string {
    return createHash('sha256').update(`${uid}:${routeId}:${targetSportsLibVersion}`).digest('hex');
}

export function parseUidAndRouteIdFromRoutePath(path: string): { uid: string; routeId: string } | null {
    const parts = path.split('/');
    if (parts.length !== 4) {
        return null;
    }
    if (parts[0] !== 'users' || parts[2] !== 'routes') {
        return null;
    }
    return { uid: parts[1], routeId: parts[3] };
}

export function extractPrimaryRouteSourceFile(routeDoc: FirestoreRouteJSON | Record<string, unknown>): OriginalRouteFileMetaData | null {
    const routeAny = routeDoc as FirestoreRouteJSON;
    if (Array.isArray(routeAny.originalFiles)) {
        const sourceFile = routeAny.originalFiles.find(file => !!file?.path);
        if (sourceFile) {
            return sourceFile;
        }
    }

    return routeAny.originalFile?.path ? routeAny.originalFile : null;
}

export async function shouldRouteBeReparsed(
    routeRef: admin.firestore.DocumentReference,
    targetSportsLibVersion: string,
): Promise<boolean> {
    const validatedTargetVersion = semver.valid(targetSportsLibVersion);
    if (!validatedTargetVersion) {
        throw new Error(`[sports-lib-route-reparse] Invalid target sports-lib version "${targetSportsLibVersion}"`);
    }

    const processingDoc = await routeRef.collection('metaData').doc('processing').get();
    if (!processingDoc.exists) {
        return true;
    }

    const rawVersion = processingDoc.data()?.sportsLibVersion;
    if (!rawVersion) {
        return true;
    }

    const storedVersion = semver.valid(`${rawVersion}`);
    if (!storedVersion) {
        return true;
    }

    return semver.lt(storedVersion, validatedTargetVersion);
}

async function assertRouteReparsePersistenceUserActiveInTransaction(
    db: admin.firestore.Firestore,
    transaction: admin.firestore.Transaction,
    uid: string,
    phase: string,
): Promise<void> {
    let deletionGuard;
    try {
        deletionGuard = await getUserDeletionGuardStateInTransaction(db, transaction, uid);
    } catch (error) {
        throw new UserDeletionGuardReadError(uid, phase, error);
    }

    if (!deletionGuard.shouldSkip) {
        return;
    }

    throw new RouteReparsePersistenceSkippedForDeletedUserError(uid, phase);
}

async function setRouteReparseDocIfUserActive(
    uid: string,
    phase: string,
    docRef: admin.firestore.DocumentReference,
    data: unknown,
    options?: admin.firestore.SetOptions,
): Promise<void> {
    const db = admin.firestore();
    await db.runTransaction(async (transaction) => {
        await assertRouteReparsePersistenceUserActiveInTransaction(db, transaction, uid, phase);
        transaction.set(docRef, data as admin.firestore.DocumentData, options as admin.firestore.SetOptions);
    });
}

export async function writeRouteReparseStatus(
    uid: string,
    routeId: string,
    payload: RouteReparseStatusWrite,
): Promise<void> {
    const statusRef = admin.firestore().doc(`users/${uid}/routes/${routeId}/metaData/${SPORTS_LIB_REPARSE_STATUS_DOC_ID}`);
    await setRouteReparseDocIfUserActive(
        uid,
        'sports_lib_route_reparse_status',
        statusRef,
        payload,
        { merge: true },
    );
}

export {
    SPORTS_LIB_REPARSE_SKIP_REASON_NO_ORIGINAL_FILES,
    SPORTS_LIB_REPARSE_STATUS_DOC_ID,
};
