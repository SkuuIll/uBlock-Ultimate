/**
 * src/core/user-rules/rule-lowering-planner.ts
 *
 * Plan-list re-export (Rev15 §5.4). The canonical implementation lives at
 * `src/core/compiler/rule-lowering-planner.ts`; this file exists so new
 * user-rule code can import from the path the plan calls for, while
 * existing compiler tests keep importing from the original location.
 * Behavior is identical.
 */

export {
    planLowering,
    planLoweringSummary,
    type LoweringPlan,
    type PlanAction,
} from '../compiler/rule-lowering-planner';
