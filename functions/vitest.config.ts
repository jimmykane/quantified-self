import { configDefaults, defineConfig } from 'vitest/config';
import { resolve } from 'path';
import { EMULATOR_SUITES } from '../tools/functions-emulator-suites.mjs';

export default defineConfig({
    root: resolve(__dirname),
    test: {
        // Bound import/reporting pressure on shared CI runners. Emulator suites
        // still override this with one worker and serial files via their CLI.
        pool: 'forks',
        maxWorkers: 2,
        minWorkers: 1,
        server: {
            deps: {
                inline: ['@sports-alliance/sports-lib']
            }
        },
        globals: true,
        environment: 'node',
        include: ['src/**/*.spec.ts'],
        // Real emulator suites have a separate mandatory runner. Exclude exact
        // registered paths so their imports are never collected in unit runs.
        exclude: [...configDefaults.exclude, ...Object.values(EMULATOR_SUITES).flat()],
        coverage: {
            provider: 'v8',
            reporter: ['text', 'html'],
            include: ['src/**/*.ts'],
            exclude: ['src/**/*.spec.ts', 'src/index.ts'],
        },
        // Mock firebase-admin and firebase-functions by default
        setupFiles: [resolve(__dirname, 'src/test-setup.ts')],

    },
});
