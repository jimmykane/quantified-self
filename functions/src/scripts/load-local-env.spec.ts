import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadLocalFunctionEnvironment } from './load-local-env';

const directories: string[] = [];
const directory = () => {
  const value = mkdtempSync(join(tmpdir(), 'qs-external-env-'));
  directories.push(value);
  return value;
};
afterEach(() => directories.splice(0).forEach(value => rmSync(value, { recursive: true, force: true })));

describe('external local Function environment loader', () => {
  it('loads only the external profile and preserves invoking-shell values', () => {
    const base = directory();
    writeFileSync(join(base, 'functions.env'), 'SHARED=file\nLOCAL_ONLY=synthetic\n');
    writeFileSync(join(base, '.secret.local'), 'REPOSITORY_FALLBACK=forbidden\n');
    writeFileSync(join(base, '.env'), 'LEGACY_FALLBACK=forbidden\n');
    const environment = { QS_LOCAL_CONFIG_DIR: base, SHARED: 'shell' };
    loadLocalFunctionEnvironment(undefined, environment);
    expect(environment).toEqual({ QS_LOCAL_CONFIG_DIR: base, SHARED: 'shell', LOCAL_ONLY: 'synthetic' });
  });

  it('supports an explicit profile without loading other files', () => {
    const file = join(directory(), 'selected.env');
    writeFileSync(file, 'SELECTED=synthetic\n');
    const environment = { QS_LOCAL_SECRETS_FILE: file };
    loadLocalFunctionEnvironment(undefined, environment);
    expect(environment).toEqual({ QS_LOCAL_SECRETS_FILE: file, SELECTED: 'synthetic' });
  });

  it('fails closed for missing or unreadable explicit profiles without printing their contents', () => {
    const base = directory();
    expect(() => loadLocalFunctionEnvironment(join(base, 'missing.env'), {}))
      .toThrow('The configured external local secrets file is unavailable.');
    expect(() => loadLocalFunctionEnvironment(base, {}))
      .toThrow('Unable to load the external local secrets file.');
    expect(() => loadLocalFunctionEnvironment('relative.env', {})).toThrow('Local secret paths must be absolute.');
  });

  it.each([{ CI: 'true' }, { K_SERVICE: 'synthetic' }, { FUNCTION_NAME: 'synthetic' }, { FUNCTION_TARGET: 'synthetic' }])(
    'never loads a personal profile in CI or a deployed runtime: %j', flags => {
      const environment = { ...flags, QS_LOCAL_SECRETS_FILE: '/missing/private.env' };
      expect(() => loadLocalFunctionEnvironment(undefined, environment)).not.toThrow();
      expect(environment).not.toHaveProperty('LOCAL_ONLY');
    },
  );
});
