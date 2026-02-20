import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import {
    SPORTS_LIB_REPARSE_SKIP_REASON_NO_ORIGINAL_FILES,
    extractSourceFiles,
    hasPaidOrGraceAccess,
    parseUIDAllowlist,
    parseUidAndEventIdFromEventPath,
    reparseEventFromOriginalFiles,
    resolveTargetSportsLibVersion,
    shouldEventBeReparsed,
    writeReparseStatus,
} from '../reparse/sports-lib-reparse.service';

interface ScriptOptions {
    execute: boolean;
    uid?: string;
    uids?: string[];
    limit: number;
    startAfter?: string;
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
    const index = argv.indexOf(key);
    if (index === -1) {
        return undefined;
    }
    return argv[index + 1];
}

export function parseScriptOptions(argv: string[]): ScriptOptions {
    const execute = argv.includes('--execute');
    const uid = readArgValue(argv, '--uid');
    const cliUIDAllowlist = parseUIDAllowlist(readArgValue(argv, '--uids'));
    const envUIDAllowlist = parseUIDAllowlist(process.env.SPORTS_LIB_REPARSE_UID_ALLOWLIST);
    const effectiveUIDAllowlist = uid ? null : (cliUIDAllowlist || envUIDAllowlist);
    const limit = parseIntArg(readArgValue(argv, '--limit'), 200);
    const startAfter = readArgValue(argv, '--start-after');

    return {
        execute,
        uid,
        uids: effectiveUIDAllowlist ? Array.from(effectiveUIDAllowlist) : undefined,
        limit,
        startAfter,
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

    let groupQuery = db.collectionGroup('events')
        .orderBy(admin.firestore.FieldPath.documentId())
        .limit(options.limit);
    if (options.startAfter) {
        groupQuery = groupQuery.startAfter(db.doc(options.startAfter));
    }
    const snapshot = await groupQuery.get();
    return snapshot.docs;
}

export async function runSportsLibReparseScript(argv: string[]): Promise<ScriptSummary> {
    const options = parseScriptOptions(argv);
    const targetSportsLibVersion = resolveTargetSportsLibVersion();
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

    const eventDocs = await getEventsToInspect(options);
    const accessCache = new Map<string, Promise<boolean>>();

    for (const eventDoc of eventDocs) {
        summary.scanned++;
        const parsedPath = parseUidAndEventIdFromEventPath(eventDoc.ref.path);
        if (!parsedPath) {
            continue;
        }
        const { uid, eventId } = parsedPath;

        const needsReparse = await shouldEventBeReparsed(eventDoc.ref, targetSportsLibVersion);
        if (!needsReparse) {
            continue;
        }

        let hasAccessPromise = accessCache.get(uid);
        if (!hasAccessPromise) {
            hasAccessPromise = hasPaidOrGraceAccess(uid);
            accessCache.set(uid, hasAccessPromise);
        }
        const hasAccess = await hasAccessPromise;
        if (!hasAccess) {
            summary.skippedNoAccess++;
            continue;
        }

        const sourceFiles = extractSourceFiles(eventDoc.data() as Record<string, unknown>);
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
            continue;
        }

        summary.candidates++;
        if (!options.execute) {
            continue;
        }

        try {
            const result = await reparseEventFromOriginalFiles(uid, eventId, {
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
            await writeReparseStatus(uid, eventId, {
                status: 'failed',
                reason: 'REPARSE_FAILED',
                targetSportsLibVersion,
                checkedAt: admin.firestore.FieldValue.serverTimestamp(),
                lastError: (error as Error)?.message || `${error}`,
            });
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
