import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
    root: resolve(__dirname),
    test: {
        server: {
            deps: {
                inline: ['@sports-alliance/sports-lib']
            }
        },
        globals: true,
        environment: 'node',
        include: ['src/**/*.spec.ts'],
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
