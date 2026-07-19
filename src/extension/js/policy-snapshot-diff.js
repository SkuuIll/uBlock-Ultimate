/**
 * platform/chromium/js/policy-snapshot-diff.js
 *
 * Policy snapshot diff utility.
 *
 * Computes the difference between two policy snapshots, identifying
 * which fields changed, their before/after values, and the net effect
 * on runtime behavior. Used by the logger, diagnostics, and repair
 * workflow to explain why behavior changed after a policy update.
 *
 * Usage:
 *   import { PolicySnapshotDiff } from "./policy-snapshot-diff.js";
 *   const changes = PolicySnapshotDiff.diff(before, after);
 */

export const PolicySnapshotDiff = Object.freeze({
    /**
     * Compute the diff between two policy snapshots.
     * @param {object} before
     * @param {object} after
     * @returns {{ changed: string[], added: string[], removed: string[], diffs: object[] }}
     */
    diff(before, after) {
        const changed = [];
        const added = [];
        const removed = [];
        const diffs = [];

        const allKeys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);

        for (const key of allKeys) {
            if (!(key in before)) {
                added.push(key);
                diffs.push({ key, type: "added", after: after[key] });
            } else if (!(key in after)) {
                removed.push(key);
                diffs.push({ key, type: "removed", before: before[key] });
            } else if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
                changed.push(key);
                diffs.push({ key, type: "changed", before: before[key], after: after[key] });
            }
        }

        return { changed, added, removed, diffs };
    },
});
