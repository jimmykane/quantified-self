import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ALL_SECRET_NAMES } from './secrets';
import {
  findForbiddenFunctionSourceFiles,
  listFunctionSourceFiles,
} from './deployment-file-safety';

const REPOSITORY_ROOT = resolve(__dirname, '../..');
const FUNCTIONS_ROOT = resolve(REPOSITORY_ROOT, 'functions');
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function readRepositoryFile(path: string): string {
  return readFileSync(resolve(REPOSITORY_ROOT, path), 'utf8');
}

describe('Function secret deployment safety', () => {
  it('excludes credential-bearing and local operational files from Function uploads', () => {
    const firebaseConfig = JSON.parse(readRepositoryFile('firebase.json')) as {
      functions?: {
        disallowLegacyRuntimeConfig?: boolean;
        ignore?: string[];
        predeploy?: string[];
      };
    };

    expect(firebaseConfig.functions?.disallowLegacyRuntimeConfig).toBe(true);
    expect(firebaseConfig.functions?.predeploy).toEqual([
      'rm -rf "$RESOURCE_DIR/lib"',
      'node "$RESOURCE_DIR/node_modules/typescript/bin/tsc" --project "$RESOURCE_DIR/tsconfig.json"',
      'node "$RESOURCE_DIR/lib/functions/src/scripts/check-deployment-files.js" "$RESOURCE_DIR"',
      'node "$RESOURCE_DIR/lib/functions/src/scripts/check-secret-bindings.js"',
    ]);
    expect(firebaseConfig.functions?.ignore).toEqual(expect.arrayContaining([
      'node_modules',
      '.git',
      '.env*',
      '.secret*',
      '.runtimeconfig.json',
      '**/*service-account*.json',
      '**/*service_account*.json',
      '**/*serviceAccount*.json',
      '**/*firebase-adminsdk*.json',
      '**/*.log',
      'emulator-export',
      'firestore_export',
    ]));
  });

  it('blocks files that Firebase could convert back into ordinary environment variables', () => {
    expect(findForbiddenFunctionSourceFiles([
      '.env',
      '.env.quantified-self-io',
      '.env.production',
      '.runtimeconfig.json',
      'service-account.json',
      'nested/firebase_service_account.json',
      'nested/serviceAccount-production.json',
      'quantified-self-firebase-adminsdk-key.json',
      '.secret.local',
      '.secret.local.example',
      'package.json',
    ])).toEqual([
      '.env',
      '.env.production',
      '.env.quantified-self-io',
      '.runtimeconfig.json',
      'nested/firebase_service_account.json',
      'nested/serviceAccount-production.json',
      'quantified-self-firebase-adminsdk-key.json',
      'service-account.json',
    ]);
  });

  it('scans nested source files without traversing dependency or build output', () => {
    const directory = mkdtempSync(resolve(tmpdir(), 'qs-function-source-'));
    temporaryDirectories.push(directory);
    mkdirSync(resolve(directory, 'config'), { recursive: true });
    mkdirSync(resolve(directory, 'node_modules', 'fixture'), { recursive: true });
    mkdirSync(resolve(directory, 'lib', 'fixture'), { recursive: true });
    writeFileSync(resolve(directory, 'package.json'), '{}');
    writeFileSync(resolve(directory, 'config', '.env.production'), 'SECRET=value');
    writeFileSync(resolve(directory, 'config', 'firebase_service_account.json'), '{}');
    writeFileSync(resolve(directory, 'node_modules', 'fixture', '.env'), 'IGNORED=value');
    writeFileSync(resolve(directory, 'lib', 'fixture', '.runtimeconfig.json'), '{}');

    const files = listFunctionSourceFiles(directory);

    expect(files).toEqual([
      'config/.env.production',
      'config/firebase_service_account.json',
      'package.json',
    ]);
    expect(findForbiddenFunctionSourceFiles(files)).toEqual([
      'config/.env.production',
      'config/firebase_service_account.json',
    ]);
  });

  it('keeps the emulator secret template exhaustive and value-free', () => {
    const templateLines = readFileSync(resolve(FUNCTIONS_ROOT, '.secret.local.example'), 'utf8')
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('#'));
    const entries = templateLines.map((line) => {
      const separator = line.indexOf('=');
      return {
        name: separator >= 0 ? line.slice(0, separator) : line,
        value: separator >= 0 ? line.slice(separator + 1) : '',
      };
    });

    expect(entries.map(entry => entry.name).sort()).toEqual([...ALL_SECRET_NAMES].sort());
    expect(entries.every(entry => entry.value === '')).toBe(true);
    expect(readFileSync(resolve(FUNCTIONS_ROOT, '.gitignore'), 'utf8')).toMatch(/^\.secret\.local$/m);
  });

  it('does not materialize Function runtime secrets in GitHub workflows', () => {
    const workflowDirectory = resolve(REPOSITORY_ROOT, '.github/workflows');
    const workflowSource = readdirSync(workflowDirectory)
      .filter(name => /\.ya?ml$/i.test(name))
      .map(name => readFileSync(resolve(workflowDirectory, name), 'utf8'))
      .join('\n');

    expect(workflowSource).not.toContain('functions/.env');
    for (const secretName of ALL_SECRET_NAMES) {
      expect(workflowSource).not.toContain(`secrets.${secretName}`);
    }
  });

  it('keeps dotenv loading out of deployed runtime configuration', () => {
    const runtimeConfigSource = readFileSync(resolve(FUNCTIONS_ROOT, 'src/config.ts'), 'utf8');
    const packageJson = JSON.parse(readFileSync(resolve(FUNCTIONS_ROOT, 'package.json'), 'utf8')) as {
      scripts?: Record<string, string>;
    };

    expect(runtimeConfigSource).not.toContain("from 'dotenv'");
    expect(runtimeConfigSource).not.toContain('dotenv.config');
    expect(Object.values(packageJson.scripts || {}).some(script => script.includes('-r dotenv/config'))).toBe(false);
  });
});
