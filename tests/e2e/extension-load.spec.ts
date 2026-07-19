import { chromium, expect, test } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

test('loads the MV3 worker, popup and dashboard', async () => {
    const extensionPath = resolve(import.meta.dirname, '../../platform/chromium');
    const profile = await mkdtemp(join(tmpdir(), 'ublock-ultimate-e2e-'));
    const context = await chromium.launchPersistentContext(profile, {
        headless: true,
        args: [
            `--disable-extensions-except=${extensionPath}`,
            `--load-extension=${extensionPath}`,
        ],
    });
    try {
        let workers = context.serviceWorkers();
        if (workers.length === 0) workers = [await context.waitForEvent('serviceworker')];
        const extensionId = new URL(workers[0].url()).host;

        const popup = await context.newPage();
        await popup.goto(`chrome-extension://${extensionId}/popup-fenix.html`);
        await expect(popup.locator('body')).toBeVisible();
        await expect(popup).toHaveTitle(/uBlock/i);

        const dashboard = await context.newPage();
        await dashboard.goto(`chrome-extension://${extensionId}/dashboard.html`);
        await expect(dashboard.locator('body')).toBeVisible();
    } finally {
        await context.close();
        await rm(profile, { recursive: true, force: true });
    }
});
