/// <reference types="vitest" />

import { defineConfig } from 'vite';
import angular from '@analogjs/vite-plugin-angular';

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
    plugins: [
        angular(),
    ],
    test: {
        globals: true,
        environment: 'jsdom',
        setupFiles: ['src/test-setup.ts'],
        inclue: ['**/*.spec.ts'],
        reporters: ['default'],
    },
    define: {
        'import.meta.vitest': mode !== 'production',
    },
}));
