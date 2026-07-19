/**
 * platform/chromium/js/cache-registry.js
 *
 * Cache registry for filter-list cache and compiled data.
 *
 * Tracks all cached entries (filter-list cache, compiled cosmetic
 * filters, DNR rule compilations, smart rule metadata) with metadata
 * about freshness, owner, and policy revision. Supports invalidation
 * by owner, revision, or age.
 *
 * Usage:
 *   import { CacheRegistry } from "./cache-registry.js";
 *   CacheRegistry.set("filter-list-cache", data, { owner: "filter-engine", ttl: 3600000 });
 *   const cached = CacheRegistry.get("filter-list-cache");
 */

const _cache = new Map();

export const CacheRegistry = Object.freeze({
    /**
     * Store a cache entry.
     * @param {string} key
     * @param {*} value
     * @param {{ owner?: string, ttl?: number, policyRevision?: number }} [meta]
     */
    set(key, value, meta = {}) {
        _cache.set(key, {
            value,
            owner: meta.owner || "",
            ttl: meta.ttl || 0,
            policyRevision: meta.policyRevision || 0,
            storedAt: Date.now(),
        });
    },

    /**
     * Retrieve a cache entry if not expired.
     * @param {string} key
     * @returns {{ value: *, fresh: boolean, owner: string }|null}
     */
    get(key) {
        const entry = _cache.get(key);
        if (!entry) return null;

        if (entry.ttl > 0 && Date.now() - entry.storedAt > entry.ttl) {
            _cache.delete(key);
            return null;
        }

        return entry;
    },

    /**
     * Invalidate cache entries by owner.
     * @param {string} owner
     */
    invalidateByOwner(owner) {
        for (const [key, entry] of _cache) {
            if (entry.owner === owner) _cache.delete(key);
        }
    },

    /**
     * Invalidate cache entries by policy revision threshold.
     * @param {number} revision
     */
    invalidateByRevision(revision) {
        for (const [key, entry] of _cache) {
            if (entry.policyRevision < revision) _cache.delete(key);
        }
    },

    /**
     * Clear all cache entries.
     */
    clear() {
        _cache.clear();
    },
});
