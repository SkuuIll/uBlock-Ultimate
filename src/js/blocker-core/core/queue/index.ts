// @ts-nocheck
import { compileSitePolicy } from "../compiler/index.js";
import type { SitePolicy, CompiledRule, RuleMappingEntry, CompileSitePolicyResult } from "../compiler/index.js";
import type { LifecycleState } from "../lifecycle/index.js";

let globalPolicyVersion = 0;

export function setPolicyVersion(version: number): void {
    globalPolicyVersion = version;
}

export function getPolicyVersion(): number {
    return globalPolicyVersion;
}

export type UpdateRequestType = "add" | "update" | "remove";

export interface UpdateRequest {
    id: string;
    type: UpdateRequestType;
    site: string;
    policy: SitePolicy | null;
    policyVersion: number;
    timestamp: number;
    previousRuleIds?: string[];
}

export interface CompiledUpdateRequest {
    request: UpdateRequest;
    compiledRules: {
        dynamic: CompiledRule[];
        session: CompiledRule[];
    };
    mapping: Record<string, RuleMappingEntry>;
}

export function createUpdateRequest(site: string, policy: SitePolicy | null, type: UpdateRequestType): UpdateRequest {
    return {
        id: `${site}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        type,
        site,
        policy,
        policyVersion: getPolicyVersion(),
        timestamp: Date.now(),
    };
}

export function compileUpdateRequest(request: UpdateRequest, startDynamicId: number, startSessionId: number): CompiledUpdateRequest | null {
    if (request.type === "remove") {
        return {
            request,
            compiledRules: { dynamic: [], session: [] },
            mapping: {},
        };
    }
    if (!request.policy) return null;
    const result = compileSitePolicy({
        site: request.site,
        policy: request.policy,
        startDynamicId,
        startSessionId,
    });
    return {
        request,
        compiledRules: {
            dynamic: result.dynamicRules,
            session: result.sessionRules,
        },
        mapping: result.mapping,
    };
}

export function isStaleRequest(request: UpdateRequest, currentVersion: number): boolean {
    return request.policyVersion < currentVersion;
}

export function shouldDebounce(prevRequest: UpdateRequest, newRequest: UpdateRequest, debounceMs: number): boolean {
    return (
        prevRequest.site === newRequest.site &&
        newRequest.timestamp - prevRequest.timestamp < debounceMs
    );
}

export function mergeRequests(prev: UpdateRequest, next: UpdateRequest): UpdateRequest {
    return {
        ...next,
        previousRuleIds: [...(prev.previousRuleIds ?? []), ...(next.previousRuleIds ?? [])],
        policyVersion: Math.max(prev.policyVersion, next.policyVersion),
    };
}

export interface QueueState {
    pending: CompiledUpdateRequest[];
    processing: CompiledUpdateRequest | null;
    completed: string[];
    failed: string[];
}

export function createEmptyQueueState(): QueueState {
    return {
        pending: [],
        processing: null,
        completed: [],
        failed: [],
    };
}

export function enqueue(state: QueueState, update: CompiledUpdateRequest, maxSize: number): QueueState {
    const newPending = [...state.pending];
    const existingIndex = newPending.findIndex(u => u.request.site === update.request.site);
    if (existingIndex >= 0) {
        newPending[existingIndex] = update;
    } else {
        if (newPending.length >= maxSize) {
            newPending.shift();
        }
        newPending.push(update);
    }
    return {
        ...state,
        pending: newPending,
    };
}

export function startProcessing(state: QueueState): QueueState {
    if (state.pending.length === 0) return state;
    const [next, ...remaining] = state.pending;
    return {
        ...state,
        pending: remaining,
        processing: next,
    };
}

export function completeProcessing(state: QueueState): QueueState {
    if (!state.processing) return state;
    return {
        ...state,
        processing: null,
        completed: [...state.completed, state.processing.request.id],
    };
}

export function failProcessing(state: QueueState, error: unknown): QueueState {
    if (!state.processing) return state;
    return {
        ...state,
        processing: null,
        failed: [...state.failed, state.processing.request.id],
    };
}

export function requeue(state: QueueState): QueueState {
    if (!state.processing) return state;
    return {
        ...state,
        pending: [state.processing, ...state.pending],
        processing: null,
    };
}

export function clearCompleted(state: QueueState): QueueState {
    return {
        ...state,
        completed: [],
    };
}

export function getNextPending(state: QueueState): CompiledUpdateRequest | null {
    return state.pending[0] ?? null;
}

export function hasPendingWork(state: QueueState): boolean {
    return state.pending.length > 0 || state.processing !== null;
}

export interface TransactionSnapshot {
    ruleMapping: Record<string, RuleMappingEntry>;
    budget: {
        dynamicRuleCount: number;
        sessionRuleCount: number;
        perSiteRules: Record<string, { dynamic: number; session: number; total: number }>;
        dynamicCeiling: number;
        sessionCeiling: number;
        globalOverridePool: number;
    };
    compiledRuleGroups: Record<string, { site: string; rules: CompiledRule[]; lastUsed: number; isPruned: boolean }>;
    idAllocator: { nextDynamicId: number; nextSessionId: number; freedDynamicIds: number[]; freedSessionIds: number[] };
}

export interface TransactionPlanned {
    ruleMapping: Record<string, RuleMappingEntry>;
    budget: {
        dynamicRuleCount: number;
        sessionRuleCount: number;
        perSiteRules: Record<string, { dynamic: number; session: number; total: number }>;
        dynamicCeiling: number;
        sessionCeiling: number;
        globalOverridePool: number;
    };
    compiledRuleGroups: Record<string, { site: string; rules: CompiledRule[]; lastUsed: number; isPruned: boolean }>;
    idAllocator: { nextDynamicId: number; nextSessionId: number; freedDynamicIds: number[]; freedSessionIds: number[] };
}

export interface Transaction {
    snapshot: TransactionSnapshot;
    planned: TransactionPlanned;
    queuedUpdate: CompiledUpdateRequest;
    isApplied: boolean;
}

export function createTransaction(state: LifecycleState, queuedUpdate: CompiledUpdateRequest): Transaction {
    const site = queuedUpdate.request.site;
    const previousSiteBudget = state.budget.perSiteRules[site] ?? { dynamic: 0, session: 0, total: 0 };
    const newDynamicCount = queuedUpdate.compiledRules.dynamic.length;
    const newSessionCount = queuedUpdate.compiledRules.session.length;
    const newTotalCount = newDynamicCount + newSessionCount;
    const allRules = [...queuedUpdate.compiledRules.dynamic, ...queuedUpdate.compiledRules.session];
    const siteMapping: Record<string, RuleMappingEntry> = {};
    for (const [key, value] of Object.entries(queuedUpdate.mapping)) {
        if (key.startsWith(`${site}|`)) {
            siteMapping[key] = value;
        }
    }
    const newMapping: Record<string, RuleMappingEntry> = { ...state.ruleMapping };
    for (const key of Object.keys(newMapping)) {
        if (newMapping[key]?.policyKey.startsWith(`${site}|`)) {
            delete newMapping[key];
        }
    }
    for (const [key, value] of Object.entries(siteMapping)) {
        newMapping[key] = value;
    }
    const plannedBudget = {
        dynamicRuleCount: Math.max(0, state.budget.dynamicRuleCount - previousSiteBudget.dynamic + newDynamicCount),
        sessionRuleCount: Math.max(0, state.budget.sessionRuleCount - previousSiteBudget.session + newSessionCount),
        perSiteRules: {
            ...state.budget.perSiteRules,
            [site]: {
                dynamic: newDynamicCount,
                session: newSessionCount,
                total: newTotalCount,
            },
        },
        dynamicCeiling: state.budget.dynamicCeiling,
        sessionCeiling: state.budget.sessionCeiling,
        globalOverridePool: state.budget.globalOverridePool,
    };
    const plannedCompiledGroups = {
        ...state.compiledRuleGroups,
        [site]: {
            site,
            rules: allRules,
            lastUsed: Date.now(),
            isPruned: false,
        },
    };
    const plannedIdAllocator = {
        nextDynamicId: Math.max(state.idAllocator.nextDynamicId, Math.max(...queuedUpdate.compiledRules.dynamic.map(r => r.id), 0) + 1),
        nextSessionId: Math.max(state.idAllocator.nextSessionId, Math.max(...queuedUpdate.compiledRules.session.map(r => r.id), 0) + 1),
        freedDynamicIds: state.idAllocator.freedDynamicIds,
        freedSessionIds: state.idAllocator.freedSessionIds,
    };
    return {
        snapshot: {
            ruleMapping: JSON.parse(JSON.stringify(state.ruleMapping)),
            budget: {
                dynamicRuleCount: state.budget.dynamicRuleCount,
                sessionRuleCount: state.budget.sessionRuleCount,
                perSiteRules: JSON.parse(JSON.stringify(state.budget.perSiteRules)),
                dynamicCeiling: state.budget.dynamicCeiling,
                sessionCeiling: state.budget.sessionCeiling,
                globalOverridePool: state.budget.globalOverridePool,
            },
            compiledRuleGroups: JSON.parse(JSON.stringify(state.compiledRuleGroups)),
            idAllocator: JSON.parse(JSON.stringify(state.idAllocator)),
        },
        planned: {
            ruleMapping: newMapping,
            budget: plannedBudget,
            compiledRuleGroups: plannedCompiledGroups,
            idAllocator: plannedIdAllocator,
        },
        queuedUpdate,
        isApplied: false,
    };
}

export function commitTransaction(currentState: LifecycleState, transaction: Transaction): Partial<LifecycleState> {
    transaction.isApplied = true;
    return {
        ruleMapping: transaction.planned.ruleMapping,
        budget: transaction.planned.budget as typeof currentState.budget,
        compiledRuleGroups: transaction.planned.compiledRuleGroups as typeof currentState.compiledRuleGroups,
        idAllocator: transaction.planned.idAllocator as typeof currentState.idAllocator,
    };
}

export function rollbackTransaction(currentState: LifecycleState, transaction: Transaction): Partial<LifecycleState> {
    transaction.isApplied = false;
    return {
        ruleMapping: transaction.snapshot.ruleMapping,
        budget: transaction.snapshot.budget as typeof currentState.budget,
        compiledRuleGroups: transaction.snapshot.compiledRuleGroups as typeof currentState.compiledRuleGroups,
        idAllocator: transaction.snapshot.idAllocator as typeof currentState.idAllocator,
    };
}