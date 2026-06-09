import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import { parseUIDAllowlist } from '../reparse/sports-lib-reparse.service';
import {
    SPORTS_LIB_ROUTE_REPARSE_RUNTIME_DEFAULTS,
    parseUidAndRouteIdFromRoutePath,
} from '../reparse/sports-lib-route-reparse.service';

const ROUTE_PROCESSING_ENTITY = 'route';
const PROGRESS_LOG_EVERY = 25;
const DEFAULT_CONCURRENCY = 5;
const MAX_CONCURRENCY = 50;

interface BackfillRouteProcessingEntityOptions {
    execute: boolean;
    uid?: string;
    uids?: string[];
    limit: number;
    startAfter?: string;
    concurrency: number;
}

export interface BackfillRouteProcessingEntitySummary {
    dryRun: boolean;
    scanned: number;
    patched: number;
    unchanged: number;
    skippedMissing: number;
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

function parseConcurrencyArg(value: string | undefined): number {
    const parsed = parseIntArg(value, DEFAULT_CONCURRENCY);
    return Math.min(Math.max(parsed, 1), MAX_CONCURRENCY);
}

export function parseBackfillRouteProcessingEntityOptions(argv: string[]): BackfillRouteProcessingEntityOptions {
    const execute = argv.includes('--execute');
    const uid = readArgValue(argv, '--uid');
    const cliUIDAllowlist = parseUIDAllowlist(readArgValue(argv, '--uids'));
    const constantUIDAllowlist = SPORTS_LIB_ROUTE_REPARSE_RUNTIME_DEFAULTS.uidAllowlist
        && SPORTS_LIB_ROUTE_REPARSE_RUNTIME_DEFAULTS.uidAllowlist.length > 0
        ? new Set(SPORTS_LIB_ROUTE_REPARSE_RUNTIME_DEFAULTS.uidAllowlist)
        : null;
    const effectiveUIDAllowlist = uid ? null : (cliUIDAllowlist || constantUIDAllowlist);

    return {
        execute,
        uid,
        uids: effectiveUIDAllowlist ? Array.from(effectiveUIDAllowlist) : undefined,
        limit: parseIntArg(readArgValue(argv, '--limit'), SPORTS_LIB_ROUTE_REPARSE_RUNTIME_DEFAULTS.scanLimit),
        startAfter: readArgValue(argv, '--start-after'),
        concurrency: parseConcurrencyArg(readArgValue(argv, '--concurrency')),
    };
}

function resolveScopedStartAfterValue(startAfter: string | undefined, options: BackfillRouteProcessingEntityOptions): string | undefined {
    if (!startAfter || !options.uid) {
        return startAfter;
    }
    const parsed = parseUidAndRouteIdFromRoutePath(startAfter);
    if (parsed && parsed.uid === options.uid) {
        return parsed.routeId;
    }
    return startAfter;
}

async function getRoutesToInspect(options: BackfillRouteProcessingEntityOptions): Promise<admin.firestore.QueryDocumentSnapshot[]> {
    const db = admin.firestore();
    if (options.uid) {
        let userQuery = db.collection(`users/${options.uid}/routes`)
            .orderBy(admin.firestore.FieldPath.documentId())
            .limit(options.limit);
        const scopedStartAfter = resolveScopedStartAfterValue(options.startAfter, options);
        if (scopedStartAfter) {
            userQuery = userQuery.startAfter(scopedStartAfter);
        }
        const snapshot = await userQuery.get();
        return snapshot.docs;
    }

    if (options.uids && options.uids.length > 0) {
        if (options.startAfter) {
            logger.warn('[route-processing-entity-backfill] Ignoring --start-after in multi-UID mode.');
        }

        const docs: admin.firestore.QueryDocumentSnapshot[] = [];
        let remainingLimit = options.limit;
        for (const uid of options.uids) {
            if (remainingLimit <= 0) {
                break;
            }
            const snapshot = await db.collection(`users/${uid}/routes`)
                .orderBy(admin.firestore.FieldPath.documentId())
                .limit(remainingLimit)
                .get();
            docs.push(...snapshot.docs);
            remainingLimit -= snapshot.docs.length;
        }
        return docs;
    }

    let groupQuery = db.collectionGroup('routes')
        .orderBy(admin.firestore.FieldPath.documentId())
        .limit(options.limit);
    if (options.startAfter) {
        groupQuery = groupQuery.startAfter(db.doc(options.startAfter));
    }
    const snapshot = await groupQuery.get();
    return snapshot.docs;
}

function shouldLogProgress(scanned: number, total: number): boolean {
    if (total <= 0) {
        return false;
    }
    return scanned === 1 || scanned === total || scanned % PROGRESS_LOG_EVERY === 0;
}

export async function runBackfillRouteProcessingEntity(argv: string[]): Promise<BackfillRouteProcessingEntitySummary> {
    const options = parseBackfillRouteProcessingEntityOptions(argv);
    const summary: BackfillRouteProcessingEntitySummary = {
        dryRun: !options.execute,
        scanned: 0,
        patched: 0,
        unchanged: 0,
        skippedMissing: 0,
        skippedInvalid: 0,
        failed: 0,
    };

    if (!admin.apps.length) {
        admin.initializeApp();
    }

    const routeDocs = await getRoutesToInspect(options);
    const totalRoutes = routeDocs.length;
    logger.info('[route-processing-entity-backfill] Starting backfill run.', {
        dryRun: !options.execute,
        totalRoutes,
        progressLogEvery: PROGRESS_LOG_EVERY,
        concurrency: options.concurrency,
        startAfter: options.startAfter,
    });

    const processRouteDoc = async (routeDoc: admin.firestore.QueryDocumentSnapshot): Promise<void> => {
        summary.scanned++;
        const parsed = parseUidAndRouteIdFromRoutePath(routeDoc.ref.path);
        if (!parsed) {
            summary.skippedInvalid++;
            logger.warn('[route-processing-entity-backfill] Could not parse UID/routeID from route path.', {
                routePath: routeDoc.ref.path,
            });
            return;
        }

        const { uid, routeId } = parsed;
        const routePath = routeDoc.ref.path;
        const processingRef = routeDoc.ref.collection('metaData').doc('processing');
        const processingDocPath = processingRef.path;

        try {
            const processingSnapshot = await processingRef.get();
            if (!processingSnapshot.exists) {
                summary.skippedMissing++;
                logger.warn('[route-processing-entity-backfill] Skipping route without processing metadata.', {
                    uid,
                    routeId,
                    routePath,
                    processingDocPath,
                });
                return;
            }

            const processingData = processingSnapshot.data() as Record<string, unknown>;
            const existingEntity = processingData.processingEntity;
            if (existingEntity === ROUTE_PROCESSING_ENTITY) {
                summary.unchanged++;
                return;
            }
            if (typeof existingEntity === 'string' && existingEntity.length > 0) {
                summary.skippedInvalid++;
                logger.warn('[route-processing-entity-backfill] Skipping route processing metadata with unexpected entity.', {
                    uid,
                    routeId,
                    routePath,
                    processingDocPath,
                    processingEntity: existingEntity,
                });
                return;
            }

            summary.patched++;
            if (options.execute) {
                await processingRef.set({
                    processingEntity: ROUTE_PROCESSING_ENTITY,
                }, { merge: true });
            }
            logger.info('[route-processing-entity-backfill] Patched route processing metadata entity.', {
                uid,
                routeId,
                routePath,
                processingDocPath,
                dryRun: !options.execute,
            });
        } catch (error) {
            summary.failed++;
            logger.error('[route-processing-entity-backfill] Failed to backfill route processing metadata entity.', {
                uid,
                routeId,
                routePath,
                processingDocPath,
                error: `${error}`,
            });
        } finally {
            if (shouldLogProgress(summary.scanned, totalRoutes)) {
                logger.info('[route-processing-entity-backfill] Progress', {
                    scanned: summary.scanned,
                    totalRoutes,
                    percentComplete: Math.round((summary.scanned / totalRoutes) * 100),
                    patched: summary.patched,
                    unchanged: summary.unchanged,
                    skippedMissing: summary.skippedMissing,
                    skippedInvalid: summary.skippedInvalid,
                    failed: summary.failed,
                });
            }
        }
    };

    if (routeDocs.length > 0) {
        let nextIndex = 0;
        const workerCount = Math.min(options.concurrency, routeDocs.length);
        const workers = Array.from({ length: workerCount }, async () => {
            while (true) {
                const currentIndex = nextIndex++;
                if (currentIndex >= routeDocs.length) {
                    return;
                }
                await processRouteDoc(routeDocs[currentIndex]);
            }
        });
        await Promise.all(workers);
    }

    logger.info('[route-processing-entity-backfill] Summary', summary);
    return summary;
}

if (require.main === module) {
    runBackfillRouteProcessingEntity(process.argv.slice(2)).catch(error => {
        logger.error('[route-processing-entity-backfill] Fatal error', error);
        process.exitCode = 1;
    });
}
