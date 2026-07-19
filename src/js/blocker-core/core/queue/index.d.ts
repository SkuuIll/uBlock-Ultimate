// @ts-nocheck
import type { CompiledRule, SitePolicy, BudgetState } from "../types/index.js";
export interface UpdateRequest {
    id: string;
    type: "add" | "remove" | "update";
    site: string;
    policy?: SitePolicy;
    policyVersion: number;
    timestamp: number;
    previousRuleIds?: number[];
}
export interface QueuedUpdate {
    request: UpdateRequest;
    compiledRules: {
        dynamic: CompiledRule[];
        session: CompiledRule[];
    };
    mapping: Record<string, {
        policyKey: string;
        ruleId: number;
        ruleType: "dynamic" | "session";
    }>;
}
export interface QueueState {
    pending: QueuedUpdate[];
    processing: QueuedUpdate | null;
    completed: string[];
    failed: string[];
    current?: string;
}
export interface Transaction {
    snapshot: {
        ruleMapping: Record<string, {
            policyKey: string;
            ruleId: number;
            ruleType: "dynamic" | "session";
        }>;
        budget: {
            dynamicRuleCount: number;
            sessionRuleCount: number;
            perSiteRules: Record<string, {
                dynamic: number;
                session: number;
                total: number;
            }>;
            dynamicCeiling: number;
            sessionCeiling: number;
            globalOverridePool: number;
        };
        compiledRuleGroups: Record<string, {
            site: string;
            rules: CompiledRule[];
            lastUsed: number;
            isPruned?: boolean;
        }>;
        idAllocator: {
            nextDynamicId: number;
            nextSessionId: number;
            freedDynamicIds: number[];
            freedSessionIds: number[];
        };
    };
    planned: {
        ruleMapping: Record<string, {
            policyKey: string;
            ruleId: number;
            ruleType: "dynamic" | "session";
        }>;
        budget: {
            dynamicRuleCount: number;
            sessionRuleCount: number;
            perSiteRules: Record<string, {
                dynamic: number;
                session: number;
                total: number;
            }>;
            dynamicCeiling: number;
            sessionCeiling: number;
            globalOverridePool: number;
        };
        compiledRuleGroups: Record<string, {
            site: string;
            rules: CompiledRule[];
            lastUsed: number;
            isPruned?: boolean;
        }>;
        idAllocator: {
            nextDynamicId: number;
            nextSessionId: number;
            freedDynamicIds: number[];
            freedSessionIds: number[];
        };
    };
    queuedUpdate: QueuedUpdate;
    isApplied: boolean;
}
export interface QueueOptions {
    debounceMs?: number;
    maxQueueSize?: number;
}
export declare function setPolicyVersion(version: number): void;
export declare function getPolicyVersion(): number;
export declare function createUpdateRequest(site: string, policy: SitePolicy | undefined, type: "add" | "remove" | "update"): UpdateRequest;
export declare function compileUpdateRequest(request: UpdateRequest, startDynamicId: number, startSessionId: number): QueuedUpdate | null;
export declare function isStaleRequest(request: UpdateRequest, currentVersion: number): boolean;
export declare function shouldDebounce(prevRequest: UpdateRequest, newRequest: UpdateRequest, debounceMs: number): boolean;
export declare function mergeRequests(prev: UpdateRequest, next: UpdateRequest): UpdateRequest;
export declare function createEmptyQueueState(): QueueState;
export declare function enqueue(state: QueueState, update: QueuedUpdate, maxSize: number): QueueState;
export declare function startProcessing(state: QueueState): QueueState;
export declare function completeProcessing(state: QueueState): QueueState;
export declare function failProcessing(state: QueueState, error: string): QueueState;
export declare function requeue(state: QueueState): QueueState;
export declare function clearCompleted(state: QueueState): QueueState;
export declare function getNextPending(state: QueueState): QueuedUpdate | null;
export declare function hasPendingWork(state: QueueState): boolean;
export declare function createTransaction(state: {
    ruleMapping: Record<string, {
        policyKey: string;
        ruleId: number;
        ruleType: "dynamic" | "session";
    }>;
    budget: BudgetState;
    compiledRuleGroups: Record<string, {
        site: string;
        rules: CompiledRule[];
        lastUsed: number;
        isPruned?: boolean;
    }>;
    idAllocator: {
        nextDynamicId: number;
        nextSessionId: number;
        freedDynamicIds: number[];
        freedSessionIds: number[];
    };
}, queuedUpdate: QueuedUpdate): Transaction;
export declare function commitTransaction(currentState: {
    ruleMapping: Record<string, {
        policyKey: string;
        ruleId: number;
        ruleType: "dynamic" | "session";
    }>;
    budget: BudgetState;
    compiledRuleGroups: Record<string, {
        site: string;
        rules: CompiledRule[];
        lastUsed: number;
        isPruned?: boolean;
    }>;
    idAllocator: {
        nextDynamicId: number;
        nextSessionId: number;
        freedDynamicIds: number[];
        freedSessionIds: number[];
    };
}, transaction: Transaction): {
    ruleMapping: Record<string, {
        policyKey: string;
        ruleId: number;
        ruleType: "dynamic" | "session";
    }>;
    budget: BudgetState;
    compiledRuleGroups: Record<string, {
        site: string;
        rules: CompiledRule[];
        lastUsed: number;
        isPruned?: boolean;
    }>;
    idAllocator: {
        nextDynamicId: number;
        nextSessionId: number;
        freedDynamicIds: number[];
        freedSessionIds: number[];
    };
};
export declare function rollbackTransaction(currentState: {
    ruleMapping: Record<string, {
        policyKey: string;
        ruleId: number;
        ruleType: "dynamic" | "session";
    }>;
    budget: BudgetState;
    compiledRuleGroups: Record<string, {
        site: string;
        rules: CompiledRule[];
        lastUsed: number;
        isPruned?: boolean;
    }>;
    idAllocator: {
        nextDynamicId: number;
        nextSessionId: number;
        freedDynamicIds: number[];
        freedSessionIds: number[];
    };
}, transaction: Transaction): {
    ruleMapping: Record<string, {
        policyKey: string;
        ruleId: number;
        ruleType: "dynamic" | "session";
    }>;
    budget: BudgetState;
    compiledRuleGroups: Record<string, {
        site: string;
        rules: CompiledRule[];
        lastUsed: number;
        isPruned?: boolean;
    }>;
    idAllocator: {
        nextDynamicId: number;
        nextSessionId: number;
        freedDynamicIds: number[];
        freedSessionIds: number[];
    };
};
