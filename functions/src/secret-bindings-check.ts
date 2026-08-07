import type { SecretParam } from 'firebase-functions/params';

interface EndpointSecretEnvironmentVariable {
  key?: unknown;
}

interface EndpointMetadata {
  secretEnvironmentVariables?: unknown;
}

export interface ExportedFunctionLike {
  __endpoint?: EndpointMetadata;
}

export type FunctionSecretBindingPolicy = Record<string, readonly SecretParam[]>;

function getEndpointSecretNames(endpoint: EndpointMetadata): string[] {
  const entries = Array.isArray(endpoint.secretEnvironmentVariables)
    ? endpoint.secretEnvironmentVariables
    : [];

  return entries.map((entry) => {
    if (typeof entry === 'string') return entry;
    const key = (entry as EndpointSecretEnvironmentVariable | null)?.key;
    return typeof key === 'string' ? key : '';
  }).filter(Boolean);
}

function sorted(values: readonly string[]): string[] {
  return [...values].sort();
}

/** Returns every policy violation; an empty array means the metadata is exact. */
export function validateFunctionSecretBindings(
  functionExports: Record<string, unknown>,
  policy: FunctionSecretBindingPolicy,
): string[] {
  const violations: string[] = [];
  const discoveredFunctions = new Set<string>();

  for (const [functionName, candidate] of Object.entries(functionExports)) {
    let endpoint: EndpointMetadata | undefined;
    try {
      endpoint = (candidate as ExportedFunctionLike | null)?.__endpoint;
    } catch (error) {
      violations.push(`${functionName}: could not inspect endpoint metadata (${error instanceof Error ? error.message : error})`);
      continue;
    }
    if (!endpoint) continue;

    discoveredFunctions.add(functionName);
    const actual = sorted(getEndpointSecretNames(endpoint));
    const expected = sorted((policy[functionName] || []).map(secret => secret.name));
    if (actual.length !== expected.length || actual.some((name, index) => name !== expected[index])) {
      violations.push(`${functionName}: expected [${expected.join(', ')}], found [${actual.join(', ')}]`);
    }
  }

  for (const functionName of Object.keys(policy)) {
    if (!discoveredFunctions.has(functionName)) {
      violations.push(`${functionName}: policy entry has no exported Firebase Function`);
    }
  }

  return violations;
}
