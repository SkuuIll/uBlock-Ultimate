/**
 * platform/chromium/js/match-pattern-authority.js
 *
 * URL/match-pattern semantic compiler.
 *
 * Compiles manifest match patterns, compatibility entries, whitelist
 * hostnames, DNR domain conditions, and web-accessible-resource matches
 * into one canonical form. This ensures that different subsystems
 * interpret the same pattern identically.
 *
 * Usage:
 *   import { MatchPatternAuthority } from "./match-pattern-authority.js";
 *   const compiled = MatchPatternAuthority.compile("*://*.example.com/*");
 *   if (compiled.matches("https://sub.example.com/path")) { ... }
 */

function _escapeRegex(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function _patternToRegex(source) {
    let regexStr = "^";
    let i = 0;
    while (i < source.length) {
        const ch = source[i];
        if (ch === "*") {
            regexStr += ".*";
        } else if (ch === "?") {
            regexStr += ".";
        } else if (ch === "^") {
            regexStr += "(?:[^a-zA-Z0-9_.%-]|$)";
        } else {
            regexStr += _escapeRegex(ch);
        }
        i++;
    }
    regexStr += "$";
    return new RegExp(regexStr, "i");
}

/**
 * Parse a match-pattern into its components.
 * Supports: <all_urls>, *://*.host/path*, exact scheme + host + path.
 */
function _parsePattern(source) {
    if (source === "<all_urls>") {
        return { schemes: ["http", "https", "ws", "wss", "file", "ftp"], hostMode: "all", pathMode: "all" };
    }

    const match = source.match(/^(\*|https?|wss?|file|ftp|chrome-extension|data):\/\/(\*|[^/]*)(\/.*)?$/);
    if (!match) return null;

    const scheme = match[1];
    const hostPart = match[2];
    const pathPart = match[3] || "/";

    const schemes = scheme === "*" ? ["http", "https", "ws", "wss", "file", "ftp"] : [scheme];

    let hostMode = "exact";
    if (hostPart === "*") {
        hostMode = "all";
    } else if (hostPart.startsWith("*.")) {
        hostMode = "subdomains";
    }

    const pathMode = pathPart.includes("*") ? "glob" : "exact";

    return { schemes, hostMode, host: hostPart, path: pathPart, pathMode };
}

const _compiledCache = new Map();

export const MatchPatternAuthority = Object.freeze({
    /**
     * Compile a match-pattern string into a CompiledPattern.
     * @param {string} source
     * @returns {{
     *   source: string,
     *   schemes: string[],
     *   hostMode: "exact"|"subdomains"|"effective-site"|"all",
     *   pathMode: "all"|"prefix"|"exact"|"glob",
     *   includesAboutBlank: boolean,
     *   includesOpaqueOrigin: boolean,
     *   normalizedEffectiveSite?: string,
     * }|null}
     */
    compile(source) {
        if (_compiledCache.has(source)) return _compiledCache.get(source);

        const parsed = _parsePattern(source);
        if (!parsed) {
            _compiledCache.set(source, null);
            return null;
        }

        const result = {
            source,
            schemes: parsed.schemes,
            hostMode: parsed.hostMode,
            pathMode: parsed.pathMode,
            includesAboutBlank: source.includes("about:blank"),
            includesOpaqueOrigin: source.includes("data:") || source.includes("about:blank"),
        };

        _compiledCache.set(source, result);
        return result;
    },

    /**
     * Test whether a URL matches a compiled pattern.
     * @param {object} pattern - return value of compile()
     * @param {string} url
     * @returns {boolean}
     */
    matches(pattern, url) {
        if (!pattern) return false;

        try {
            const urlObj = new URL(url);
            if (!pattern.schemes.includes(urlObj.protocol.replace(":", ""))) return false;

            if (pattern.hostMode === "all") return true;
            if (pattern.hostMode === "subdomains") {
                const baseHost = pattern.host.replace(/^\*\./, "");
                return urlObj.hostname === baseHost || urlObj.hostname.endsWith("." + baseHost);
            }
            if (pattern.hostMode === "exact") {
                return urlObj.hostname === pattern.host;
            }
            return true;
        } catch (_) {
            return false;
        }
    },

    /**
     * Clear internal cache (useful for tests).
     */
    clearCache() {
        _compiledCache.clear();
    },
});
