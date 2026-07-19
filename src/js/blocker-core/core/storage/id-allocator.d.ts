// @ts-nocheck
import { type IDAllocatorState, type RuleMapping } from "../types/index.js";
export declare function createDefaultAllocatorState(): IDAllocatorState;
export declare function allocateId(state: IDAllocatorState, ruleType: "dynamic" | "session"): number;
export declare function freeId(state: IDAllocatorState, ruleId: number, ruleType: "dynamic" | "session"): void;
export declare function buildMapping(mappings: Array<{
    policyKey: string;
    ruleId: number;
    ruleType: "dynamic" | "session";
}>): Map<string, RuleMapping>;
export declare function serializeMapping(map: Map<string, RuleMapping>): Record<string, RuleMapping>;
export declare function deserializeMapping(obj: Record<string, RuleMapping>): Map<string, RuleMapping>;
export declare function getMaxRuleId(rules: Array<{
    id: number;
}>, ruleType: "dynamic" | "session"): number;
export declare function rebuildAllocatorState(existingDynamicRules: Array<{
    id: number;
}>, existingSessionRules: Array<{
    id: number;
}>, savedState?: IDAllocatorState): IDAllocatorState;
