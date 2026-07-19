// @ts-nocheck
export const DEFAULT_DYNAMIC_CEILING = 30000;
export const DEFAULT_SESSION_CEILING = 5000;
export const SOFT_PER_SITE_THRESHOLD = 100;
export const WARNING_THRESHOLD = 0.8;
export const CRITICAL_THRESHOLD = 0.95;
export const PRUNE_THRESHOLD = 0.9;

export type BudgetStatus = "ok" | "warning" | "critical";

export interface PerSiteBudget {
    dynamic: number;
    session: number;
    total: number;
}

export interface BudgetState {
    dynamicRuleCount: number;
    sessionRuleCount: number;
    dynamicCeiling: number;
    sessionCeiling: number;
    perSiteRules: Record<string, PerSiteBudget>;
    globalOverridePool: number;
}

export interface BudgetCheckResult {
    allowed: boolean;
    reason?: string;
    warning?: string;
}

export interface BudgetStatusResult {
    dynamic: BudgetStatus;
    session: BudgetStatus;
}

export function createDefaultBudgetState(
    dynamicCeiling: number = DEFAULT_DYNAMIC_CEILING,
    sessionCeiling: number = DEFAULT_SESSION_CEILING
): BudgetState {
    return {
        dynamicRuleCount: 0,
        sessionRuleCount: 0,
        dynamicCeiling,
        sessionCeiling,
        perSiteRules: {},
        globalOverridePool: Math.floor(dynamicCeiling * 0.1),
    };
}

export function getBudgetStatus(state: BudgetState): BudgetStatusResult {
    const dynamicRatio = state.dynamicRuleCount / state.dynamicCeiling;
    const sessionRatio = state.sessionRuleCount / state.sessionCeiling;
    return {
        dynamic:
            dynamicRatio >= CRITICAL_THRESHOLD
                ? "critical"
                : dynamicRatio >= WARNING_THRESHOLD
                    ? "warning"
                    : "ok",
        session:
            sessionRatio >= CRITICAL_THRESHOLD
                ? "critical"
                : sessionRatio >= WARNING_THRESHOLD
                    ? "warning"
                    : "ok",
    };
}

export function canAllocateRules(
    state: BudgetState,
    dynamicCount: number,
    sessionCount: number,
    site?: string
): BudgetCheckResult {
    const dynamicRatio = (state.dynamicRuleCount + dynamicCount) / state.dynamicCeiling;
    const sessionRatio = (state.sessionRuleCount + sessionCount) / state.sessionCeiling;

    if (dynamicRatio > 1) {
        return { allowed: false, reason: "Exceeds dynamic rule budget" };
    }
    if (sessionRatio > 1) {
        return { allowed: false, reason: "Exceeds session rule budget" };
    }

    let warning: string | undefined;
    if (site) {
        const siteBudget = state.perSiteRules[site] ?? { dynamic: 0, session: 0, total: 0 };
        const projectedTotal = siteBudget.total + dynamicCount + sessionCount;
        if (projectedTotal > SOFT_PER_SITE_THRESHOLD) {
            warning = `Site ${site} is approaching threshold (${projectedTotal} rules)`;
        }
    }
    return { allowed: true, warning };
}

export function updateBudgetCounts(
    state: BudgetState,
    dynamicDelta: number,
    sessionDelta: number,
    site?: string
): BudgetState {
    const newState: BudgetState = { ...state };
    newState.dynamicRuleCount = Math.max(0, state.dynamicRuleCount + dynamicDelta);
    newState.sessionRuleCount = Math.max(0, state.sessionRuleCount + sessionDelta);

    if (site) {
        const siteBudget = state.perSiteRules[site] ?? { dynamic: 0, session: 0, total: 0 };
        const newDynamic = Math.max(0, siteBudget.dynamic + dynamicDelta);
        const newSession = Math.max(0, siteBudget.session + sessionDelta);
        newState.perSiteRules = {
            ...state.perSiteRules,
            [site]: {
                dynamic: newDynamic,
                session: newSession,
                total: newDynamic + newSession,
            },
        };
    }
    return newState;
}

export function getPerSiteRuleCount(state: BudgetState, site: string): PerSiteBudget {
    return state.perSiteRules[site] ?? { dynamic: 0, session: 0, total: 0 };
}

export function isPerSiteOverThreshold(state: BudgetState, site: string): boolean {
    const siteBudget = getPerSiteRuleCount(state, site);
    return siteBudget.total > SOFT_PER_SITE_THRESHOLD;
}

export function projectBudgetGrowth(
    state: BudgetState,
    additionalDynamic: number,
    additionalSession: number
): BudgetState {
    return {
        ...state,
        dynamicRuleCount: state.dynamicRuleCount + additionalDynamic,
        sessionRuleCount: state.sessionRuleCount + additionalSession,
    };
}

export function computePruneCandidates(state: BudgetState, currentSite: string): string[] {
    const sites = Object.keys(state.perSiteRules);
    const candidates: { site: string; ruleCount: number }[] = [];
    for (const site of sites) {
        if (site === currentSite) continue;
        const siteBudget = state.perSiteRules[site];
        candidates.push({
            site,
            ruleCount: siteBudget?.total ?? 0,
        });
    }
    candidates.sort((a, b) => a.ruleCount - b.ruleCount);
    return candidates.map((c) => c.site);
}

export interface RuleGroup {
    isPruned: boolean;
    lastUsed: number;
    [key: string]: unknown;
}

export interface PruneCandidate {
    site: string;
    ruleCount: number;
    lastUsed: number;
}

export function getLruPruneCandidates(
    compiledRuleGroups: Record<string, RuleGroup>,
    budget: BudgetState,
    currentSite: string,
    maxCandidates?: number
): PruneCandidate[] {
    const candidates: PruneCandidate[] = [];
    for (const site of Object.keys(budget.perSiteRules)) {
        if (site === currentSite) continue;
        const group = compiledRuleGroups[site];
        if (!group || group.isPruned) continue;
        const siteBudget = budget.perSiteRules[site];
        candidates.push({
            site,
            ruleCount: siteBudget?.total ?? 0,
            lastUsed: group.lastUsed,
        });
    }
    candidates.sort((a, b) => a.lastUsed - b.lastUsed);
    if (maxCandidates !== undefined) {
        return candidates.slice(0, maxCandidates);
    }
    return candidates;
}

export function pruneSiteFromBudget(state: BudgetState, site: string): BudgetState {
    const { [site]: _, ...remainingSites } = state.perSiteRules;
    return {
        ...state,
        perSiteRules: remainingSites,
    };
}
