/**
 * platform/chromium/js/context-menu-registry.js
 *
 * Central context menu lifecycle registry (P0.1).
 * Every extension context menu is declared here with owner, purpose,
 * and menu-item configuration. The registry provides ensure, verify,
 * disable, reset, and retry-after-failure primitives so that
 * enable/disable/re-enable cycles always produce correct menu state.
 *
 * Usage:
 *   import { registerContextMenu, ensureContextMenus, removeContextMenusByOwner, verifyContextMenus, resetContextMenuRegistry } from "./context-menu-registry.js";
 *
 *   // Declare at module scope
 *   registerContextMenu({ id: "uBlockUltimateBlockElement", title: "Block element...", contexts: ["all"], documentUrlPatterns: ["http://*", "https://*"], owner: "element-picker" });
 *   registerContextMenu({ id: "uBlockUltimateOpenLogger", title: "Open logger", contexts: ["action"], owner: "logger" });
 *
 *   // Install (idempotent)
 *   await ensureContextMenus();
 *
 *   // Remove by owner (safe disable)
 *   await removeContextMenusByOwner("logger");
 *
 *   // Verify installed vs declared
 *   const ok = await verifyContextMenus();
 *
 *   // Full reset (migration / upgrade)
 *   await resetContextMenuRegistry("extension-update");
 */

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------
const _entries = [];
let _installed = false;

/**
 * @typedef {Object} ContextMenuEntry
 * @property {string} id - Unique menu-item ID.
 * @property {string} title - Display text.
 * @property {string[]} contexts - e.g. ["all"], ["action"].
 * @property {string[]} [documentUrlPatterns] - Optional URL match patterns.
 * @property {string} owner - Owner capability name, e.g. "element-picker", "logger", "debug".
 */

export function registerContextMenu(entry) {
    if (!entry || !entry.id) throw new Error("ContextMenuEntry must have an id");
    const idx = _entries.findIndex(e => e.id === entry.id);
    if (idx !== -1) {
        _entries[idx] = { ..._entries[idx], ...entry };
        return;
    }
    _entries.push({ ...entry });
}

export function getRegisteredMenuIds() {
    return _entries.map(e => e.id);
}

export function getEntriesByOwner(owner) {
    return _entries.filter(e => e.owner === owner);
}

// ---------------------------------------------------------------------------
// Install / ensure
// ---------------------------------------------------------------------------
export async function ensureContextMenus({ force = false } = {}) {
    if (_installed && !force) return;

    // Clear only known declaration IDs so we do not nuke other extension menus
    const knownIds = _entries.map(e => e.id);
    for (const id of knownIds) {
        try {
            await chrome.contextMenus.remove(id);
        } catch {
            /* may not exist yet */
        }
    }

    // Create each entry
    for (const entry of _entries) {
        try {
            await chrome.contextMenus.create({
                id: entry.id,
                title: entry.title,
                contexts: entry.contexts,
                documentUrlPatterns: entry.documentUrlPatterns,
            });
        } catch (err) {
            console.warn("[uBlock Ultimate] context-menu-registry: failed to create menu", entry.id, err);
        }
    }

    // Verify before marking installed
    const ok = await verifyContextMenus();
    if (!ok) {
        console.warn("[uBlock Ultimate] context-menu-registry: verification failed after ensure");
    }
    _installed = ok;
}

// ---------------------------------------------------------------------------
// Remove by owner (safe disable without affecting other owners)
// ---------------------------------------------------------------------------
export async function removeContextMenusByOwner(owner) {
    const ids = _entries.filter(e => e.owner === owner).map(e => e.id);
    for (const id of ids) {
        try {
            await chrome.contextMenus.remove(id);
        } catch {
            /* already removed */
        }
    }
    // If all entries are now gone, reset installed flag
    const remaining = _entries.filter(e => !ids.includes(e.id));
    if (remaining.length === 0) {
        _installed = false;
    }
}

// ---------------------------------------------------------------------------
// Verify
// ---------------------------------------------------------------------------
export async function verifyContextMenus() {
    // Chrome does not expose a list-menus API directly, so we check
    // by attempting to update each known entry. If update succeeds the menu exists.
    for (const entry of _entries) {
        try {
            await chrome.contextMenus.update(entry.id, { title: entry.title });
        } catch {
            return false;
        }
    }
    return true;
}

// ---------------------------------------------------------------------------
// Reset (for migration / upgrade / full re-initialization)
// ---------------------------------------------------------------------------
export async function resetContextMenuRegistry(reason) {
    console.log("[uBlock Ultimate] context-menu-registry: reset reason=", reason);
    // Use removeAll only during migration/reset, not routine enable/disable
    await chrome.contextMenus.removeAll().catch(() => {});
    _installed = false;
    // Re-install from declarations
    await ensureContextMenus({ force: true });
}
