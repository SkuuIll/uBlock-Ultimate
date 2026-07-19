/**
 * platform/chromium/js/effective-site.js
 *
 * Effective-site and origin-authority resolver (P0.22).
 * Provides a normalized identity object for any URL, replacing ad-hoc
 * hostname slicing (parts.slice(-2)) with structured site identity.
 *
 * All policy caches, compatibility debt matching, DNR attribution, and
 * logger grouping should use this module instead of raw hostname parsing.
 *
 * Usage:
 *   import { resolveEffectiveSite } from "./effective-site.js";
 *
 *   const identity = resolveEffectiveSite(url);
 *   if (identity.effectiveSite) { ... }
 */

// ---------------------------------------------------------------------------
// Public suffix list — built-in common multi-part suffixes
// ---------------------------------------------------------------------------
const PUBLIC_SUFFIXES = new Set([
    "co.uk", "co.jp", "co.kr", "co.nz", "co.za", "co.in",
    "com.au", "com.br", "com.mx", "com.ar", "com.cn",
    "org.uk", "ac.uk", "gov.uk", "net.uk",
    "ne.jp", "or.jp", "ed.jp", "go.jp",
    "ac.kr", "or.kr", "go.kr",
    "com.pl", "org.pl",
    "com.ua", "org.ua",
    "co.il", "org.il",
    "com.hk", "org.hk",
    "com.sg", "edu.sg",
    "co.th", "or.th",
    "co.ve", "com.ve",
    "com.eg", "org.eg",
    "com.pk", "org.pk",
    "com.ng", "org.ng",
    "co.id", "or.id",
    "com.tr", "org.tr",
    "com.vn", "org.vn",
    "co.hu", "info.hu",
    "com.ro", "org.ro",
    "com.gr", "org.gr",
    "com.pt", "org.pt",
    "com.ph", "org.ph",
    "com.pe", "org.pe",
    // Developer / dynamic DNS
    "github.io", "gitlab.io", "pages.dev", "netlify.app",
    "vercel.app", "firebaseapp.com", "web.app",
    "herokuapp.com", "herokudns.com",
    "cloudfront.net", "s3.amazonaws.com",
    "azurewebsites.net", "azureedge.net",
    "blogspot.com", "blogspot.co.uk",
    "webflow.io",
    // Legacy / other
    "nom.co", "name",
]);

function getPublicSuffix(hostname) {
    const parts = hostname.split(".");
    if (parts.length < 3) return null;
    // Check multi-part suffix (last 3 labels)
    const three = parts.slice(-3).join(".");
    if (PUBLIC_SUFFIXES.has(three)) return three;
    const two = parts.slice(-2).join(".");
    if (PUBLIC_SUFFIXES.has(two)) return two;
    return null;
}

function getRegistrableDomain(hostname, publicSuffix) {
    if (!publicSuffix) return hostname;
    const parts = hostname.split(".");
    const suffixParts = publicSuffix.split(".").length;
    const regParts = parts.slice(0, -(suffixParts + 1));
    if (regParts.length === 0) return hostname;
    return regParts.slice(-1)[0] + "." + publicSuffix;
}

// ---------------------------------------------------------------------------
// URL classification helpers
// ---------------------------------------------------------------------------
const LOCAL_HOSTNAMES = new Set([
    "localhost", "127.0.0.1", "::1", "0.0.0.0",
    "255.255.255.255",
]);

const PRIVATE_PREFIXES = [
    "10.", "172.16.", "172.17.", "172.18.", "172.19.",
    "172.20.", "172.21.", "172.22.", "172.23.",
    "172.24.", "172.25.", "172.26.", "172.27.",
    "172.28.", "172.29.", "172.30.", "172.31.",
    "192.168.",
];

function isPrivateNetwork(hostname) {
    if (LOCAL_HOSTNAMES.has(hostname)) return true;
    if (PRIVATE_PREFIXES.some(p => hostname.startsWith(p))) return true;
    return false;
}

// ---------------------------------------------------------------------------
// Canonical identity
// ---------------------------------------------------------------------------

/**
 * @param {string} url
 * @param {object} [options]
 * @param {string} [options.parentUrl] - For about:blank/srcdoc inheritance
 * @returns {EffectiveSiteIdentity}
 */
export function resolveEffectiveSite(url, options = {}) {
    const { parentUrl } = options;

    let rawUrl = url || "";
    let parsed;

    try {
        parsed = new URL(rawUrl);
    } catch {
        // Try inherited parent URL
        if (parentUrl) {
            try {
                parsed = new URL(parentUrl);
                rawUrl = parentUrl;
            } catch {
                return _opaqueIdentity(rawUrl);
            }
        } else {
            return _opaqueIdentity(rawUrl);
        }
    }

    const scheme = parsed.protocol.replace(":", "");
    const hostname = parsed.hostname;
    const origin = parsed.origin;
    const effectiveScheme = _normalizeScheme(scheme);

    if (effectiveScheme === "extension") {
        return {
            rawUrl,
            normalizedUrl: parsed.href,
            scheme: effectiveScheme,
            hostname,
            registrableDomain: hostname,
            effectiveSite: hostname,
            topLevelSite: hostname,
            origin,
            isOpaqueOrigin: false,
            isExtensionPage: true,
            isLocalhost: false,
            isPrivateNetwork: false,
        };
    }

    if (effectiveScheme === "about" || effectiveScheme === "data" || effectiveScheme === "blob") {
        // Inherited or opaque origin
        if (parentUrl) {
            const parentIdentity = resolveEffectiveSite(parentUrl);
            return {
                ...parentIdentity,
                rawUrl,
                isOpaqueOrigin: parsed.origin === "null",
            };
        }
        return _opaqueIdentity(rawUrl);
    }

    if (effectiveScheme === "file") {
        return {
            rawUrl,
            normalizedUrl: parsed.href,
            scheme: effectiveScheme,
            hostname: "",
            registrableDomain: null,
            effectiveSite: null,
            topLevelSite: null,
            origin: null,
            isOpaqueOrigin: false,
            isExtensionPage: false,
            isLocalhost: false,
            isPrivateNetwork: false,
        };
    }

    const normalizedHostname = hostname.toLowerCase();
    const isLocal = LOCAL_HOSTNAMES.has(normalizedHostname);
    const isPrivate = isPrivateNetwork(normalizedHostname);
    const publicSuffix = getPublicSuffix(normalizedHostname);
    const registrableDomain = getRegistrableDomain(normalizedHostname, publicSuffix);
    const effectiveSite = registrableDomain || normalizedHostname;

    return {
        rawUrl,
        normalizedUrl: parsed.href,
        scheme: effectiveScheme,
        hostname: normalizedHostname,
        registrableDomain,
        effectiveSite,
        topLevelSite: effectiveSite,
        origin,
        isOpaqueOrigin: false,
        isExtensionPage: false,
        isLocalhost: isLocal,
        isPrivateNetwork: isPrivate,
    };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------
function _normalizeScheme(scheme) {
    const s = scheme.toLowerCase();
    if (s === "http" || s === "https") return s;
    if (s === "chrome-extension" || s === "moz-extension") return "extension";
    if (s === "about" || s === "data" || s === "blob" || s === "filesystem") return s;
    if (s === "file") return "file";
    return "other";
}

function _opaqueIdentity(rawUrl) {
    return {
        rawUrl,
        normalizedUrl: undefined,
        scheme: "other",
        hostname: "",
        registrableDomain: null,
        effectiveSite: null,
        topLevelSite: null,
        origin: null,
        isOpaqueOrigin: true,
        isExtensionPage: false,
        isLocalhost: false,
        isPrivateNetwork: false,
    };
}
