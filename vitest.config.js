import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        environment: 'node',
        include: ['tests/**/*.{test,spec}.{js,ts}'],
        exclude: ['tests/e2e/**'],
        coverage: {
            provider: 'v8',
            reporter: ['text', 'json', 'html'],
            include: [
                'src/extension/js/hybrid-filter-updater.ts',
                'src/extension/js/storage-schema-v2.ts',
            ],
        },
    },
});
