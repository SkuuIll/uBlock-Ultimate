/**
 * platform/chromium/js/storage-authority.js
 *
 * Storage-key ownership and write-authority registry.
 *
 * Every storage key must be registered with its owner, allowed writers,
 * schema, and backup/cloud/migration policy. All storage writes should
 * route through setStorageKey() which validates writer authority, schema
 * conformance, and policy restrictions.
 *
 * Usage:
 *   import { StorageAuthority } from "./storage-authority.js";
 *   StorageAuthority.defineKey("userSettings", { owner: "settings-ui", allowedWriters: ["settings-ui", "backup-restore"] });
 *   const result = StorageAuthority.authorizeWrite({ key: "userSettings", writer: "backup-restore" });
 */

const _keys = new Map();

/**
 * @typedef {{
 *   key: string,
 *   owner: string,
 *   schemaId: string,
 *   allowedWriters: string[],
 *   allowedReaders: string[],
 *   backupPolicy: "include"|"exclude"|"redacted",
 *   cloudPolicy: "sync"|"local-only"|"forbidden",
 *   migrationPolicy: "manual"|"automatic"|"forbidden",
 *   privacyClass: "public"|"settings"|"diagnostic"|"sensitive",
 * }} StorageKeyAuthority
 */

export const StorageAuthority = Object.freeze({
    /**
     * Register a storage key with its authority metadata.
     * @param {string} key
     * @param {StorageKeyAuthority} spec
     */
    defineKey(key, spec) {
        if (_keys.has(key)) throw new Error(`Duplicate storage key: ${key}`);
        _keys.set(key, {
            key,
            owner: spec.owner || "unknown",
            schemaId: spec.schemaId || "",
            allowedWriters: spec.allowedWriters || [],
            allowedReaders: spec.allowedReaders || [],
            backupPolicy: spec.backupPolicy || "include",
            cloudPolicy: spec.cloudPolicy || "local-only",
            migrationPolicy: spec.migrationPolicy || "automatic",
            privacyClass: spec.privacyClass || "settings",
        });
    },

    /**
     * Check whether a writer is allowed to write a storage key.
     * @param {{ key: string, writer: string }} request
     * @returns {{ ok: boolean, reason?: string }}
     */
    authorizeWrite(request) {
        const entry = _keys.get(request.key);
        if (!entry) return { ok: false, reason: `unknown-key: ${request.key}` };
        if (entry.allowedWriters.length > 0 && !entry.allowedWriters.includes(request.writer)) {
            return { ok: false, reason: `writer-not-allowed: ${request.writer}` };
        }
        return { ok: true };
    },

    /**
     * Check whether a reader is allowed to read a storage key.
     * @param {{ key: string, reader: string }} request
     * @returns {{ ok: boolean, reason?: string }}
     */
    authorizeRead(request) {
        const entry = _keys.get(request.key);
        if (!entry) return { ok: false, reason: `unknown-key: ${request.key}` };
        if (entry.allowedReaders.length > 0 && !entry.allowedReaders.includes(request.reader)) {
            return { ok: false, reason: `reader-not-allowed: ${request.reader}` };
        }
        return { ok: true };
    },

    /**
     * Get the authority entry for a key.
     * @param {string} key
     * @returns {StorageKeyAuthority|null}
     */
    getKey(key) {
        return _keys.get(key) || null;
    },

    /**
     * Get backup-eligible keys.
     * @returns {string[]}
     */
    getBackupEligibleKeys() {
        const result = [];
        for (const [key, entry] of _keys) {
            if (entry.backupPolicy !== "exclude") result.push(key);
        }
        return result;
    },

    /**
     * Get cloud-sync-eligible keys.
     * @returns {string[]}
     */
    getCloudEligibleKeys() {
        const result = [];
        for (const [key, entry] of _keys) {
            if (entry.cloudPolicy === "sync") result.push(key);
        }
        return result;
    },

    entries() {
        return _keys.entries();
    },
});
