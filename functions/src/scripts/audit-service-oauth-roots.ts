import * as admin from 'firebase-admin';
import {
  auditServiceOAuthRoots,
  type ServiceOAuthRootAuditSummary,
} from '../service-oauth-root-reconciliation';

const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGE_SIZE = 500;
const DEFAULT_MAX_ROOTS_PER_SERVICE = 2_000;
const MAX_ROOTS_PER_SERVICE = 20_000;

export interface ServiceOAuthRootAuditOptions {
  projectId: string;
  pageSize: number;
  maxRootsPerService: number;
}

export interface ServiceOAuthRootAuditResult extends ServiceOAuthRootAuditSummary {
  projectId: string;
}

function parseBoundedInteger(
  value: string | undefined,
  optionName: string,
  fallback: number,
  maximum: number,
): number {
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(value)) {
    throw new Error(`${optionName} must be between 1 and ${maximum}.`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw new Error(`${optionName} must be between 1 and ${maximum}.`);
  }
  return parsed;
}

function parseProjectId(value: string | undefined): string {
  const projectId = `${value || ''}`.trim();
  if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(projectId)) {
    throw new Error('A valid --project=<firebase-project-id> argument is required.');
  }
  return projectId;
}

function parseArguments(argv: readonly string[]): ReadonlyMap<string, string> {
  const valueOptions = new Set(['--project', '--page-size', '--max-roots-per-service']);
  const parsed = new Map<string, string>();
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === '--execute' || argument === '--apply') {
      throw new Error('This command is read-only and does not support --execute or --apply.');
    }
    if (valueOptions.has(argument)) {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) {
        throw new Error(`Missing value for ${argument}.`);
      }
      if (parsed.has(argument)) throw new Error(`Duplicate argument: ${argument}`);
      parsed.set(argument, value);
      index += 1;
      continue;
    }
    const equalsOption = [...valueOptions].find(option => argument.startsWith(`${option}=`));
    if (equalsOption) {
      if (parsed.has(equalsOption)) throw new Error(`Duplicate argument: ${equalsOption}`);
      parsed.set(equalsOption, argument.slice(equalsOption.length + 1));
      continue;
    }
    throw new Error(`Unsupported argument: ${argument}`);
  }
  return parsed;
}

export function parseServiceOAuthRootAuditOptions(
  argv: readonly string[],
): ServiceOAuthRootAuditOptions {
  const parsed = parseArguments(argv);
  return {
    projectId: parseProjectId(parsed.get('--project')),
    pageSize: parseBoundedInteger(
      parsed.get('--page-size'),
      '--page-size',
      DEFAULT_PAGE_SIZE,
      MAX_PAGE_SIZE,
    ),
    maxRootsPerService: parseBoundedInteger(
      parsed.get('--max-roots-per-service'),
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
): Promise<ServiceOAuthRootAuditResult> {
  const options = parseServiceOAuthRootAuditOptions(argv);
  if (!admin.apps.length && !dependencies.db) admin.initializeApp({ projectId: options.projectId });
  if (!dependencies.db) {
    const configuredProjectId = admin.app().options.projectId;
    if (configuredProjectId !== options.projectId) {
      throw new Error(
        `Firebase Admin is configured for ${configuredProjectId || 'an unknown project'}, not ${options.projectId}.`,
      );
    }
  }
  const summary = await auditServiceOAuthRoots(
    dependencies.db || admin.firestore(),
    dependencies.nowMs ?? Date.now(),
    options.pageSize,
    options.maxRootsPerService,
  );
  return { projectId: options.projectId, ...summary };
}

async function main(): Promise<void> {
  const summary = await runServiceOAuthRootAudit(process.argv.slice(2));
  process.stdout.write(`[service-oauth-root-audit] ${JSON.stringify(summary)}\n`);
  if (summary.failed > 0 || summary.truncated) process.exitCode = 1;
}

if (require.main === module) {
  main().catch(error => {
    process.stderr.write(
      `[service-oauth-root-audit] ${error instanceof Error ? error.message : 'Audit failed.'}\n`,
    );
    process.exitCode = 1;
  });
}
