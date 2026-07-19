/**
 * src/core/compiler/filter-classifier.ts
 *
 * Classifies a single filter line into a target lane. This is the
 * first step toward compiling real filters; it deliberately does
 * NOT parse the full uBlock filter syntax.
 *
 * Output lanes:
 *   safe-dnr-block        - ||domain^ or plain urlFilter block
 *   safe-dnr-allow        - @@||domain^ or plain urlFilter allow
 *   limited-supported     - $removeparam with a static key, $redirect to known resource
 *   unsupported-recognized- $replace, $csp, regex $removeparam, etc.
 *   invalid               - empty, comment, or unparseable
 *
 * NOTE: Cosmetic `##` syntax is no longer recognized as a valid
 * user filter lane — the smart-cosmetic system replaced it.
 * `##` lines are classified as `unsupported-recognized`.
 */

export type FilterLane =
  | 'safe-dnr-block'
  | 'safe-dnr-allow'
  | 'limited-supported'
  | 'unsupported-recognized'
  | 'invalid';

export interface ClassifiedFilter {
  raw: string;
  lane: FilterLane;
  reason: string;
  domain?: string;
  options?: string[];
}

const NETWORK_HOST_RE = /^\|\|([a-z0-9._-]+)\^/i;
// Plain network pattern: starts with a host character, a
// wildcard, or a path. Must not be a pure cosmetic operator.
const NETWORK_PLAIN_RE = /^[a-z0-9._*/&][a-z0-9._*/?&=%@-]*/i;

export function classifyFilter(raw: string): ClassifiedFilter {
    if (typeof raw !== 'string') {
        return { raw: String(raw), lane: 'invalid', reason: 'Not a string.' };
    }
    const line = raw.trim();
    if (line.length === 0) {
        return { raw, lane: 'invalid', reason: 'Empty line.' };
    }
    if (line.startsWith('!') || line.startsWith('[')) {
        return { raw, lane: 'invalid', reason: 'Comment or metadata.' };
    }

    // Exception prefix @@
    const isException = line.startsWith('@@');
    const body = isException ? line.slice(2) : line;

    // Cosmetic filter syntax (`##`, `#@#`, `#?#`, `#@?#`, `#$#`) — no longer
    // supported as user-facing filter language. Check before network
    // regex patterns because lines like `example.com#?#.ad` would
    // match the plain network regex.
    if (body.includes('#')) {
        if (
            body.includes('##') ||
            body.includes('#@#') ||
            body.includes('#?#') ||
            body.includes('#@?#') ||
            body.includes('#$#')
        ) {
            return {
        raw,
        lane: 'unsupported-recognized',
        reason: 'Cosmetic syntax is no longer supported as a user filter; use the picker to create smart rules.',
            };
        }
    }

    let m = NETWORK_HOST_RE.exec(body);
    if (m) {
        const options = extractOptions(body);
        if (options) {
            const lane = classifyOptions(options, isException);
            return {
        raw,
        lane,
        reason: `Network rule with options (${options.join(',')}).`,
        domain: m[1],
        options,
            };
        }
        return {
      raw,
      lane: isException ? 'safe-dnr-allow' : 'safe-dnr-block',
      reason: isException ? 'Network allow.' : 'Network block.',
      domain: m[1],
        };
    }

    // Plain network pattern: host, wildcard, or path fragment.
    m = NETWORK_PLAIN_RE.exec(body);
    if (m) {
        const options = extractOptions(body);
        if (options) {
            const lane = classifyOptions(options, isException);
            return {
        raw,
        lane,
        reason: `Plain network rule with options (${options.join(',')}).`,
        options,
            };
        }
        return {
      raw,
      lane: isException ? 'safe-dnr-allow' : 'safe-dnr-block',
      reason: isException ? 'Plain network allow.' : 'Plain network block.',
        };
    }

    // Unrecognizable line — not a valid filter form.
    return {
    raw,
    lane: 'invalid',
    reason: 'Unrecognized filter form.',
    };
}

function extractOptions(s: string): string[] | null {
    const idx = s.lastIndexOf('$');
    if (idx < 0 || idx === s.length - 1) return null;
    const opts = s.slice(idx + 1).split(',').map(o => o.trim()).filter(Boolean);
    return opts.length > 0 ? opts : null;
}

const SUPPORTED_RESOURCE_TYPE_OPTS = new Set([
    'script',
    'image',
    'stylesheet',
    'xhr',
    'xmlhttprequest',
    'document',
    'main_frame',
    'frame',
    'subdocument',
    'sub_frame',
    'font',
    'media',
    'websocket',
    'webtransport',
    'webbundle',
    'ping',
    'csp_report',
    'object',
    'other',
]);

function classifyOptions(options: string[], isException: boolean): FilterLane {
    let hasLimitedSupported = false;
    for (const opt of options) {
        const lower = opt.toLowerCase();
        if (
            lower === 'replace' ||
            lower.startsWith('csp') ||
            lower === 'popup' ||
            lower === 'scriptlet' ||
            lower === 'inline-script' ||
            lower === 'inline-font' ||
            lower === '_____' ||
            lower.startsWith('redirect-rule=')
        ) {
            // Hard-unsupported option: the whole filter cannot be compiled,
            // regardless of any other supported option it carries.
            return 'unsupported-recognized';
        }
        if (lower.startsWith('redirect=')) {
            hasLimitedSupported = true;
            continue;
        }
        if (lower.startsWith('removeparam=')) {
            if (isException) {
                return 'unsupported-recognized';
            }
            const arg = lower.slice('removeparam='.length);
            // static-key form: no regex/value modifiers
            if (/^[\w-]+$/.test(arg)) {
                hasLimitedSupported = true;
            } else {
                return 'unsupported-recognized';
            }
            continue;
        }
        if (
            lower === '3p' ||
            lower === 'third-party' ||
            lower === '~third-party' ||
            lower === '1p' ||
            lower === 'first-party'
        ) {
            continue;
        }
        if (
            lower === 'domain=' ||
            lower.startsWith('domain=') ||
            lower === 'from=' ||
            lower.startsWith('from=') ||
            lower === 'to=' ||
            lower.startsWith('to=')
        ) {
            continue;
        }
        if (lower === 'match-case' || lower === '~match-case') {
            continue;
        }
        if (lower === 'important') {
            continue;
        }
        if (
            SUPPORTED_RESOURCE_TYPE_OPTS.has(lower) ||
            (
                lower.startsWith('~') &&
                SUPPORTED_RESOURCE_TYPE_OPTS.has(lower.slice(1))
            )
        ) {
            continue;
        }
        // Unknown option: be conservative.
        return 'unsupported-recognized';
    }
    if (hasLimitedSupported) return 'limited-supported';
    return isException ? 'safe-dnr-allow' : 'safe-dnr-block';
}
