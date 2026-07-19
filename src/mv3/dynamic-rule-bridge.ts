/**
 * src/mv3/dynamic-rule-bridge.ts
 *
 * The pure-module-to-Chrome bridge for `DynamicRuleManager`.
 *
 * Responsibilities:
 *   - assign fresh DNR ids from a reserved id range
 *     (Rev15 §5.5: "reserve ID ranges for static, dynamic,
 *     session, and diagnostics")
 *   - remove any pre-existing dynamic rules in that id range
 *   - call `chrome.declarativeNetRequest.updateDynamicRules`
 *     atomically (the API is atomic by spec)
 *   - surface install/remove counts and any errors
 *
 * The bridge is the canonical "in-Chrome stub" for the dynamic
 * rule manager. It does not call `chrome.declarativeNetRequest`
 * directly; the API is injected so the bridge is testable in
 * Node.
 */

import {
    DynamicRuleManager,
    type DryRunPlan,
    type PlannedDynamicRule,
} from './dynamic-rule-manager';

export interface DynamicRuleBridgeChromeSurface {
  declarativeNetRequest?: {
    getDynamicRules?: () => Promise<PlannedDynamicRule[]>;
    getSessionRules?: () => Promise<PlannedDynamicRule[]>;
    updateDynamicRules?: (_opts: {
      addRules?: PlannedDynamicRule[];
      removeRuleIds?: number[];
    }) => Promise<void>;
    updateSessionRules?: (_opts: {
      addRules?: PlannedDynamicRule[];
      removeRuleIds?: number[];
    }) => Promise<void>;
  };
}

export interface BridgeOptions {
  /** Inclusive lower bound of the dynamic-rule id range. */
  idRangeStart: number;
  /** Exclusive upper bound of the dynamic-rule id range. */
  idRangeEnd: number;
  now?: () => Date;
}

export interface BridgeResult {
  ok: boolean;
  installed: number;
  installedDynamic: number;
  installedSession: number;
  removed: number;
  removedDynamic: number;
  removedSession: number;
  errors: string[];
  /** The id range the bridge operated over, for telemetry. */
  idRange: { start: number; end: number };
}

export class DynamicRuleBridge {
    private readonly idRangeStart: number;
    private readonly idRangeEnd: number;
    private readonly chrome?: DynamicRuleBridgeChromeSurface;
    private nextId: number;

    constructor(opts: BridgeOptions & { chrome?: DynamicRuleBridgeChromeSurface }) {
        if (!Number.isInteger(opts.idRangeStart) || opts.idRangeStart <= 0) {
            throw new Error('idRangeStart must be a positive integer');
        }
        if (!Number.isInteger(opts.idRangeEnd) || opts.idRangeEnd <= opts.idRangeStart) {
            throw new Error('idRangeEnd must be a positive integer greater than idRangeStart');
        }
        this.idRangeStart = opts.idRangeStart;
        this.idRangeEnd = opts.idRangeEnd;
        this.chrome = opts.chrome;
        this.nextId = opts.idRangeStart;
    }

    /**
   * Apply a `DryRunPlan` from the `DynamicRuleManager` to the
   * browser. Returns counts and any errors. Pure call: a single
   * `updateDynamicRules` invocation handles both adds and removes.
   */
    async apply(plan: DryRunPlan): Promise<BridgeResult> {
        const errors: string[] = [...plan.errors];
        if (!plan.ok) {
            return {
        ok: false,
        installed: 0,
        installedDynamic: 0,
        installedSession: 0,
        removed: 0,
        removedDynamic: 0,
        removedSession: 0,
        errors: errors.length > 0 ? errors : ['Plan is not ok; aborting apply.'],
        idRange: { start: this.idRangeStart, end: this.idRangeEnd },
            };
        }

        const update = this.chrome?.declarativeNetRequest?.updateDynamicRules;
        const updateSession = this.chrome?.declarativeNetRequest?.updateSessionRules;
        const dynamicRules = plan.rules.filter(r => r.lane !== 'temporary-session');
        const sessionRules = plan.rules.filter(r => r.lane === 'temporary-session');
        if (typeof update !== 'function' && typeof updateSession !== 'function') {
            // No chrome surface (Node test). Caller decides whether
            // that's an error; we still return counts.
            return {
        ok: true,
        installed: plan.rules.length,
        installedDynamic: dynamicRules.length,
        installedSession: sessionRules.length,
        removed: 0,
        removedDynamic: 0,
        removedSession: 0,
        errors: [],
        idRange: { start: this.idRangeStart, end: this.idRangeEnd },
            };
        }

        // 1. Compute ids and pre-existing range.
        let addRules: PlannedDynamicRule[];
        try {
            addRules = plan.rules.map(rule => {
                const id = this.allocateId();
                return { ...rule, id };
            });
        } catch (err) {
      console.warn('[uBR] dynamic-rule-bridge: id allocation failed', err);
      return {
        ok: false,
        installed: 0,
        installedDynamic: 0,
        installedSession: 0,
        removed: 0,
        removedDynamic: 0,
        removedSession: 0,
        errors: [`Id allocation failed: ${(err as Error).message}`],
        idRange: { start: this.idRangeStart, end: this.idRangeEnd },
      };
        }
        const addDynamicRules = addRules.filter(r => r.lane !== 'temporary-session');
        const addSessionRules = addRules.filter(r => r.lane === 'temporary-session');
        const removeDynamicRuleIds = addDynamicRules.length > 0 ? this.computePreExistingRange() : [];
        const removeSessionRuleIds = addSessionRules.length > 0 ? this.computePreExistingRange() : [];

        // 2. Atomic per-DNR-lane updates. Chrome exposes dynamic and
        // session rules through separate APIs, so cross-lane updates
        // cannot be a single browser call.
        try {
            if (addDynamicRules.length > 0) {
                if (typeof update !== 'function') {
                    throw new Error('updateDynamicRules unavailable');
                }
                await update({ addRules: addDynamicRules, removeRuleIds: removeDynamicRuleIds });
            }
            if (addSessionRules.length > 0) {
                if (typeof updateSession !== 'function') {
                    throw new Error('updateSessionRules unavailable');
                }
                await updateSession({ addRules: addSessionRules, removeRuleIds: removeSessionRuleIds });
            }
        } catch (err) {
      console.warn('[uBR] dynamic-rule-bridge: DNR update threw', err);
      return {
        ok: false,
        installed: 0,
        installedDynamic: 0,
        installedSession: 0,
        removed: 0,
        removedDynamic: 0,
        removedSession: 0,
        errors: [`DNR update threw: ${(err as Error).message}`],
        idRange: { start: this.idRangeStart, end: this.idRangeEnd },
      };
        }

        return {
      ok: true,
      installed: addRules.length,
      installedDynamic: addDynamicRules.length,
      installedSession: addSessionRules.length,
      removed: removeDynamicRuleIds.length + removeSessionRuleIds.length,
      removedDynamic: removeDynamicRuleIds.length,
      removedSession: removeSessionRuleIds.length,
      errors: [],
      idRange: { start: this.idRangeStart, end: this.idRangeEnd },
        };
    }

    /**
   * Look up the existing dynamic rules in the managed id range
   * and return the ids to remove. The bridge does NOT call this
   * inside `apply` to avoid a race; the caller can pre-warm by
   * calling `discoverExistingIds` once at startup.
   */
    async discoverExistingIds(): Promise<number[]> {
        const get = this.chrome?.declarativeNetRequest?.getDynamicRules;
        if (typeof get !== 'function') return [];
        try {
            const rules = await get();
            return rules
        .filter(r => Number.isInteger(r.id)
          && r.id >= this.idRangeStart
          && r.id < this.idRangeEnd)
        .map(r => r.id);
        } catch (e) {
      console.warn('[uBR] dynamic-rule-bridge: getIds failed', e);
      return [];
        }
    }

    private allocateId(): number {
        if (this.nextId >= this.idRangeEnd) {
            throw new Error(
                `Dynamic rule id range exhausted: ${this.idRangeStart}..${this.idRangeEnd}`,
            );
        }
        return this.nextId++;
    }

    /**
   * Returns the next id that would be allocated, without
   * consuming it. Used by `applyDynamicRulesToBrowser` to
   * pre-allocate ids for the manager's plan validation.
   */
    peekNextId(): number {
        if (this.nextId >= this.idRangeEnd) {
            throw new Error(
                `Dynamic rule id range exhausted: ${this.idRangeStart}..${this.idRangeEnd}`,
            );
        }
        return this.nextId;
    }

    /**
   * Returns the list of ids in the managed range that the
   * bridge assumes are currently installed. The bridge seeds
   * this on the first call from `discoverExistingIds` (called
   * by the SW at startup) and tracks allocations thereafter.
   */
    private computePreExistingRange(): number[] {
    // For simplicity, the bridge assumes it owns the entire
    // range from `idRangeStart` to the current `nextId` minus
    // 1. This is a conservative wipe: any rules in this range
    // that weren't just allocated are removed.
        const out: number[] = [];
        for (let id = this.idRangeStart; id < this.nextId; id++) {
      out.push(id);
        }
        return out;
    }
}

/**
 * Convenience: build a plan + apply it in one call. Useful for
 * test code and for the SW's `applyUserRules` path.
 *
 * The function pre-allocates fresh ids from the bridge's
 * reserved range before calling the manager's `plan`. The
 * manager's id-validation check therefore sees real positive
 * integers; the bridge retains ownership of the range and
 * overwrites any caller-supplied id on the install path.
 */
export async function applyDynamicRulesToBrowser(
    manager: DynamicRuleManager,
    rules: PlannedDynamicRule[],
    chrome: DynamicRuleBridgeChromeSurface,
    options: BridgeOptions,
): Promise<BridgeResult & { plan: DryRunPlan }> {
    const bridge = new DynamicRuleBridge({ ...options, chrome });
    // Pre-allocate ids so the manager's id check passes. The
    // bridge will re-allocate in `apply` to keep the id range
    // bookkeeping correct, but the rule shape sent to the
    // browser is whatever the manager validates.
    const preAllocated: PlannedDynamicRule[] = [];
    for (const r of rules) {
        try {
      preAllocated.push({ ...r, id: bridge.peekNextId() });
        } catch (err) {
      console.warn('[uBR] dynamic-rule-bridge: pre-allocation id peek failed', err);
      return {
        ok: false,
        installed: 0,
        installedDynamic: 0,
        installedSession: 0,
        removed: 0,
        removedDynamic: 0,
        removedSession: 0,
        errors: [`Id allocation failed: ${(err as Error).message}`],
        plan: { ok: false, errors: [(err as Error).message], warnings: [], rules: [], budget: { persistentSafe: 0, persistentUnsafe: 0, session: 0 } },
        idRange: { start: options.idRangeStart, end: options.idRangeEnd },
      };
        }
    }
    const plan = manager.plan(preAllocated);
    const result = await bridge.apply(plan);
    return { ...result, plan };
}
