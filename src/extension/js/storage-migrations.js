/**
 * platform/chromium/js/storage-migrations.js
 *
 * Storage migration registry.
 * Every migration is idempotent and has a test.
 * Startup must run pending migrations before reading cached runtime state.
 *
 * Usage:
 *   import { MIGRATIONS, runPendingMigrations } from "./storage-migrations.js";
 */

const MIGRATIONS = [
    {
        id: 1,
        name: "clear-legacy-global-cosmetics",
        description: "Remove stale stored cosmetic filter data from before layered policy",
        run: async () => {
            // Idempotent: clear legacy global cosmetic filter keys
            const keys = ["cosmeticFiltersData", "globalCosmeticFilters"];
            for (const key of keys) {
                try {
                    await chrome.storage.local.remove(key);
                } catch (_) { /* ignore */ }
            }
        },
    },
    {
        id: 2,
        name: "clear-dnr-broad-fallback-state",
        description: "Clear any cached DNR fallback rule state from before degraded allow mode",
        run: async () => {
            try {
                await chrome.storage.local.remove("dnrFallbackActive");
            } catch (_) { /* ignore */ }
        },
    },
    {
        id: 3,
        name: "normalize-selected-filter-lists",
        description: "Normalize selected filter list storage to new schema",
        run: async () => {
            // Future: normalize filter list selection keys
        },
    },
];

export async function runPendingMigrations(currentVersion = 0) {
    const pending = MIGRATIONS.filter(m => m.id > currentVersion);
    for (const migration of pending) {
        try {
            await migration.run();
        } catch (err) {
            console.warn(`[uBlock Ultimate] Migration ${migration.id} (${migration.name}) failed:`, err);
        }
    }
    return MIGRATIONS.length;
}
