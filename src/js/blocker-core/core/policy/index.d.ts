// @ts-nocheck
import { type ResourceType, type DomainRule, type SitePolicy, type Profile, type StoredPolicy } from "../types/index.js";
export declare function normalizeSite(site: string): string;
export declare function normalizeDomain(domain: string): string;
export declare function normalizeResourceTypes(types?: ResourceType[]): ResourceType[] | undefined;
export declare function normalizeExcludedDomains(domains?: string[]): string[] | undefined;
export declare function normalizeDomainRule(rule: Partial<DomainRule>): DomainRule;
export declare function normalizeSitePolicy(policy: Partial<SitePolicy>): SitePolicy;
export declare function validateProfile(profile?: string): profile is Profile;
export declare function validateResourceType(type: string): type is ResourceType;
export declare function validateDomainRule(rule: unknown): rule is DomainRule;
export declare function validateSitePolicy(policy: unknown): policy is SitePolicy;
export declare function validateStoredPolicy(policy: unknown): policy is StoredPolicy;
export declare function createDefaultStoredPolicy(): StoredPolicy;
export declare function mergeSitePolicy(existing: SitePolicy, updates: Partial<SitePolicy>): SitePolicy;
export declare function getPolicyVersion(policy: StoredPolicy): number;
export declare function incrementPolicyVersion(policy: StoredPolicy): StoredPolicy;
