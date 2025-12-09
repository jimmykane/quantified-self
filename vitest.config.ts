import { defineConfig } from 'vitest/config';
import angular from '@analogjs/vite-plugin-angular';

export default defineConfig({
    plugins: [angular({
        tsconfig: './src/tsconfig.spec.json',
    })],
    test: {
        globals: true,
        environment: 'jsdom',
        setupFiles: ['src/test-setup.ts'],
        include: ['**/*.spec.ts'],
        reporters: ['default'],
    },
});
