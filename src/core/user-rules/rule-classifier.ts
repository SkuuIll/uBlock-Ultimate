/**
 * src/core/user-rules/rule-classifier.ts
 *
 * Lane-decider for user-authored filters. Reuses the compiler-side
 * `classifyFilter` to get the underlying `FilterLane`, then maps to a
 * `UserRuleLane` per Rev15 §5.2 and §5.3, with extra warnings for
 * overbroad rules and high-risk site rules.
 *
 * Pure module: no chrome.*, no Date.now(). Caller-injected where
 * clock is needed.
 */

import { classifyFilter, type FilterLane } from '../compiler/filter-classifier';

export type UserRuleLane =
  | 'persistent-safe-dynamic'
  | 'persistent-unsafe-dynamic'
  | 'temporary-session';

export interface UserRuleWarnings {
  /**
   * The rule, if installed, would match most URLs on the open web.
   * Example: `*$third-party`, `||*^` (no domain restriction), bare
   * `*$domain=~bank.com`. The editor must show the "may break most
   * websites" prompt and require an extra confirmation click
   * (Rev15 §5.3).
   */
  overbroad: boolean;
  /**
   * The rule's domain or token matches a configured high-risk
   * site list (banking, payments, identity providers, etc.).
   */
  highRiskSite: boolean;
  /**
   * Convenience flag: true when either `overbroad` or
   * `highRiskSite` is true. The editor may use this to decide
   * whether to gate the rule on an extra confirmation click.
   * (Rev15 §5.3 explicitly calls out "overbroad" cases for
   * the confirmation prompt; high-risk-site is added as a
   * conservative extension since blocking a login page is
   * a closely related user-harm pattern.)
   */
  dangerous: boolean;
}

export interface UserRuleClassification {
  lane: UserRuleLane;
  warnings: UserRuleWarnings;
  reason: string;
  notes: string[];
  underlyingFilterLane: FilterLane;
  /**
   * Estimated dynamic-rule impact. Always a 0|1 for the single
   * rule being classified; aggregated callers sum this across
   * rules to compute a transaction budget delta.
   */
  estimatedBudgetImpact: {
    safe: 0 | 1;
    unsafe: 0 | 1;
    session: 0 | 1;
  };
}

export interface ClassifyUserRuleOptions {
  /**
   * If true, the rule is forced into `temporary-session` instead
   * of `persistent-*`. Used by the "temporary unbreak" button in
   * the options UI.
   */
  isTemporary?: boolean;
  /**
   * Mirror of `DynamicRuleManagerOptions.unsafeDynamicAllowed`.
   * When false, `unsafe-dynamic` lane choices are downgraded to
   * `unsupported` notes but still classified as
   * `unsupported-recognized` underlying.
   */
  isUnsafeAllowed?: boolean;
  /**
   * Tokens (lowercased, dot-separated) used by the high-risk-site
   * detector. Default list is the store-safe baseline; callers
   * can override or extend.
   */
  highRiskDomains?: readonly string[];
  /**
   * Disables the dangerous-rule detection entirely. Useful for
   * tests and for callers that want raw classification.
   */
  detectDangerous?: boolean;
}

export const DEFAULT_HIGH_RISK_TOKENS: readonly string[] = [
  'bank',
  'paypal',
  'chase',
  'wellsfargo',
  'amex',
  'americanexpress',
  'venmo',
  'stripe',
  'coinbase',
  'kraken',
  'gemini',
  'login',
  'auth',
  'sso',
  'idp',
  '2fa',
  'okta',
  'duo',
  'accounts.google.com',
  'signin',
  'sign-in',
  'authenticate',
  'webauthn',
];

const DEFAULT_OPTIONS: Required<Pick<ClassifyUserRuleOptions, 'isTemporary' | 'isUnsafeAllowed' | 'detectDangerous'>> = {
  isTemporary: false,
  isUnsafeAllowed: false,
  detectDangerous: true,
};

export function classifyUserRule(
    raw: string,
    options: ClassifyUserRuleOptions = {},
): UserRuleClassification {
    const opts = { ...DEFAULT_OPTIONS, ...options };
    const highRiskTokens = options.highRiskDomains ?? DEFAULT_HIGH_RISK_TOKENS;
    const classified = classifyFilter(raw);

    const notes: string[] = [];
    const budget: UserRuleClassification['estimatedBudgetImpact'] = {
    safe: 0,
    unsafe: 0,
    session: 0,
    };
    let lane: UserRuleLane;

    switch (classified.lane) {
    case 'safe-dnr-block':
    case 'safe-dnr-allow':
        lane = opts.isTemporary ? 'temporary-session' : 'persistent-safe-dynamic';
        if (opts.isTemporary) {
            budget.session = 1;
        notes.push('Forced into temporary-session by caller.');
        } else {
            budget.safe = 1;
        }
        break;
    case 'limited-supported':
        lane = opts.isUnsafeAllowed ? 'persistent-unsafe-dynamic' : 'persistent-safe-dynamic';
        if (opts.isUnsafeAllowed) {
            budget.unsafe = 1;
        notes.push('Static $removeparam lowered into persistent-unsafe-dynamic (URLTransform).');
        } else {
            budget.safe = 1;
        notes.push('Static $removeparam lowered as persistent-safe-dynamic; URLTransform is safe.');
        }
        break;
    case 'unsupported-recognized':
        // Redirects / CSP / scriptlets / etc. — these can only install
        // as unsafe dynamic. If unsafe is not allowed, we still mark
        // the lane so the editor can show the user a clear "not
        // supported" decision instead of silently dropping it.
        if (opts.isUnsafeAllowed) {
            lane = 'persistent-unsafe-dynamic';
            budget.unsafe = 1;
        notes.push('Unsafe action requires unsafeDynamicAllowed=true.');
        } else {
            lane = 'persistent-safe-dynamic';
            budget.safe = 1;
        notes.push('Unsafe action not allowed in current profile; will not install as safe no-op.');
        }
        break;
    case 'invalid':
    default:
        lane = 'persistent-safe-dynamic';
        budget.safe = 0;
      notes.push('Invalid or non-rule line; no action taken.');
        break;
    }

    // Danger detection runs on the raw text, not the lane, so that
    // safe-looking rules with an overbroad body still get flagged.
    // Cosmetic-only `##` lines are CSS selectors and cannot be overbroad
    // in the URL sense, so skip danger detection for them.
    const isCosmetic = raw.includes('##');
    const overbroad = opts.detectDangerous && !isCosmetic
        ? detectOverbroad(raw, classified)
        : false;
    const highRiskSite = opts.detectDangerous && !isCosmetic
        ? detectHighRiskSite(raw, classified, highRiskTokens)
        : false;
    const dangerous = overbroad || highRiskSite;

    if (overbroad) {
    notes.push('Overbroad pattern detected: would match most URLs.');
    }
    if (highRiskSite) {
    notes.push('High-risk site token detected in rule domain/path.');
    }

    return {
    lane,
    warnings: { overbroad, highRiskSite, dangerous },
    reason: classified.reason,
    notes,
    underlyingFilterLane: classified.lane,
    estimatedBudgetImpact: budget,
    };
}

// ---------------------------------------------------------------------------
// Danger detection
// ---------------------------------------------------------------------------

/**
 * Heuristic overbroad detector. A rule is overbroad when its body
 * would match nearly every URL on the web. The list of patterns is
 * deliberately conservative: false positives are surfaced to the
 * user (with confirmation), false negatives are not catastrophic
 * (worst case the user has to confirm a wide rule).
 */
function detectOverbroad(raw: string, classified: ReturnType<typeof classifyFilter>): boolean {
    const line = raw.trim();
    if (line.length === 0) return false;
    // Allow rules are evaluated against the body after stripping @@.
    const body = line.startsWith('@@') ? line.slice(2) : line;

    // Split on the option delimiter to get the pattern and the options.
    const optIdx = body.lastIndexOf('$');
    const pattern = optIdx > 0 ? body.slice(0, optIdx) : body;
    const optionsStr = optIdx > 0 ? body.slice(optIdx + 1) : '';

    // 1. Domain restriction absent AND pattern is naked wildcard.
    if (!hasDomainOption(optionsStr) && hasWildcardOrUniversalPattern(pattern)) {
        return true;
    }
    // 2. Negated single-domain is still broad (`*$domain=~bank.com`).
    if (hasOnlyNegatedDomainOption(optionsStr) && patternIsUniversalOrHostStar(pattern)) {
        return true;
    }
    // 3. Plain host (`example.com` with no ^ anchor and no path) — the
    //    safe-network-rule-compiler lowers this to a wide urlFilter.
    //    This is the user-friendly "block example.com entirely"
    //    affordance, not overbroad in the URL sense. Skip.
    void classified;
    return false;
}

function hasDomainOption(optionsStr: string): boolean {
    if (optionsStr.length === 0) return false;
    for (const opt of optionsStr.split(',')) {
        const lower = opt.trim().toLowerCase();
        if (lower === 'domain' || lower.startsWith('domain=')) return true;
    }
    return false;
}

function hasOnlyNegatedDomainOption(optionsStr: string): boolean {
    if (optionsStr.length === 0) return false;
    const opts = optionsStr.split(',').map(o => o.trim().toLowerCase()).filter(Boolean);
    if (opts.length === 0) return false;
    for (const opt of opts) {
        if (opt === 'domain' || opt.startsWith('domain=')) {
            const arg = opt.startsWith('domain=') ? opt.slice('domain='.length) : '';
            if (arg.length === 0) return false;
            // All listed domains are negated?
            const parts = arg.split('|').map(p => p.trim()).filter(Boolean);
            if (parts.length === 0) return false;
            return parts.every(p => p.startsWith('~'));
        }
    }
    return false;
}

function hasWildcardOrUniversalPattern(pattern: string): boolean {
    if (pattern.length === 0) return false;
    // `*` is the universal adblock wildcard.
    if (pattern === '*') return true;
    // `||*^` or `||*` with no further restriction.
    if (pattern === '||*' || pattern === '||*^') return true;
    // `^https?://.*` family.
    if (/^\^https?:\/\/\.\*/.test(pattern)) return true;
    return false;
}

function patternIsUniversalOrHostStar(pattern: string): boolean {
    if (hasWildcardOrUniversalPattern(pattern)) return true;
    // `||*^` with no other anchor.
    if (/^\|\|[a-z0-9._-]*\*/i.test(pattern) && !pattern.includes('\\')) return true;
    return false;
}

function detectHighRiskSite(
    raw: string,
    classified: ReturnType<typeof classifyFilter>,
    highRiskTokens: readonly string[],
): boolean {
    if (highRiskTokens.length === 0) return false;
    const line = raw.toLowerCase();
    // 1. Domain form: `||bank.com^` -> the `domain` field on the
    //    classified filter is a strong signal.
    if (classified.domain) {
        const lowerDomain = classified.domain.toLowerCase();
        for (const token of highRiskTokens) {
            const tok = token.toLowerCase();
            // Match the full token, or a token followed by a TLD boundary.
            if (lowerDomain === tok || lowerDomain.startsWith(`${tok  }.`)) {
                return true;
            }
        }
    }
    // 2. Token presence anywhere in the raw line (covers the rare
    //    case of a network rule with the token in its pattern but
    //    no recognized domain).
    for (const token of highRiskTokens) {
        const tok = token.toLowerCase();
        if (line.includes(tok)) return true;
    }
    return false;
}
