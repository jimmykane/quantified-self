import type { SecretParam } from 'firebase-functions/params';
import { ALL_SECRET_NAMES } from './secrets';

/**
 * Retired credential names that were previously injected into every Function
 * from local Firebase configuration. They must be removed but must never be
 * recreated as Secret Manager bindings.
 */
export const RETIRED_PLAINTEXT_CREDENTIAL_NAMES = Object.freeze([
  'GARMINHEALTHAPI_CONSUMER_KEY',
  'GARMINHEALTHAPI_CONSUMER_SECRET',
  'SENTRY_AUTH_TOKEN',
  'SUUNTOAPP_NOTIFICATION_ACCESS_TOKEN',
]);

export const MANAGED_PLAINTEXT_CREDENTIAL_NAMES = Object.freeze([
  ...ALL_SECRET_NAMES,
  ...RETIRED_PLAINTEXT_CREDENTIAL_NAMES,
]);

export type DeployedFunctionEnvironment = 'GEN_1' | 'GEN_2';

export interface DeployedFunctionConfiguration {
  name: string;
  region: string;
  environment: DeployedFunctionEnvironment;
  sourceBucket: string;
  sourceObject: string;
  environmentVariableNames: readonly string[];
  secretEnvironmentVariableNames: readonly string[];
}

export interface FunctionSecretMigrationAction {
  name: string;
  region: string;
  environment: DeployedFunctionEnvironment;
  sourceBucket: string;
  sourceObject: string;
  removeEnvironmentVariables: string[];
  removeSecrets: string[];
  updateSecrets: string[];
}

export interface FunctionSecretMigrationPlan {
  actions: FunctionSecretMigrationAction[];
  missingDeployedFunctions: string[];
  unmanagedDeployedFunctions: string[];
  unusableSourceFunctions: string[];
  violations: string[];
}

export interface DeployedSecretMigrationCliOptions {
  projectId: string;
  regions: string[];
  apply: boolean;
  confirmProject?: string;
  requireClean: boolean;
}

export class DeployedSecretMigrationError extends Error {
  override readonly name = 'DeployedSecretMigrationError';
}

export function createGcloudFunctionDeployArgs(
  action: FunctionSecretMigrationAction,
  projectId: string,
): string[] {
  if (!action.sourceBucket || !action.sourceObject) {
    throw new DeployedSecretMigrationError(
      `${action.name} has no reusable deployed source archive.`,
    );
  }

  const args = [
    'functions',
    'deploy',
    action.name,
    `--project=${projectId}`,
    `--region=${action.region}`,
    `--source=gs://${action.sourceBucket}/${action.sourceObject}`,
    '--quiet',
  ];
  if (action.environment === 'GEN_2') args.push('--gen2');
  if (action.removeEnvironmentVariables.length > 0) {
    args.push(`--remove-env-vars=${action.removeEnvironmentVariables.join(',')}`);
  }
  if (action.removeSecrets.length > 0) {
    args.push(`--remove-secrets=${action.removeSecrets.join(',')}`);
  }
  if (action.updateSecrets.length > 0) {
    args.push(`--update-secrets=${action.updateSecrets
      .map(name => `${name}=${name}:latest`)
      .join(',')}`);
  }
  return args;
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function difference(left: readonly string[], right: readonly string[]): string[] {
  const rightSet = new Set(right);
  return left.filter(value => !rightSet.has(value));
}

function parseRequiredValue(
  args: readonly string[],
  name: string,
): string | undefined {
  const prefix = `--${name}=`;
  const argument = args.find(value => value.startsWith(prefix));
  return argument?.slice(prefix.length).trim() || undefined;
}

export function parseDeployedSecretMigrationArgs(
  args: readonly string[],
): DeployedSecretMigrationCliOptions {
  const allowedFlags = new Set(['--apply', '--require-clean']);
  const allowedPrefixes = [
    '--project=',
    '--region=',
    '--regions=',
    '--confirm-project=',
  ];
  const unexpected = args.find(argument => !allowedFlags.has(argument)
    && !allowedPrefixes.some(prefix => argument.startsWith(prefix)));
  if (unexpected) {
    throw new DeployedSecretMigrationError(`Unknown argument: ${unexpected}`);
  }

  const projectId = parseRequiredValue(args, 'project');
  const region = parseRequiredValue(args, 'region');
  const regionsValue = parseRequiredValue(args, 'regions');
  const apply = args.includes('--apply');
  const confirmProject = parseRequiredValue(args, 'confirm-project');
  const requireClean = args.includes('--require-clean');

  if (!projectId || !/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(projectId)) {
    throw new DeployedSecretMigrationError(
      'A valid --project=<firebase-project-id> argument is required.',
    );
  }
  if (region && regionsValue) {
    throw new DeployedSecretMigrationError(
      'Specify either --region or --regions, not both.',
    );
  }
  const regions = regionsValue
    ? regionsValue.split(',').map(value => value.trim())
    : region
      ? [region]
      : [];
  if (
    regions.length === 0
    || regions.length > 10
    || new Set(regions).size !== regions.length
    || regions.some(value => !/^[a-z]+-[a-z]+\d+$/.test(value))
  ) {
    throw new DeployedSecretMigrationError(
      'A valid --region=<region> or comma-separated --regions=<regions> argument is required.',
    );
  }
  if (apply && confirmProject !== projectId) {
    throw new DeployedSecretMigrationError(
      'Applying changes requires --confirm-project to exactly match --project.',
    );
  }
  if (!apply && confirmProject) {
    throw new DeployedSecretMigrationError(
      '--confirm-project is only valid together with --apply.',
    );
  }
  if (apply && requireClean) {
    throw new DeployedSecretMigrationError(
      '--apply and --require-clean are separate operations and cannot be combined.',
    );
  }

  return { projectId, regions, apply, confirmProject, requireClean };
}

export function createFunctionSecretMigrationPlan(
  deployedFunctions: readonly DeployedFunctionConfiguration[],
  repositoryFunctionNames: readonly string[],
  policy: Record<string, readonly SecretParam[]>,
): FunctionSecretMigrationPlan {
  const repositoryNames = new Set(repositoryFunctionNames);
  const deployedByName = new Map(deployedFunctions.map(entry => [entry.name, entry]));
  const managedPlaintextNames = new Set(MANAGED_PLAINTEXT_CREDENTIAL_NAMES);
  const actions: FunctionSecretMigrationAction[] = [];
  const violations: string[] = [];
  const unusableSourceFunctions: string[] = [];

  const missingDeployedFunctions = repositoryFunctionNames
    .filter(name => !deployedByName.has(name))
    .sort();
  const unmanagedDeployedFunctions = deployedFunctions
    .map(entry => entry.name)
    .filter(name => !repositoryNames.has(name))
    .sort();

  for (const functionName of repositoryFunctionNames) {
    const deployed = deployedByName.get(functionName);
    if (!deployed) continue;

    if (!deployed.sourceBucket || !deployed.sourceObject) {
      violations.push(`${functionName}: deployed source is not a reusable Cloud Storage archive`);
      unusableSourceFunctions.push(functionName);
    }

    const ordinaryNames = sortedUnique(deployed.environmentVariableNames);
    const actualSecrets = sortedUnique(deployed.secretEnvironmentVariableNames);
    const expectedSecrets = sortedUnique(
      (policy[functionName] || []).map(secret => secret.name),
    );
    const legacyPlaintext = ordinaryNames.filter(name => managedPlaintextNames.has(name));
    const missingSecrets = difference(expectedSecrets, actualSecrets);
    const extraSecrets = difference(actualSecrets, expectedSecrets);

    if (legacyPlaintext.length > 0) {
      violations.push(
        `${functionName}: legacy plaintext bindings [${legacyPlaintext.join(', ')}]`,
      );
    }
    if (missingSecrets.length > 0 || extraSecrets.length > 0) {
      violations.push(
        `${functionName}: expected secrets [${expectedSecrets.join(', ')}], found [${actualSecrets.join(', ')}]`,
      );
    }

    // Firebase redeployments can preserve environment variables configured on
    // an existing Function outside the current source. Plan cleanup-only
    // revisions for zero-secret endpoints instead of assuming a later deploy
    // will remove their inherited plaintext credentials.
    if (legacyPlaintext.length > 0
      || missingSecrets.length > 0
      || extraSecrets.length > 0) {
      actions.push({
        name: functionName,
        region: deployed.region,
        environment: deployed.environment,
        sourceBucket: deployed.sourceBucket,
        sourceObject: deployed.sourceObject,
        removeEnvironmentVariables: legacyPlaintext,
        removeSecrets: extraSecrets,
        updateSecrets: expectedSecrets,
      });
    }
  }

  return {
    actions: actions.sort((left, right) => left.name.localeCompare(right.name)),
    missingDeployedFunctions,
    unmanagedDeployedFunctions,
    unusableSourceFunctions: unusableSourceFunctions.sort(),
    violations: violations.sort(),
  };
}
