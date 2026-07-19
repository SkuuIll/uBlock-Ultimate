/**
 * src/core/compiler/badfilter-resolver.ts
 *
 * Resolves `$badfilter` lines against the rest of the filter list
 * before lowering. Only the v0 supported subset is recognized:
 *
 *   ||host^$badfilter
 *   host$badfilter
 *   @@||host^$badfilter  (matches an @@||host^ base)
 *
 * Anything more exotic (regex body, non-host form, etc.) is
 * reported as `unsupported-badfilter` so the build can be
 * inspected, but it does not silently drop rules.
 *
 * Pure module, no Chrome API calls, no I/O.
 */

export interface RawFilterEntry {
  raw: string;
  line: number;
}

export interface ResolvedBadfilters {
  /** Filters that survived the resolver. */
  kept: RawFilterEntry[];
  /** Filters that were dropped because a `$badfilter` matched them. */
  dropped: Array<{ line: number; raw: string; matchedBy: string }>;
  /** `$badfilter` lines that targeted a base filter, applied at least once. */
  appliedBadfilterCount: number;
  /** `$badfilter` lines that did not match any surviving base filter. */
  orphanBadfilterCount: number;
  /** `$badfilter` lines that were not in a recognized form. */
  unsupportedBadfilterCount: number;
}

const NETWORK_HOST_RE = /^\|\|([a-z0-9._-]+)\^?/i;
const PLAIN_HOST_RE = /^([a-z0-9._-]+)$/i;

interface RecognizedForm {
  isException: boolean;
  host: string;
}

function recognizeForm(line: string): RecognizedForm | null {
    if (typeof line !== 'string') return null;
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith('!')) return null;

    const isException = trimmed.startsWith('@@');
    const body = isException ? trimmed.slice(2) : trimmed;

    // Strip a $badfilter suffix if present.
    let stem = body;
    const badIdx = body.indexOf('$');
    if (badIdx >= 0) {
        const optsPart = body.slice(badIdx + 1).split(',').map(o => o.trim());
        const hasBadfilter = optsPart.indexOf('badfilter') !== -1;
        if (!hasBadfilter) return null;
        if (optsPart.length !== 1) return null;
        stem = body.slice(0, badIdx);
    }

    let m = NETWORK_HOST_RE.exec(stem);
    if (m) {
        return { isException, host: m[1].toLowerCase() };
    }
    m = PLAIN_HOST_RE.exec(stem);
    if (m) {
        return { isException, host: m[1].toLowerCase() };
    }
    return null;
}

function isBadfilterLine(line: string): boolean {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith('!')) return false;
    const dollarIdx = trimmed.indexOf('$');
    if (dollarIdx < 0) return false;
    const optsPart = trimmed.slice(dollarIdx + 1).split(',').map(o => o.trim());
    return optsPart.indexOf('badfilter') !== -1;
}

export function resolveBadfilters(entries: RawFilterEntry[]): ResolvedBadfilters {
    const kept: RawFilterEntry[] = [];
    const dropped: ResolvedBadfilters['dropped'] = [];

    // Pass 1: collect base-filter forms keyed by `lane|host`. The
    // set of (lane, host) pairs that have at least one base filter
    // is what a $badfilter will successfully nullify.
    const baseKeys = new Set<string>();
    for (const e of entries) {
        if (isBadfilterLine(e.raw)) continue;
        const form = recognizeForm(e.raw);
        if (form === null) continue;
    baseKeys.add(`${form.isException ? 'allow' : 'block'}|${form.host}`);
    }

    // Pass 2: collect badfilter lines and classify them. A badfilter
    // is "applied" if it targeted at least one base filter, "orphan"
    // if it did not, and "unsupported" if the line did not match a
    // recognised form at all.
    const badfilterByKey = new Map<string, RawFilterEntry[]>();
    const badfilterLineCount = { applied: 0, orphan: 0, unsupported: 0 };
    for (const e of entries) {
        if (!isBadfilterLine(e.raw)) continue;
        const form = recognizeForm(e.raw);
        if (form === null) {
            badfilterLineCount.unsupported++;
            continue;
        }
        const key = `${form.isException ? 'allow' : 'block'}|${form.host}`;
        if (baseKeys.has(key)) {
            badfilterLineCount.applied++;
        } else {
            badfilterLineCount.orphan++;
        }
        const arr = badfilterByKey.get(key) ?? [];
    arr.push(e);
    badfilterByKey.set(key, arr);
    }

    // Pass 3: walk the input, drop base filters whose key is in the
    // badfilter set, skip badfilter lines themselves.
    for (const e of entries) {
        if (isBadfilterLine(e.raw)) {
            // Badfilter lines never end up in `kept`; they were
            // classified in pass 2.
            continue;
        }
        const form = recognizeForm(e.raw);
        if (form === null) {
      kept.push(e);
      continue;
        }
        const key = `${form.isException ? 'allow' : 'block'}|${form.host}`;
        if (badfilterByKey.has(key)) {
      dropped.push({ line: e.line, raw: e.raw, matchedBy: `badfilter:${form.host}` });
      continue;
        }
    kept.push(e);
    }

    return {
    kept,
    dropped,
    appliedBadfilterCount: badfilterLineCount.applied,
    orphanBadfilterCount: badfilterLineCount.orphan,
    unsupportedBadfilterCount: badfilterLineCount.unsupported,
    };
}
