// @ts-nocheck
import { type BudgetState } from "../types/index.js";
export type { BudgetState };
export declare const DEFAULT_DYNAMIC_CEILING = 30000;
export declare const DEFAULT_SESSION_CEILING = 5000;
export declare const SOFT_PER_SITE_THRESHOLD = 100;
export declare const WARNING_THRESHOLD = 0.8;
export declare const CRITICAL_THRESHOLD = 0.95;
export declare const PRUNE_THRESHOLD = 0.9;
export declare function createDefaultBudgetState(dynamicCeiling?: number, sessionCeiling?: number): BudgetState;
export declare function getBudgetStatus(state: BudgetState): {
    dynamic: "ok" | "warning" | "critical";
    session: "ok" | "warning" | "critical";
};
export declare function canAllocateRules(state: BudgetState, dynamicCount: number, sessionCount: number, site?: string): {
    allowed: boolean;
    reason?: string;
    warning?: string;
};
export declare function updateBudgetCounts(state: BudgetState, dynamicDelta: number, sessionDelta: number, site?: string): BudgetState;
export declare function getPerSiteRuleCount(state: BudgetState, site: string): {
    dynamic: number;
    session: number;
    total: number;
};
export declare function isPerSiteOverThreshold(state: BudgetState, site: string): boolean;
export declare function projectBudgetGrowth(state: BudgetState, additionalDynamic: number, additionalSession: number): BudgetState;
export declare function computePruneCandidates(state: BudgetState, currentSite?: string): string[];
export interface PruneCandidate {
    site: string;
    ruleCount: number;
    lastUsed: number;
}
export declare function getLruPruneCandidates(compiledRuleGroups: Record<string, {
    site: string;
    rules: any[];
    lastUsed: number;
    isPruned?: boolean;
}>, budget: BudgetState, currentSite?: string, maxCandidates?: number): PruneCandidate[];
export declare function pruneSiteFromBudget(state: BudgetState, site: string): BudgetState;
