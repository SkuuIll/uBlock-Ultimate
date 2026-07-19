/**
 * src/safety/high-risk-site-policy.ts
 *
 * §6.1.1 of the Rev15 plan. The high-risk site policy triggers
 * when any of the following occur on a domain:
 *
 *   1. Cosmetic selector execution exceeds 100ms cumulative
 *      time within a 5-second window.
 *   2. Three or more cosmetic-related performance warnings
 *      (LongTaskObserver, slow style recalculation, etc.)
 *      occur in a 30-second window.
 *   3. User manually marks the site as "problematic" via the
 *      popup.
 *
 * When triggered, the policy disables cosmetic filtering for
 * that domain as a temporary session exception. The user can
 * re-enable in a single click. If performance problems recur,
 * the policy offers a permanent disable option.
 *
 * Pure module. No chrome. No DOM. The SW side is responsible
 * for the chrome.storage-backed persistence of `problematic`
 * and `reEnabled` flags across sessions.
 */

export type HighRiskTrigger =
  | 'cumulative-time'
  | 'long-task-warnings'
  | 'manual-flag';

export type HighRiskDecisionAction =
  | 'none'
  | 'disable-cosmetic-temporarily'
  | 'keep-disabled'
  | 're-enable';

export interface HighRiskDecision {
  action: HighRiskDecisionAction;
  reason?: HighRiskTrigger;
  recoveryHint?: string;
}

export interface HighRiskTriggerEvent {
  domain: string;
  kind: HighRiskTrigger;
  timestamp: number;
  durationMs?: number;
}

export interface HighRiskDomainState {
  domain: string;
  cumulativeTimeEvents: Array<{ timestamp: number; durationMs: number }>;
  longTaskEvents: Array<{ timestamp: number }>;
  manualFlag: boolean;
  disabledUntil: number | null;
  disabledReason: HighRiskTrigger | null;
  reEnabledByUser: boolean;
  lastDecision: HighRiskDecisionAction;
}

export interface HighRiskSitePolicyConfig {
  cumulativeTimeBudgetMs: number;
  cumulativeTimeWindowMs: number;
  longTaskWarningBudget: number;
  longTaskWindowMs: number;
  reEnableCooldownMs: number;
}

export const DEFAULT_HIGH_RISK_CONFIG: Readonly<HighRiskSitePolicyConfig> = Object.freeze({
  cumulativeTimeBudgetMs: 100,
  cumulativeTimeWindowMs: 5_000,
  longTaskWarningBudget: 3,
  longTaskWindowMs: 30_000,
  reEnableCooldownMs: 60_000,
});

export const HIGH_RISK_RECOVERY_HINT =
  'Cosmetic filtering disabled on this site due to performance issues. Click to re-enable.';

export class HighRiskSitePolicy {
    private readonly config: HighRiskSitePolicyConfig;
    private readonly domains: Map<string, HighRiskDomainState> = new Map();
    private readonly now: () => number;

    constructor(opts: { config?: Partial<HighRiskSitePolicyConfig>; now?: () => number } = {}) {
        this.config = { ...DEFAULT_HIGH_RISK_CONFIG, ...(opts.config ?? {}) };
        this.now = opts.now ?? (() => Date.now());
    }

    getConfig(): Readonly<HighRiskSitePolicyConfig> {
        return { ...this.config };
    }

    /**
   * Returns a defensive copy of the per-domain state, or null
   * if the domain has no recorded events.
   */
    inspect(domain: string): HighRiskDomainState | null {
        const s = this.domains.get(domain);
        if (!s) return null;
        return {
      ...s,
      cumulativeTimeEvents: s.cumulativeTimeEvents.slice(),
      longTaskEvents: s.longTaskEvents.slice(),
        };
    }

    /**
   * Record a trigger event. The event is rotated out of the
   * domain's window if it's older than the configured window.
   */
    record(event: HighRiskTriggerEvent): void {
        if (!event || typeof event.domain !== 'string' || event.domain.length === 0) {
            throw new Error('high-risk-site-policy: event.domain is required');
        }
        let state = this.domains.get(event.domain);
        if (!state) {
            state = {
        domain: event.domain,
        cumulativeTimeEvents: [],
        longTaskEvents: [],
        manualFlag: false,
        disabledUntil: null,
        disabledReason: null,
        reEnabledByUser: false,
        lastDecision: 'none',
            };
      this.domains.set(event.domain, state);
        }
        const t = event.timestamp;
        if (event.kind === 'cumulative-time') {
            const duration = event.durationMs ?? this.config.cumulativeTimeBudgetMs;
      state.cumulativeTimeEvents.push({ timestamp: t, durationMs: duration });
        } else if (event.kind === 'long-task-warnings') {
      state.longTaskEvents.push({ timestamp: t });
        } else if (event.kind === 'manual-flag') {
            state.manualFlag = true;
        }
    }

    /**
   * Mark a domain as user-flagged "problematic" (popup path).
   * Idempotent.
   */
    markProblematic(domain: string): HighRiskDecision {
        if (typeof domain !== 'string' || domain.length === 0) {
            throw new Error('high-risk-site-policy: domain is required');
        }
    this.record({ domain, kind: 'manual-flag', timestamp: this.now() });
    const s = this.domains.get(domain)!;
    s.disabledUntil = Number.POSITIVE_INFINITY;
    s.disabledReason = 'manual-flag';
    s.lastDecision = 'disable-cosmetic-temporarily';
    return {
      action: 'disable-cosmetic-temporarily',
      reason: 'manual-flag',
      recoveryHint: HIGH_RISK_RECOVERY_HINT,
    };
    }

    /**
   * Mark a domain as resolved by the user (re-enable path).
   * Resets the manual flag and the disabled state. Performance
   * events are kept for the current session.
   */
    markResolved(domain: string): HighRiskDecision {
        if (typeof domain !== 'string' || domain.length === 0) {
            throw new Error('high-risk-site-policy: domain is required');
        }
        const s = this.domains.get(domain);
        if (!s) {
            return { action: 'none' };
        }
        s.manualFlag = false;
        s.disabledUntil = null;
        s.disabledReason = null;
        s.reEnabledByUser = true;
        s.lastDecision = 're-enable';
        return { action: 're-enable' };
    }

    /**
   * Evaluate the current state of a domain and return the
   * recommended action. The decision is deterministic and
   * time-windowed.
   */
    evaluate(domain: string, nowInput?: number): HighRiskDecision {
        const t = nowInput ?? this.now();
        const s = this.domains.get(domain);
        if (!s) {
            return { action: 'none' };
        }

        // Rotate out events outside their window
        s.cumulativeTimeEvents = s.cumulativeTimeEvents.filter(
            e => t - e.timestamp <= this.config.cumulativeTimeWindowMs,
        );
        s.longTaskEvents = s.longTaskEvents.filter(
            e => t - e.timestamp <= this.config.longTaskWindowMs,
        );

        // Manual flag takes precedence and persists indefinitely
        if (s.manualFlag) {
            if (s.disabledReason === 'manual-flag' && s.disabledUntil === Number.POSITIVE_INFINITY) {
                if (s.lastDecision !== 'keep-disabled') {
                    s.lastDecision = 'keep-disabled';
                }
                return {
          action: 'keep-disabled',
          reason: 'manual-flag',
          recoveryHint: HIGH_RISK_RECOVERY_HINT,
                };
            }
        }

        // Cumulative-time check
        const cumMs = s.cumulativeTimeEvents.reduce((acc, e) => acc + e.durationMs, 0);
        if (cumMs >= this.config.cumulativeTimeBudgetMs) {
            s.disabledUntil = t + this.config.reEnableCooldownMs;
            s.disabledReason = 'cumulative-time';
            s.lastDecision = 'disable-cosmetic-temporarily';
            return {
        action: 'disable-cosmetic-temporarily',
        reason: 'cumulative-time',
        recoveryHint: HIGH_RISK_RECOVERY_HINT,
            };
        }

        // Long-task check
        if (s.longTaskEvents.length >= this.config.longTaskWarningBudget) {
            s.disabledUntil = t + this.config.reEnableCooldownMs;
            s.disabledReason = 'long-task-warnings';
            s.lastDecision = 'disable-cosmetic-temporarily';
            return {
        action: 'disable-cosmetic-temporarily',
        reason: 'long-task-warnings',
        recoveryHint: HIGH_RISK_RECOVERY_HINT,
            };
        }

        // If previously disabled and cooldown elapsed, recover
        if (s.disabledUntil !== null && t >= s.disabledUntil && !s.reEnabledByUser) {
            s.disabledUntil = null;
            s.disabledReason = null;
            s.lastDecision = 're-enable';
            return { action: 're-enable' };
        }

        s.lastDecision = 'none';
        return { action: 'none' };
    }

    /**
   * Is cosmetic filtering currently disabled for this domain?
   */
    isDisabled(domain: string, nowInput?: number): boolean {
        const t = nowInput ?? this.now();
        const s = this.domains.get(domain);
        if (!s) return false;
        if (s.manualFlag) return true;
        if (s.disabledUntil === null) return false;
        if (s.disabledUntil === Number.POSITIVE_INFINITY) return true;
        return t < s.disabledUntil;
    }

    /**
   * List all domains the policy is tracking. Used for the
   * diagnostics export.
   */
    listDomains(): string[] {
        return Array.from(this.domains.keys());
    }

    /**
   * Reset all state. Used by tests.
   */
    reset(): void {
    this.domains.clear();
    }
}
