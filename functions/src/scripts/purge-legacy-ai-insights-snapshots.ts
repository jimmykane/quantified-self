import * as admin from 'firebase-admin';

export const LEGACY_AI_INSIGHTS_SNAPSHOT_COLLECTION_GROUP = 'aiInsightsRequests';
export const DEFAULT_LEGACY_SNAPSHOT_PURGE_BATCH_SIZE = 100;
export const MAX_LEGACY_SNAPSHOT_PURGE_BATCH_SIZE = 500;

type LegacySnapshotPurgeFirestore = Pick<
  FirebaseFirestore.Firestore,
  'bulkWriter' | 'collectionGroup' | 'recursiveDelete'
>;

interface LegacySnapshotPurgeLogger {
  info: (message: string) => void;
  warn: (message: string, details?: Record<string, unknown>) => void;
}

export interface LegacySnapshotPurgeOptions {
  db: LegacySnapshotPurgeFirestore;
  execute?: boolean;
  batchSize?: number;
  logger?: LegacySnapshotPurgeLogger;
}

export interface LegacySnapshotPurgeResult {
  found: number;
  deleted: number;
  remaining: number;
}

export interface LegacySnapshotPurgeCliOptions {
  projectId: string;
  execute: boolean;
  batchSize: number;
}

export class LegacySnapshotPurgeError extends Error {
  override readonly name = 'LegacySnapshotPurgeError';
}

const defaultLogger: LegacySnapshotPurgeLogger = {
  info: message => console.info(message),
  warn: (message, details) => console.warn(message, details),
};

function assertBatchSize(value: number): number {
  if (!Number.isSafeInteger(value)
    || value < 1
    || value > MAX_LEGACY_SNAPSHOT_PURGE_BATCH_SIZE) {
    throw new LegacySnapshotPurgeError(
      `batchSize must be an integer between 1 and ${MAX_LEGACY_SNAPSHOT_PURGE_BATCH_SIZE}.`,
    );
  }
  return value;
}

async function countLegacySnapshots(
  db: LegacySnapshotPurgeFirestore,
): Promise<number> {
  const aggregate = await db
    .collectionGroup(LEGACY_AI_INSIGHTS_SNAPSHOT_COLLECTION_GROUP)
    .count()
    .get();
  const count = aggregate.data().count;
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new LegacySnapshotPurgeError(
      'Firestore returned an invalid legacy snapshot count.',
    );
  }
  return count;
}

export async function purgeLegacyAiInsightsSnapshots(
  options: LegacySnapshotPurgeOptions,
): Promise<LegacySnapshotPurgeResult> {
  const execute = options.execute === true;
  const batchSize = assertBatchSize(
    options.batchSize ?? DEFAULT_LEGACY_SNAPSHOT_PURGE_BATCH_SIZE,
  );
  const logger = options.logger ?? defaultLogger;
  const found = await countLegacySnapshots(options.db);

  if (!execute) {
    logger.info(
      `[LegacyAiInsightsPurge] Dry run found ${found} document(s) in the retired collection group.`,
    );
    return { found, deleted: 0, remaining: found };
  }

  let deleted = 0;
  while (true) {
    const snapshot = await options.db
      .collectionGroup(LEGACY_AI_INSIGHTS_SNAPSHOT_COLLECTION_GROUP)
      .limit(batchSize)
      .get();
    if (snapshot.empty) {
      break;
    }

    const bulkWriter = options.db.bulkWriter();
    bulkWriter.onWriteError((error) => {
      logger.warn('[LegacyAiInsightsPurge] Retrying a failed recursive delete.', {
        code: error.code,
        failedAttempts: error.failedAttempts,
      });
      return error.failedAttempts < 3;
    });

    try {
      // The retired writer created flat roots, but use recursive deletion for
      // defense in depth and keep traversal concurrency at one root at a time.
      for (const document of snapshot.docs) {
        await options.db.recursiveDelete(document.ref, bulkWriter);
      }
    } finally {
      await bulkWriter.close();
    }

    deleted += snapshot.size;
    logger.info(
      `[LegacyAiInsightsPurge] Recursively deleted ${deleted} document(s).`,
    );
  }

  const remaining = await countLegacySnapshots(options.db);
  if (remaining !== 0) {
    throw new LegacySnapshotPurgeError(
      `Legacy AI Insights purge stopped with ${remaining} document(s) remaining.`,
    );
  }

  return { found, deleted, remaining };
}

function parseProjectId(value: string | undefined): string {
  const projectId = `${value || ''}`.trim();
  if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(projectId)) {
    throw new LegacySnapshotPurgeError(
      'A valid --project=<firebase-project-id> argument is required.',
    );
  }
  return projectId;
}

export function parseLegacySnapshotPurgeArgs(
  args: readonly string[],
): LegacySnapshotPurgeCliOptions {
  let projectId: string | undefined;
  let execute = false;
  let explicitDryRun = false;
  let batchSize = DEFAULT_LEGACY_SNAPSHOT_PURGE_BATCH_SIZE;

  for (const argument of args) {
    if (argument === '--execute') {
      execute = true;
    } else if (argument === '--dry-run') {
      explicitDryRun = true;
    } else if (argument.startsWith('--project=')) {
      projectId = argument.slice('--project='.length);
    } else if (argument.startsWith('--batch-size=')) {
      batchSize = Number(argument.slice('--batch-size='.length));
    } else {
      throw new LegacySnapshotPurgeError('An unsupported argument was provided.');
    }
  }

  if (execute && explicitDryRun) {
    throw new LegacySnapshotPurgeError(
      'Choose either --execute or --dry-run, not both.',
    );
  }

  return {
    projectId: parseProjectId(projectId),
    execute,
    batchSize: assertBatchSize(batchSize),
  };
}

export async function runLegacySnapshotPurgeCli(
  args: readonly string[] = process.argv.slice(2),
): Promise<LegacySnapshotPurgeResult> {
  const options = parseLegacySnapshotPurgeArgs(args);
  if (admin.apps.length === 0) {
    admin.initializeApp({ projectId: options.projectId });
  }
  const configuredProjectId = admin.app().options.projectId;
  if (configuredProjectId !== options.projectId) {
    throw new LegacySnapshotPurgeError(
      `Firebase Admin is configured for ${configuredProjectId || 'an unknown project'}, not ${options.projectId}.`,
    );
  }

  return purgeLegacyAiInsightsSnapshots({
    db: admin.firestore(),
    execute: options.execute,
    batchSize: options.batchSize,
  });
}

if (require.main === module) {
  runLegacySnapshotPurgeCli()
    .then(result => {
      console.info(
        `[LegacyAiInsightsPurge] Complete: found=${result.found}, deleted=${result.deleted}, remaining=${result.remaining}.`,
      );
    })
    .catch(error => {
      if (error instanceof LegacySnapshotPurgeError) {
        console.error('[LegacyAiInsightsPurge] Failed.', error.message);
      } else {
        const errorRecord = error && typeof error === 'object'
          ? error as { code?: unknown; name?: unknown }
          : {};
        console.error('[LegacyAiInsightsPurge] Failed.', {
          errorName: typeof errorRecord.name === 'string'
            ? errorRecord.name
            : 'unknown',
          errorCode: typeof errorRecord.code === 'string'
            || typeof errorRecord.code === 'number'
            ? errorRecord.code
            : 'unknown',
        });
      }
      process.exitCode = 1;
    });
}
