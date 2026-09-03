import * as admin from 'firebase-admin';
import {
  auditServiceOAuthRoots,
  type ServiceOAuthRootReconciliationSummary,
} from '../service-oauth-root-reconciliation';

const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGE_SIZE = 500;
const DEFAULT_MAX_ROOTS_PER_SERVICE = 2_000;
const MAX_ROOTS_PER_SERVICE = 20_000;

export interface ServiceOAuthRootAuditOptions {
  pageSize: number;
  maxRootsPerService: number;
}

function readArgValue(argv: readonly string[], key: string): string | undefined {
  const prefix = `${key}=`;
  for (let index = 0; index < argv.length; index++) {
    if (argv[index] === key) return argv[index + 1];
    if (argv[index].startsWith(prefix)) return argv[index].slice(prefix.length);
  }
  return undefined;
}

function parseBoundedInteger(
  value: string | undefined,
  optionName: string,
  fallback: number,
  maximum: number,
): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw new Error(`${optionName} must be between 1 and ${maximum}.`);
  }
  return parsed;
}

export function parseServiceOAuthRootAuditOptions(
  argv: readonly string[],
): ServiceOAuthRootAuditOptions {
  if (argv.includes('--execute') || argv.includes('--apply')) {
    throw new Error('This command is read-only and does not support --execute or --apply.');
  }
  return {
    pageSize: parseBoundedInteger(
      readArgValue(argv, '--page-size'),
      '--page-size',
      DEFAULT_PAGE_SIZE,
      MAX_PAGE_SIZE,
    ),
    maxRootsPerService: parseBoundedInteger(
      readArgValue(argv, '--max-roots-per-service'),
      '--max-roots-per-service',
      DEFAULT_MAX_ROOTS_PER_SERVICE,
      MAX_ROOTS_PER_SERVICE,
    ),
  };
}

export async function runServiceOAuthRootAudit(
  argv: readonly string[],
  dependencies: {
    db?: admin.firestore.Firestore;
    nowMs?: number;
  } = {},
): Promise<ServiceOAuthRootReconciliationSummary> {
  const options = parseServiceOAuthRootAuditOptions(argv);
  if (!admin.apps.length && !dependencies.db) admin.initializeApp();
  return auditServiceOAuthRoots(
    dependencies.db || admin.firestore(),
    dependencies.nowMs ?? Date.now(),
    options.pageSize,
    options.maxRootsPerService,
  );
}

async function main(): Promise<void> {
  const summary = await runServiceOAuthRootAudit(process.argv.slice(2));
  process.stdout.write(`[service-oauth-root-audit] ${JSON.stringify(summary)}\n`);
  if (summary.failed > 0) process.exitCode = 1;
}

if (require.main === module) {
  main().catch(error => {
    process.stderr.write(
      `[service-oauth-root-audit] ${error instanceof Error ? error.message : 'Audit failed.'}\n`,
    );
    process.exitCode = 1;
  });
}
