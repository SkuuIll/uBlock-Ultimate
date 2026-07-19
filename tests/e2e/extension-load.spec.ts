import { chromium, expect, test, type Page } from '@playwright/test';
import { existsSync } from 'node:fs';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const compatibleChromiumPaths = [
    process.env.CHROME_PATH,
    chromium.executablePath(),
    join(process.env.LOCALAPPDATA ?? '', 'CentBrowser\\Application\\chrome.exe'),
].filter((path): path is string => typeof path === 'string' && path !== '');

const chromePath = compatibleChromiumPaths.find(path => existsSync(path));

function collectPageFailures(page: Page, failures: string[]): void {
    page.on('pageerror', error => {
        failures.push(`${page.url()}: ${error.message}`);
    });
    page.on('response', response => {
        if (
            response.url().startsWith('chrome-extension://') &&
            response.status() >= 400
        ) {
            failures.push(`${response.status()} ${response.url()}`);
        }
    });
}

test('loads Chromium MV3 worker, popup and every dashboard tab', async () => {
    test.skip(
        chromePath === undefined,
        'Install Playwright Chromium or set CHROME_PATH to a Chromium build that supports unpacked extensions',
    );

    const extensionSourcePath = resolve(
        import.meta.dirname,
        '../../platform/chromium',
    );
    const profile = await mkdtemp(join(tmpdir(), 'ublock-ultimate-e2e-'));
    const extensionPath = join(profile, 'extension-under-test');
    await cp(extensionSourcePath, extensionPath, { recursive: true });
    const context = await chromium.launchPersistentContext(profile, {
        executablePath: chromePath,
        // Branded Chrome ignores unpacked-extension flags in its headless
        // mode. Use a disposable visible profile for real extension E2E.
        headless: process.env.UBLOCK_E2E_HEADLESS === '1',
        args: [
            `--disable-extensions-except=${extensionPath}`,
            `--load-extension=${extensionPath}`,
        ],
    });
    const failures: string[] = [];
    try {
        context.on('page', page => collectPageFailures(page, failures));

        let workers = context.serviceWorkers();
        if (workers.length === 0) {
            workers = [await context.waitForEvent('serviceworker', { timeout: 30_000 })];
        }
        const worker = workers[0];
        worker.on('console', message => {
            if (message.type() === 'error') {
                failures.push(`service worker: ${message.text()}`);
            }
        });
        const extensionId = new URL(worker.url()).host;

        const popup = await context.newPage();
        await popup.goto(`chrome-extension://${extensionId}/popup-fenix.html`);
        await expect(popup.locator('body')).toBeVisible();
        await expect(popup).toHaveTitle(/uBlock/i);

        const dashboard = await context.newPage();
        await dashboard.goto(`chrome-extension://${extensionId}/dashboard.html`);
        await expect(dashboard.locator('body')).toBeVisible();
        await expect(dashboard.locator('body')).not.toHaveClass(/notReady/, {
            timeout: 30_000,
        });

        const panes = [
            'settings.html',
            '3p-filters.html',
            'protections.html',
            '1p-filters.html',
            'dyna-rules.html',
            'whitelist.html',
            'about.html',
        ];
        for (const pane of panes) {
            await dashboard.locator(`[data-pane="${pane}"]`).click();
            const frame = dashboard.frameLocator('#iframe');
            await expect(frame.locator('body')).toBeVisible();
            await expect(frame.locator('body')).toHaveAttribute(
                'data-ready',
                'true',
                { timeout: 30_000 },
            );
            await expect(dashboard.locator('#iframe')).toHaveAttribute(
                'src',
                pane,
            );
        }

        const protectionFrame = dashboard.frameLocator('#iframe');
        await dashboard.locator('[data-pane="protections.html"]').click();
        await expect(protectionFrame.locator('.ruleset-card')).toHaveCount(7);
        await expect(protectionFrame.locator('#status')).toBeEmpty();
        const socialProtection = protectionFrame.locator(
            '[data-ruleset-id="privacy-social-trackers"]',
        );
        await socialProtection.locator('input').evaluate(
            (input: HTMLInputElement) => input.click(),
        );
        await expect(
            protectionFrame.locator(
                '[data-ruleset-id="privacy-social-trackers"] input',
            ),
        ).toBeChecked();
        const enabledRulesets = await worker.evaluate(async () =>
            chrome.declarativeNetRequest.getEnabledRulesets()
        );
        expect(enabledRulesets).toContain('privacy-social-trackers');
        const urlCleanupMatches = await worker.evaluate(async () =>
            chrome.declarativeNetRequest.testMatchOutcome({
                url: 'https://example.test/article?utm_source=e2e',
                type: 'main_frame',
            })
        );
        expect(urlCleanupMatches.matchedRules).toContainEqual(
            expect.objectContaining({ rulesetId: 'privacy-url-cleanup' }),
        );

        const logger = await context.newPage();
        await logger.goto(`chrome-extension://${extensionId}/logger-ui.html`);
        await expect(logger.locator('body')).toBeVisible();

        expect(failures, failures.join('\n')).toEqual([]);
    } finally {
        await context.close();
        await rm(profile, { recursive: true, force: true });
    }
});
