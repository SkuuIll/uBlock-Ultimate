// @ts-nocheck
import { type RuleScope } from "../types/index.js";
export interface PriorityDecision {
    action: "allow" | "block";
    priority: number;
    scope: RuleScope;
    isEffective: boolean;
}
export interface ConflictEntry {
    domain: string;
    resourceTypes: string[];
    conflictingActions: ("allow" | "block")[];
    scopes: RuleScope[];
    resolvedAction: "allow" | "block";
    resolvedScope: RuleScope;
}
export declare function resolvePriority(scopes: RuleScope[], actions: ("allow" | "block")[]): PriorityDecision;
export declare function computeRulePriority(scope: RuleScope, action: "allow" | "block"): number;
export declare function detectConflicts(rules: Array<{
    domain: string;
    resourceTypes: string[];
    action: "allow" | "block";
    scope: RuleScope;
}>): ConflictEntry[];
export declare function normalizeOverlaps(rules: Array<{
    domain: string;
    resourceTypes: string[];
    action: "allow" | "block";
    scope: RuleScope;
    excludedDomains?: string[];
}>): Array<{
    domain: string;
    resourceTypes: string[];
    action: "allow" | "block";
    scope: RuleScope;
    priority: number;
    excludedDomains?: string[];
}>;
export declare function evaluateEffectiveDecision(domain: string, resourceType: string, sitePolicy: {
    resourceDefaults: Record<string, "allow" | "block">;
    rules: Record<string, {
        allow: boolean;
        temporary?: boolean;
        excludedDomains?: string[];
        resourceTypes?: string[];
    }>;
}): {
    action: "allow" | "block";
    scope: RuleScope;
    isOverride: boolean;
};
