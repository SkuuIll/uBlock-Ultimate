/**
 * src/mv3/dynamic-rule-manager.ts
 *
 * Plan-list re-export (Rev15 §5.4). The canonical implementation lives at
 * `src/js/mv3/dynamic-rule-manager.ts`; this file exists so new code can
 * import from the path the plan calls for, while existing tests keep
 * importing from the legacy path. Behavior is identical.
 */

export {
    DynamicRuleManager,
    type DynamicRuleLane,
    type PlannedDynamicRule,
    type DryRunPlan,
    type DynamicRuleManagerOptions,
} from '../js/mv3/dynamic-rule-manager';
