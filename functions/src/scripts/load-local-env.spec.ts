import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  loadLocalFunctionEnvironment,
  LOCAL_FUNCTION_ENV_FILES,
} from './load-local-env';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('local Function environment loader', () => {
  it('loads secret-local, env-local, then legacy env without overriding earlier values', () => {
    const directory = mkdtempSync(join(tmpdir(), 'qs-function-env-'));
    temporaryDirectories.push(directory);
    writeFileSync(join(directory, '.secret.local'), 'SHARED=secret-local\nSECRET_ONLY=secret\n');
    writeFileSync(join(directory, '.env.local'), 'SHARED=env-local\nLOCAL_ONLY=local\n');
    writeFileSync(join(directory, '.env'), 'SHARED=legacy\nLEGACY_ONLY=legacy\n');
    const targetEnvironment: NodeJS.ProcessEnv = { SHELL_VALUE: 'shell' };

    loadLocalFunctionEnvironment(directory, targetEnvironment);

    expect(LOCAL_FUNCTION_ENV_FILES).toEqual(['.secret.local', '.env.local', '.env']);
    expect(targetEnvironment).toEqual({
      SHELL_VALUE: 'shell',
      SHARED: 'secret-local',
      SECRET_ONLY: 'secret',
      LOCAL_ONLY: 'local',
      LEGACY_ONLY: 'legacy',
    });
  });

  it('preserves values already supplied by the invoking shell', () => {
    const directory = mkdtempSync(join(tmpdir(), 'qs-function-env-'));
    temporaryDirectories.push(directory);
    writeFileSync(join(directory, '.secret.local'), 'SHARED=secret-local\n');
    const targetEnvironment: NodeJS.ProcessEnv = { SHARED: 'shell' };

    loadLocalFunctionEnvironment(directory, targetEnvironment);

    expect(targetEnvironment.SHARED).toBe('shell');
  });
});
