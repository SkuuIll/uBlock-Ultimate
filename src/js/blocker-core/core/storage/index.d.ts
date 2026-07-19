// @ts-nocheck
import { type StoredPolicy, type BudgetState, type IDAllocatorState, type RuleMapping, type CompiledRuleGroup } from "../types/index.js";
export declare const STORAGE_SCHEMA_VERSION = 1;
export interface StorageSchema {
    version: number;
    policy: StoredPolicy;
    compiledState: Record<string, CompiledRuleGroup>;
    ruleMapping: Record<string, RuleMapping>;
    idAllocator: IDAllocatorState;
    budget: BudgetState;
    observedDomains: ObservedDomain[];
    cosmeticSelectors: CosmeticSelector[];
    temporaryOverrides: Record<string, TemporaryOverride>;
    lastUpdated: number;
}
export interface ObservedDomain {
    site: string;
    domain: string;
    resourceType: string;
    url: string;
    timestamp: number;
}
export interface CosmeticSelector {
    site: string;
    selector: string;
    status: "saved" | "active" | "inactive";
    createdAt: number;
}
export interface TemporaryOverride {
    site: string;
    ruleId: number;
    domain: string;
    action: "allow" | "block";
    resourceTypes: string[];
    createdAt: number;
    expiresAt: number;
}
export interface StorageValidationResult {
    valid: boolean;
    errors: string[];
    warnings: string[];
}
export interface StorageLoadResult {
    success: boolean;
    schema?: StorageSchema;
    error?: string;
    needsMigration?: boolean;
    migrationFromVersion?: number;
}
export declare function createDefaultStorageSchema(): StorageSchema;
export declare function validateStorageSchema(data: unknown): StorageValidationResult;
export declare function migrateSchema(oldData: Record<string, unknown>, fromVersion: number): StorageSchema;
export declare function validateAndMigrateStorage(data: unknown, currentVersion?: number): StorageLoadResult;
export declare function serializeStorageSchema(schema: StorageSchema): Record<string, unknown>;
export declare function deserializeStorageSchema(data: Record<string, unknown>): StorageSchema | null;
export declare function getStorageKeys(): Record<string, string>;
export declare function validateSiteInPolicy(policy: StoredPolicy, site: string): boolean;
export declare function validateBudgetState(budget: unknown): budget is BudgetState;
export declare function validateIdAllocator(allocator: unknown): allocator is IDAllocatorState;
export declare function checkBudgetIntegrity(budget: BudgetState, ruleMapping: Map<string, RuleMapping>): {
    valid: boolean;
    issues: string[];
};
export declare function reconcileBudgetState(budget: BudgetState, ruleMapping: Map<string, RuleMapping>): BudgetState;
export declare function normalizeObservedDomains(domains: ObservedDomain[]): ObservedDomain[];
export declare function pruneObservedDomains(domains: ObservedDomain[], maxEntries?: number, maxAgeMs?: number): ObservedDomain[];
export declare function normalizeCosmeticSelectors(selectors: CosmeticSelector[]): CosmeticSelector[];
export declare function cleanupExpiredTemporaryOverrides(overrides: Record<string, TemporaryOverride>): Record<string, TemporaryOverride>;
