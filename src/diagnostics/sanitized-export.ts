/**
 * src/diagnostics/sanitized-export.ts
 *
 * §7.4 of the Rev15 plan. Local diagnostics may show full URLs
 * to the user; exported bug reports must redact full URLs by
 * default and require explicit user confirmation to include
 * full URLs.
 *
 * Three sections, in fixed order:
 *   1. Environment (browser, DNR profile, static profile mode,
 *      user-rule counts, build version) — always included.
 *   2. Matched-rule evidence (tab, ruleset, rule, source list,
 *      source line) — always included; no PII.
 *   3. URLs — redacted by default; the `full` mode requires
 *      `userConfirmed === true`; otherwise the function throws
 *      to make accidental leakage impossible.
 *
 * Pure module. No chrome. No I/O.
 */

export type RedactionMode = 'redact-path-and-query' | 'redact-query-only' | 'full';

export interface SanitizedExportEnv {
  browser: string;
  browserVersion: string;
  dnrCapabilityProfile: string;
  staticProfileMode: string;
  userRuleCountsByLane: Record<string, number>;
  buildVersion: string;
}

export interface SanitizedExportMatch {
  tabId: number;
  rulesetId: string;
  ruleId: number;
  sourceList: string;
  sourceLine: number | null;
  sourceTextHash: string;
  originalFilter: string;
  compiledAction: string;
  source: 'static' | 'dynamic' | 'unknown';
}

export interface SanitizedExportOptions {
  env: SanitizedExportEnv;
  matches: SanitizedExportMatch[];
  urls: string[];
  redactionMode?: RedactionMode;
  userConfirmed?: boolean;
  now?: () => Date;
  schemaVersion?: number;
}

export interface SanitizedExport {
  schemaVersion: number;
  generatedAt: string;
  redactionMode: RedactionMode;
  env: SanitizedExportEnv;
  matches: SanitizedExportMatch[];
  urls: string[];
  text: string;
  json: string;
}

const SCHEMA_VERSION = 1;
const REDACTED_PATH = '[REDACTED]';

export class SanitizationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'SanitizationError';
    }
}

export function redactUrl(url: string, mode: RedactionMode): string {
    if (mode === 'full') return url;
    if (typeof url !== 'string' || url.length === 0) return url;
    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch (e) {
    console.warn('[uBR] sanitized-export: URL parse failed in redactUrl', url, e);
    return REDACTED_PATH;
    }
    const scheme = parsed.protocol;
    const host = parsed.host;
    if (mode === 'redact-path-and-query') {
        return `${scheme}//${host}/[REDACTED]`;
    }
    // redact-query-only: keep path, drop query + hash
    const path = parsed.pathname || '/';
    return `${scheme}//${host}${path}`;
}

export function buildSanitizedExport(opts: SanitizedExportOptions): SanitizedExport {
    const mode = opts.redactionMode ?? 'redact-path-and-query';
    const userConfirmed = opts.userConfirmed ?? false;
    if (mode === 'full' && !userConfirmed) {
        throw new SanitizationError(
            'Full URL export requires userConfirmed=true. This is a §7.4 privacy guard.',
        );
    }
    if (mode !== 'redact-path-and-query' && mode !== 'redact-query-only' && mode !== 'full') {
        throw new SanitizationError(`Unknown redaction mode: ${mode as string}`);
    }
    const generatedAt = (opts.now ?? (() => new Date()))().toISOString();
    const urls = opts.urls.map(u => redactUrl(u, mode));
    const env = opts.env;
    const matches = opts.matches.slice();
    const text = renderText(env, matches, urls, mode, generatedAt, opts.schemaVersion ?? SCHEMA_VERSION);
    const json = renderJson(env, matches, urls, mode, generatedAt, opts.schemaVersion ?? SCHEMA_VERSION);
    return {
    schemaVersion: opts.schemaVersion ?? SCHEMA_VERSION,
    generatedAt,
    redactionMode: mode,
    env,
    matches,
    urls,
    text,
    json,
    };
}

function renderJson(
    env: SanitizedExportEnv,
    matches: SanitizedExportMatch[],
    urls: string[],
    mode: RedactionMode,
    generatedAt: string,
    schemaVersion: number = SCHEMA_VERSION,
): string {
    return JSON.stringify(
        {
      schemaVersion,
      generatedAt,
      redactionMode: mode,
      env,
      matches,
      urls,
        },
        null,
        2,
    );
}

function renderText(
    env: SanitizedExportEnv,
    matches: SanitizedExportMatch[],
    urls: string[],
    mode: RedactionMode,
    generatedAt: string,
    schemaVersion: number = SCHEMA_VERSION,
): string {
    const lines: string[] = [];
  lines.push(`# Rev15 Sanitized Diagnostics Export`);
  lines.push(`schemaVersion: ${schemaVersion}`);
  lines.push(`generatedAt: ${generatedAt}`);
  lines.push(`redactionMode: ${mode}`);
  lines.push('');
  lines.push('## Environment');
  lines.push(`browser: ${env.browser} ${env.browserVersion}`);
  lines.push(`dnrCapabilityProfile: ${env.dnrCapabilityProfile}`);
  lines.push(`staticProfileMode: ${env.staticProfileMode}`);
  lines.push(`buildVersion: ${env.buildVersion}`);
  lines.push('userRuleCountsByLane:');
  for (const [lane, count] of Object.entries(env.userRuleCountsByLane)) {
    lines.push(`  ${lane}: ${count}`);
  }
  lines.push('');
  lines.push(`## Matched-rule evidence (${matches.length})`);
  for (const m of matches) {
    lines.push(
        `- tab=${m.tabId} ${m.rulesetId}:${m.ruleId} source=${m.source} list=${m.sourceList} line=${m.sourceLine ?? 'null'} hash=${m.sourceTextHash || 'null'} action=${m.compiledAction}`,
    );
    if (m.originalFilter) {
      lines.push(`    originalFilter: ${m.originalFilter}`);
    }
  }
  lines.push('');
  lines.push(`## URLs (${urls.length}, mode=${mode})`);
  for (const u of urls) {
    lines.push(`- ${u}`);
  }
  return `${lines.join('\n')  }\n`;
}

export const SANITIZATION_LIMITS = Object.freeze({
  SCHEMA_VERSION,
  DEFAULT_REDACTION_MODE: 'redact-path-and-query' as RedactionMode,
});
