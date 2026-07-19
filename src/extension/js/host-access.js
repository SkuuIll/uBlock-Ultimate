/**
 * platform/chromium/js/host-access.js
 *
 * Site access resolution — determines whether uBO can run on a given tab URL.
 *
 * Usage:
 *   import { resolveHostAccess } from "./host-access.js";
 *
 *   const { active, restricted, cannotRun, specialPage } =
 *     await resolveHostAccess("https://example.com");
 */

export async function resolveHostAccess(tabUrl) {
    const result = {
    active: false,
    restricted: false,
    cannotRun: false,
    specialPage: false,
    };

    if (!tabUrl) {
        result.cannotRun = true;
        return result;
    }

    // Detect special browser pages
    if (
    tabUrl.startsWith('chrome://') ||
    tabUrl.startsWith('chrome-extension://') ||
    tabUrl.startsWith('about:') ||
    tabUrl.startsWith('edge://') ||
    tabUrl.startsWith('brave://') ||
    tabUrl.startsWith('view-source:')
    ) {
        result.specialPage = true;
        result.active = false;
        result.restricted = true;
        return result;
    }

    // Check <all_urls> permission
    try {
        const granted = await chrome.permissions.contains({
      permissions: [],
      origins: ['<all_urls>'],
        });
        if (!granted) {
            result.restricted = true;
            return result;
        }
    } catch {
    // permissions API not available or failed — assume restricted
        result.restricted = true;
        return result;
    }

    result.active = true;
    return result;
}
