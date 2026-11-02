import { existsSync } from 'node:fs';
import { config as loadDotenv } from 'dotenv';
import { localSecretPaths } from '../../../shared/local-secret-paths';

/**
 * Loads one external profile for an explicitly invoked operational script.
 * Imports, ordinary tests, CI and deployed Functions never load local secrets.
 */
export function loadLocalFunctionEnvironment(
  file: string | undefined = undefined,
  targetEnvironment: NodeJS.ProcessEnv = process.env,
): void {
  if (targetEnvironment.CI === 'true' || targetEnvironment.K_SERVICE
    || targetEnvironment.FUNCTION_NAME
    || targetEnvironment.FUNCTION_TARGET && targetEnvironment.FUNCTIONS_EMULATOR !== 'true') return;
  const configured = file || targetEnvironment.QS_LOCAL_SECRETS_FILE;
  const path = localSecretPaths({ ...targetEnvironment, ...(file ? { QS_LOCAL_SECRETS_FILE: file } : {}) }).functions;
  if (!existsSync(path)) {
    if (configured) throw new Error('The configured external local secrets file is unavailable.');
    return;
  }
  try {
    const result = loadDotenv({
      path,
      override: false,
      processEnv: targetEnvironment as Record<string, string>,
      quiet: true,
    });
    if (result.error) throw result.error;
  } catch {
    throw new Error('Unable to load the external local secrets file.');
  }
}
