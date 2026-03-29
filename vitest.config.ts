import { defineConfig } from 'vitest/config';
import angular from '@analogjs/vite-plugin-angular';
import { resolve } from 'path';

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
        server: {
            deps: {
                inline: ['firebase', '@sports-alliance/sports-lib']
            }
        },
        globals: true,
        environment: 'jsdom',
        setupFiles: ['src/test-setup.ts'],
        include: ['**/*.spec.ts'],
        exclude: ['functions/**', 'node_modules/**', 'src/firestore.rules.spec.ts'],
        reporters: ['default'],
    }
});
