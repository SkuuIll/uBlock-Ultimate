/**
 * src/js/runtime/auto-recovery.ts
 *
 * Automatic recovery when a page looks broken after filtering (P2.4).
 * If a tab matches several breakage signals, enter temporary safe mode.
 *
 * Usage:
 *   import { checkBreakageSignals, enterSafeModeForTab, getSafeModeTabs }
 *     from "./auto-recovery.js";
 */

const MAX_SAFE_MODE_TABS = 100;
const SAFE_MODE_TTL_MS = 30 * 60 * 1000; // 30 minutes

const safeModeTabs = new Map();

export function getSafeModeTabs() {
    pruneExpired();
    return new Map(safeModeTabs);
}

export function isTabInSafeMode(tabId: number): boolean {
    pruneExpired();
    return safeModeTabs.has(tabId);
}

export function enterSafeModeForTab(tabId: number, reason: string): void {
    pruneExpired();
    if (safeModeTabs.size >= MAX_SAFE_MODE_TABS) {
        const oldest = safeModeTabs.keys().next().value;
        if (oldest !== undefined) safeModeTabs.delete(oldest);
    }
    safeModeTabs.set(tabId, {
        reason,
        enteredAt: Date.now(),
    });
}

export function exitSafeModeForTab(tabId: number): void {
    safeModeTabs.delete(tabId);
}

export function cleanupClosedTabs(openTabIds: Set<number>): void {
    for (const tabId of safeModeTabs.keys()) {
        if (!openTabIds.has(tabId)) safeModeTabs.delete(tabId);
    }
}

function pruneExpired(): void {
    const now = Date.now();
    for (const [tabId, entry] of safeModeTabs) {
        if (now - entry.enteredAt > SAFE_MODE_TTL_MS) safeModeTabs.delete(tabId);
    }
}

export function checkBreakageSignals(tabId: number, signals: Record<string, boolean>): boolean {
    let breakageScore = 0;

    if (signals.manyHighRiskDnrBlocks) breakageScore += 2;
    if (signals.scriptXhrBlocks) breakageScore += 2;
    if (signals.bodyNearlyEmpty) breakageScore += 3;
    if (signals.userReloadedRepeatedly) breakageScore += 2;
    if (signals.extensionContentErrors) breakageScore += 1;
    if (signals.zeroAppRootsAfterMutation) breakageScore += 3;
    if (signals.largeViewportHiddenByCSS) breakageScore += 2;

    if (breakageScore >= 5) {
        enterSafeModeForTab(tabId, `breakage score ${breakageScore}`);
        return true;
    }
    return false;
}
