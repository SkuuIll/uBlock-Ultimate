/**
 * platform/chromium/js/url-utils.js
 *
 * Shared URL/domain utilities for all runtime layers and tools.
 * Prevents scattered hostname parsing, subdomain matching, and URL checks.
 *
 * Usage:
 *   import { extractHostname, isHttpWebUrl, isSpecialBrowserUrl,
 *            isSubdomainOrExact, getApproxRegistrableDomain,
 *            normalizeHostname } from "./url-utils.js";
 */

export function extractHostname(url) {
    if (!url) return "";
    try {
        const u = new URL(url);
        return u.hostname;
    } catch (_) {
        // Try to handle partial URLs
        const match = url.match(/^(?:https?:\/\/)?([^\/?#:]+)/);
        return match ? match[1].toLowerCase() : "";
    }
}

export function isHttpWebUrl(url) {
    if (!url) return false;
    return url.startsWith("http://") || url.startsWith("https://");
}

export function isSpecialBrowserUrl(url) {
    if (!url) return false;
    return (
        url.startsWith("chrome://") ||
        url.startsWith("chrome-extension://") ||
        url.startsWith("about:") ||
        url.startsWith("edge://") ||
        url.startsWith("moz-extension://") ||
        url.startsWith("data:") ||
        url.startsWith("blob:") ||
        url.startsWith("file://")
    );
}

export function isSubdomainOrExact(hostname, base) {
    const host = hostname.toLowerCase();
    const b = base.toLowerCase();
    if (host === b) return true;
    if (host.endsWith("." + b)) return true;
    return false;
}

export function getApproxRegistrableDomain(hostname) {
    if (!hostname) return "";
    // Simple heuristic: last two labels. Does not handle co.uk etc.
    const parts = hostname.toLowerCase().split(".");
    if (parts.length <= 2) return hostname.toLowerCase();
    return parts.slice(-2).join(".");
}

export function normalizeHostname(hostname) {
    return hostname.toLowerCase().replace(/^www\./, "");
}
