import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveServiceAccountPath } from './firebase-admin-config';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function createTempProject(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'firebase-admin-config-'));
  tempDirs.push(dir);
  return dir;
}

describe('resolveServiceAccountPath', () => {
  it('resolves the service account path from source runtime output', () => {
    const projectDir = createTempProject();
    const functionsDir = path.join(projectDir, 'functions');
    const runtimeDir = path.join(functionsDir, 'src');
    const serviceAccountPath = path.join(functionsDir, 'service-account.json');

    mkdirSync(runtimeDir, { recursive: true });
    writeFileSync(serviceAccountPath, '{}');

    expect(resolveServiceAccountPath({
      runtimeDirname: runtimeDir,
    })).toBe(serviceAccountPath);
  });

  it('resolves the service account path from compiled runtime output', () => {
    const projectDir = createTempProject();
    const functionsDir = path.join(projectDir, 'functions');
    const runtimeDir = path.join(functionsDir, 'lib', 'functions', 'src');
    const serviceAccountPath = path.join(functionsDir, 'service-account.json');

    mkdirSync(runtimeDir, { recursive: true });
    writeFileSync(serviceAccountPath, '{}');

    expect(resolveServiceAccountPath({
      runtimeDirname: runtimeDir,
    })).toBe(serviceAccountPath);
  });

  it('returns null when the deterministic runtime paths do not contain a service account file', () => {
    const projectDir = createTempProject();
    const functionsDir = path.join(projectDir, 'functions');
    const runtimeDir = path.join(projectDir, 'elsewhere');

    mkdirSync(runtimeDir, { recursive: true });

    expect(resolveServiceAccountPath({
      runtimeDirname: runtimeDir,
    })).toBeNull();
  });
});
