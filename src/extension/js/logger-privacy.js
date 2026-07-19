/**
 * platform/chromium/js/logger-privacy.js
 *
 * URL redaction for logger display.
 *
 * Usage:
 *   import { redactURLForLogger } from "./logger-privacy.js";
 *
 *   redactURLForLogger("https://example.com/page?q=secret#section", "full");
 *   // → "https://example.com/page?q=secret#section"
 *
 *   redactURLForLogger("https://example.com/page?q=secret#section", "stripQuery");
 *   // → "https://example.com/page#section"
 *
 *   redactURLForLogger("https://example.com/page?q=secret#section", "stripQueryAndFragment");
 *   // → "https://example.com/page"
 *
 *   redactURLForLogger("https://example.com/page?q=secret#section", "hostnameOnly");
 *   // → "example.com"
 *
 *   redactURLForLogger("https://example.com/page?q=secret#section", "disabled");
 *   // → "https://example.com/page?q=secret#section"
 */

const VALID_MODES = new Set([
  'full',
  'stripQuery',
  'stripQueryAndFragment',
  'hostnameOnly',
  'disabled',
]);

const DEFAULT_MODE = 'stripQueryAndFragment';

export function redactURLForLogger(url, mode) {
    if (!url) return url;

    const resolvedMode = VALID_MODES.has(mode) ? mode : DEFAULT_MODE;

    if (resolvedMode === 'disabled' || resolvedMode === 'full') {
        return url;
    }

    try {
        const u = new URL(url);

        if (resolvedMode === 'hostnameOnly') {
            return u.hostname;
        }

        // stripQuery: keep scheme + host + path + fragment
        if (resolvedMode === 'stripQuery') {
            let result = `${u.protocol  }//${  u.hostname}`;
            if (u.port) result += `:${  u.port}`;
            result += u.pathname;
            if (u.hash) result += u.hash;
            return result;
        }

        // stripQueryAndFragment: keep scheme + host + path only
        if (resolvedMode === 'stripQueryAndFragment') {
            let result = `${u.protocol  }//${  u.hostname}`;
            if (u.port) result += `:${  u.port}`;
            result += u.pathname;
            return result;
        }

        return url;
    } catch {
        return url;
    }
}
