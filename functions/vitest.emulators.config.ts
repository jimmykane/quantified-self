import { configDefaults, defineConfig } from 'vitest/config';
import config from './vitest.config';
import { EMULATOR_SUITES } from '../tools/functions-emulator-suites.mjs';

export default defineConfig({
    ...config,
    test: {
        ...config.test,
        include: Object.values(EMULATOR_SUITES).flat(),
        // Replace the unit exclusions rather than merging/appending arrays.
        exclude: [...configDefaults.exclude],
        maxWorkers: 1,
        minWorkers: 1,
        fileParallelism: false,
    },
});
