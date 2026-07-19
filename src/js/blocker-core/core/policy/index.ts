// @ts-nocheck
import { PROFILE_DEFAULTS, RESOURCE_TYPES } from "../types/index.js";

export type ResourceType = "script" | "image" | "stylesheet" | "font" | "xmlhttprequest" | "sub_frame" | "main_frame" | "media";
export type ProfileType = "strict" | "balanced" | "relaxed" | "custom";
export type ActionType = "allow" | "block";
export type ScopeType = "temporary" | "permanent";

export interface DomainRule {
    allow: boolean;
    resourceTypes?: ResourceType[];
    temporary: boolean;
    excludedDomains?: string[];
}

export interface SitePolicy {
    site: string;
    resourceDefaults: Record<ResourceType, ActionType>;
    rules: Record<string, DomainRule>;
    profile: ProfileType;
}

export interface StoredPolicy {
    version: number;
    sites: Record<string, SitePolicy>;
    createdAt: number;
    updatedAt: number;
}

export function normalizeSite(site: string): string {
    try {
        const url = new URL(site.startsWith("http") ? site : `https://${site}`);
        return url.hostname.toLowerCase();
    } catch (e) {
        console.warn('[uBR] policy: normalizeSite failed', e);
        return site.toLowerCase();
    }
}

export function normalizeDomain(domain: string): string {
    return domain.toLowerCase().replace(/^(https?:\/\/)?(www\.)?/, "").replace(/\/.*$/, "").replace(/:\d+$/, "");
}

export function normalizeResourceTypes(types: string[] | undefined): string[] | undefined {
    if (!types || types.length === 0) return undefined;
    const normalized = types.map((t) => t.toLowerCase());
    const unique = [...new Set(normalized)];
    return unique.length > 0 ? unique : undefined;
}

export function normalizeExcludedDomains(domains: string[] | undefined): string[] | undefined {
    if (!domains || domains.length === 0) return undefined;
    const normalized = domains.map(normalizeDomain).filter((d) => d.length > 0);
    return normalized.length > 0 ? [...new Set(normalized)] : undefined;
}

export function normalizeDomainRule(rule: DomainRule): DomainRule {
    return {
        allow: rule.allow ?? false,
        resourceTypes: normalizeResourceTypes(rule.resourceTypes as string[]) as ResourceType[] | undefined,
        temporary: rule.temporary ?? false,
        excludedDomains: normalizeExcludedDomains(rule.excludedDomains),
    };
}

export function normalizeSitePolicy(policy: Partial<SitePolicy>): SitePolicy {
    const site = normalizeSite(policy.site ?? "");
    const profile = validateProfile(policy.profile) ? (policy.profile as ProfileType) : "balanced";
    const resourceDefaults: Record<ResourceType, ActionType> = {} as Record<ResourceType, ActionType>;
    const defaults = PROFILE_DEFAULTS[profile];
    for (const type of RESOURCE_TYPES) {
        if (policy.resourceDefaults?.[type as ResourceType]) {
            resourceDefaults[type as ResourceType] = policy.resourceDefaults[type as ResourceType] as ActionType;
        } else if (defaults[type as ResourceType]) {
            resourceDefaults[type as ResourceType] = defaults[type as ResourceType] as ActionType;
        }
    }
    const rules: Record<string, DomainRule> = {};
    if (policy.rules) {
        for (const [domain, rule] of Object.entries(policy.rules)) {
            if (rule && (rule.allow !== undefined || rule.resourceTypes)) {
                rules[normalizeDomain(domain)] = normalizeDomainRule(rule);
            }
        }
    }
    return {
        site,
        resourceDefaults,
        rules,
        profile,
    };
}

export function validateProfile(profile: string | undefined): profile is ProfileType {
    return ["strict", "balanced", "relaxed", "custom"].includes(profile ?? "");
}

export function validateResourceType(type: string): type is ResourceType {
    return RESOURCE_TYPES.includes(type as ResourceType);
}

export function validateDomainRule(rule: unknown): rule is DomainRule {
    if (typeof rule !== "object" || rule === null) return false;
    const r = rule as DomainRule;
    if (typeof r.allow !== "boolean") return false;
    if (r.resourceTypes !== undefined) {
        if (!Array.isArray(r.resourceTypes)) return false;
        for (const t of r.resourceTypes) {
            if (typeof t !== "string" || !validateResourceType(t)) return false;
        }
    }
    if (r.excludedDomains !== undefined) {
        if (!Array.isArray(r.excludedDomains)) return false;
        for (const d of r.excludedDomains) {
            if (typeof d !== "string") return false;
        }
    }
    return true;
}

export function validateSitePolicy(policy: unknown): policy is SitePolicy {
    if (typeof policy !== "object" || policy === null) return false;
    const p = policy as SitePolicy;
    if (typeof p.site !== "string" || p.site.length === 0) return false;
    if (!validateProfile(p.profile)) return false;
    if (p.resourceDefaults !== undefined && typeof p.resourceDefaults !== "object") return false;
    if (p.rules !== undefined) {
        if (typeof p.rules !== "object") return false;
        const rules = p.rules;
        if (!rules) return false;
        for (const rule of Object.values(rules)) {
            if (!validateDomainRule(rule)) return false;
        }
    }
    return true;
}

export function validateStoredPolicy(policy: unknown): policy is StoredPolicy {
    if (typeof policy !== "object" || policy === null) return false;
    const p = policy as StoredPolicy;
    if (typeof p.version !== "number") return false;
    if (typeof p.sites !== "object" || p.sites === null) return false;
    for (const sitePolicy of Object.values(p.sites)) {
        if (!validateSitePolicy(sitePolicy)) return false;
    }
    return true;
}

export function createDefaultStoredPolicy(): StoredPolicy {
    return {
        version: 1,
        sites: {},
        createdAt: Date.now(),
        updatedAt: Date.now(),
    };
}

export function mergeSitePolicy(existing: SitePolicy, updates: Partial<SitePolicy>): SitePolicy {
    const normalized = normalizeSitePolicy({
        ...existing,
        ...updates,
        site: existing.site,
    });
    return normalized;
}

export function getPolicyVersion(policy: StoredPolicy): number {
    return policy.version;
}

export function incrementPolicyVersion(policy: StoredPolicy): StoredPolicy {
    return {
        ...policy,
        version: policy.version + 1,
        updatedAt: Date.now(),
    };
}