/**
 * src/core/compiler/rule-lowering-planner.ts
 *
 * Takes a ClassifiedFilter and produces a *plan* describing how it
 * would be lowered into DNR rules. The planner does not actually
 * emit DNR rules; that is the compiler's job. It only decides the
 * shape of the output.
 */

import type { ClassifiedFilter, FilterLane } from './filter-classifier';

export type PlanAction =
  | 'emit-safe-block'
  | 'emit-safe-allow'
  | 'emit-cosmetic-css'
  | 'emit-limited-removeparam-static'
  | 'skip-unsupported'
  | 'skip-invalid';

export interface LoweringPlan {
  raw: string;
  lane: FilterLane;
  action: PlanAction;
  notes: string[];
}

export function planLowering(filter: ClassifiedFilter): LoweringPlan {
    const notes: string[] = [];
    switch (filter.lane) {
    case 'safe-dnr-block':
      notes.push('Emit single safe DNR block rule with urlFilter.');
        return { raw: filter.raw, lane: filter.lane, action: 'emit-safe-block', notes };
    case 'safe-dnr-allow':
      notes.push('Emit single safe DNR allow rule with urlFilter.');
        return { raw: filter.raw, lane: filter.lane, action: 'emit-safe-allow', notes };
    case 'cosmetic-css':
      notes.push('Defer to cosmetic CSS engine; out of scope for v0 compiler.');
        return { raw: filter.raw, lane: filter.lane, action: 'emit-cosmetic-css', notes };
    case 'limited-supported':
      notes.push('Limited support: emit a static-key removeparam placeholder; not enforced in v0.');
        return { raw: filter.raw, lane: filter.lane, action: 'emit-limited-removeparam-static', notes };
    case 'unsupported-recognized':
      notes.push('Skip: syntax not supported in current DNR backend.');
        return { raw: filter.raw, lane: filter.lane, action: 'skip-unsupported', notes };
    case 'invalid':
      notes.push('Skip: invalid or non-rule line.');
        return { raw: filter.raw, lane: filter.lane, action: 'skip-invalid', notes };
    }
}

export function planLoweringSummary(plans: LoweringPlan[]) {
    const counts: Record<PlanAction, number> = {
    'emit-safe-block': 0,
    'emit-safe-allow': 0,
    'emit-cosmetic-css': 0,
    'emit-limited-removeparam-static': 0,
    'skip-unsupported': 0,
    'skip-invalid': 0,
    };
    for (const p of plans) counts[p.action]++;
    return counts;
}
