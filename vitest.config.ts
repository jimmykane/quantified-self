import { defineConfig } from 'vitest/config';
import angular from '@analogjs/vite-plugin-angular';
import { resolve } from 'path';

const isCI = process.env.CI === 'true';

export default defineConfig({
    plugins: [angular({
        tsconfig: './src/tsconfig.spec.json',
    })],
    resolve: {
        alias: {
            '@shared': resolve(__dirname, 'shared'),
            'app': resolve(__dirname, 'src/app'),
        }
    },
    test: {
        ...(isCI ? {
            pool: 'forks' as const,
            maxWorkers: 2,
            minWorkers: 1,
        } : {}),
        server: {
            deps: {
                inline: ['firebase', '@sports-alliance/sports-lib']
            }
        },
        globals: true,
        environment: 'jsdom',
        setupFiles: ['src/test-setup.ts'],
        include: ['**/*.spec.ts'],
        exclude: ['functions/**', 'node_modules/**', 'src/firestore.rules.spec.ts', 'src/storage.rules.spec.ts'],
        reporters: ['default'],
    }
});
