// @ts-nocheck
import type { StoredPolicy, SitePolicy, CompiledRuleGroup, IDAllocatorState, BudgetState, CompiledRule } from "../types/index.js";
export interface LifecycleState {
    policy: StoredPolicy;
    compiledRuleGroups: Record<string, CompiledRuleGroup>;
    idAllocator: IDAllocatorState;
    budget: BudgetState;
    ruleMapping: Record<string, {
        policyKey: string;
        ruleId: number;
        ruleType: "dynamic" | "session";
    }>;
    policyVersion: number;
    isReconciled?: boolean;
}
export interface LifecycleOptions {
    policy: StoredPolicy;
    existingDynamicRules: Array<{
        id: number;
        priority: number;
        action: {
            type: string;
        };
        condition: Record<string, unknown>;
    }>;
    existingSessionRules: Array<{
        id: number;
        priority: number;
        action: {
            type: string;
        };
        condition: Record<string, unknown>;
    }>;
    savedState?: Partial<LifecycleState>;
}
export declare function createInitialLifecycleState(options: LifecycleOptions): LifecycleState;
export declare function reconcileState(currentState: LifecycleState, runtimeDynamicRules: Array<{
    id: number;
    condition: Record<string, unknown>;
}>, runtimeSessionRules: Array<{
    id: number;
    condition: Record<string, unknown>;
}>): {
    needsFullRebuild: boolean;
    mismatchedRuleIds: number[];
    orphanRuntimeIds: number[];
};
export declare function updateSitePolicy(currentState: LifecycleState, site: string, newPolicy: SitePolicy): LifecycleState;
export declare function markSiteCompiled(currentState: LifecycleState, site: string, rules: CompiledRule[], mapping: Record<string, {
    policyKey: string;
    ruleId: number;
    ruleType: "dynamic" | "session";
}>): LifecycleState;
export declare function markSitePruned(currentState: LifecycleState, site: string): LifecycleState;
export declare function getSiteNeedsRecompile(currentState: LifecycleState, site: string): boolean;
export declare function snapshotState(state: LifecycleState): LifecycleState;
export declare function restoreFromSnapshot(snapshot: LifecycleState): LifecycleState;
