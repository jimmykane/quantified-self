import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
    root: resolve(__dirname),
    test: {
        globals: true,
        environment: 'node',
        include: ['src/**/*.spec.ts'],
        alias: {
            '@sports-alliance/sports-lib': resolve(__dirname, 'node_modules/@sports-alliance/sports-lib/lib/esm/index.js'),
        },
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
