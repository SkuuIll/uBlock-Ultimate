/**
 * URL import assistant.
 *
 * Validates a user-supplied URL for importing a custom filter list, and
 * pre-classifies the response body. The actual fetch is performed by the
 * gate script (or a future SW handler) using the UBR_ALLOW_FETCH_NON_RULE_DATA
 * marker. This module is pure: it returns a result object, never touches
 * the network.
 *
 * Safety:
 *   - URL must use an allowed scheme (default: https only).
 *   - URL host must be present in an explicit exact-domain allowlist
 *     (default: empty allowlist).
 *   - URL host must not be a private/loopback address (defense against
 *     SSRF if a future fetch path is ever added inside the extension).
 *   - URL length is bounded (default 2048 chars).
 *   - Filter list size is bounded (default 100k filters / 5MB content).
 *
 * The classifier is intentionally line-based and shallow: it categorizes
 * lines as `cosmetic`, `network`, `comment`, `header`, or `empty` and
 * returns counts. The full AST parser lives in `static-filtering-parser.ts`
 * and is run by the gate/user-rules pipeline; this module just gives
 * the user a preview of what the imported list would look like.
 */

export type ImportStatus =
    | 'valid'
    | 'invalid-url'
    | 'untrusted-host'
    | 'unsupported-scheme'
    | 'url-too-long'
    | 'empty'
    | 'too-large';

export type FilterKind = 'network' | 'exception' | 'comment' | 'header' | 'empty';

export interface ImportAssistantConfig {
    allowedSchemes: string[];        // default ['https:']
    trustedDomains: string[];        // default []; exact domains only
    blockPrivateHosts: boolean;      // default true
    maxUrlLength: number;            // default 2048
    maxFilterCount: number;          // default 100_000
    maxContentBytes: number;         // default 5_242_880 (5MB)
}

export const DEFAULT_IMPORT_CONFIG: Readonly<ImportAssistantConfig> = Object.freeze({
    allowedSchemes: ['https:'],
    trustedDomains: [],
    blockPrivateHosts: true,
    maxUrlLength: 2048,
    maxFilterCount: 100_000,
    maxContentBytes: 5_242_880,
});

export interface ImportRequest {
    url: string;
    userTitle?: string;
}

export interface ImportSummary {
    networkCount: number;
    exceptionCount: number;
    commentCount: number;
    headerCount: number;
    emptyCount: number;
    totalLines: number;
}

export interface ImportResult {
    status: ImportStatus;
    url: string;
    host: string | null;
    title: string;
    trustedHost: boolean;
    summary: ImportSummary;
    reason?: string;
}

export interface ParsedLine {
    line: number;
    kind: FilterKind;
    content: string;
}

export interface ParseFilterListResult {
    lines: ParsedLine[];
    summary: ImportSummary;
    truncated: boolean;
}

const PRIVATE_HOST_PATTERNS: RegExp[] = [
    /^localhost$/i,
    /^127\./,
    /^10\./,
    /^192\.168\./,
    /^172\.(1[6-9]|2[0-9]|3[01])\./,
    /^169\.254\./,
    /^::$/,
    /^::1$/,
    /^fc[0-9a-f][0-9a-f]:/i,
    /^fe80:/i,
    /^0\.0\.0\.0$/,
    /^::ffff:127\./i,
    /^::ffff:10\./i,
    /^::ffff:192\.168\./i,
    /^::ffff:172\.(1[6-9]|2[0-9]|3[01])\./i,
    /^::ffff:169\.254\./i,
    /^::ffff:0\./i,
    /^0:0:0:0:0:ffff:/i,
    /^0000:0000:0000:0000:0000:ffff:/i,
];

function expandIPv6(host: string): string {
    if (!host.includes(':')) return host;
    const parts = host.split(':');
    const doubleColonIdx = parts.indexOf('');
    if (doubleColonIdx !== -1) {
        const before = parts.slice(0, doubleColonIdx);
        const after = parts.slice(doubleColonIdx + 1).filter(p => p !== '' || parts[doubleColonIdx + 1] === '');
        const missing = 8 - before.length - after.length;
        const expanded = [...before, ...Array(missing).fill('0000'), ...after];
        return expanded.map(p => p.padStart(4, '0')).join(':');
    }
    return parts.map(p => p.padStart(4, '0')).join(':');
}

export function isPrivateHost(host: string): boolean {
    if (!host) return true;
    for (const re of PRIVATE_HOST_PATTERNS) {
        if (re.test(host)) return true;
    }
    const normalized = expandIPv6(host.toLowerCase());
    if (normalized.startsWith('00000000000000000000000000000001')) return true;
    if (normalized.startsWith('00000000000000000000ffff0000')) return true;
    if (normalized.startsWith('0000000000000000000000000000')) return true;
    if (normalized.startsWith('fc00') || normalized.startsWith('fd00')) return true;
    if (normalized.startsWith('fe80')) return true;
    return false;
}

export function isAllowedScheme(url: string, allowed: string[]): boolean {
    try {
        const u = new URL(url);
        return allowed.includes(u.protocol);
    } catch (e) {
        console.warn('[uBR] url-import-assistant: URL parse failed in isAllowedScheme', url, e);
        return false;
    }
}

export function isTrustedExactDomain(host: string, trustedDomains: readonly string[]): boolean {
    if (typeof host !== 'string' || host.length === 0) return false;
    const normalizedHost = host.toLowerCase();
    for (const domain of trustedDomains) {
        if (typeof domain !== 'string') continue;
        const normalized = domain.trim().toLowerCase();
        if (normalized.length === 0) continue;
        // Exact hostnames only: no scheme, path, wildcard, or regex-like globs.
        if (normalized.includes('/') || normalized.includes('*') || normalized.includes(':')) continue;
        if (normalizedHost === normalized) return true;
    }
    return false;
}

/**
 * Lightweight line classifier. Categorizes each non-empty line into one
 * of: cosmetic, network, exception, comment, header, empty.
 */
export function classifyLine(line: string): FilterKind {
    const trimmed = line.trim();
    if (trimmed.length === 0) return 'empty';
    if (trimmed.startsWith('!')) return 'comment';
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) return 'header';
    if (trimmed.startsWith('@@')) return 'exception';
    return 'network';
}

export function parseFilterList(
    content: string,
    config: Partial<ImportAssistantConfig> = {},
): ParseFilterListResult {
    const maxFilters = config.maxFilterCount ?? DEFAULT_IMPORT_CONFIG.maxFilterCount;
    const maxBytes = config.maxContentBytes ?? DEFAULT_IMPORT_CONFIG.maxContentBytes;
    const byteLength = new TextEncoder().encode(content).byteLength;
    const truncated = byteLength > maxBytes;
    const usable = truncated
        ? new TextDecoder().decode(new TextEncoder().encode(content).slice(0, maxBytes))
        : content;

    const lines: ParsedLine[] = [];
    const summary: ImportSummary = {
        networkCount: 0,
        exceptionCount: 0,
        commentCount: 0,
        headerCount: 0,
        emptyCount: 0,
        totalLines: 0,
    };

    const rawLines = usable.split(/\r?\n/);
    for (let i = 0; i < rawLines.length; i++) {
        if (lines.length >= maxFilters) {
            return { lines, summary, truncated: true };
        }
        const content = rawLines[i];
        const kind = classifyLine(content);
        lines.push({ line: i + 1, kind, content });
        summary.totalLines++;
        switch (kind) {
        case 'network': summary.networkCount++; break;
        case 'exception': summary.exceptionCount++; break;
        case 'comment': summary.commentCount++; break;
        case 'header': summary.headerCount++; break;
        case 'empty': summary.emptyCount++; break;
        }
    }
    return { lines, summary, truncated };
}

/**
 * Validate a URL for import. Does NOT fetch anything; returns a result
 * describing the URL and (optionally) the parsed body.
 */
export function validateImportUrl(
    request: ImportRequest,
    config: Partial<ImportAssistantConfig> = {},
): ImportResult {
    const cfg = { ...DEFAULT_IMPORT_CONFIG, ...config };
    const empty: ImportSummary = {
        networkCount: 0, exceptionCount: 0,
        commentCount: 0, headerCount: 0, emptyCount: 0, totalLines: 0,
    };

    if (typeof request.url !== 'string' || request.url.length === 0) {
        return {
            status: 'invalid-url',
            url: String(request.url ?? ''),
            host: null,
            title: request.userTitle ?? '',
            trustedHost: false,
            summary: empty,
            reason: 'URL is empty or not a string',
        };
    }

    if (request.url.length > cfg.maxUrlLength) {
        return {
            status: 'url-too-long',
            url: `${request.url.slice(0, cfg.maxUrlLength)  }…`,
            host: null,
            title: request.userTitle ?? '',
            trustedHost: false,
            summary: empty,
            reason: `URL exceeds ${cfg.maxUrlLength} characters`,
        };
    }

    let u: URL;
    try {
        u = new URL(request.url);
    } catch (e) {
        console.warn('[uBR] url-import-assistant: URL parse failed for request', request.url, e);
        return {
            status: 'invalid-url',
            url: request.url,
            host: null,
            title: request.userTitle ?? '',
            trustedHost: false,
            summary: empty,
            reason: 'URL failed to parse',
        };
    }

    if (!cfg.allowedSchemes.includes(u.protocol)) {
        return {
            status: 'unsupported-scheme',
            url: request.url,
            host: u.hostname,
            title: request.userTitle ?? '',
            trustedHost: false,
            summary: empty,
            reason: `scheme ${u.protocol} not in allowed list`,
        };
    }

    if (cfg.blockPrivateHosts && isPrivateHost(u.hostname)) {
        return {
            status: 'untrusted-host',
            url: request.url,
            host: u.hostname,
            title: request.userTitle ?? '',
            trustedHost: false,
            summary: empty,
            reason: 'host is private or loopback',
        };
    }

    if (!isTrustedExactDomain(u.hostname, cfg.trustedDomains)) {
        return {
            status: 'untrusted-host',
            url: request.url,
            host: u.hostname,
            title: request.userTitle ?? '',
            trustedHost: false,
            summary: empty,
            reason: 'host is not in the exact-domain allowlist',
        };
    }

    return {
        status: 'valid',
        url: request.url,
        host: u.hostname,
        title: request.userTitle ?? deriveTitle(u),
        trustedHost: true,
        summary: empty,
    };
}

/**
 * Validate a URL and parse a fetched body. Pure: no I/O.
 */
export function validateAndParse(
    request: ImportRequest,
    body: string,
    config: Partial<ImportAssistantConfig> = {},
): ImportResult {
    const urlResult = validateImportUrl(request, config);
    if (urlResult.status !== 'valid') {
        return urlResult;
    }
    const cfg = { ...DEFAULT_IMPORT_CONFIG, ...config };
    if (body.length === 0) {
        return { ...urlResult, status: 'empty', reason: 'response body is empty' };
    }
    const bodyBytes = new TextEncoder().encode(body).byteLength;
    if (bodyBytes > cfg.maxContentBytes) {
        return { ...urlResult, status: 'too-large', reason: `body exceeds ${cfg.maxContentBytes} bytes` };
    }
    const parsed = parseFilterList(body, cfg);
    return { ...urlResult, summary: parsed.summary };
}

function deriveTitle(u: URL): string {
    return u.hostname.replace(/^www\./, '');
}
