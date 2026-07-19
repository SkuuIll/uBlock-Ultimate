// @ts-nocheck
import { RESOURCE_TYPE_TO_DNR } from "../types/index.js";
import { computeRulePriority } from "../policy/priority.js";
import { normalizeDomain } from "../policy/index.js";
import type { SitePolicy, DomainRule, ResourceType, ActionType, ScopeType } from "../policy/index.js";

export type DnrResourceType = keyof typeof RESOURCE_TYPE_TO_DNR;

export interface RuleDescriptor {
    domains: string[];
    resourceTypes: string[];
    action: ActionType;
    scope: ScopeType;
    excludedDomains?: string[];
    priority: number;
}

export interface PolicyKeyDescriptor {
    domains: string[];
    resourceTypes: string[];
    action: ActionType;
    scope: ScopeType;
    excludedDomains?: string[];
}

export interface CompiledRule {
    id: number;
    priority: number;
    action: { type: ActionType };
    condition: {
        initiatorDomains?: string[];
        domains?: string[];
        resourceTypes: string[];
        excludedDomains?: string[];
    };
}

export interface RuleMappingEntry {
    policyKey: string;
    ruleId: number;
    ruleType: "session" | "dynamic";
}

export interface CompileSitePolicyResult {
    dynamicRules: CompiledRule[];
    sessionRules: CompiledRule[];
    nextDynamicId: number;
    nextSessionId: number;
    mapping: Record<string, RuleMappingEntry>;
}

export function generatePolicyKey(descriptor: PolicyKeyDescriptor, site: string): string {
    const domainKey = [...descriptor.domains].sort().join(",");
    const typeKey = [...descriptor.resourceTypes].sort().join(",");
    const exclusionKey = descriptor.excludedDomains ? [...descriptor.excludedDomains].sort().join(",") : "";
    return `${site}|${domainKey}|${descriptor.action}|${typeKey}|${descriptor.scope}|${exclusionKey}`;
}

export function generateDefaultRuleKey(site: string, resourceType: string, action: ActionType): string {
    return `${site}|*|${action}|${resourceType}|default|`;
}

export interface CompileSitePolicyOptions {
    site: string;
    policy: SitePolicy;
    startDynamicId: number;
    startSessionId: number;
    includeTemporary?: boolean;
    includePermanent?: boolean;
    excludeMainFrame?: boolean;
}

export function compileSitePolicy(options: CompileSitePolicyOptions): CompileSitePolicyResult {
    const { site, policy, startDynamicId, startSessionId, includeTemporary = true, includePermanent = true, excludeMainFrame = true } = options;
    const dynamicRules: CompiledRule[] = [];
    const sessionRules: CompiledRule[] = [];
    const mapping: Record<string, RuleMappingEntry> = {};
    let nextDynamicId = startDynamicId;
    let nextSessionId = startSessionId;
    const descriptors = generateRuleDescriptors(policy, site, excludeMainFrame);
    for (const desc of descriptors) {
        const isTemporary = desc.scope === "temporary";
        if (isTemporary && !includeTemporary) continue;
        if (!isTemporary && !includePermanent) continue;
        const ruleId = isTemporary ? nextSessionId++ : nextDynamicId++;
        const rule: CompiledRule = {
            id: ruleId,
            priority: desc.priority,
            action: { type: desc.action },
            condition: {
                initiatorDomains: [site],
                domains: desc.domains,
                resourceTypes: desc.resourceTypes.map((rt) => RESOURCE_TYPE_TO_DNR[rt as DnrResourceType]),
            },
        };
        if (desc.excludedDomains && desc.excludedDomains.length > 0) {
            rule.condition.excludedDomains = desc.excludedDomains;
        }
        const policyKey = generatePolicyKey(desc, site);
        mapping[policyKey] = { policyKey, ruleId, ruleType: isTemporary ? "session" : "dynamic" };
        if (isTemporary) {
            sessionRules.push(rule);
        } else {
            dynamicRules.push(rule);
        }
    }
    const finalNextDynamicId = addDefaultRules(site, policy, dynamicRules, sessionRules, nextDynamicId, nextSessionId, mapping);
    return {
        dynamicRules,
        sessionRules,
        nextDynamicId: finalNextDynamicId,
        nextSessionId,
        mapping,
    };
}

export function generateRuleDescriptors(policy: SitePolicy, site: string, excludeMainFrame: boolean): RuleDescriptor[] {
    const descriptors: RuleDescriptor[] = [];
    const domainActions = new Map<string, { allow: boolean; scope: ScopeType; resourceTypes: Set<string>; excludedDomains?: string[] }>();
    for (const [domain, rule] of Object.entries(policy.rules)) {
        const normalizedDomain = normalizeDomain(domain);
        if (!normalizedDomain) continue;
        const scope: ScopeType = rule.temporary ? "temporary" : "permanent";
        const resourceTypes = new Set<string>(rule.resourceTypes ?? ["script", "image", "stylesheet", "font", "xmlhttprequest", "sub_frame", "media"]);
        if (excludeMainFrame) {
            resourceTypes.delete("main_frame");
        }
        const existing = domainActions.get(normalizedDomain);
        if (existing) {
            if (scope === "temporary" || (scope === existing.scope && rule.allow === existing.allow)) {
                for (const rt of resourceTypes) {
                    existing.resourceTypes.add(rt);
                }
            } else if (scope === "permanent" && existing.scope === "temporary") {
                continue;
            }
        } else {
            domainActions.set(normalizedDomain, {
                allow: rule.allow,
                scope,
                resourceTypes,
                excludedDomains: rule.excludedDomains,
            });
        }
    }
    for (const [domain, action] of domainActions) {
        if (action.resourceTypes.size === 0) continue;
        descriptors.push({
            domains: [domain],
            resourceTypes: [...action.resourceTypes],
            action: action.allow ? "allow" : "block",
            scope: action.scope,
            excludedDomains: action.excludedDomains,
            priority: computeRulePriority(action.scope, action.allow ? "allow" : "block"),
        });
    }
    return compactDescriptors(descriptors);
}

function compactDescriptors(descriptors: RuleDescriptor[]): RuleDescriptor[] {
    const byKey = new Map<string, RuleDescriptor>();
    for (const desc of descriptors) {
        const sortedTypes = [...desc.resourceTypes].sort().join(",");
        const sortedExclusions = desc.excludedDomains ? [...desc.excludedDomains].sort().join(",") : "";
        const key = `${desc.action}|${desc.scope}|${desc.priority}|${sortedTypes}|${sortedExclusions}`;
        const existing = byKey.get(key);
        if (existing) {
            const combinedTypes = new Set([...existing.resourceTypes, ...desc.resourceTypes]);
            existing.resourceTypes = [...combinedTypes];
            const combinedDomains = [...existing.domains, ...desc.domains].sort();
            existing.domains = combinedDomains;
        } else {
            byKey.set(key, { ...desc, resourceTypes: [...desc.resourceTypes], domains: [...desc.domains] });
        }
    }
    return Array.from(byKey.values());
}

function addDefaultRules(
    site: string,
    policy: SitePolicy,
    dynamicRules: CompiledRule[],
    sessionRules: CompiledRule[],
    nextDynamicId: number,
    nextSessionId: number,
    mapping: Record<string, RuleMappingEntry>
): number {
    const resourceTypes = ["script", "image", "stylesheet", "font", "xmlhttprequest", "sub_frame", "media"];
    let currentId = nextDynamicId;
    for (const rt of resourceTypes) {
        const defaultAction = policy.resourceDefaults[rt as ResourceType];
        if (!defaultAction) continue;
        const allRules = [...dynamicRules, ...sessionRules];
        const explicitResourceTypeRules = allRules.filter((r) => r.condition.resourceTypes?.includes(RESOURCE_TYPE_TO_DNR[rt as DnrResourceType]));
        const coveredDomains = new Set<string>();
        for (const rule of explicitResourceTypeRules) {
            const domains = rule.condition.domains ?? [];
            for (const d of domains) coveredDomains.add(d);
        }
        const policyDomains = Object.keys(policy.rules);
        const hasUncoveredDomain = policyDomains.some(d => !coveredDomains.has(d));
        if (!explicitResourceTypeRules.length || hasUncoveredDomain) {
            const isBlock = defaultAction === "block";
            const ruleId = currentId++;
            const rule: CompiledRule = {
                id: ruleId,
                priority: 1,
                action: { type: isBlock ? "block" : "allow" },
                condition: {
                    initiatorDomains: [site],
                    resourceTypes: [RESOURCE_TYPE_TO_DNR[rt as DnrResourceType]],
                },
            };
            dynamicRules.push(rule);
            const policyKey = generateDefaultRuleKey(site, rt, isBlock ? "block" : "allow");
            mapping[policyKey] = { policyKey, ruleId, ruleType: "dynamic" };
        }
    }
    return currentId;
}