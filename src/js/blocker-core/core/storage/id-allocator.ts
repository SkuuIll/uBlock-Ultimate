// @ts-nocheck
import {
    DYNAMIC_RULE_MIN,
    DYNAMIC_RULE_MAX,
    SESSION_RULE_MIN,
    SESSION_RULE_MAX,
} from "../types/index.js";

export type RuleType = "dynamic" | "session";

export interface AllocatorState {
    nextDynamicId: number;
    nextSessionId: number;
    freedDynamicIds: number[];
    freedSessionIds: number[];
}

export interface PolicyMapping {
    policyKey: string;
    [key: string]: unknown;
}

export function createDefaultAllocatorState(): AllocatorState {
    return {
        nextDynamicId: DYNAMIC_RULE_MIN,
        nextSessionId: SESSION_RULE_MIN,
        freedDynamicIds: [],
        freedSessionIds: [],
    };
}

export function allocateId(state: AllocatorState, ruleType: RuleType): number {
    const pool = ruleType === "dynamic" ? state.freedDynamicIds : state.freedSessionIds;
    const nextKey = ruleType === "dynamic" ? "nextDynamicId" : "nextSessionId";
    const max = ruleType === "dynamic" ? DYNAMIC_RULE_MAX : SESSION_RULE_MAX;
    const min = ruleType === "dynamic" ? DYNAMIC_RULE_MIN : SESSION_RULE_MIN;

    if (pool.length > 0) {
        return pool.shift()!;
    }
    if (state[nextKey] <= max) {
        return state[nextKey]++;
    }
    return -1;
}

export function freeId(state: AllocatorState, ruleId: number, ruleType: RuleType): void {
    if (ruleType === "dynamic") {
        if (ruleId >= DYNAMIC_RULE_MIN && ruleId <= DYNAMIC_RULE_MAX) {
            state.freedDynamicIds.push(ruleId);
        }
    } else {
        if (ruleId >= SESSION_RULE_MIN && ruleId <= SESSION_RULE_MAX) {
            state.freedSessionIds.push(ruleId);
        }
    }
}

export function buildMapping(mappings: PolicyMapping[]): Map<string, PolicyMapping> {
    const map = new Map<string, PolicyMapping>();
    for (const m of mappings) {
        map.set(m.policyKey, m);
    }
    return map;
}

export function serializeMapping(map: Map<string, PolicyMapping>): Record<string, PolicyMapping> {
    const result: Record<string, PolicyMapping> = {};
    for (const [key, value] of map) {
        result[key] = value;
    }
    return result;
}

export function deserializeMapping(obj: Record<string, PolicyMapping>): Map<string, PolicyMapping> {
    const map = new Map<string, PolicyMapping>();
    for (const [key, value] of Object.entries(obj)) {
        map.set(key, value);
    }
    return map;
}

export interface Rule {
    id: number;
    [key: string]: unknown;
}

export function getMaxRuleId(rules: Rule[], ruleType: RuleType): number {
    const min = ruleType === "dynamic" ? DYNAMIC_RULE_MIN : SESSION_RULE_MIN;
    const max = ruleType === "dynamic" ? DYNAMIC_RULE_MAX : SESSION_RULE_MAX;
    let maxId = min - 1;
    for (const rule of rules) {
        if (rule.id >= min && rule.id <= max && rule.id > maxId) {
            maxId = rule.id;
        }
    }
    return maxId;
}

export function rebuildAllocatorState(
    existingDynamicRules: Rule[],
    existingSessionRules: Rule[],
    savedState: AllocatorState | null
): AllocatorState {
    if (savedState) {
        return savedState;
    }
    const maxDynamic = getMaxRuleId(existingDynamicRules, "dynamic");
    const maxSession = getMaxRuleId(existingSessionRules, "session");
    return {
        nextDynamicId: maxDynamic + 1,
        nextSessionId: maxSession + 1,
        freedDynamicIds: [],
        freedSessionIds: [],
    };
}
