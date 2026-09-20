import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Firebase Admin initialization', () => {
  it('uses one ADC initialization path on the migrated application bucket', () => {
    const bootstrapSource = readFileSync(path.resolve(__dirname, 'bootstrap.ts'), 'utf8');
    const indexSource = readFileSync(path.resolve(__dirname, 'index.ts'), 'utf8');

    expect(indexSource).toContain("import { initializeFirebase } from './bootstrap';");
    expect(indexSource).toContain('initializeFirebase();');
    expect(bootstrapSource).toContain("const PRIMARY_STORAGE_BUCKET = 'quantified-self-io';");
    expect(bootstrapSource.match(/admin\.initializeApp\(/g)).toHaveLength(1);
    expect(bootstrapSource).toContain('storageBucket: PRIMARY_STORAGE_BUCKET');
    expect(bootstrapSource).not.toContain('credential:');
    expect(bootstrapSource).not.toContain('credential.cert');
    expect(bootstrapSource).not.toContain('resolveServiceAccountPath');
    expect(bootstrapSource).not.toContain('Service account not found');
  });
});
