import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import {
    SPORTS_LIB_REPARSE_RUNTIME_DEFAULTS,
    parseUIDAllowlist,
    parseUidAndEventIdFromEventPath,
    sportsLibVersionToCode,
} from '../reparse/sports-lib-reparse.service';

const MISSING_PROCESSING_VERSION = '0.0.0';
const MISSING_PROCESSING_VERSION_CODE = 0;

interface BackfillOptions {
    execute: boolean;
    uid?: string;
    uids?: string[];
    limit: number;
    startAfter?: string;
}

export interface BackfillSummary {
    dryRun: boolean;
    scanned: number;
    created: number;
    patched: number;
    unchanged: number;
    skippedInvalid: number;
    failed: number;
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

export function parseBackfillOptions(argv: string[]): BackfillOptions {
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

    return {
        execute,
        uid,
        uids: effectiveUIDAllowlist ? Array.from(effectiveUIDAllowlist) : undefined,
        limit,
        startAfter,
    };
}

async function getEventsToInspect(options: BackfillOptions): Promise<admin.firestore.QueryDocumentSnapshot[]> {
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
            logger.warn('[sports-lib-processing-backfill] Ignoring --start-after in multi-UID mode.');
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

export async function runBackfillSportsLibProcessingCode(argv: string[]): Promise<BackfillSummary> {
    const options = parseBackfillOptions(argv);
    const summary: BackfillSummary = {
        dryRun: !options.execute,
        scanned: 0,
        created: 0,
        patched: 0,
        unchanged: 0,
        skippedInvalid: 0,
        failed: 0,
    };

    if (!admin.apps.length) {
        admin.initializeApp();
    }

    const eventDocs = await getEventsToInspect(options);
    for (const eventDoc of eventDocs) {
        summary.scanned++;
        const parsed = parseUidAndEventIdFromEventPath(eventDoc.ref.path);
        if (!parsed) {
            continue;
        }
        const { uid, eventId } = parsed;
        const processingRef = eventDoc.ref.collection('metaData').doc('processing');

        try {
            const processingSnapshot = await processingRef.get();
            if (!processingSnapshot.exists) {
                summary.created++;
                if (options.execute) {
                    await processingRef.set({
                        sportsLibVersion: MISSING_PROCESSING_VERSION,
                        sportsLibVersionCode: MISSING_PROCESSING_VERSION_CODE,
                        processedAt: admin.firestore.FieldValue.serverTimestamp(),
                    }, { merge: true });
                }
                continue;
            }

            const processingData = processingSnapshot.data() as Record<string, unknown>;
            const rawVersion = processingData.sportsLibVersion;
            if (typeof rawVersion !== 'string') {
                summary.skippedInvalid++;
                logger.warn('[sports-lib-processing-backfill] Invalid processing metadata. Missing or non-string sportsLibVersion.', {
                    processingDocPath: processingRef.path,
                    sportsLibVersion: rawVersion,
                });
                continue;
            }

            let computedCode: number;
            try {
                computedCode = sportsLibVersionToCode(rawVersion);
            } catch (error) {
                summary.skippedInvalid++;
                logger.warn('[sports-lib-processing-backfill] Invalid processing metadata. Could not parse sportsLibVersion.', {
                    processingDocPath: processingRef.path,
                    sportsLibVersion: rawVersion,
                    error: `${error}`,
                });
                continue;
            }

            const rawCode = processingData.sportsLibVersionCode;
            const normalizedRawCode = typeof rawCode === 'number' && Number.isFinite(rawCode) ? rawCode : null;
            if (normalizedRawCode === computedCode) {
                summary.unchanged++;
                continue;
            }

            summary.patched++;
            if (options.execute) {
                await processingRef.set({
                    sportsLibVersionCode: computedCode,
                }, { merge: true });
            }
        } catch (error) {
            summary.failed++;
            logger.error('[sports-lib-processing-backfill] Failed to backfill processing metadata for event.', {
                uid,
                eventId,
                eventPath: eventDoc.ref.path,
                error: `${error}`,
            });
        }
    }

    logger.info('[sports-lib-processing-backfill] Summary', summary);
    return summary;
}

async function main(): Promise<void> {
    const summary = await runBackfillSportsLibProcessingCode(process.argv.slice(2));
    if (!summary.dryRun && summary.failed > 0) {
        process.exitCode = 1;
    }
}

if (require.main === module) {
    main().catch((error) => {
        logger.error('[sports-lib-processing-backfill] Fatal error', error);
        process.exitCode = 1;
    });
}
