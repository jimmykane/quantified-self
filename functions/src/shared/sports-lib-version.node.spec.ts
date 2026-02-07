import path from 'node:path';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, it, expect } from 'vitest';
import { SPORTS_LIB_VERSION } from './sports-lib-version.node';

describe('SPORTS_LIB_VERSION (node)', () => {
    it('matches the resolved sports-lib package.json version', () => {
        const nodeRequire = createRequire(__filename);
        const mainPath = nodeRequire.resolve('@sports-alliance/sports-lib');
        const packageJsonPath = path.resolve(path.dirname(mainPath), '..', '..', 'package.json');
        const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as { version: string };
        expect(SPORTS_LIB_VERSION).toBe(pkg.version);
        expect(SPORTS_LIB_VERSION.length).toBeGreaterThan(0);
    });
});
