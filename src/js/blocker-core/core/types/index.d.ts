// @ts-nocheck
export type ResourceType = "script" | "image" | "stylesheet" | "font" | "xmlhttprequest" | "sub_frame" | "main_frame" | "media";
export declare const RESOURCE_TYPES: ResourceType[];
export declare const RESOURCE_TYPE_TO_DNR: Record<ResourceType, string>;
export type RuleScope = "permanent" | "temporary" | "profile" | "static";
export type Profile = "strict" | "balanced" | "relaxed" | "custom";
export interface DomainRule {
    allow: boolean;
    resourceTypes?: ResourceType[];
    temporary?: boolean;
    excludedDomains?: string[];
}
export interface SitePolicy {
    site: string;
    resourceDefaults: Partial<Record<ResourceType, "allow" | "block">>;
    rules: Record<string, DomainRule>;
    profile: Profile;
    enabled?: boolean;
}
export interface StoredPolicy {
    version: number;
    sites: Record<string, SitePolicy>;
    createdAt: number;
    updatedAt: number;
    schemaVersion?: number;
}
export interface CompiledRuleGroup {
    site: string;
    rules: CompiledRule[];
    lastUsed: number;
    isPruned?: boolean;
}
export interface CompiledRule {
    id: number;
    priority: number;
    action: {
        type: "allow" | "block";
    };
    condition: {
        initiatorDomains?: string[];
        domains?: string[];
        resourceTypes?: string[];
        excludedDomains?: string[];
    };
}
export interface PolicyKey {
    site: string;
    domains: string[];
    action: "allow" | "block";
    resourceTypes: ResourceType[];
    scope: RuleScope;
    exclusions: string[];
}
export interface RuleMapping {
    policyKey: string;
    ruleId: number;
    ruleType: "dynamic" | "session";
}
export interface IDAllocatorState {
    nextDynamicId: number;
    nextSessionId: number;
    freedDynamicIds: number[];
    freedSessionIds: number[];
}
export interface BudgetState {
    dynamicRuleCount: number;
    sessionRuleCount: number;
    dynamicCeiling: number;
    sessionCeiling: number;
    perSiteRules: Record<string, {
        dynamic: number;
        session: number;
        total: number;
    }>;
    globalOverridePool: number;
}
export interface SimpleBudgetState {
    dynamicRuleCount: number;
    sessionRuleCount: number;
    perSiteRules: Record<string, number>;
}
export declare const PROFILE_DEFAULTS: Record<Profile, Partial<Record<ResourceType, "allow" | "block">>>;
export declare const PRIORITY_MAP: Record<RuleScope, number>;
export declare const DYNAMIC_RULE_MIN = 1;
export declare const DYNAMIC_RULE_MAX = 999999;
export declare const SESSION_RULE_MIN = 1000000;
export declare const SESSION_RULE_MAX = 1999999;
