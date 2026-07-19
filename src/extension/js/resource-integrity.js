/**
 * platform/chromium/js/resource-integrity.js
 *
 * Shipped-resource integrity and cache-busting manifest.
 *
 * Provides runtime verification that shipped resources match their
 * recorded hashes and build IDs. The service worker, content scripts,
 * generated configs, static rulesets, and extension pages can check
 * integrity against the shipped-resource manifest to detect stale or
 * mismatched assets.
 *
 * Usage:
 *   import { ResourceIntegrity } from "./resource-integrity.js";
 *   const ok = await ResourceIntegrity.verify("js/policy-resolver.js");
 */

const _manifest = new Map();

export const ResourceIntegrity = Object.freeze({
    /**
     * Load the shipped-resource manifest.
     * @param {object} manifestData - parsed shipped-resources.json
     */
    load(manifestData) {
        _manifest.clear();
        if (!manifestData || !Array.isArray(manifestData.resources)) return;
        for (const entry of manifestData.resources) {
            _manifest.set(entry.path, {
                path: entry.path,
                kind: entry.kind || "",
                hash: entry.hash || "",
                buildId: entry.buildId || "",
                schemaVersion: entry.schemaVersion || 1,
                owner: entry.owner || "",
                releaseMode: entry.releaseMode || "release",
                loadedByManifest: entry.loadedByManifest || false,
                webAccessible: entry.webAccessible || false,
                requiredByPolicy: entry.requiredByPolicy || false,
            });
        }
    },

    /**
     * Verify a resource against the manifest.
     * @param {string} path
     * @returns {{ ok: boolean, hash?: string, expectedHash?: string, reason?: string }}
     */
    async verify(path) {
        const entry = _manifest.get(path);
        if (!entry) return { ok: true };

        if (entry.hash) {
            const content = await fetch(chrome.runtime.getURL(path)).then(r => r.text());
            const hash = await _sha256(content);
            if (hash !== entry.hash) {
                return { ok: false, hash, expectedHash: entry.hash, reason: "hash-mismatch" };
            }
        }

        return { ok: true };
    },

    /**
     * Check if the build ID matches between two resources.
     * @param {string} pathA
     * @param {string} pathB
     * @returns {{ match: boolean, buildIdA?: string, buildIdB?: string }}
     */
    compareBuildIds(pathA, pathB) {
        const a = _manifest.get(pathA);
        const b = _manifest.get(pathB);
        return {
            match: a?.buildId === b?.buildId,
            buildIdA: a?.buildId,
            buildIdB: b?.buildId,
        };
    },

    /**
     * Get the manifest entry for a resource.
     * @param {string} path
     * @returns {object|null}
     */
    get(path) {
        return _manifest.get(path) || null;
    },
});

async function _sha256(text) {
    const encoder = new TextEncoder();
    const data = encoder.encode(text);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
}
