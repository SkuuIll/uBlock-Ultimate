import { defineConfig } from '@playwright/test';

export default defineConfig({
    testDir: './tests/e2e',
    fullyParallel: false,
    workers: 1,
    retries: 0,
    reporter: 'list',
    timeout: 60_000,
    use: {
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure',
    },
});
