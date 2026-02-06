import { defineConfig } from 'vitest/config';
import angular from '@analogjs/vite-plugin-angular';

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
        environment: 'node',
        // setupFiles: ['src/test-setup.ts'],
        include: ['src/**/*.rules.spec.ts'],
        exclude: ['functions/**', 'node_modules/**'],
        reporters: ['default'],
    }
});
