import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';

export const LOCAL_FUNCTION_ENV_FILES = [
  '.secret.local',
  '.env.local',
  '.env',
] as const;

/**
 * Loads local script configuration without overriding a value from a
 * higher-precedence file or the invoking shell. Deployed Functions never use
 * this helper; Secret Manager values are injected by their endpoint bindings.
 */
export function loadLocalFunctionEnvironment(
  baseDirectory = resolve(__dirname, '../..'),
  targetEnvironment: NodeJS.ProcessEnv = process.env,
): void {
  for (const fileName of LOCAL_FUNCTION_ENV_FILES) {
    const path = resolve(baseDirectory, fileName);
    if (!existsSync(path)) continue;
    loadDotenv({
      path,
      override: false,
      processEnv: targetEnvironment as Record<string, string>,
      quiet: true,
    });
  }
}

loadLocalFunctionEnvironment();
