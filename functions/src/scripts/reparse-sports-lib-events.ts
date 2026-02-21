import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import {
    SPORTS_LIB_REPARSE_RUNTIME_DEFAULTS,
    SPORTS_LIB_REPARSE_SKIP_REASON_NO_ORIGINAL_FILES,
    extractSourceFiles,
    hasPaidOrGraceAccess,
    parseUIDAllowlist,
    parseUidAndEventIdFromEventPath,
    reparseEventFromOriginalFiles,
    resolveTargetSportsLibVersion,
    resolveTargetSportsLibVersionCode,
    sportsLibVersionToCode,
    shouldEventBeReparsed,
    writeReparseStatus,
} from '../reparse/sports-lib-reparse.service';

interface ScriptOptions {
    execute: boolean;
    uid?: string;
    uids?: string[];
    limit: number;
    startAfter?: string;
    includeFreeUsers: boolean;
}

export interface ScriptSummary {
    dryRun: boolean;
    targetSportsLibVersion: string;
    scanned: number;
    candidates: number;
    skippedNoAccess: number;
    skippedNoSourceFiles: number;
    completed: number;
    failed: number;
}

function extractFirestoreIndexUrl(errorMessage: string): string | undefined {
    const match = errorMessage.match(/https:\/\/console\.firebase\.google\.com\/\S+/);
    return match?.[0];
}

function parseIntArg(value: string | undefined, fallback: number): number {
    if (!value) {
        return fallback;
    }
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        return fallback;
    }
    return parsed;
}

function readArgValue(argv: string[], key: string): string | undefined {
    const equalsPrefix = `${key}=`;
    for (let i = 0; i < argv.length; i++) {
        const token = argv[i];
        if (token === key) {
            return argv[i + 1];
        }
        if (token.startsWith(equalsPrefix)) {
            return token.slice(equalsPrefix.length);
        }
    }
    return undefined;
}

export function parseScriptOptions(argv: string[]): ScriptOptions {
    const execute = argv.includes('--execute');
    const uid = readArgValue(argv, '--uid');
    const cliUIDAllowlist = parseUIDAllowlist(readArgValue(argv, '--uids'));
    const constantUIDAllowlist = SPORTS_LIB_REPARSE_RUNTIME_DEFAULTS.uidAllowlist
        && SPORTS_LIB_REPARSE_RUNTIME_DEFAULTS.uidAllowlist.length > 0
        ? new Set(SPORTS_LIB_REPARSE_RUNTIME_DEFAULTS.uidAllowlist)
        : null;
    const effectiveUIDAllowlist = uid ? null : (cliUIDAllowlist || constantUIDAllowlist);
    const limit = parseIntArg(readArgValue(argv, '--limit'), SPORTS_LIB_REPARSE_RUNTIME_DEFAULTS.scanLimit);
    const startAfter = readArgValue(argv, '--start-after');
    const includeFreeUsers = SPORTS_LIB_REPARSE_RUNTIME_DEFAULTS.includeFreeUsers;

    return {
        execute,
        uid,
        uids: effectiveUIDAllowlist ? Array.from(effectiveUIDAllowlist) : undefined,
        limit,
        startAfter,
        includeFreeUsers,
    };
}

async function getEventsToInspect(options: ScriptOptions): Promise<admin.firestore.QueryDocumentSnapshot[]> {
    const db = admin.firestore();
    if (options.uid) {
        let userQuery = db.collection(`users/${options.uid}/events`)
            .orderBy(admin.firestore.FieldPath.documentId())
            .limit(options.limit);
        if (options.startAfter) {
            userQuery = userQuery.startAfter(options.startAfter);
        }
        const snapshot = await userQuery.get();
        return snapshot.docs;
    }

    if (options.uids && options.uids.length > 0) {
        if (options.startAfter) {
            logger.warn('[sports-lib-reparse-script] Ignoring --start-after in multi-UID mode.');
        }

        const docs: admin.firestore.QueryDocumentSnapshot[] = [];
        let remainingLimit = options.limit;

        for (const uid of options.uids) {
            if (remainingLimit <= 0) {
                break;
            }
            const snapshot = await db.collection(`users/${uid}/events`)
                .orderBy(admin.firestore.FieldPath.documentId())
                .limit(remainingLimit)
                .get();
            docs.push(...snapshot.docs);
            remainingLimit -= snapshot.docs.length;
        }

        return docs;
    }

    return [];
}

function resolveProcessingStartAfterPath(startAfter?: string): string | undefined {
    if (!startAfter) {
        return undefined;
    }
    if (startAfter.endsWith('/metaData/processing')) {
        return startAfter;
    }
    const parsedEventPath = parseUidAndEventIdFromEventPath(startAfter);
    if (parsedEventPath) {
        return `${startAfter}/metaData/processing`;
    }
    return undefined;
}

async function getGlobalProcessingDocsToInspect(options: ScriptOptions, targetSportsLibVersionCode: number): Promise<admin.firestore.QueryDocumentSnapshot[]> {
    const db = admin.firestore();
    let groupQuery = db.collectionGroup('processing')
        .where('sportsLibVersionCode', '<', targetSportsLibVersionCode)
        .orderBy('sportsLibVersionCode', 'asc')
        .orderBy(admin.firestore.FieldPath.documentId())
        .limit(options.limit);

    const processingStartAfterPath = resolveProcessingStartAfterPath(options.startAfter);
    if (options.startAfter && !processingStartAfterPath) {
        logger.warn('[sports-lib-reparse-script] Ignoring --start-after. Expected event path or processing metadata path.', {
            startAfter: options.startAfter,
        });
    } else if (processingStartAfterPath) {
        const startAfterSnapshot = await db.doc(processingStartAfterPath).get();
        if (!startAfterSnapshot.exists) {
            logger.warn('[sports-lib-reparse-script] Ignoring --start-after because processing doc was not found.', {
                processingStartAfterPath,
            });
        } else {
            const startAfterCode = startAfterSnapshot.data()?.sportsLibVersionCode;
            if (typeof startAfterCode === 'number' && Number.isFinite(startAfterCode)) {
                groupQuery = groupQuery.startAfter(startAfterCode, db.doc(processingStartAfterPath));
            } else {
                logger.warn('[sports-lib-reparse-script] Ignoring --start-after because processing metadata has invalid sportsLibVersionCode.', {
                    processingStartAfterPath,
                    sportsLibVersionCode: startAfterCode,
                });
            }
        }
    }
    const snapshot = await groupQuery.get();
    return snapshot.docs;
}

export async function runSportsLibReparseScript(argv: string[]): Promise<ScriptSummary> {
    const options = parseScriptOptions(argv);
    const targetSportsLibVersion = resolveTargetSportsLibVersion();
    const targetSportsLibVersionCode = resolveTargetSportsLibVersionCode();
    const summary: ScriptSummary = {
        dryRun: !options.execute,
        targetSportsLibVersion,
        scanned: 0,
        candidates: 0,
        skippedNoAccess: 0,
        skippedNoSourceFiles: 0,
        completed: 0,
        failed: 0,
    };

    if (!admin.apps.length) {
        admin.initializeApp();
    }

    const accessCache = new Map<string, Promise<boolean>>();
    const processEventCandidate = async (
        uid: string,
        eventId: string,
        eventData: Record<string, unknown>,
    ): Promise<void> => {
        if (!options.includeFreeUsers) {
            let hasAccessPromise = accessCache.get(uid);
            if (!hasAccessPromise) {
                hasAccessPromise = hasPaidOrGraceAccess(uid);
                accessCache.set(uid, hasAccessPromise);
            }
            const hasAccess = await hasAccessPromise;
            if (!hasAccess) {
                summary.skippedNoAccess++;
                return;
            }
        }

        const sourceFiles = extractSourceFiles(eventData);
        if (sourceFiles.length === 0) {
            summary.skippedNoSourceFiles++;
            if (options.execute) {
                await writeReparseStatus(uid, eventId, {
                    status: 'skipped',
                    reason: SPORTS_LIB_REPARSE_SKIP_REASON_NO_ORIGINAL_FILES,
                    targetSportsLibVersion,
                    checkedAt: admin.firestore.FieldValue.serverTimestamp(),
                });
            }
            return;
        }

        summary.candidates++;
        if (!options.execute) {
            return;
        }

        try {
            const result = await reparseEventFromOriginalFiles(uid, eventId, {
                mode: 'reimport',
                targetSportsLibVersion,
            });
            if (result.status === 'skipped' && result.reason === SPORTS_LIB_REPARSE_SKIP_REASON_NO_ORIGINAL_FILES) {
                summary.skippedNoSourceFiles++;
                await writeReparseStatus(uid, eventId, {
                    status: 'skipped',
                    reason: SPORTS_LIB_REPARSE_SKIP_REASON_NO_ORIGINAL_FILES,
                    targetSportsLibVersion,
                    checkedAt: admin.firestore.FieldValue.serverTimestamp(),
                });
            } else {
                summary.completed++;
                await writeReparseStatus(uid, eventId, {
                    status: 'completed',
                    targetSportsLibVersion,
                    checkedAt: admin.firestore.FieldValue.serverTimestamp(),
                    processedAt: admin.firestore.FieldValue.serverTimestamp(),
                    lastError: '',
                });
            }
        } catch (error) {
            summary.failed++;
            const errorMessage = (error as Error)?.message || `${error}`;
            const firestoreIndexUrl = extractFirestoreIndexUrl(errorMessage);
            logger.error('[sports-lib-reparse-script] Reparse failed', {
                uid,
                eventId,
                errorMessage,
                ...(firestoreIndexUrl ? { firestoreIndexUrl } : {}),
            });
            await writeReparseStatus(uid, eventId, {
                status: 'failed',
                reason: 'REPARSE_FAILED',
                targetSportsLibVersion,
                checkedAt: admin.firestore.FieldValue.serverTimestamp(),
                lastError: errorMessage,
            });
        }
    };

    const shouldRunScopedEventQuery = !!options.uid || !!(options.uids && options.uids.length > 0);
    if (shouldRunScopedEventQuery) {
        const eventDocs = await getEventsToInspect(options);
        for (const eventDoc of eventDocs) {
            summary.scanned++;
            const parsedPath = parseUidAndEventIdFromEventPath(eventDoc.ref.path);
            if (!parsedPath) {
                continue;
            }
            const { uid, eventId } = parsedPath;

            let needsReparse = false;
            try {
                needsReparse = await shouldEventBeReparsed(eventDoc.ref, targetSportsLibVersion);
            } catch (error) {
                logger.warn('[sports-lib-reparse-script] Invalid processing metadata; skipping event.', {
                    eventPath: eventDoc.ref.path,
                    error: `${error}`,
                });
                continue;
            }
            if (!needsReparse) {
                continue;
            }

            await processEventCandidate(uid, eventId, eventDoc.data() as Record<string, unknown>);
        }
    } else {
        const processingDocs = await getGlobalProcessingDocsToInspect(options, targetSportsLibVersionCode);
        for (const processingDoc of processingDocs) {
            summary.scanned++;
            const processingData = processingDoc.data() as Record<string, unknown>;
            const rawVersion = processingData.sportsLibVersion;
            const rawVersionCode = processingData.sportsLibVersionCode;
            if (typeof rawVersion !== 'string' || typeof rawVersionCode !== 'number' || !Number.isFinite(rawVersionCode)) {
                logger.warn('[sports-lib-reparse-script] Invalid processing metadata; skipping doc.', {
                    processingDocPath: processingDoc.ref.path,
                    sportsLibVersion: rawVersion,
                    sportsLibVersionCode: rawVersionCode,
                });
                continue;
            }

            let computedVersionCode: number;
            try {
                computedVersionCode = sportsLibVersionToCode(rawVersion);
            } catch (error) {
                logger.warn('[sports-lib-reparse-script] Invalid processing metadata; skipping doc.', {
                    processingDocPath: processingDoc.ref.path,
                    sportsLibVersion: rawVersion,
                    sportsLibVersionCode: rawVersionCode,
                    error: `${error}`,
                });
                continue;
            }
            if (computedVersionCode !== rawVersionCode) {
                logger.warn('[sports-lib-reparse-script] Mismatched processing metadata version/code; skipping doc.', {
                    processingDocPath: processingDoc.ref.path,
                    sportsLibVersion: rawVersion,
                    sportsLibVersionCode: rawVersionCode,
                    computedVersionCode,
                });
                continue;
            }

            const eventRef = processingDoc.ref.parent.parent;
            if (!eventRef) {
                logger.warn('[sports-lib-reparse-script] Could not resolve parent event from processing metadata path.', {
                    processingDocPath: processingDoc.ref.path,
                });
                continue;
            }

            const parsedPath = parseUidAndEventIdFromEventPath(eventRef.path);
            if (!parsedPath) {
                logger.warn('[sports-lib-reparse-script] Could not parse UID/eventID from processing metadata parent path.', {
                    processingDocPath: processingDoc.ref.path,
                    eventPath: eventRef.path,
                });
                continue;
            }
            const { uid, eventId } = parsedPath;

            const eventSnapshot = await eventRef.get();
            if (!eventSnapshot.exists) {
                logger.warn('[sports-lib-reparse-script] Skipping stale processing metadata because parent event is missing.', {
                    processingDocPath: processingDoc.ref.path,
                    eventPath: eventRef.path,
                });
                continue;
            }

            await processEventCandidate(uid, eventId, eventSnapshot.data() as Record<string, unknown>);
        }
    }

    logger.info('[sports-lib-reparse-script] Summary', summary);
    return summary;
}

async function main(): Promise<void> {
    const summary = await runSportsLibReparseScript(process.argv.slice(2));
    if (!summary.dryRun && summary.failed > 0) {
        process.exitCode = 1;
    }
}

if (require.main === module) {
    main().catch((error) => {
        logger.error('[sports-lib-reparse-script] Fatal error', error);
        process.exitCode = 1;
    });
}
