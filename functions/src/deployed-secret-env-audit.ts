import type { SecretParam } from 'firebase-functions/params';
import { ALL_SECRET_NAMES } from './secrets';

/**
 * Retired credential names that were previously injected into every Function
 * from local Firebase configuration. They must never reappear as ordinary
 * environment variables or Secret Manager bindings.
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

export interface DeployedFunctionConfiguration {
  name: string;
  region: string;
  state: string;
  environmentVariableNames: readonly string[];
  secretEnvironmentVariableNames: readonly string[];
}

export interface DeployedSecretEnvironmentAudit {
  missingDeployedFunctions: string[];
  unmanagedDeployedFunctions: string[];
  violations: string[];
}

export interface DeployedSecretAuditCliOptions {
  projectId: string;
  regions: string[];
}

export class DeployedSecretAuditError extends Error {
  override readonly name = 'DeployedSecretAuditError';
}

function sorted(values: readonly string[]): string[] {
  return [...values].sort();
}

function parseSingleValue(
  args: readonly string[],
  name: string,
): string | undefined {
  const prefix = `--${name}=`;
  const matches = args.filter(value => value.startsWith(prefix));
  if (matches.length > 1) {
    throw new DeployedSecretAuditError(`Argument --${name} may be specified only once.`);
  }
  return matches[0]?.slice(prefix.length).trim() || undefined;
}

export function parseDeployedSecretAuditArgs(
  args: readonly string[],
): DeployedSecretAuditCliOptions {
  const allowedPrefixes = ['--project=', '--region=', '--regions='];
  const unexpected = args.find(argument => (
    !allowedPrefixes.some(prefix => argument.startsWith(prefix))
  ));
  if (unexpected) {
    throw new DeployedSecretAuditError(`Unknown argument: ${unexpected}`);
  }

  const projectId = parseSingleValue(args, 'project');
  const region = parseSingleValue(args, 'region');
  const regionsValue = parseSingleValue(args, 'regions');
  if (!projectId || !/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(projectId)) {
    throw new DeployedSecretAuditError(
      'A valid --project=<firebase-project-id> argument is required.',
    );
  }
  if (region && regionsValue) {
    throw new DeployedSecretAuditError(
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
    throw new DeployedSecretAuditError(
      'A valid --region=<region> or comma-separated --regions=<regions> argument is required.',
    );
  }
  return { projectId, regions };
}

export function createDeployedSecretEnvironmentAudit(
  deployedFunctions: readonly DeployedFunctionConfiguration[],
  repositoryFunctionNames: readonly string[],
  policy: Record<string, readonly SecretParam[]>,
): DeployedSecretEnvironmentAudit {
  const repositoryNames = new Set(repositoryFunctionNames);
  const deployedByName = new Map(deployedFunctions.map(entry => [entry.name, entry]));
  const managedPlaintextNames = new Set(MANAGED_PLAINTEXT_CREDENTIAL_NAMES);
  const violations: string[] = [];

  const missingDeployedFunctions = repositoryFunctionNames
    .filter(name => !deployedByName.has(name))
    .sort();
  const unmanagedDeployedFunctions = deployedFunctions
    .filter(entry => !repositoryNames.has(entry.name))
    .map(entry => `${entry.region}/${entry.name}`)
    .sort();

  for (const functionName of repositoryFunctionNames) {
    const deployed = deployedByName.get(functionName);
    if (!deployed) continue;

    const identity = `${deployed.region}/${functionName}`;
    if (deployed.state !== 'ACTIVE') {
      violations.push(`${identity}: deployed state is ${deployed.state || 'unknown'}`);
    }

    const ordinaryNames = sorted(deployed.environmentVariableNames);
    const actualSecrets = sorted(deployed.secretEnvironmentVariableNames);
    const expectedSecrets = sorted(
      (policy[functionName] || []).map(secret => secret.name),
    );
    const legacyPlaintext = ordinaryNames.filter(name => managedPlaintextNames.has(name));
    const exactSecrets = actualSecrets.length === expectedSecrets.length
      && actualSecrets.every((name, index) => name === expectedSecrets[index]);

    if (legacyPlaintext.length > 0) {
      violations.push(
        `${identity}: managed plaintext bindings [${legacyPlaintext.join(', ')}]`,
      );
    }
    if (!exactSecrets) {
      violations.push(
        `${identity}: expected secrets [${expectedSecrets.join(', ')}], found [${actualSecrets.join(', ')}]`,
      );
    }
  }

  return {
    missingDeployedFunctions,
    unmanagedDeployedFunctions,
    violations: violations.sort(),
  };
}
