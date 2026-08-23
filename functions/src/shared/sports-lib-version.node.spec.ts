import path from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, it, expect } from 'vitest';
import { SPORTS_LIB_VERSION } from './sports-lib-version.node';
import { SPORTS_LIB_REPARSE_TARGET_VERSION } from '../reparse/sports-lib-reparse.config';

const browserPackageJsonPath = resolveBrowserPackageJsonPath(__dirname);

describe('SPORTS_LIB_VERSION (node)', () => {
    it('matches the resolved sports-lib package.json version', () => {
        const nodeRequire = createRequire(__filename);
        const mainPath = nodeRequire.resolve('@sports-alliance/sports-lib');
        const packageJsonPath = path.resolve(path.dirname(mainPath), '..', '..', 'package.json');
        const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as { version: string };
        expect(SPORTS_LIB_VERSION).toBe(pkg.version);
        expect(SPORTS_LIB_VERSION.length).toBeGreaterThan(0);
    });

    it('keeps the sports-lib reparse target aligned with the runtime package version', () => {
        expect(SPORTS_LIB_REPARSE_TARGET_VERSION).toBe(SPORTS_LIB_VERSION);
    });

    it('keeps the browser and Functions manifests pinned to the same version', () => {
        const browserPackageJson = JSON.parse(readFileSync(browserPackageJsonPath, 'utf8')) as {
            dependencies?: Record<string, string>;
        };

        expect(browserPackageJson.dependencies?.['@sports-alliance/sports-lib']).toBe(SPORTS_LIB_VERSION);
    });
});

function resolveBrowserPackageJsonPath(startDirectory: string): string {
    let directory = startDirectory;
    while (true) {
        const packageJsonPath = path.join(directory, 'package.json');
        if (existsSync(packageJsonPath)) {
            const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as { name?: string };
            if (packageJson.name === 'quantified-self-io-functions') {
                return path.resolve(directory, '..', 'package.json');
            }
        }

        const parentDirectory = path.dirname(directory);
        if (parentDirectory === directory) {
            throw new Error('Could not locate the Functions package root.');
        }
        directory = parentDirectory;
    }
}
