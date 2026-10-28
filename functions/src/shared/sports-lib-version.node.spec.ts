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

    it('locks the browser and Functions to the same published artifact', () => {
        const browserRoot = path.dirname(browserPackageJsonPath);
        const readLock = (directory: string) => JSON.parse(
            readFileSync(path.join(directory, 'package-lock.json'), 'utf8'),
        ) as { packages: Record<string, { version?: string; resolved?: string; integrity?: string }> };
        const browserLock = readLock(browserRoot);
        const functionsLock = readLock(path.join(browserRoot, 'functions'));
        const browserEntry = browserLock.packages['node_modules/@sports-alliance/sports-lib'];
        const functionsEntry = functionsLock.packages['node_modules/@sports-alliance/sports-lib'];

        expect(browserEntry).toMatchObject({ version: SPORTS_LIB_VERSION });
        expect(functionsEntry).toMatchObject({
            version: SPORTS_LIB_VERSION,
            resolved: browserEntry.resolved,
            integrity: browserEntry.integrity,
        });
        expect(browserEntry.resolved).toBe(
            `https://registry.npmjs.org/@sports-alliance/sports-lib/-/sports-lib-${SPORTS_LIB_VERSION}.tgz`,
        );
        expect(browserEntry.integrity).toMatch(/^sha512-/);
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
