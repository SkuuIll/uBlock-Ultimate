/**
 * platform/chromium/js/mutation-journal.js
 *
 * Mutation journal for tracking storage and state changes.
 *
 * Records every storage write, policy change, setting toggle, and
 * user action with before/after snapshots. The journal supports
 * rollback, audit, and diagnostic export.
 *
 * Usage:
 *   import { MutationJournal } from "./mutation-journal.js";
 *   const entryId = MutationJournal.record({ key: "userSettings", action: "update", before: old, after: new });
 *   const entries = MutationJournal.query({ key: "userSettings" });
 */

const _entries = [];
let _nextId = 1;

export const MutationJournal = Object.freeze({
    /**
     * Record a mutation entry.
     * @param {{ key: string, action: string, before?: any, after?: any, source?: string, reason?: string }} entry
     * @returns {number} entry ID
     */
    record(entry) {
        const id = _nextId++;
        _entries.push({
            id,
            key: entry.key,
            action: entry.action,
            before: entry.before !== undefined ? JSON.parse(JSON.stringify(entry.before)) : undefined,
            after: entry.after !== undefined ? JSON.parse(JSON.stringify(entry.after)) : undefined,
            source: entry.source || "",
            reason: entry.reason || "",
            timestamp: Date.now(),
        });
        if (_entries.length > 500) _entries.shift();
        return id;
    },

    /**
     * Query journal entries.
     * @param {{ key?: string, action?: string, source?: string, since?: number }} filter
     * @returns {object[]}
     */
    query(filter = {}) {
        let results = _entries;
        if (filter.key) results = results.filter(e => e.key === filter.key);
        if (filter.action) results = results.filter(e => e.action === filter.action);
        if (filter.source) results = results.filter(e => e.source === filter.source);
        if (filter.since) results = results.filter(e => e.timestamp >= filter.since);
        return results;
    },

    /**
     * Get entry by ID.
     * @param {number} id
     * @returns {object|null}
     */
    get(id) {
        return _entries.find(e => e.id === id) || null;
    },

    /**
     * Get all entries (for diagnostic export).
     * @returns {object[]}
     */
    getAll() {
        return [..._entries];
    },

    clear() {
        _entries.length = 0;
    },
});
