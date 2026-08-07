import { execFileSync, spawn } from 'node:child_process';
import {
  createGcloudFunctionDeployArgs,
  createFunctionSecretMigrationPlan,
  DeployedFunctionConfiguration,
  DeployedSecretMigrationError,
  FunctionSecretMigrationAction,
  parseDeployedSecretMigrationArgs,
} from '../deployed-secret-env-migration';
import { getExportedFirebaseFunctionNames } from '../secret-bindings-check';
import {
  ALL_SECRET_NAMES,
  FUNCTION_SECRET_BINDINGS,
} from '../secrets';

interface CloudFunctionListEntry {
  name?: unknown;
  environment?: unknown;
  buildConfig?: {
    source?: {
      storageSource?: {
        bucket?: unknown;
        object?: unknown;
      };
    };
  };
  serviceConfig?: {
    environmentVariables?: unknown;
    secretEnvironmentVariables?: unknown;
  };
}

interface SecretEnvironmentVariableEntry {
  key?: unknown;
}

const MAX_GCLOUD_OUTPUT_BYTES = 64 * 1024 * 1024;
const APPLY_CONCURRENCY = 5;

function runGcloud(args: readonly string[]): string {
  return execFileSync('gcloud', args, {
    encoding: 'utf8',
    maxBuffer: MAX_GCLOUD_OUTPUT_BYTES,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function parseFunctionName(resourceName: unknown): string {
  if (typeof resourceName !== 'string') return '';
  const segments = resourceName.split('/');
  return segments[segments.length - 1] || '';
}

function parseStringRecordKeys(candidate: unknown): string[] {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    return [];
  }
  return Object.keys(candidate).sort();
}

function parseSecretEnvironmentVariableNames(candidate: unknown): string[] {
  if (!Array.isArray(candidate)) return [];
  return candidate
    .map(entry => (entry as SecretEnvironmentVariableEntry | null)?.key)
    .filter((key): key is string => typeof key === 'string' && key.length > 0)
    .sort();
}

function loadDeployedFunctions(
  projectId: string,
  region: string,
): DeployedFunctionConfiguration[] {
  const output = runGcloud([
    'functions',
    'list',
    '--v2',
    `--regions=${region}`,
    `--project=${projectId}`,
    '--format=json',
  ]);
  const parsed = JSON.parse(output) as unknown;
  if (!Array.isArray(parsed)) {
    throw new DeployedSecretMigrationError(
      'Google Cloud returned an unexpected Function list response.',
    );
  }

  return parsed.map((candidate): DeployedFunctionConfiguration => {
    const entry = candidate as CloudFunctionListEntry;
    const name = parseFunctionName(entry.name);
    const environment = entry.environment;
    if (!name || (environment !== 'GEN_1' && environment !== 'GEN_2')) {
      throw new DeployedSecretMigrationError(
        'Google Cloud returned a Function with invalid identity metadata.',
      );
    }

    const storageSource = entry.buildConfig?.source?.storageSource;
    return {
      name,
      environment,
      sourceBucket: typeof storageSource?.bucket === 'string' ? storageSource.bucket : '',
      sourceObject: typeof storageSource?.object === 'string' ? storageSource.object : '',
      environmentVariableNames: parseStringRecordKeys(
        entry.serviceConfig?.environmentVariables,
      ),
      secretEnvironmentVariableNames: parseSecretEnvironmentVariableNames(
        entry.serviceConfig?.secretEnvironmentVariables,
      ),
    };
  });
}

function loadRepositoryFunctionNames(): string[] {
  process.env.GCLOUD_PROJECT ||= 'deployed-secret-env-migration';
  process.env.FIREBASE_CONFIG ||= JSON.stringify({
    projectId: process.env.GCLOUD_PROJECT,
  });

  // Importing the complete Function graph can initialize SDK components that
  // log routine diagnostics. Silence only that import; migration output never
  // includes runtime configuration or credential values.
  const originalConsole = {
    error: console.error,
    info: console.info,
    log: console.log,
    warn: console.warn,
  };
  try {
    console.error = () => undefined;
    console.info = () => undefined;
    console.log = () => undefined;
    console.warn = () => undefined;
    // Runtime require is intentional: Firebase metadata needs the environment
    // above before the Functions index is initialized.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const functionExports = require('../index') as Record<string, unknown>;
    return getExportedFirebaseFunctionNames(functionExports);
  } finally {
    console.error = originalConsole.error;
    console.info = originalConsole.info;
    console.log = originalConsole.log;
    console.warn = originalConsole.warn;
  }
}

function assertEverySecretHasEnabledVersion(
  projectId: string,
): void {
  const unavailable: string[] = [];
  for (const secretName of ALL_SECRET_NAMES) {
    const enabledVersion = runGcloud([
      'secrets',
      'versions',
      'list',
      secretName,
      `--project=${projectId}`,
      '--filter=state:ENABLED',
      '--limit=1',
      '--format=value(name)',
    ]).trim();
    if (!enabledVersion) unavailable.push(secretName);
  }
  if (unavailable.length > 0) {
    throw new DeployedSecretMigrationError(
      `Secrets without an enabled version: ${unavailable.join(', ')}`,
    );
  }
}

function applyAction(
  action: FunctionSecretMigrationAction,
  projectId: string,
  region: string,
): Promise<void> {
  const args = createGcloudFunctionDeployArgs(action, projectId, region);

  console.info(`[SecretMigration] Updating ${action.name} (${action.environment}).`);
  return new Promise((resolve, reject) => {
    const child = spawn('gcloud', args, {
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      stderr = `${stderr}${chunk}`.slice(-16_384);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        console.info(`[SecretMigration] Updated ${action.name}.`);
        resolve();
        return;
      }
      const finalErrorLine = stderr.trim().split(/\r?\n/).filter(Boolean).pop();
      reject(new DeployedSecretMigrationError(
        `${action.name} failed with exit code ${code ?? 'unknown'}`
          + (finalErrorLine ? `: ${finalErrorLine}` : '.'),
      ));
    });
  });
}

async function applyActions(
  actions: readonly FunctionSecretMigrationAction[],
  projectId: string,
  region: string,
): Promise<void> {
  let nextActionIndex = 0;
  const failures: string[] = [];
  const worker = async (): Promise<void> => {
    while (nextActionIndex < actions.length) {
      const action = actions[nextActionIndex];
      nextActionIndex += 1;
      try {
        await applyAction(action, projectId, region);
      } catch (error) {
        failures.push(error instanceof Error ? error.message : String(error));
      }
    }
  };

  const workers = Array.from(
    { length: Math.min(APPLY_CONCURRENCY, actions.length) },
    () => worker(),
  );
  await Promise.all(workers);
  if (failures.length > 0) {
    throw new DeployedSecretMigrationError(
      `${failures.length} update(s) failed: ${failures.join('; ')}`,
    );
  }
}

function printPlan(
  actions: readonly FunctionSecretMigrationAction[],
  missing: readonly string[],
  unmanaged: readonly string[],
  violations: readonly string[],
): void {
  console.info(
    `[SecretMigration] ${actions.length} preparatory update(s); `
      + `${violations.length} deployed policy violation(s); `
      + `${missing.length} repository endpoint(s) not yet deployed; `
      + `${unmanaged.length} deployed endpoint(s) absent from this checkout.`,
  );
  for (const action of actions) {
    console.info(
      `[SecretMigration] ${action.name}: remove env [${action.removeEnvironmentVariables.join(', ')}]; `
        + `remove secrets [${action.removeSecrets.join(', ')}]; `
        + `bind secrets [${action.updateSecrets.join(', ')}].`,
    );
  }
  if (missing.length > 0) {
    console.info(`[SecretMigration] Not yet deployed: ${missing.join(', ')}.`);
  }
  if (unmanaged.length > 0) {
    console.info(`[SecretMigration] Not managed by this checkout: ${unmanaged.join(', ')}.`);
  }
}

function loadPlan(projectId: string, region: string) {
  return createFunctionSecretMigrationPlan(
    loadDeployedFunctions(projectId, region),
    loadRepositoryFunctionNames(),
    FUNCTION_SECRET_BINDINGS,
  );
}

async function main(): Promise<void> {
  const options = parseDeployedSecretMigrationArgs(process.argv.slice(2));
  const plan = loadPlan(options.projectId, options.region);
  printPlan(
    plan.actions,
    plan.missingDeployedFunctions,
    plan.unmanagedDeployedFunctions,
    plan.violations,
  );

  if (options.requireClean) {
    if (plan.violations.length > 0 || plan.missingDeployedFunctions.length > 0) {
      throw new DeployedSecretMigrationError(
        'The deployed Function secret environment is not clean.',
      );
    }
    console.info('[SecretMigration] Deployed Function secret environment is clean.');
    return;
  }
  if (!options.apply) {
    console.info('[SecretMigration] Dry run only; no cloud configuration was changed.');
    return;
  }

  const unsafeAction = plan.actions.find(action => (
    plan.unusableSourceFunctions.includes(action.name)
  ));
  if (unsafeAction) {
    throw new DeployedSecretMigrationError(
      `${unsafeAction.name} has no reusable deployed source archive; refusing to apply.`,
    );
  }

  assertEverySecretHasEnabledVersion(options.projectId);
  // Refresh immediately before the first write so a concurrent deployment
  // cannot make the dry-run plan stale while secret versions are checked.
  const confirmedPlan = loadPlan(options.projectId, options.region);
  const unsafeConfirmedAction = confirmedPlan.actions.find(action => (
    confirmedPlan.unusableSourceFunctions.includes(action.name)
  ));
  if (unsafeConfirmedAction) {
    throw new DeployedSecretMigrationError(
      `${unsafeConfirmedAction.name} has no reusable deployed source archive; refusing to apply.`,
    );
  }
  await applyActions(
    confirmedPlan.actions,
    options.projectId,
    options.region,
  );

  const remainingPlan = loadPlan(options.projectId, options.region);
  if (remainingPlan.actions.length > 0) {
    throw new DeployedSecretMigrationError(
      `${remainingPlan.actions.length} preparatory update(s) still required; rerun safely.`,
    );
  }
  console.info(
    '[SecretMigration] Preparatory updates completed. Run the complete Firebase Functions deployment next.',
  );
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[SecretMigration] Failed: ${message}`);
  process.exitCode = 1;
});
