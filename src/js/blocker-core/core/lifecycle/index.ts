// @ts-nocheck
import { DEFAULT_DYNAMIC_CEILING, DEFAULT_SESSION_CEILING } from "../budget/index.js";
import { DYNAMIC_RULE_MIN, SESSION_RULE_MIN } from "../types/index.js";
import type { StoredPolicy, SitePolicy } from "../policy/index.js";
import type { CompiledRule, RuleMappingEntry } from "../compiler/index.js";

export interface CompiledRuleGroup {
    site: string;
    rules: CompiledRule[];
    lastUsed: number;
    isPruned: boolean;
}

export interface IdAllocatorState {
    nextDynamicId: number;
    nextSessionId: number;
    freedDynamicIds: number[];
    freedSessionIds: number[];
}

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

export interface LifecycleState {
    policy: StoredPolicy;
    compiledRuleGroups: Record<string, CompiledRuleGroup>;
    idAllocator: IdAllocatorState;
    budget: BudgetState;
    ruleMapping: Record<string, RuleMappingEntry>;
    policyVersion: number;
}

export interface CreateInitialLifecycleStateOptions {
    policy: StoredPolicy;
    existingDynamicRules: CompiledRule[];
    existingSessionRules: CompiledRule[];
    savedState?: Partial<LifecycleState>;
}

export function createInitialLifecycleState(options: CreateInitialLifecycleStateOptions): LifecycleState {
    const { policy, existingDynamicRules, existingSessionRules, savedState } = options;
    const policyVersion = policy.version;
    const compiledRuleGroups: Record<string, CompiledRuleGroup> = {};
    for (const [site, sitePolicy] of Object.entries(policy.sites)) {
        compiledRuleGroups[site] = {
            site,
            rules: [],
            lastUsed: Date.now(),
            isPruned: false,
        };
    }
    const existingDynamicIds = existingDynamicRules.map(r => r.id);
    const existingSessionIds = existingSessionRules.map(r => r.id);
    const idAllocator: IdAllocatorState = savedState?.idAllocator ?? {
        nextDynamicId: existingDynamicIds.length > 0 ? Math.max(...existingDynamicIds) + 1 : DYNAMIC_RULE_MIN,
        nextSessionId: existingSessionIds.length > 0 ? Math.max(...existingSessionIds) + 1 : SESSION_RULE_MIN,
        freedDynamicIds: [],
        freedSessionIds: [],
    };
    const budget: BudgetState = savedState?.budget ?? {
        dynamicRuleCount: existingDynamicRules.length,
        sessionRuleCount: existingSessionRules.length,
        dynamicCeiling: DEFAULT_DYNAMIC_CEILING,
        sessionCeiling: DEFAULT_SESSION_CEILING,
        perSiteRules: {},
        globalOverridePool: Math.floor(DEFAULT_DYNAMIC_CEILING * 0.1),
    };
    const runtimePerSite = new Map<string, { dynamic: number; session: number }>();
    for (const rule of existingDynamicRules) {
        const condition = rule.condition;
        const site = condition.initiatorDomains?.[0];
        if (site) {
            const current = runtimePerSite.get(site) ?? { dynamic: 0, session: 0 };
            runtimePerSite.set(site, { dynamic: current.dynamic + 1, session: current.session });
        }
    }
    for (const rule of existingSessionRules) {
        const condition = rule.condition;
        const site = condition.initiatorDomains?.[0];
        if (site) {
            const current = runtimePerSite.get(site) ?? { dynamic: 0, session: 0 };
            runtimePerSite.set(site, { dynamic: current.dynamic, session: current.session + 1 });
        }
    }
    for (const site of Object.keys(policy.sites)) {
        const siteData = runtimePerSite.get(site) ?? { dynamic: 0, session: 0 };
        budget.perSiteRules[site] = {
            dynamic: siteData.dynamic,
            session: siteData.session,
            total: siteData.dynamic + siteData.session,
        };
    }
    return {
        policy,
        compiledRuleGroups,
        idAllocator,
        budget,
        ruleMapping: savedState?.ruleMapping ?? {},
        policyVersion,
    };
}

export interface ReconcileResult {
    needsFullRebuild: boolean;
    mismatchedRuleIds: number[];
    orphanRuntimeIds: number[];
}

export function reconcileState(
    currentState: LifecycleState,
    runtimeDynamicRules: CompiledRule[],
    runtimeSessionRules: CompiledRule[]
): ReconcileResult {
    const managedDynamicIds = new Set(
        Object.values(currentState.ruleMapping)
            .filter(m => m.ruleType === "dynamic")
            .map(m => m.ruleId)
    );
    const managedSessionIds = new Set(
        Object.values(currentState.ruleMapping)
            .filter(m => m.ruleType === "session")
            .map(m => m.ruleId)
    );
    const currentRuntimeDynamicIds = new Set(runtimeDynamicRules.map(r => r.id));
    const currentRuntimeSessionIds = new Set(runtimeSessionRules.map(r => r.id));
    const orphanedDynamicIds = [...managedDynamicIds].filter(id => !currentRuntimeDynamicIds.has(id));
    const orphanedSessionIds = [...managedSessionIds].filter(id => !currentRuntimeSessionIds.has(id));
    const orphanRuntimeDynamicIds = [...currentRuntimeDynamicIds].filter(id => !managedDynamicIds.has(id));
    const orphanRuntimeSessionIds = [...currentRuntimeSessionIds].filter(id => !managedSessionIds.has(id));
    return {
        needsFullRebuild: orphanedDynamicIds.length > 0 || orphanedSessionIds.length > 0 || orphanRuntimeDynamicIds.length > 0 || orphanRuntimeSessionIds.length > 0,
        mismatchedRuleIds: [...orphanedDynamicIds, ...orphanedSessionIds],
        orphanRuntimeIds: [...orphanRuntimeDynamicIds, ...orphanRuntimeSessionIds],
    };
}

export function updateSitePolicy(currentState: LifecycleState, site: string, newPolicy: SitePolicy): LifecycleState {
    const updatedPolicy: StoredPolicy = {
        ...currentState.policy,
        sites: {
            ...currentState.policy.sites,
            [site]: newPolicy,
        },
        updatedAt: Date.now(),
        version: currentState.policy.version + 1,
    };
    return {
        ...currentState,
        policy: updatedPolicy,
        policyVersion: updatedPolicy.version,
    };
}

export function markSiteCompiled(
    currentState: LifecycleState,
    site: string,
    rules: CompiledRule[],
    mapping: Record<string, RuleMappingEntry>
): LifecycleState {
    const existingGroup = currentState.compiledRuleGroups[site];
    const existingRuleCount = existingGroup?.rules.length ?? 0;
    const existingDynamicCount = existingGroup?.rules.filter(r => r.id < 1000000).length ?? 0;
    const existingSessionCount = existingGroup?.rules.filter(r => r.id >= 1000000).length ?? 0;
    const newDynamicCount = rules.filter(r => r.id < 1000000).length;
    const newSessionCount = rules.filter(r => r.id >= 1000000).length;
    const updatedGroup: CompiledRuleGroup = {
        ...existingGroup,
        site,
        rules: rules,
        lastUsed: Date.now(),
        isPruned: false,
    };
    const updatedGroups = {
        ...currentState.compiledRuleGroups,
        [site]: updatedGroup,
    };
    const updatedBudget: BudgetState = {
        ...currentState.budget,
        perSiteRules: {
            ...currentState.budget.perSiteRules,
            [site]: {
                dynamic: newDynamicCount,
                session: newSessionCount,
                total: rules.length,
            },
        },
        dynamicRuleCount: Math.max(0, currentState.budget.dynamicRuleCount - existingDynamicCount + newDynamicCount),
        sessionRuleCount: Math.max(0, currentState.budget.sessionRuleCount - existingSessionCount + newSessionCount),
    };
    return {
        ...currentState,
        compiledRuleGroups: updatedGroups,
        ruleMapping: { ...currentState.ruleMapping, ...mapping },
        budget: updatedBudget,
    };
}

export function markSitePruned(currentState: LifecycleState, site: string): LifecycleState {
    const existingGroup = currentState.compiledRuleGroups[site];
    if (!existingGroup) return currentState;
    const prunedRuleCount = existingGroup.rules.length;
    const dynamicRulesCount = existingGroup.rules.filter(r => r.id < 1000000).length;
    const sessionRulesCount = existingGroup.rules.filter(r => r.id >= 1000000).length;
    const updatedGroup: CompiledRuleGroup = {
        ...existingGroup,
        rules: [],
        isPruned: true,
    };
    const updatedBudget: BudgetState = {
        ...currentState.budget,
        perSiteRules: {
            ...currentState.budget.perSiteRules,
            [site]: { dynamic: 0, session: 0, total: 0 },
        },
        dynamicRuleCount: Math.max(0, currentState.budget.dynamicRuleCount - dynamicRulesCount),
        sessionRuleCount: Math.max(0, currentState.budget.sessionRuleCount - sessionRulesCount),
    };
    return {
        ...currentState,
        compiledRuleGroups: {
            ...currentState.compiledRuleGroups,
            [site]: updatedGroup,
        },
        budget: updatedBudget,
    };
}

export function getSiteNeedsRecompile(currentState: LifecycleState, site: string): boolean {
    const group = currentState.compiledRuleGroups[site];
    const hasStoredPolicy = currentState.policy.sites[site] !== undefined;
    return hasStoredPolicy && (group === undefined || group.isPruned === true);
}

export function snapshotState(state: LifecycleState): LifecycleState {
    return JSON.parse(JSON.stringify(state));
}

export function restoreFromSnapshot(snapshot: LifecycleState): LifecycleState {
    return snapshot;
}