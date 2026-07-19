// @ts-nocheck
import { validateStoredPolicy, validateSitePolicy, createDefaultStoredPolicy } from "../policy/index.js";
import type { StoredPolicy, SitePolicy } from "../policy/index.js";
import { createDefaultAllocatorState, serializeMapping, deserializeMapping } from "./id-allocator.js";
import type { BudgetState } from "../lifecycle/index.js";
import type { RuleMappingEntry } from "../compiler/index.js";

export const STORAGE_SCHEMA_VERSION = 1;

export interface IdAllocatorState {
    nextDynamicId: number;
    nextSessionId: number;
    freedDynamicIds: number[];
    freedSessionIds: number[];
}

export interface ObservedDomain {
    site: string;
    domain: string;
    resourceType: string;
    timestamp: number;
}

export interface CosmeticSelector {
    site: string;
    selector: string;
    timestamp: number;
}

export interface TemporaryOverride {
    expiresAt: number;
    value: unknown;
}

export interface StorageSchema {
    version: number;
    policy: StoredPolicy;
    compiledState: Record<string, unknown>;
    ruleMapping: Record<string, RuleMappingEntry>;
    idAllocator: IdAllocatorState;
    budget: BudgetState;
    observedDomains: ObservedDomain[];
    cosmeticSelectors: CosmeticSelector[];
    temporaryOverrides: Record<string, TemporaryOverride>;
    lastUpdated: number;
}

export interface ValidationResult {
    valid: boolean;
    errors: string[];
    warnings: string[];
}

export interface MigrationResult {
    success: boolean;
    schema?: StorageSchema;
    error?: string;
    needsMigration?: boolean;
    migrationFromVersion?: number;
}

export function createDefaultStorageSchema(): StorageSchema {
    return {
        version: STORAGE_SCHEMA_VERSION,
        policy: createDefaultStoredPolicy(),
        compiledState: {},
        ruleMapping: {},
        idAllocator: createDefaultAllocatorState(),
        budget: {
            dynamicRuleCount: 0,
            sessionRuleCount: 0,
            dynamicCeiling: 30000,
            sessionCeiling: 5000,
            perSiteRules: {},
            globalOverridePool: 3000,
        },
        observedDomains: [],
        cosmeticSelectors: [],
        temporaryOverrides: {},
        lastUpdated: Date.now(),
    };
}

export function validateStorageSchema(data: unknown): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    if (typeof data !== "object" || data === null) {
        errors.push("Storage data must be an object");
        return { valid: false, errors, warnings };
    }
    const schema = data as Record<string, unknown>;
    if (schema.version === undefined) {
        errors.push("Missing schema version");
    } else if (typeof schema.version !== "number") {
        errors.push("Schema version must be a number");
    }
    if (schema.policy !== undefined) {
        if (!validateStoredPolicy(schema.policy)) {
            errors.push("Invalid stored policy");
        }
    }
    if (schema.budget !== undefined) {
        const budget = schema.budget as Record<string, unknown>;
        if (typeof budget.dynamicRuleCount !== "number" || typeof budget.sessionRuleCount !== "number") {
            errors.push("Invalid budget state");
        }
    }
    if (schema.idAllocator !== undefined) {
        const alloc = schema.idAllocator as Record<string, unknown>;
        if (typeof alloc.nextDynamicId !== "number" || typeof alloc.nextSessionId !== "number") {
            errors.push("Invalid ID allocator state");
        }
    }
    return {
        valid: errors.length === 0,
        errors,
        warnings,
    };
}

export function migrateSchema(oldData: Record<string, unknown>, fromVersion: number): StorageSchema {
    const schema = createDefaultStorageSchema();
    schema.version = fromVersion;
    if (fromVersion < 1) {
        if (oldData.policy) {
            schema.policy = oldData.policy as StoredPolicy;
        }
        if (oldData.budget) {
            schema.budget = oldData.budget as BudgetState;
        }
    }
    schema.version = STORAGE_SCHEMA_VERSION;
    schema.lastUpdated = Date.now();
    return schema;
}

export function validateAndMigrateStorage(data: unknown, currentVersion: number = STORAGE_SCHEMA_VERSION): MigrationResult {
    if (data === null || data === undefined) {
        return {
            success: true,
            schema: createDefaultStorageSchema(),
            needsMigration: false,
        };
    }
    const validation = validateStorageSchema(data);
    if (!validation.valid) {
        const record = data as Record<string, unknown>;
        if (record.version === undefined || typeof record.version !== "number") {
            return {
                success: false,
                error: `Corrupted storage: ${validation.errors.join(", ")}`,
            };
        }
        if (record.version < currentVersion) {
            const migrated = migrateSchema(record, record.version as number);
            return {
                success: true,
                schema: migrated,
                needsMigration: true,
                migrationFromVersion: record.version as number,
            };
        }
        return {
            success: false,
            error: `Invalid storage: ${validation.errors.join(", ")}`,
        };
    }
    const record = data as StorageSchema;
    if (record.version < currentVersion) {
        const migrated = migrateSchema(record as unknown as Record<string, unknown>, record.version);
        return {
            success: true,
            schema: migrated,
            needsMigration: true,
            migrationFromVersion: record.version,
        };
    }
    return {
        success: true,
        schema: record,
        needsMigration: false,
    };
}

export function serializeStorageSchema(schema: StorageSchema): Record<string, unknown> {
    return {
        version: schema.version,
        policy: schema.policy,
        compiledState: schema.compiledState,
        ruleMapping: serializeMapping(new Map(Object.entries(schema.ruleMapping))),
        idAllocator: schema.idAllocator,
        budget: schema.budget,
        observedDomains: schema.observedDomains,
        cosmeticSelectors: schema.cosmeticSelectors,
        temporaryOverrides: schema.temporaryOverrides,
        lastUpdated: schema.lastUpdated,
    };
}

export function deserializeStorageSchema(data: unknown): StorageSchema | null {
    const result = validateAndMigrateStorage(data);
    if (!result.success || !result.schema) {
        return null;
    }
    const schema = result.schema;
    if (typeof schema.ruleMapping === "object" && schema.ruleMapping !== null) {
        schema.ruleMapping = deserializeMapping(schema.ruleMapping as Record<string, RuleMappingEntry>);
    }
    return schema;
}

export interface StorageKeys {
    POLICY: string;
    STATE: string;
    ID_ALLOCATOR: string;
    BUDGET: string;
    RULE_MAPPING: string;
    COSMETIC: string;
    OBSERVED_DOMAINS: string;
    COSMETIC_SELECTORS: string;
    TEMPORARY_OVERRIDES: string;
}

export function getStorageKeys(): StorageKeys {
    return {
        POLICY: "blocker_policy",
        STATE: "blocker_state",
        ID_ALLOCATOR: "blocker_id_allocator",
        BUDGET: "blocker_budget",
        RULE_MAPPING: "blocker_rule_mapping",
        COSMETIC: "blocker_cosmetic",
        OBSERVED_DOMAINS: "blocker_observed_domains",
        COSMETIC_SELECTORS: "blocker_cosmetic_selectors",
        TEMPORARY_OVERRIDES: "blocker_temporary_overrides",
    };
}

export function validateSiteInPolicy(policy: StoredPolicy, site: string): boolean {
    const sitePolicy = policy.sites[site];
    if (!sitePolicy) return false;
    return validateSitePolicy(sitePolicy);
}

export function validateBudgetState(budget: unknown): budget is BudgetState {
    if (typeof budget !== "object" || budget === null) return false;
    const b = budget as BudgetState;
    return (
        typeof b.dynamicRuleCount === "number" &&
        typeof b.sessionRuleCount === "number" &&
        typeof b.dynamicCeiling === "number" &&
        typeof b.sessionCeiling === "number"
    );
}

export function validateIdAllocator(allocator: unknown): allocator is IdAllocatorState {
    if (typeof allocator !== "object" || allocator === null) return false;
    const a = allocator as IdAllocatorState;
    return (
        typeof a.nextDynamicId === "number" &&
        typeof a.nextSessionId === "number" &&
        Array.isArray(a.freedDynamicIds) &&
        Array.isArray(a.freedSessionIds)
    );
}

export interface BudgetIntegrityResult {
    valid: boolean;
    issues: string[];
}

export function checkBudgetIntegrity(budget: BudgetState, ruleMapping: Map<string, RuleMappingEntry>): BudgetIntegrityResult {
    const issues: string[] = [];
    let dynamicCount = 0;
    let sessionCount = 0;
    for (const mapping of ruleMapping.values()) {
        if (mapping.ruleType === "dynamic") {
            dynamicCount++;
        } else {
            sessionCount++;
        }
    }
    if (dynamicCount !== budget.dynamicRuleCount) {
        issues.push(`Dynamic rule count mismatch: stored=${budget.dynamicRuleCount}, mapped=${dynamicCount}`);
    }
    if (sessionCount !== budget.sessionRuleCount) {
        issues.push(`Session rule count mismatch: stored=${budget.sessionRuleCount}, mapped=${sessionCount}`);
    }
    return {
        valid: issues.length === 0,
        issues,
    };
}

export function reconcileBudgetState(budget: BudgetState, ruleMapping: Map<string, RuleMappingEntry>): BudgetState {
    let dynamicCount = 0;
    let sessionCount = 0;
    const perSiteCounts: Record<string, { dynamic: number; session: number; total: number }> = {};
    for (const mapping of ruleMapping.values()) {
        const [site] = mapping.policyKey.split("|");
        if (!perSiteCounts[site]) {
            perSiteCounts[site] = { dynamic: 0, session: 0, total: 0 };
        }
        if (mapping.ruleType === "dynamic") {
            dynamicCount++;
            perSiteCounts[site].dynamic++;
        } else {
            sessionCount++;
            perSiteCounts[site].session++;
        }
        perSiteCounts[site].total++;
    }
    return {
        ...budget,
        dynamicRuleCount: dynamicCount,
        sessionRuleCount: sessionCount,
        perSiteRules: perSiteCounts,
    };
}

export function normalizeObservedDomains(domains: ObservedDomain[]): ObservedDomain[] {
    const seen = new Set<string>();
    const normalized: ObservedDomain[] = [];
    for (const domain of domains) {
        const key = `${domain.site}|${domain.domain}|${domain.resourceType}`;
        if (!seen.has(key)) {
            seen.add(key);
            normalized.push({
                ...domain,
                site: domain.site.toLowerCase(),
                domain: domain.domain.toLowerCase(),
                resourceType: domain.resourceType.toLowerCase(),
            });
        }
    }
    return normalized.sort((a, b) => b.timestamp - a.timestamp);
}

export function pruneObservedDomains(domains: ObservedDomain[], maxEntries: number = 1000, maxAgeMs: number = 7 * 24 * 60 * 60 * 1000): ObservedDomain[] {
    const now = Date.now();
    const valid = domains.filter((d) => now - d.timestamp < maxAgeMs);
    return valid.slice(0, maxEntries);
}

export function normalizeCosmeticSelectors(selectors: CosmeticSelector[]): CosmeticSelector[] {
    const seen = new Set<string>();
    const normalized: CosmeticSelector[] = [];
    for (const selector of selectors) {
        const key = `${selector.site}|${selector.selector}`;
        if (!seen.has(key)) {
            seen.add(key);
            normalized.push({
                ...selector,
                site: selector.site.toLowerCase(),
                selector: selector.selector.trim(),
            });
        }
    }
    return normalized;
}

export function cleanupExpiredTemporaryOverrides(overrides: Record<string, TemporaryOverride>): Record<string, TemporaryOverride> {
    const now = Date.now();
    const valid: Record<string, TemporaryOverride> = {};
    for (const [key, override] of Object.entries(overrides)) {
        if (override.expiresAt > now) {
            valid[key] = override;
        }
    }
    return valid;
}