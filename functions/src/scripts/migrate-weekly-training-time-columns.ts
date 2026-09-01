import * as admin from 'firebase-admin';
import {
  ChartDataCategoryTypes,
  ChartDataValueTypes,
  ChartTypes,
  DataDuration,
  TileTypes,
  TimeIntervals,
} from '@sports-alliance/sports-lib';

import {
  getUserDeletionGuardStateInTransaction,
  UserDeletionGuardReadError,
} from '../shared/user-deletion-guard';

/**
 * Run without --execute first. Use the reported tilesMatched value as
 * --expected-tiles when executing the global migration.
 */

const DEFAULT_PAGE_SIZE = 250;
const MAX_PAGE_SIZE = 500;
const DEFAULT_CONCURRENCY = 10;
const MAX_CONCURRENCY = 25;
const FIREBASE_UID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const FIREBASE_PROJECT_ID_PATTERN = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;

export interface WeeklyTrainingTimeColumnsMigrationOptions {
  projectId: string;
  execute: boolean;
  confirmAllUsers: boolean;
  expectedTiles?: number;
  uid?: string;
  pageSize: number;
  concurrency: number;
}

export interface WeeklyTrainingTimeColumnsMigrationSummary {
  dryRun: boolean;
  usersScanned: number;
  settingsDocumentsFound: number;
  settingsDocumentsMissing: number;
  usersMatched: number;
  tilesMatched: number;
  usersUpdated: number;
  tilesUpdated: number;
  skippedUserDeletion: number;
  skippedNoLongerMatched: number;
  failed: number;
  failedUserIDs: string[];
}

export interface WeeklyTrainingTimeTileMigrationResult {
  changed: boolean;
  matchedTiles: number;
  tiles: unknown[] | null;
}

interface SettingsMigrationCandidate {
  uid: string;
  ref: admin.firestore.DocumentReference;
}

interface SettingsMigrationScan {
  candidates: SettingsMigrationCandidate[];
  usersScanned: number;
  settingsDocumentsFound: number;
  settingsDocumentsMissing: number;
  usersMatched: number;
  tilesMatched: number;
}

type SettingsUpdateOutcome =
  | { status: 'updated'; tilesUpdated: number }
  | { status: 'skipped_user_deletion' }
  | { status: 'skipped_no_longer_matched' };

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function readSingleValue(argv: string[], name: string): string | undefined {
  const prefix = `--${name}=`;
  const values = argv
    .filter(argument => argument.startsWith(prefix))
    .map(argument => argument.slice(prefix.length));
  if (values.length > 1) {
    throw new Error(`--${name} cannot be repeated.`);
  }
  return values[0];
}

function parseBoundedInteger(
  value: string | undefined,
  name: string,
  fallback: number | undefined,
  minimum: number,
  maximum: number,
): number | undefined {
  if (value === undefined) {
    return fallback;
  }
  if (!/^\d+$/.test(value)) {
    throw new Error(`--${name} must be an integer between ${minimum} and ${maximum}.`);
  }
  const parsed = Number.parseInt(value, 10);
  if (parsed < minimum || parsed > maximum) {
    throw new Error(`--${name} must be an integer between ${minimum} and ${maximum}.`);
  }
  return parsed;
}

export function parseWeeklyTrainingTimeColumnsMigrationOptions(
  argv: string[],
): WeeklyTrainingTimeColumnsMigrationOptions {
  const valueOptions = ['project', 'expected-tiles', 'uid', 'page-size', 'concurrency'];
  const flagOptions = new Set(['--execute', '--confirm-all-users']);
  const unknownArgument = argv.find(argument => (
    !flagOptions.has(argument)
    && !valueOptions.some(name => argument.startsWith(`--${name}=`))
  ));
  if (unknownArgument) {
    throw new Error(`Unknown migration argument: ${unknownArgument}`);
  }

  const projectId = `${readSingleValue(argv, 'project') || ''}`.trim();
  const uid = `${readSingleValue(argv, 'uid') || ''}`.trim() || undefined;
  const execute = argv.includes('--execute');
  const confirmAllUsers = argv.includes('--confirm-all-users');
  const expectedTiles = parseBoundedInteger(
    readSingleValue(argv, 'expected-tiles'),
    'expected-tiles',
    undefined,
    0,
    Number.MAX_SAFE_INTEGER,
  );
  const pageSize = parseBoundedInteger(
    readSingleValue(argv, 'page-size'),
    'page-size',
    DEFAULT_PAGE_SIZE,
    1,
    MAX_PAGE_SIZE,
  ) as number;
  const concurrency = parseBoundedInteger(
    readSingleValue(argv, 'concurrency'),
    'concurrency',
    DEFAULT_CONCURRENCY,
    1,
    MAX_CONCURRENCY,
  ) as number;

  if (!FIREBASE_PROJECT_ID_PATTERN.test(projectId)) {
    throw new Error('--project must be an explicit Firebase project ID.');
  }
  if (uid && !FIREBASE_UID_PATTERN.test(uid)) {
    throw new Error('--uid must be a safe Firebase UID.');
  }
  if (execute && expectedTiles === undefined) {
    throw new Error('Execution requires --expected-tiles from a fresh dry run.');
  }
  if (execute && !uid && !confirmAllUsers) {
    throw new Error('Global execution requires --confirm-all-users.');
  }

  return {
    projectId,
    execute,
    confirmAllUsers,
    expectedTiles,
    uid,
    pageSize,
    concurrency,
  };
}

function isLegacyWeeklyTrainingTimeTile(value: unknown): boolean {
  const tile = asRecord(value);
  return tile?.type === TileTypes.Chart
    && tile.chartType === ChartTypes.LinesVertical
    && tile.dataType === DataDuration.type
    && tile.dataValueType === ChartDataValueTypes.Total
    && tile.dataCategoryType === ChartDataCategoryTypes.DateType
    && tile.dataTimeInterval === TimeIntervals.Weekly;
}

export function migrateWeeklyTrainingTimeTiles(
  value: unknown,
): WeeklyTrainingTimeTileMigrationResult {
  if (!Array.isArray(value)) {
    return { changed: false, matchedTiles: 0, tiles: null };
  }

  let matchedTiles = 0;
  const tiles = value.map(tile => {
    if (!isLegacyWeeklyTrainingTimeTile(tile)) {
      return tile;
    }
    matchedTiles++;
    return {
      ...asRecord(tile),
      chartType: ChartTypes.ColumnsVertical,
    };
  });

  return {
    changed: matchedTiles > 0,
    matchedTiles,
    tiles,
  };
}

function inspectSettingsSnapshot(
  snapshot: admin.firestore.DocumentSnapshot,
  uid: string,
  scan: SettingsMigrationScan,
): void {
  if (!snapshot.exists) {
    scan.settingsDocumentsMissing++;
    return;
  }
  scan.settingsDocumentsFound++;
  const data = asRecord(snapshot.data());
  const dashboardSettings = asRecord(data?.dashboardSettings);
  const migration = migrateWeeklyTrainingTimeTiles(dashboardSettings?.tiles);
  if (!migration.changed) {
    return;
  }

  scan.usersMatched++;
  scan.tilesMatched += migration.matchedTiles;
  scan.candidates.push({ uid, ref: snapshot.ref });
}

async function scanMigrationCandidates(
  db: admin.firestore.Firestore,
  options: WeeklyTrainingTimeColumnsMigrationOptions,
): Promise<SettingsMigrationScan> {
  const scan: SettingsMigrationScan = {
    candidates: [],
    usersScanned: 0,
    settingsDocumentsFound: 0,
    settingsDocumentsMissing: 0,
    usersMatched: 0,
    tilesMatched: 0,
  };

  if (options.uid) {
    const userRef = db.collection('users').doc(options.uid);
    const settingsRef = userRef.collection('config').doc('settings');
    const [userSnapshot, settingsSnapshot] = await db.getAll(userRef, settingsRef);
    if (!userSnapshot.exists) {
      return scan;
    }
    scan.usersScanned = 1;
    inspectSettingsSnapshot(settingsSnapshot, options.uid, scan);
    return scan;
  }

  let lastUserID: string | null = null;
  while (true) {
    let query = db.collection('users')
      .orderBy(admin.firestore.FieldPath.documentId())
      .select()
      .limit(options.pageSize);
    if (lastUserID) {
      query = query.startAfter(lastUserID);
    }
    const usersSnapshot = await query.get();
    if (usersSnapshot.empty) {
      break;
    }

    const settingsRefs = usersSnapshot.docs.map(userSnapshot => (
      userSnapshot.ref.collection('config').doc('settings')
    ));
    const settingsSnapshots = await db.getAll(...settingsRefs);
    settingsSnapshots.forEach((settingsSnapshot, index) => {
      const uid = usersSnapshot.docs[index].id;
      scan.usersScanned++;
      inspectSettingsSnapshot(settingsSnapshot, uid, scan);
    });

    lastUserID = usersSnapshot.docs[usersSnapshot.docs.length - 1].id;
    if (usersSnapshot.size < options.pageSize) {
      break;
    }
  }

  return scan;
}

async function updateSettingsCandidate(
  db: admin.firestore.Firestore,
  candidate: SettingsMigrationCandidate,
): Promise<SettingsUpdateOutcome> {
  return db.runTransaction(async transaction => {
    let deletionGuard;
    try {
      deletionGuard = await getUserDeletionGuardStateInTransaction(
        db,
        transaction,
        candidate.uid,
      );
    } catch (error) {
      throw new UserDeletionGuardReadError(
        candidate.uid,
        'weekly_training_time_columns_migration',
        error,
      );
    }
    if (deletionGuard.shouldSkip) {
      return { status: 'skipped_user_deletion' } as const;
    }

    const currentSnapshot = await transaction.get(candidate.ref);
    const data = currentSnapshot.exists ? asRecord(currentSnapshot.data()) : null;
    const dashboardSettings = asRecord(data?.dashboardSettings);
    const migration = migrateWeeklyTrainingTimeTiles(dashboardSettings?.tiles);
    if (!migration.changed || !migration.tiles) {
      return { status: 'skipped_no_longer_matched' } as const;
    }

    transaction.update(candidate.ref, {
      'dashboardSettings.tiles': migration.tiles,
    });
    return {
      status: 'updated',
      tilesUpdated: migration.matchedTiles,
    } as const;
  });
}

function initializeAdmin(projectId: string): void {
  if (admin.apps.length === 0) {
    admin.initializeApp({ projectId });
    return;
  }
  const initializedProjectId = admin.app().options.projectId;
  if (initializedProjectId !== projectId) {
    throw new Error(
      `Firebase Admin is already initialized for ${initializedProjectId || 'an unknown project'}; refusing ${projectId}.`,
    );
  }
}

export async function runWeeklyTrainingTimeColumnsMigration(
  argv: string[],
): Promise<WeeklyTrainingTimeColumnsMigrationSummary> {
  const options = parseWeeklyTrainingTimeColumnsMigrationOptions(argv);
  initializeAdmin(options.projectId);
  const db = admin.firestore();
  const scan = await scanMigrationCandidates(db, options);

  if (options.execute && scan.tilesMatched !== options.expectedTiles) {
    throw new Error(
      `Expected ${options.expectedTiles} matching tiles but found ${scan.tilesMatched}; aborting before writes.`,
    );
  }

  const summary: WeeklyTrainingTimeColumnsMigrationSummary = {
    dryRun: !options.execute,
    usersScanned: scan.usersScanned,
    settingsDocumentsFound: scan.settingsDocumentsFound,
    settingsDocumentsMissing: scan.settingsDocumentsMissing,
    usersMatched: scan.usersMatched,
    tilesMatched: scan.tilesMatched,
    usersUpdated: 0,
    tilesUpdated: 0,
    skippedUserDeletion: 0,
    skippedNoLongerMatched: 0,
    failed: 0,
    failedUserIDs: [],
  };
  if (!options.execute) {
    return summary;
  }

  let nextCandidateIndex = 0;
  const workers = Array.from(
    { length: Math.min(options.concurrency, scan.candidates.length) },
    async () => {
      while (nextCandidateIndex < scan.candidates.length) {
        const candidate = scan.candidates[nextCandidateIndex++];
        try {
          const outcome = await updateSettingsCandidate(db, candidate);
          if (outcome.status === 'updated') {
            summary.usersUpdated++;
            summary.tilesUpdated += outcome.tilesUpdated;
          } else if (outcome.status === 'skipped_user_deletion') {
            summary.skippedUserDeletion++;
          } else {
            summary.skippedNoLongerMatched++;
          }
        } catch {
          summary.failed++;
          summary.failedUserIDs.push(candidate.uid);
        }
      }
    },
  );
  await Promise.all(workers);
  return summary;
}

if (require.main === module) {
  void runWeeklyTrainingTimeColumnsMigration(process.argv.slice(2))
    .then(summary => {
      console.info(JSON.stringify(summary, null, 2));
      if (summary.failed > 0) {
        process.exitCode = 1;
      }
    })
    .catch(error => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    });
}
