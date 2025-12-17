import { defineConfig } from 'vitest/config';
import angular from '@analogjs/vite-plugin-angular';
import { resolve } from 'path';

export default defineConfig({
    plugins: [angular({
        tsconfig: './src/tsconfig.spec.json',
    })],
    test: {
        server: {
            deps: {
                inline: ['rxfire', '@angular/fire', 'firebase']
            }
        },
        globals: true,
        environment: 'jsdom',
        setupFiles: ['src/test-setup.ts'],
        include: ['**/*.spec.ts'],
        exclude: ['functions/**', 'node_modules/**'],
        reporters: ['default'],
    }
});
