import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Firebase Admin initialization', () => {
  it('uses one ADC initialization path on the migrated application bucket', () => {
    const indexSource = readFileSync(path.resolve(__dirname, 'index.ts'), 'utf8');
    const runtimeSource = readFileSync(path.resolve(__dirname, 'firebase-admin-runtime.ts'), 'utf8');

    expect(runtimeSource).toContain("const PRIMARY_STORAGE_BUCKET = 'quantified-self-io';");
    expect(indexSource.match(/admin\.initializeApp\(/g)).toHaveLength(1);
    expect(indexSource).toContain('storageBucket: runtime.storageBucket');
    expect(indexSource).toContain('const runtime = resolveFirebaseAdminRuntime();');
    expect(indexSource).not.toContain('credential:');
    expect(indexSource).not.toContain('credential.cert');
    expect(indexSource).not.toContain('resolveServiceAccountPath');
    expect(indexSource).not.toContain('Service account not found');
  });
});
