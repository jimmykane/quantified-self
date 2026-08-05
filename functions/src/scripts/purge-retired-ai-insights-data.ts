import * as admin from 'firebase-admin';

export const RETIRED_AI_INSIGHTS_COLLECTION_GROUPS = [
  'aiInsightsRequests',
  'aiInsightsUsage',
  'aiInsightsPromptRepairs',
] as const;

export type RetiredAiInsightsCollectionGroup =
  typeof RETIRED_AI_INSIGHTS_COLLECTION_GROUPS[number];

export const DEFAULT_RETIRED_AI_INSIGHTS_PURGE_BATCH_SIZE = 100;
export const MAX_RETIRED_AI_INSIGHTS_PURGE_BATCH_SIZE = 500;

type RetiredAiInsightsPurgeFirestore = Pick<
  FirebaseFirestore.Firestore,
  'bulkWriter' | 'collectionGroup' | 'recursiveDelete'
>;

type RetiredAiInsightsPurgeCounts = Record<
  RetiredAiInsightsCollectionGroup,
  number
>;

interface RetiredAiInsightsPurgeLogger {
  info: (message: string) => void;
  warn: (message: string, details?: Record<string, unknown>) => void;
}

export interface RetiredAiInsightsPurgeOptions {
  db: RetiredAiInsightsPurgeFirestore;
  execute?: boolean;
  batchSize?: number;
  logger?: RetiredAiInsightsPurgeLogger;
}

export interface RetiredAiInsightsPurgeResult {
  found: RetiredAiInsightsPurgeCounts;
  deleted: RetiredAiInsightsPurgeCounts;
  remaining: RetiredAiInsightsPurgeCounts;
}

export interface RetiredAiInsightsPurgeCliOptions {
  projectId: string;
  execute: boolean;
  batchSize: number;
}

export class RetiredAiInsightsPurgeError extends Error {
  override readonly name = 'RetiredAiInsightsPurgeError';
}

const defaultLogger: RetiredAiInsightsPurgeLogger = {
  info: message => console.info(message),
  warn: (message, details) => console.warn(message, details),
};

function createCounts(value: number): RetiredAiInsightsPurgeCounts {
  return Object.fromEntries(
    RETIRED_AI_INSIGHTS_COLLECTION_GROUPS.map(collectionGroup => [
      collectionGroup,
      value,
    ]),
  ) as RetiredAiInsightsPurgeCounts;
}

function assertBatchSize(value: number): number {
  if (!Number.isSafeInteger(value)
    || value < 1
    || value > MAX_RETIRED_AI_INSIGHTS_PURGE_BATCH_SIZE) {
    throw new RetiredAiInsightsPurgeError(
      `batchSize must be an integer between 1 and ${MAX_RETIRED_AI_INSIGHTS_PURGE_BATCH_SIZE}.`,
    );
  }
  return value;
}

async function countCollectionGroup(
  db: RetiredAiInsightsPurgeFirestore,
  collectionGroup: RetiredAiInsightsCollectionGroup,
): Promise<number> {
  const aggregate = await db.collectionGroup(collectionGroup).count().get();
  const count = aggregate.data().count;
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new RetiredAiInsightsPurgeError(
      `Firestore returned an invalid document count for ${collectionGroup}.`,
    );
  }
  return count;
}

async function countRetiredAiInsightsData(
  db: RetiredAiInsightsPurgeFirestore,
): Promise<RetiredAiInsightsPurgeCounts> {
  const counts = createCounts(0);
  for (const collectionGroup of RETIRED_AI_INSIGHTS_COLLECTION_GROUPS) {
    counts[collectionGroup] = await countCollectionGroup(db, collectionGroup);
  }
  return counts;
}

async function purgeCollectionGroup(
  db: RetiredAiInsightsPurgeFirestore,
  collectionGroup: RetiredAiInsightsCollectionGroup,
  batchSize: number,
  logger: RetiredAiInsightsPurgeLogger,
): Promise<number> {
  let deleted = 0;
  while (true) {
    const snapshot = await db.collectionGroup(collectionGroup)
      .limit(batchSize)
      .get();
    if (snapshot.empty) {
      return deleted;
    }

    const bulkWriter = db.bulkWriter();
    bulkWriter.onWriteError((error) => {
      logger.warn('[RetiredAiInsightsPurge] Retrying a failed recursive delete.', {
        collectionGroup,
        code: error.code,
        failedAttempts: error.failedAttempts,
      });
      return error.failedAttempts < 3;
    });

    try {
      // Every retired root is deleted recursively so unexpected descendants
      // cannot retain historical prompts, responses, or usage state.
      for (const document of snapshot.docs) {
        await db.recursiveDelete(document.ref, bulkWriter);
      }
    } finally {
      await bulkWriter.close();
    }

    deleted += snapshot.size;
    logger.info(
      `[RetiredAiInsightsPurge] Deleted ${deleted} ${collectionGroup} document root(s).`,
    );
  }
}

export async function purgeRetiredAiInsightsData(
  options: RetiredAiInsightsPurgeOptions,
): Promise<RetiredAiInsightsPurgeResult> {
  const execute = options.execute === true;
  const batchSize = assertBatchSize(
    options.batchSize ?? DEFAULT_RETIRED_AI_INSIGHTS_PURGE_BATCH_SIZE,
  );
  const logger = options.logger ?? defaultLogger;
  const found = await countRetiredAiInsightsData(options.db);

  if (!execute) {
    logger.info(
      `[RetiredAiInsightsPurge] Dry run found ${JSON.stringify(found)} document root(s).`,
    );
    return { found, deleted: createCounts(0), remaining: found };
  }

  const deleted = createCounts(0);
  for (const collectionGroup of RETIRED_AI_INSIGHTS_COLLECTION_GROUPS) {
    deleted[collectionGroup] = await purgeCollectionGroup(
      options.db,
      collectionGroup,
      batchSize,
      logger,
    );
  }

  const remaining = await countRetiredAiInsightsData(options.db);
  const remainingGroups = RETIRED_AI_INSIGHTS_COLLECTION_GROUPS.filter(
    collectionGroup => remaining[collectionGroup] !== 0,
  );
  if (remainingGroups.length > 0) {
    throw new RetiredAiInsightsPurgeError(
      `Retired AI Insights purge stopped with documents remaining in ${remainingGroups.join(', ')}.`,
    );
  }

  return { found, deleted, remaining };
}

function parseProjectId(value: string | undefined): string {
  const projectId = `${value || ''}`.trim();
  if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(projectId)) {
    throw new RetiredAiInsightsPurgeError(
      'A valid --project=<firebase-project-id> argument is required.',
    );
  }
  return projectId;
}

export function parseRetiredAiInsightsPurgeArgs(
  args: readonly string[],
): RetiredAiInsightsPurgeCliOptions {
  let projectId: string | undefined;
  let execute = false;
  let explicitDryRun = false;
  let batchSize = DEFAULT_RETIRED_AI_INSIGHTS_PURGE_BATCH_SIZE;

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
      throw new RetiredAiInsightsPurgeError('An unsupported argument was provided.');
    }
  }

  if (execute && explicitDryRun) {
    throw new RetiredAiInsightsPurgeError(
      'Choose either --execute or --dry-run, not both.',
    );
  }

  return {
    projectId: parseProjectId(projectId),
    execute,
    batchSize: assertBatchSize(batchSize),
  };
}

export async function runRetiredAiInsightsPurgeCli(
  args: readonly string[] = process.argv.slice(2),
): Promise<RetiredAiInsightsPurgeResult> {
  const options = parseRetiredAiInsightsPurgeArgs(args);
  if (admin.apps.length === 0) {
    admin.initializeApp({ projectId: options.projectId });
  }
  const configuredProjectId = admin.app().options.projectId;
  if (configuredProjectId !== options.projectId) {
    throw new RetiredAiInsightsPurgeError(
      `Firebase Admin is configured for ${configuredProjectId || 'an unknown project'}, not ${options.projectId}.`,
    );
  }

  return purgeRetiredAiInsightsData({
    db: admin.firestore(),
    execute: options.execute,
    batchSize: options.batchSize,
  });
}

if (require.main === module) {
  runRetiredAiInsightsPurgeCli()
    .then(result => {
      console.info(
        `[RetiredAiInsightsPurge] Complete: ${JSON.stringify(result)}.`,
      );
    })
    .catch(error => {
      if (error instanceof RetiredAiInsightsPurgeError) {
        console.error('[RetiredAiInsightsPurge] Failed.', error.message);
      } else {
        const errorRecord = error && typeof error === 'object'
          ? error as { code?: unknown; name?: unknown }
          : {};
        console.error('[RetiredAiInsightsPurge] Failed.', {
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
