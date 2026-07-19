/**
 * platform/chromium/js/allow-rule-authority.js
 *
 * Allow/exception rule authority, expiry, and provenance.
 *
 * Whitelist entries, unbreak rules, temporary compatibility allowances,
 * user-created exceptions, trusted-site modes, and emergency repair
 * relaxations must all declare their source, scope, reason, provenance,
 * and expiry/permanent justification.
 *
 * Usage:
 *   import { AllowRuleAuthority } from "./allow-rule-authority.js";
 *   const entry = AllowRuleAuthority.create({
 *     source: "user-whitelist",
 *     scope: "example.com",
 *     reason: "breaks-shopping-cart",
 *     owner: "user",
 *   });
 *   AllowRuleAuthority.register(entry);
 *   const active = AllowRuleAuthority.getActive();
 */

// ---------------------------------------------------------------------------
// Risk classes
// ---------------------------------------------------------------------------

const RISK_CLASS = Object.freeze({
    SAFE: "safe",
    LOW: "low",
    MEDIUM: "medium",
    HIGH: "high",
    CRITICAL: "critical",
});

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

const _entries = new Map();  // provenanceHash → AllowRuleEntry
const _scopeRegistry = new Map();  // scope → Set<provenanceHash>

class AllowRuleEntry {
    constructor(opts) {
        this.source = opts.source;
        this.scope = opts.scope;
        this.reason = opts.reason;
        this.owner = opts.owner;
        this.createdAt = opts.createdAt || Date.now();
        this.expiresAt = opts.expiresAt || null;
        this.permanentJustification = opts.permanentJustification || null;
        this.userVisibleLabel = opts.userVisibleLabel || opts.reason;
        this.affectedCapabilities = opts.affectedCapabilities || [];
        this.riskClass = opts.riskClass || RISK_CLASS.LOW;
        this.precedence = opts.precedence || 0;
        this.provenanceHash = null;  // set on register
        this.undoPath = opts.undoPath || null;
    }

    get isExpired() {
        return this.expiresAt !== null && Date.now() > this.expiresAt;
    }

    get isPermanent() {
        return this.expiresAt === null && this.permanentJustification !== null;
    }

    get isTemporary() {
        return this.expiresAt !== null;
    }

    computeProvenanceHash() {
        const raw = `${this.source}:${this.scope}:${this.reason}:${this.owner}:${this.createdAt}`;
        let hash = 0;
        for (let i = 0; i < raw.length; i++) {
            const chr = raw.charCodeAt(i);
            hash = ((hash << 5) - hash) + chr;
            hash |= 0;
        }
        return `${hash}`;
    }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export const AllowRuleAuthority = {
    RISK_CLASS,

    /**
     * Create a new allow-rule entry (does not register it).
     */
    create(opts) {
        const entry = new AllowRuleEntry(opts);
        entry.provenanceHash = entry.computeProvenanceHash();
        return entry;
    },

    /**
     * Register an allow-rule entry.
     * If an entry with the same provenance hash already exists, it is
     * updated (replaced).
     */
    register(entry) {
        if (!(entry instanceof AllowRuleEntry)) {
            throw new Error("Must register an AllowRuleEntry instance");
        }

        const hash = entry.provenanceHash || entry.computeProvenanceHash();
        entry.provenanceHash = hash;

        // Store in hash map
        _entries.set(hash, entry);

        // Index by scope
        if (!_scopeRegistry.has(entry.scope)) {
            _scopeRegistry.set(entry.scope, new Set());
        }
        _scopeRegistry.get(entry.scope).add(hash);

        return hash;
    },

    /**
     * Remove an allow-rule entry by provenance hash.
     */
    remove(provenanceHash) {
        const entry = _entries.get(provenanceHash);
        if (!entry) return false;

        _entries.delete(provenanceHash);

        const scoped = _scopeRegistry.get(entry.scope);
        if (scoped) {
            scoped.delete(provenanceHash);
            if (scoped.size === 0) {
                _scopeRegistry.delete(entry.scope);
            }
        }

        return true;
    },

    /**
     * Get an entry by provenance hash.
     */
    get(provenanceHash) {
        return _entries.get(provenanceHash) || null;
    },

    /**
     * Get all active (non-expired) entries for a scope, sorted by precedence.
     */
    getActive(scope) {
        const scoped = _scopeRegistry.get(scope);
        if (!scoped) return [];

        const active = [];
        for (const hash of scoped) {
            const entry = _entries.get(hash);
            if (entry && !entry.isExpired) {
                active.push(entry);
            }
        }

        active.sort((a, b) => b.precedence - a.precedence);
        return active;
    },

    /**
     * Get all active entries across all scopes.
     */
    getAllActive() {
        const active = [];
        for (const [, entry] of _entries) {
            if (!entry.isExpired) {
                active.push(entry);
            }
        }
        return active;
    },

    /**
     * Check whether a scope has any active allow rules.
     */
    hasActiveForScope(scope) {
        const active = AllowRuleAuthority.getActive(scope);
        return active.length > 0;
    },

    /**
     * Remove all expired entries.
     */
    removeExpired() {
        const expired = [];
        for (const [hash, entry] of _entries) {
            if (entry.isExpired) {
                expired.push(hash);
            }
        }
        for (const hash of expired) {
            AllowRuleAuthority.remove(hash);
        }
        return expired.length;
    },

    /**
     * Return diagnostic snapshot.
     */
    getSnapshot() {
        const entries = [];
        for (const [, entry] of _entries) {
            entries.push({
                provenanceHash: entry.provenanceHash,
                source: entry.source,
                scope: entry.scope,
                reason: entry.reason,
                owner: entry.owner,
                riskClass: entry.riskClass,
                precedence: entry.precedence,
                isExpired: entry.isExpired,
                isPermanent: entry.isPermanent,
                isTemporary: entry.isTemporary,
                expiresAt: entry.expiresAt,
                permanentJustification: entry.permanentJustification,
            });
        }
        return {
            total: entries.length,
            expired: entries.filter(e => e.isExpired).length,
            entries,
        };
    },
};
