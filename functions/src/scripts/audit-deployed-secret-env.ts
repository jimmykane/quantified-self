import { execFileSync } from 'node:child_process';
import {
  createDeployedSecretEnvironmentAudit,
  DeployedFunctionConfiguration,
  DeployedSecretAuditError,
  parseDeployedSecretAuditArgs,
} from '../deployed-secret-env-audit';
import { getExportedFirebaseFunctionNames } from '../secret-bindings-check';
import { FUNCTION_SECRET_BINDINGS } from '../secrets';

interface CloudFunctionListEntry {
  name?: unknown;
  state?: unknown;
  serviceConfig?: {
    environmentVariables?: unknown;
    secretEnvironmentVariables?: unknown;
  };
}

interface SecretEnvironmentVariableEntry {
  key?: unknown;
}

const MAX_GCLOUD_OUTPUT_BYTES = 64 * 1024 * 1024;

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

function parseFunctionRegion(resourceName: unknown): string {
  if (typeof resourceName !== 'string') return '';
  const segments = resourceName.split('/');
  const locationsIndex = segments.indexOf('locations');
  return locationsIndex >= 0 ? segments[locationsIndex + 1] || '' : '';
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
  regions: readonly string[],
): DeployedFunctionConfiguration[] {
  const output = runGcloud([
    'functions',
    'list',
    '--v2',
    `--regions=${regions.join(',')}`,
    `--project=${projectId}`,
    '--format=json',
  ]);
  const parsed = JSON.parse(output) as unknown;
  if (!Array.isArray(parsed)) {
    throw new DeployedSecretAuditError(
      'Google Cloud returned an unexpected Function list response.',
    );
  }

  const deployedFunctions = parsed.map((candidate): DeployedFunctionConfiguration => {
    const entry = candidate as CloudFunctionListEntry;
    const name = parseFunctionName(entry.name);
    const region = parseFunctionRegion(entry.name);
    const state = entry.state;
    if (!name || !regions.includes(region) || typeof state !== 'string') {
      throw new DeployedSecretAuditError(
        'Google Cloud returned a Function with invalid identity metadata.',
      );
    }

    return {
      name,
      region,
      state,
      environmentVariableNames: parseStringRecordKeys(
        entry.serviceConfig?.environmentVariables,
      ),
      secretEnvironmentVariableNames: parseSecretEnvironmentVariableNames(
        entry.serviceConfig?.secretEnvironmentVariables,
      ),
    };
  });

  const seenNames = new Set<string>();
  const duplicateNames = new Set<string>();
  for (const deployedFunction of deployedFunctions) {
    if (seenNames.has(deployedFunction.name)) {
      duplicateNames.add(deployedFunction.name);
    }
    seenNames.add(deployedFunction.name);
  }
  if (duplicateNames.size > 0) {
    throw new DeployedSecretAuditError(
      `Function names deployed in multiple selected regions: ${[...duplicateNames].sort().join(', ')}`,
    );
  }
  return deployedFunctions;
}

function loadRepositoryFunctionNames(): string[] {
  process.env.GCLOUD_PROJECT ||= 'deployed-secret-env-audit';
  process.env.FIREBASE_CONFIG ||= JSON.stringify({
    projectId: process.env.GCLOUD_PROJECT,
  });

  // Importing the complete Function graph can initialize SDK components that
  // log routine diagnostics. Silence only that import; audit output never
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

function main(): void {
  const options = parseDeployedSecretAuditArgs(process.argv.slice(2));
  const audit = createDeployedSecretEnvironmentAudit(
    loadDeployedFunctions(options.projectId, options.regions),
    loadRepositoryFunctionNames(),
    FUNCTION_SECRET_BINDINGS,
  );

  console.info(
    `[SecretAudit] ${audit.violations.length} deployed policy violation(s); `
      + `${audit.missingDeployedFunctions.length} repository endpoint(s) not yet deployed; `
      + `${audit.unmanagedDeployedFunctions.length} deployed endpoint(s) absent from this checkout.`,
  );
  for (const violation of audit.violations) {
    console.info(`[SecretAudit] ${violation}.`);
  }
  if (audit.missingDeployedFunctions.length > 0) {
    console.info(
      `[SecretAudit] Not yet deployed: ${audit.missingDeployedFunctions.join(', ')}.`,
    );
  }
  if (audit.unmanagedDeployedFunctions.length > 0) {
    console.info(
      `[SecretAudit] Not managed by this checkout: ${audit.unmanagedDeployedFunctions.join(', ')}.`,
    );
  }
  if (audit.violations.length > 0 || audit.missingDeployedFunctions.length > 0) {
    throw new DeployedSecretAuditError(
      'The deployed Function secret environment is not clean.',
    );
  }
  console.info('[SecretAudit] Deployed Function secret environment is clean.');
}

try {
  main();
} catch (error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[SecretAudit] Failed: ${message}`);
  process.exitCode = 1;
}
