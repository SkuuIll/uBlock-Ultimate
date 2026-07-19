/**
 * src/mv3/static-rule-disable-manager.ts
 *
 * Wraps `chrome.declarativeNetRequest.updateStaticRules` with a
 * small id ledger and a per-ruleset disabled-set. The manager is
 * the canonical path for "this static rule is a false positive;
 * disable it" (Rev15 §5.3 + §15.8).
 *
 * The chrome API replaces the entire `disableRuleIds` set for
 * each ruleset on every call, so the manager must remember the
 * full set and call the API with the union of pre-existing and
 * new disable ids.
 *
 * Pure module: all `chrome.*` calls go through an injected
 * surface so the manager is testable in Node.
 */

export type StaticRuleDisableReason = 'false-positive' | 'site-issue' | 'other';

export interface StaticRuleDisable {
  rulesetId: string;
  ruleId: number;
  reason: StaticRuleDisableReason;
  /** ISO timestamp. */
  disabledAt: string;
  notes?: string;
}

export interface StaticRuleDisableStorage {
  version: 1;
  list: StaticRuleDisable[];
}

export interface StaticDisableChromeSurface {
  declarativeNetRequest?: {
    updateStaticRules?: (_opts: {
      rulesetId: string;
      disableRuleIds?: number[];
      enableRuleIds?: number[];
    }) => Promise<void>;
  };
}

export interface StaticRuleDisableManagerOptions {
  storage?: StaticRuleDisableStorage;
  chrome?: StaticDisableChromeSurface;
  now?: () => Date;
}

export interface StaticDisableResult {
  ok: boolean;
  reason?: string;
  disabledRuleIds?: number[];
}

export class StaticRuleDisableManager {
    private list: StaticRuleDisable[] = [];
    private readonly chrome?: StaticDisableChromeSurface;
    private readonly now: () => Date;

    constructor(opts: StaticRuleDisableManagerOptions = {}) {
        this.chrome = opts.chrome;
        this.now = opts.now ?? (() => new Date());
        if (opts.storage) this.load(opts.storage);
    }

    load(s: StaticRuleDisableStorage): void {
        if (!s || s.version !== 1 || !Array.isArray(s.list)) {
            // Defensive: a corrupt ledger should not crash the manager.
            this.list = [];
            return;
        }
        this.list = s.list.filter(e =>
            typeof e.rulesetId === 'string'
      && e.rulesetId.length > 0
      && typeof e.ruleId === 'number'
      && Number.isInteger(e.ruleId)
      && e.ruleId > 0
        );
    }

    snapshot(): StaticRuleDisableStorage {
        return { version: 1, list: this.list.slice() };
    }

    isDisabled(rulesetId: string, ruleId: number): boolean {
        return this.list.some(e => e.rulesetId === rulesetId && e.ruleId === ruleId);
    }

    getDisabledForRuleset(rulesetId: string): number[] {
        return this.list
      .filter(e => e.rulesetId === rulesetId)
      .map(e => e.ruleId)
      .sort((a, b) => a - b);
    }

    async disable(
        input: Omit<StaticRuleDisable, 'disabledAt'>,
    ): Promise<StaticDisableResult> {
        if (!input || typeof input.rulesetId !== 'string' || input.rulesetId.length === 0) {
            return { ok: false, reason: 'rulesetId is empty' };
        }
        if (!Number.isInteger(input.ruleId) || input.ruleId <= 0) {
            return { ok: false, reason: 'ruleId must be a positive integer' };
        }
        if (this.isDisabled(input.rulesetId, input.ruleId)) {
            // Already disabled: no-op. Return the current set so the
            // caller can verify the chrome surface did not need to
            // be called.
            return { ok: true, disabledRuleIds: this.getDisabledForRuleset(input.rulesetId) };
        }
    this.list.push({
      ...input,
      disabledAt: this.now().toISOString(),
    });
    const disabledRuleIds = this.getDisabledForRuleset(input.rulesetId);
    const chromeResult = await this.callUpdateStaticRules(input.rulesetId, disabledRuleIds);
    if (!chromeResult.ok) {
        return chromeResult;
    }
    return { ok: true, disabledRuleIds };
    }

    async enable(rulesetId: string, ruleId: number): Promise<StaticDisableResult> {
        const before = this.list.length;
        this.list = this.list.filter(e => !(e.rulesetId === rulesetId && e.ruleId === ruleId));
        if (this.list.length === before) {
            return { ok: true, disabledRuleIds: this.getDisabledForRuleset(rulesetId) };
        }
        const disabledRuleIds = this.getDisabledForRuleset(rulesetId);
        const chromeResult = await this.callUpdateStaticRules(rulesetId, disabledRuleIds);
        if (!chromeResult.ok) {
            return chromeResult;
        }
        return { ok: true, disabledRuleIds };
    }

    /**
   * Drop entries whose `ruleId` is no longer in the supplied
   * map of rulesetId -> Set<ruleId>. Returns the count of
   * pruned entries. Useful when a static ruleset is recompiled
   * and the previous id assignments are stale.
   */
    prune(knownRuleIds: ReadonlyMap<string, ReadonlySet<number>>): number {
        if (!(knownRuleIds instanceof Map)) return 0;
        const before = this.list.length;
        this.list = this.list.filter(e => {
            const known = knownRuleIds.get(e.rulesetId);
            if (!known) return false;
            return known.has(e.ruleId);
        });
        return before - this.list.length;
    }

    private async callUpdateStaticRules(
        rulesetId: string,
        disabledRuleIds: number[],
    ): Promise<StaticDisableResult> {
        const update = this.chrome?.declarativeNetRequest?.updateStaticRules;
        if (typeof update !== 'function') {
            // No chrome surface (e.g. Node test): the in-memory ledger
            // is the source of truth. Return ok so the manager's API
            // remains usable for pure-logic callers.
            return { ok: true };
        }
        try {
            await update({ rulesetId, disableRuleIds: disabledRuleIds });
            return { ok: true };
        } catch (err) {
      console.warn('[uBR] static-rule-disable-manager: updateStaticRules threw', err);
      return { ok: false, reason: `updateStaticRules threw: ${(err as Error).message}` };
        }
    }
}

export function createEmptyStaticRuleDisableStorage(): StaticRuleDisableStorage {
    return { version: 1, list: [] };
}
