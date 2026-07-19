/**
 * src/js/mv3/dynamic-rule-manager.ts
 *
 * Backend wrapper that plans and applies DNR dynamic rule updates
 * with budgets enforced. Injectable in tests; does not call
 * chrome.declarativeNetRequest directly.
 */

import {
    assertWithinSafeDynamicRuleBudget,
    assertWithinSessionRuleBudget,
    assertWithinUnsafeDynamicRuleBudget,
    assertWithinUserRegexBudget,
    DNR_LIMIT_PROFILE,
} from './dnr-limit-profile';
import {
    isSafeDynamicAction,
    type DnrActionKind,
} from './dnr-capability-profile';

export type DynamicRuleLane =
  | 'persistent-safe-dynamic'
  | 'persistent-unsafe-dynamic'
  | 'temporary-session';

export interface PlannedDynamicRule {
  id: number;
  lane?: DynamicRuleLane;
  priority: number;
  action:
    | { type: 'block' }
    | { type: 'allow' }
    | { type: 'allowAllRequests' }
    | { type: 'upgradeScheme'; upgradeScheme: 'http' | 'https' }
    | { type: 'redirect'; redirect: { url: string } }
    | { type: 'modifyHeaders'; requestHeaders?: any[]; responseHeaders?: any[] };
  condition: Record<string, unknown>;
}

export interface DryRunPlan {
  ok: boolean;
  errors: string[];
  warnings: string[];
  rules: PlannedDynamicRule[];
  budget: {
    persistentSafe: number;
    persistentUnsafe: number;
    session: number;
  };
}

export interface DynamicRuleManagerOptions {
  unsafeDynamicAllowed?: boolean;
  chrome121Plus?: boolean;
  now?: () => Date;
}

export class DynamicRuleManager {
    private readonly unsafeAllowed: boolean;
    private readonly chrome121Plus: boolean;
    private readonly persistentSafe: PlannedDynamicRule[] = [];
    private readonly persistentUnsafe: PlannedDynamicRule[] = [];
    private readonly session: PlannedDynamicRule[] = [];

    constructor(opts: DynamicRuleManagerOptions = {}) {
        this.unsafeAllowed = opts.unsafeDynamicAllowed === true;
        this.chrome121Plus = opts.chrome121Plus !== false;
    }

    plan(rules: PlannedDynamicRule[]): DryRunPlan {
        const errors: string[] = [];
        const warnings: string[] = [];
        const safe: PlannedDynamicRule[] = [];
        const unsafe: PlannedDynamicRule[] = [];
        const session: PlannedDynamicRule[] = [];

        for (const r of rules) {
            if (!Number.isInteger(r.id) || r.id <= 0) {
        errors.push(`Rule id must be a positive integer, got ${r.id}.`);
        continue;
            }
            const kind = r.action.type as DnrActionKind;
            const lane = r.lane ?? (
                kind === 'redirect' || kind === 'modifyHeaders'
                    ? 'persistent-unsafe-dynamic'
                    : 'persistent-safe-dynamic'
            );
            if (lane === 'temporary-session') {
                if (!isSupportedDynamicAction(kind)) {
          errors.push(`Unsupported action kind: ${kind}.`);
          continue;
                }
                if ((kind === 'redirect' || kind === 'modifyHeaders') && !this.unsafeAllowed) {
          errors.push(`Unsafe session action '${kind}' requires unsafeDynamicAllowed=true.`);
          continue;
                }
        session.push(r);
        continue;
            }
            if (kind === 'redirect' || kind === 'modifyHeaders') {
                if (lane !== 'persistent-unsafe-dynamic') {
          errors.push(`Unsafe action '${kind}' must use persistent-unsafe-dynamic or temporary-session lane.`);
          continue;
                }
                if (!this.unsafeAllowed) {
          errors.push(`Unsafe action '${kind}' requires unsafeDynamicAllowed=true.`);
          continue;
                }
        unsafe.push(r);
        continue;
            }
            if (!isSafeDynamicAction(kind)) {
        errors.push(`Unsupported action kind: ${kind}.`);
        continue;
            }
            if (lane !== 'persistent-safe-dynamic') {
        errors.push(`Safe action '${kind}' cannot use lane '${lane}'.`);
        continue;
            }
      safe.push(r);
        }

        const safeBudget = assertWithinSafeDynamicRuleBudget(safe.length, this.chrome121Plus);
        if (!safeBudget.ok) {
      errors.push(safeBudget.message);
        } else if (safeBudget.warning) {
      warnings.push(safeBudget.message);
        }

        const unsafeBudget = assertWithinUnsafeDynamicRuleBudget(unsafe.length);
        if (!unsafeBudget.ok) {
      errors.push(unsafeBudget.message);
        } else if (unsafeBudget.warning) {
      warnings.push(unsafeBudget.message);
        }

        const sessionBudget = assertWithinSessionRuleBudget(session.length);
        if (!sessionBudget.ok) {
      errors.push(sessionBudget.message);
        } else if (sessionBudget.warning) {
      warnings.push(sessionBudget.message);
        }

        const regexCount = countRegexRules(rules);
        const regexBudget = assertWithinUserRegexBudget(regexCount);
        if (!regexBudget.ok) {
      errors.push(regexBudget.message);
        } else if (regexBudget.warning) {
      warnings.push(regexBudget.message);
        }

        return {
      ok: errors.length === 0,
      errors,
      warnings,
      rules: rules.slice(),
      budget: {
        persistentSafe: safe.length,
        persistentUnsafe: unsafe.length,
        session: session.length,
      },
        };
    }

    /**
   * Apply a plan to the manager's internal lanes. Caller is
   * responsible for actually installing them via the browser API.
   * This wrapper only manages intent and budgets.
   */
    apply(plan: DryRunPlan): void {
        this.persistentSafe.length = 0;
        this.persistentUnsafe.length = 0;
        this.session.length = 0;
        for (const r of plan.rules) {
            const kind = r.action.type;
            if (r.lane === 'temporary-session') {
        this.session.push(r);
            } else if (kind === 'redirect' || kind === 'modifyHeaders') {
        this.persistentUnsafe.push(r);
            } else {
        this.persistentSafe.push(r);
            }
        }
    }

    snapshot(): {
    persistentSafe: readonly PlannedDynamicRule[];
    persistentUnsafe: readonly PlannedDynamicRule[];
    session: readonly PlannedDynamicRule[];
    } {
        return {
      persistentSafe: this.persistentSafe.slice(),
      persistentUnsafe: this.persistentUnsafe.slice(),
      session: this.session.slice(),
        };
    }

    static limitProfile() {
        return DNR_LIMIT_PROFILE;
    }
}

function isSupportedDynamicAction(kind: DnrActionKind): boolean {
    return isSafeDynamicAction(kind) || kind === 'redirect' || kind === 'modifyHeaders';
}

function countRegexRules(rules: PlannedDynamicRule[]): number {
    let n = 0;
    for (const r of rules) {
        const c = r.condition as { regexFilter?: string };
        if (typeof c.regexFilter === 'string' && c.regexFilter.length > 0) n++;
    }
    return n;
}
