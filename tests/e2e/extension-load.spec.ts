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

async function expectMobileViewportToFit(page: Page): Promise<void> {
    await page.setViewportSize({ width: 360, height: 800 });
    const dimensions = await page.evaluate(() => ({
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
    }));
    expect(dimensions.scrollWidth).toBeLessThanOrEqual(
        dimensions.clientWidth + 1,
    );
}

async function expectLightTheme(page: Page): Promise<void> {
    await expect(page.locator('html')).toHaveClass(/light/);
    await expect(page.locator('html')).not.toHaveClass(/dark/);
    const background = await page.evaluate(() =>
        getComputedStyle(document.body).backgroundColor
    );
    const channels = background.match(/\d+(?:\.\d+)?/g)?.slice(0, 3)
        .map(Number) ?? [];
    expect(channels).toHaveLength(3);
    expect(channels.reduce((sum, value) => sum + value, 0))
        .toBeGreaterThan(500);
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
        const desktopPopupWidth = await popup.locator('body').evaluate(
            body => body.getBoundingClientRect().width,
        );
        expect(desktopPopupWidth).toBeGreaterThanOrEqual(252);
        await expectMobileViewportToFit(popup);

        const dashboard = await context.newPage();
        await dashboard.goto(`chrome-extension://${extensionId}/dashboard.html`);
        await dashboard.setViewportSize({ width: 1280, height: 900 });
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
        const visitPanes = async (
            theme: 'dark' | 'light',
        ): Promise<void> => {
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
                await expect(frame.locator('html')).toHaveClass(
                    new RegExp(theme),
                );
                const paneFrame = dashboard.frames().find(candidate =>
                    candidate.url().endsWith(`/${pane}`),
                );
                expect(paneFrame, `Frame not found for ${pane}`).toBeDefined();
                await dashboard.setViewportSize({ width: 360, height: 800 });
                const dimensions = await paneFrame!.evaluate(() => ({
                    clientWidth: document.documentElement.clientWidth,
                    scrollWidth: document.documentElement.scrollWidth,
                    offenders: Array.from(document.querySelectorAll('*'))
                        .map(element => {
                            const rect = element.getBoundingClientRect();
                            return {
                                element: [
                                    element.localName,
                                    element.id ? `#${element.id}` : '',
                                    element.classList.length
                                        ? `.${Array.from(element.classList).join('.')}`
                                        : '',
                                ].join(''),
                                left: Math.round(rect.left),
                                right: Math.round(rect.right),
                                width: Math.round(rect.width),
                            };
                        })
                        .filter(item =>
                            item.left < -1 ||
                            item.right >
                                document.documentElement.clientWidth + 1
                        )
                        .slice(0, 8),
                }));
                expect(
                    dimensions.scrollWidth,
                    `${pane} overflows at 360 px: ${JSON.stringify(dimensions.offenders)}`,
                ).toBeLessThanOrEqual(dimensions.clientWidth + 1);
                await dashboard.setViewportSize({ width: 1280, height: 900 });
            }
        };

        const settingsFrame = dashboard.frameLocator('#iframe');
        await dashboard.locator('[data-pane="settings.html"]').click();
        await expect(settingsFrame.locator('body')).toHaveAttribute(
            'data-ready',
            'true',
        );
        await settingsFrame.locator(
            '[data-setting-name="uiTheme"]',
        ).selectOption('dark');
        await expect.poll(() => dashboard.evaluate(async () => {
            const { userSettings } =
                await chrome.storage.local.get('userSettings');
            return userSettings?.uiTheme;
        })).toBe('dark');
        await visitPanes('dark');
        await dashboard.locator('[data-pane="1p-filters.html"]').click();
        await expect(
            dashboard.frameLocator('#iframe').locator('.CodeMirror'),
        ).toHaveCSS('background-color', 'rgb(13, 18, 32)');

        await dashboard.locator('[data-pane="settings.html"]').click();
        await settingsFrame.locator(
            '[data-setting-name="uiTheme"]',
        ).selectOption('light');
        await expect.poll(() => dashboard.evaluate(async () => {
            const { userSettings } =
                await chrome.storage.local.get('userSettings');
            return userSettings?.uiTheme;
        })).toBe('light');
        await expectLightTheme(dashboard);
        await popup.reload();
        await expectLightTheme(popup);
        await visitPanes('light');
        await dashboard.locator('[data-pane="1p-filters.html"]').click();
        await expect(
            dashboard.frameLocator('#iframe').locator('.CodeMirror'),
        ).toHaveCSS('background-color', 'rgb(255, 255, 255)');

        await dashboard.evaluate(async () => {
            await chrome.storage.local.set({ showCustomNewTab: true });
        });
        const newTab = await context.newPage();
        await newTab.goto(
            `chrome-extension://${extensionId}/pages/newtab.html`,
        );
        await expect(newTab.locator('.topbar')).toBeVisible();
        await expect(newTab.locator('.searchbar')).toBeVisible();
        await expect(newTab.locator('#tool-grid > section')).toHaveCount(15);
        await expect(newTab.locator('#category-links > a')).toHaveCount(15);
        await expect(newTab.locator('.tool.active')).toHaveText('Google');
        await expectLightTheme(newTab);
        await expectMobileViewportToFit(newTab);

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
        await expectLightTheme(logger);
        await expectMobileViewportToFit(logger);

        expect(failures, failures.join('\n')).toEqual([]);
    } finally {
        await context.close();
        await rm(profile, { recursive: true, force: true });
    }
});
