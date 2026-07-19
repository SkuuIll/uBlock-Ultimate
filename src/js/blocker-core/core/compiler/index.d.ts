// @ts-nocheck
import { type SitePolicy, type CompiledRule, type ResourceType, type RuleScope } from "../types/index.js";
export interface CompilerOptions {
    site: string;
    policy: SitePolicy;
    startDynamicId: number;
    startSessionId: number;
    includeTemporary?: boolean;
    includePermanent?: boolean;
    excludeMainFrame?: boolean;
}
export interface CompilationResult {
    dynamicRules: CompiledRule[];
    sessionRules: CompiledRule[];
    nextDynamicId: number;
    nextSessionId: number;
    mapping: Record<string, {
        policyKey: string;
        ruleId: number;
        ruleType: "dynamic" | "session";
    }>;
}
export interface CompiledRuleDescriptor {
    domains: string[];
    resourceTypes: ResourceType[];
    action: "allow" | "block";
    scope: RuleScope;
    excludedDomains?: string[];
    priority: number;
}
export declare function generatePolicyKey(descriptor: CompiledRuleDescriptor, site: string): string;
export declare function generateDefaultRuleKey(site: string, resourceType: ResourceType, action: "allow" | "block"): string;
export declare function compileSitePolicy(options: CompilerOptions): CompilationResult;
export declare function generateRuleDescriptors(policy: SitePolicy, site: string, excludeMainFrame: boolean): CompiledRuleDescriptor[];
