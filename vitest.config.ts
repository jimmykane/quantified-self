import { defineConfig, defineProject } from 'vitest/config';
import angular from '@analogjs/vite-plugin-angular';
import { resolve } from 'path';
import environments from './tools/frontend-test-environments.json';

const ordinaryExcludes = ['functions/**', 'node_modules/**', 'src/firestore.rules.spec.ts', 'src/storage.rules.spec.ts'];
const projectDefaults = {
    resolve: {
        alias: {
            '@shared': resolve(__dirname, 'shared'),
            'app': resolve(__dirname, 'src/app'),
        }
    },
    test: {
        pool: 'forks' as const,
        isolate: true,
        server: {
            deps: {
                inline: ['firebase', '@sports-alliance/sports-lib']
            }
        },
        globals: true,
        exclude: ordinaryExcludes,
    }
};

export default defineConfig({
    test: {
        pool: 'forks',
        maxWorkers: 2,
        minWorkers: 1,
        // Keep the original discovery/coverage boundary at the root too.
        include: ['**/*.spec.ts'],
        exclude: ordinaryExcludes,
        reporters: ['default'],
        projects: [
            defineProject({
                ...projectDefaults,
                test: {
                    ...projectDefaults.test,
                    name: 'helpers-node',
                    environment: 'node',
                    setupFiles: [],
                    include: environments.node,
                }
            }),
            defineProject({
                ...projectDefaults,
                test: {
                    ...projectDefaults.test,
                    name: 'helpers-dom',
                    environment: 'jsdom',
                    setupFiles: [],
                    include: environments.dom,
                }
            }),
            defineProject({
                ...projectDefaults,
                plugins: [angular({ tsconfig: './src/tsconfig.spec.json' })],
                test: {
                    ...projectDefaults.test,
                    name: 'angular',
                    environment: 'jsdom',
                    setupFiles: ['src/test-setup.ts'],
                    include: ['**/*.spec.ts'],
                    // New and unclassified specs retain the complete Angular setup.
                    exclude: [...ordinaryExcludes, ...environments.node, ...environments.dom],
                }
            }),
        ],
    }
});
