import * as admin from 'firebase-admin';
import { ServiceNames } from '@sports-alliance/sports-lib';
import {
  getServiceConnectionProjectionConfig,
  ProjectedServiceName,
  projectionRevisionKeyFromMs,
  readServiceConnectionAccountProjection,
  refreshServiceConnectionAccountProjection,
} from '../service-connection-account-projection';
import { ServiceConnectionAccountProjection } from '../../../shared/service-connection';

const APPLY_CONFIRMATION = 'BACKFILL_CONNECTION_PROJECTIONS';
const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGE_SIZE = 500;
const PROJECTED_SERVICES: readonly ProjectedServiceName[] = [
  ServiceNames.GarminAPI,
  ServiceNames.SuuntoApp,
  ServiceNames.COROSAPI,
];

export interface ServiceConnectionProjectionBackfillOptions {
  execute: boolean;
  pageSize: number;
  services: readonly ProjectedServiceName[];
}

export interface ServiceConnectionProjectionBackfillSummary {
  dryRun: boolean;
  rootsScanned: number;
  accountsProjected: number;
  wouldUpdate: number;
  unchanged: number;
  updated: number;
  skippedStale: number;
  skippedDeletedUser: number;
  failed: number;
  byService: Partial<Record<ProjectedServiceName, {
    rootsScanned: number;
    accountsProjected: number;
    wouldUpdate: number;
    unchanged: number;
    updated: number;
    skippedStale: number;
    skippedDeletedUser: number;
    failed: number;
  }>>;
}

function readArgValue(argv: readonly string[], key: string): string | undefined {
  const prefix = `${key}=`;
  for (let index = 0; index < argv.length; index++) {
    if (argv[index] === key) return argv[index + 1];
    if (argv[index].startsWith(prefix)) return argv[index].slice(prefix.length);
  }
  return undefined;
}

function parsePageSize(value: string | undefined): number {
  if (!value) return DEFAULT_PAGE_SIZE;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > MAX_PAGE_SIZE) {
    throw new Error(`--page-size must be between 1 and ${MAX_PAGE_SIZE}.`);
  }
  return parsed;
}

function parseServices(value: string | undefined): readonly ProjectedServiceName[] {
  if (!value) return PROJECTED_SERVICES;
  const requested = value.split(',').map(item => item.trim()).filter(Boolean);
  if (requested.length === 0) throw new Error('--services must name at least one provider.');
  const aliases: Record<string, ProjectedServiceName> = {
    garmin: ServiceNames.GarminAPI,
    suunto: ServiceNames.SuuntoApp,
    coros: ServiceNames.COROSAPI,
  };
  const services = requested.map(item => aliases[item.toLowerCase()]);
  if (services.some(service => !service)) {
    throw new Error('--services accepts only garmin,suunto,coros.');
  }
  return Array.from(new Set(services));
}

export function parseServiceConnectionProjectionBackfillOptions(
  argv: readonly string[],
): ServiceConnectionProjectionBackfillOptions {
  const execute = argv.includes('--execute');
  if (execute && readArgValue(argv, '--confirm') !== APPLY_CONFIRMATION) {
    throw new Error(`Applying the backfill requires --confirm=${APPLY_CONFIRMATION}.`);
  }
  return {
    execute,
    pageSize: parsePageSize(readArgValue(argv, '--page-size')),
    services: parseServices(readArgValue(argv, '--services')),
  };
}

function projectionsEqual(
  current: unknown,
  expected: readonly ServiceConnectionAccountProjection[],
): boolean {
  if (!Array.isArray(current) || current.length !== expected.length) return false;
  return current.every((value, index) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const account = value as Record<string, unknown>;
    const expectedAccount = expected[index];
    const allowedKeys = new Set([
      'providerUserId',
      'connectedAtMs',
      'permissions',
      'permissionsUpdatedAtMs',
    ]);
    if (Object.keys(account).some(key => !allowedKeys.has(key))) return false;
    return account.providerUserId === expectedAccount.providerUserId
      && account.connectedAtMs === expectedAccount.connectedAtMs
      && account.permissionsUpdatedAtMs === expectedAccount.permissionsUpdatedAtMs
      && JSON.stringify(account.permissions) === JSON.stringify(expectedAccount.permissions);
  });
}

export async function runServiceConnectionProjectionBackfill(
  argv: readonly string[],
  dependencies: {
    db?: admin.firestore.Firestore;
    revisionAtMs?: number;
  } = {},
): Promise<ServiceConnectionProjectionBackfillSummary> {
  const options = parseServiceConnectionProjectionBackfillOptions(argv);
  if (!admin.apps.length && !dependencies.db) admin.initializeApp();
  const db = dependencies.db || admin.firestore();
  const revisionKey = projectionRevisionKeyFromMs(dependencies.revisionAtMs ?? Date.now());

  const summary: ServiceConnectionProjectionBackfillSummary = {
    dryRun: !options.execute,
    rootsScanned: 0,
    accountsProjected: 0,
    wouldUpdate: 0,
    unchanged: 0,
    updated: 0,
    skippedStale: 0,
    skippedDeletedUser: 0,
    failed: 0,
    byService: {},
  };

  for (const serviceName of options.services) {
    const serviceSummary = {
      rootsScanned: 0,
      accountsProjected: 0,
      wouldUpdate: 0,
      unchanged: 0,
      updated: 0,
      skippedStale: 0,
      skippedDeletedUser: 0,
      failed: 0,
    };
    summary.byService[serviceName] = serviceSummary;
    const collectionName = getServiceConnectionProjectionConfig(serviceName).tokenCollectionName;
    let cursor: admin.firestore.QueryDocumentSnapshot | undefined;

    do {
      let query: admin.firestore.Query = db.collection(collectionName)
        .orderBy(admin.firestore.FieldPath.documentId())
        .limit(options.pageSize);
      if (cursor) query = query.startAfter(cursor);
      const page = await query.get();

      for (const root of page.docs) {
        serviceSummary.rootsScanned++;
        summary.rootsScanned++;
        try {
          const accounts = await readServiceConnectionAccountProjection({
            db,
            userID: root.id,
            serviceName,
          });
          serviceSummary.accountsProjected += accounts.length;
          summary.accountsProjected += accounts.length;
          if (!options.execute) {
            const metaSnapshot = await db.doc(`users/${root.id}/meta/${serviceName}`).get();
            const currentAccounts = (metaSnapshot.data() as { connectionAccounts?: unknown } | undefined)
              ?.connectionAccounts;
            if (projectionsEqual(currentAccounts, accounts)) {
              serviceSummary.unchanged++;
              summary.unchanged++;
            } else {
              serviceSummary.wouldUpdate++;
              summary.wouldUpdate++;
            }
            continue;
          }

          const outcome = await refreshServiceConnectionAccountProjection({
            db,
            userID: root.id,
            serviceName,
            revisionKey,
          });
          if (outcome === 'updated') {
            serviceSummary.updated++;
            summary.updated++;
          } else if (outcome === 'stale') {
            serviceSummary.skippedStale++;
            summary.skippedStale++;
          } else {
            serviceSummary.skippedDeletedUser++;
            summary.skippedDeletedUser++;
          }
        } catch {
          serviceSummary.failed++;
          summary.failed++;
        }
      }

      cursor = page.docs[page.docs.length - 1];
      if (page.size < options.pageSize) break;
    } while (cursor);
  }

  return summary;
}

async function main(): Promise<void> {
  const summary = await runServiceConnectionProjectionBackfill(process.argv.slice(2));
  process.stdout.write(`[service-connection-projection-backfill] ${JSON.stringify(summary)}\n`);
  if (summary.failed > 0) process.exitCode = 1;
}

if (require.main === module) {
  main().catch(error => {
    process.stderr.write(`[service-connection-projection-backfill] ${error instanceof Error ? error.message : 'Failed.'}\n`);
    process.exitCode = 1;
  });
}
