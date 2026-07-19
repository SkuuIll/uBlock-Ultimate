/**
 * platform/chromium/js/dnr-transaction.js
 *
 * Transactional DNR updates with rollback (P2.5, P0.7).
 * Algorithm:
 *   1. Snapshot current dynamic + session rules.
 *   2. Remove all current target-scope rules.
 *   3. Install next rules.
 *   4. On failure, remove current rules and restore snapshot.
 *   5. If rollback fails, enter degraded allow mode (clear everything).
 *
 * Usage:
 *   import { updateDnrTransaction } from "./dnr-transaction.js";
 *
 *   const result = await updateDnrTransaction(nextDynamicRules, nextSessionRules);
 *   if (!result.ok) { // rollback happened
 */

export async function snapshotDnrRules() {
    const [dynamicRules, sessionRules] = await Promise.all([
        chrome.declarativeNetRequest.getDynamicRules().catch(() => []),
        chrome.declarativeNetRequest.getSessionRules().catch(() => []),
    ]);
    return { dynamicRules, sessionRules };
}

async function _removeAllTargetScopeDynamic() {
    const current = await chrome.declarativeNetRequest.getDynamicRules().catch(() => []);
    const ids = current.map(r => r.id);
    if (ids.length > 0) {
        await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: ids, addRules: [] });
    }
}

async function _removeAllTargetScopeSession() {
    const current = await chrome.declarativeNetRequest.getSessionRules().catch(() => []);
    const ids = current.map(r => r.id);
    if (ids.length > 0) {
        await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: ids, addRules: [] });
    }
}

export async function restoreDnrSnapshot(snapshot) {
    // Remove current rules first, then add snapshot rules
    await _removeAllTargetScopeDynamic();
    await _removeAllTargetScopeSession();
    await Promise.all([
        chrome.declarativeNetRequest.updateDynamicRules({
            removeRuleIds: [],
            addRules: snapshot.dynamicRules,
        }).catch(() => {}),
        chrome.declarativeNetRequest.updateSessionRules({
            removeRuleIds: [],
            addRules: snapshot.sessionRules,
        }).catch(() => {}),
    ]);
}

export async function updateDnrTransaction(nextDynamic, nextSession) {
    const snapshot = await snapshotDnrRules();
    try {
        // Remove current rules first (avoid stale rule conflicts)
        await _removeAllTargetScopeDynamic();
        await _removeAllTargetScopeSession();

        if (nextDynamic && nextDynamic.length > 0) {
            await chrome.declarativeNetRequest.updateDynamicRules({
                removeRuleIds: [],
                addRules: nextDynamic,
            });
        }
        if (nextSession && nextSession.length > 0) {
            await chrome.declarativeNetRequest.updateSessionRules({
                removeRuleIds: [],
                addRules: nextSession,
            });
        }

        // Read back and verify by rule key (content-based, not just count)
        const installedDynamic = await chrome.declarativeNetRequest.getDynamicRules().catch(() => []);
        const installedSession = await chrome.declarativeNetRequest.getSessionRules().catch(() => []);

        function ruleKey(r) { return JSON.stringify({ action: r.action, condition: r.condition, priority: r.priority }); }
        const installedDynamicKeys = new Set(installedDynamic.map(ruleKey));
        const installedSessionKeys = new Set(installedSession.map(ruleKey));
        let missingDynamic = 0, extraDynamic = 0;
        if (nextDynamic) {
            const expectedKeys = new Set(nextDynamic.map(ruleKey));
            missingDynamic = [...expectedKeys].filter(k => !installedDynamicKeys.has(k)).length;
            extraDynamic = [...installedDynamicKeys].filter(k => !expectedKeys.has(k)).length;
        }
        let missingSession = 0, extraSession = 0;
        if (nextSession) {
            const expectedKeys = new Set(nextSession.map(ruleKey));
            missingSession = [...expectedKeys].filter(k => !installedSessionKeys.has(k)).length;
            extraSession = [...installedSessionKeys].filter(k => !expectedKeys.has(k)).length;
        }

        if (missingDynamic > 0 || extraDynamic > 0 || missingSession > 0 || extraSession > 0) {
            throw new Error(`Rule mismatch: dynamic ${missingDynamic} missing, ${extraDynamic} extra; session ${missingSession} missing, ${extraSession} extra`);
        }

        return { ok: true };
    } catch (err) {
        // Rollback: remove current, restore snapshot
        try {
            await restoreDnrSnapshot(snapshot);
        } catch (_) {
            // Enter degraded allow mode
            try {
                await chrome.declarativeNetRequest.updateDynamicRules({
                    removeRuleIds: (await chrome.declarativeNetRequest.getDynamicRules().catch(() => [])).map(r => r.id),
                    addRules: [],
                });
                await chrome.declarativeNetRequest.updateSessionRules({
                    removeRuleIds: (await chrome.declarativeNetRequest.getSessionRules().catch(() => [])).map(r => r.id),
                    addRules: [],
                });
            } catch (_2) {
                // Last resort: clear everything
            }
        }
        return { ok: false, error: String(err) };
    }
}
