/**
 * platform/chromium/js/asset-authority.js
 *
 * Gate remote asset fetching through an authority check.
 * Content scripts cannot request arbitrary remote fetches
 * through the service worker.
 *
 * Usage:
 *   import { mayFetchRemoteAsset } from "./asset-authority.js";
 *
 *   const allowed = mayFetchRemoteAsset({
 *     url: "https://example.com/list.txt",
 *     purpose: "filter-list",
 *     caller: "dashboard",
 *   });
 */

const ALLOWED_FETCH_PURPOSES = new Set([
    "filter-list",
    "asset-catalog",
    "user-imported-list",
    "debug-view",
]);

export function mayFetchRemoteAsset(request) {
    if (!request || !request.url) return false;
    if (!ALLOWED_FETCH_PURPOSES.has(request.purpose)) return false;
    if (request.caller === "content-script") return false;

    // Only allow http/https URLs
    if (!request.url.startsWith("http://") && !request.url.startsWith("https://")) {
        return false;
    }

    return true;
}
