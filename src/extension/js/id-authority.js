/**
 * platform/chromium/js/id-authority.js
 *
 * Stable ID and namespace allocator for all generated IDs.
 *
 * Every subsystem that needs identifiers (DNR rules, operation IDs,
 * capability tokens, context-menu IDs, diagnostic bundles) should
 * acquire them from this authority.  IDs are allocated from declared
 * numeric ranges or prefixed namespace counters.
 *
 * Usage:
 *   import { idAuthority } from "./id-authority.js";
 *   const dnrId = idAuthority.allocate("dnr-session-rules");
 *   const opId = idAuthority.allocateId("operation");
 */

// ---------------------------------------------------------------------------
// Namespace definitions
// ---------------------------------------------------------------------------

const _namespaces = new Map();  // namespaceId → IdNamespace

class IdNamespace {
    constructor(config) {
        this.id = config.id;
        this.owner = config.owner || "unknown";
        this.prefix = config.prefix || "";
        this.numericRange = config.numericRange || null;
        this.collisionPolicy = config.collisionPolicy || "allocate-next";
        this._next = config.numericRange ? config.numericRange[0] : 1;
        this._max = config.numericRange ? config.numericRange[1] : Number.MAX_SAFE_INTEGER;
        this._allocated = new Set();
    }

    allocate() {
        if (this.numericRange) {
            // Numeric ID from declared range
            const id = this._next;
            if (id > this._max) {
                throw new Error(`Namespace "${this.id}" exhausted (range ${this.numericRange[0]}-${this.numericRange[1]})`);
            }
            this._next = id + 1;
            this._allocated.add(id);
            return id;
        }

        // Prefixed string ID
        const id = `${this.prefix}${this._next}`;
        this._next++;
        this._allocated.add(id);
        return id;
    }

    allocateSpecific(id) {
        if (this._allocated.has(id)) {
            if (this.collisionPolicy === "reject") {
                throw new Error(`ID "${id}" already allocated in namespace "${this.id}"`);
            }
            if (this.collisionPolicy === "reuse-stable") {
                return id;
            }
            // allocate-next: keep going
        }
        this._allocated.add(id);
        return id;
    }

    release(id) {
        this._allocated.delete(id);
    }

    getSnapshot() {
        return {
            id: this.id,
            owner: this.owner,
            prefix: this.prefix,
            numericRange: this.numericRange,
            collisionPolicy: this.collisionPolicy,
            next: this._next,
            allocatedCount: this._allocated.size,
        };
    }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export const idAuthority = {
    /**
     * Register a namespace.
     *
     * @param {object} config
     * @param {string} config.id
     * @param {string} [config.owner]
     * @param {string} [config.prefix]
     * @param {[number,number]} [config.numericRange]
     * @param {string} [config.collisionPolicy="allocate-next"]
     */
    defineNamespace(config) {
        if (_namespaces.has(config.id)) {
            throw new Error(`Namespace "${config.id}" is already defined`);
        }
        _namespaces.set(config.id, new IdNamespace(config));
    },

    /**
     * Allocate the next ID from a namespace.
     *
     * @param {string} namespaceId
     * @returns {number|string}
     */
    allocate(namespaceId) {
        const ns = _namespaces.get(namespaceId);
        if (!ns) {
            throw new Error(`Unknown namespace: "${namespaceId}"`);
        }
        return ns.allocate();
    },

    /**
     * Allocate a specific ID (for stable/reproducible IDs).
     * Respects the namespace's collision policy.
     */
    allocateSpecific(namespaceId, id) {
        const ns = _namespaces.get(namespaceId);
        if (!ns) {
            throw new Error(`Unknown namespace: "${namespaceId}"`);
        }
        return ns.allocateSpecific(id);
    },

    /**
     * Release an allocated ID back to the namespace.
     */
    release(namespaceId, id) {
        const ns = _namespaces.get(namespaceId);
        if (ns) {
            ns.release(id);
        }
    },

    /**
     * Check whether a namespace exists.
     */
    hasNamespace(namespaceId) {
        return _namespaces.has(namespaceId);
    },

    /**
     * Return a diagnostic snapshot of all namespaces.
     */
    getSnapshot() {
        const namespaces = {};
        for (const [id, ns] of _namespaces) {
            namespaces[id] = ns.getSnapshot();
        }
        return namespaces;
    },

    /**
     * Reset all namespaces (for testing).
     */
    reset() {
        _namespaces.clear();
    },
};
