/*******************************************************************************

    uBlock Origin - MV3 Messaging Handlers
    https://github.com/gorhill/uBlock

    This file contains all the Messaging.on() handler registrations.

*******************************************************************************/

import type { LegacyMessagingAPI } from './sw-types.js';
interface PopupRequest {
    what?: string;
    [key: string]: any;
}

export const registerMessagingHandlers = (
    messaging: LegacyMessagingAPI,
    deps: {
        handlePopupPanelMessage: (_request: PopupRequest) => Promise<any>;
        getFilterListState: (..._args: any[]) => Promise<any>;
        getDashboardRules: () => Promise<any>;
        modifyDashboardRuleset: (_payload: any) => Promise<any>;
        resetDashboardRules: () => Promise<any>;
        getWhitelist: () => Promise<any>;
        setWhitelist: (_request: any) => Promise<any>;
        handleGetMatchedRuleInfo: (_req: { tabId: number; sinceMs?: number }) => Promise<any>;
        handleDisableMatchedRule: (_req: { rulesetId: string; ruleId: number }) => Promise<any>;
        handleGetSanitizedExport: (_req: { urls?: string[]; redactionMode?: any; userConfirmed?: boolean; matches?: any[] }) => any;
        getCosmeticSelectorsForDomain: (_hostname: string) => string[];
        selectorIsBlockedForCosmeticDomain?: (_hostname: string, _selector: string) => boolean;
        recordCosmeticTelemetry: (_domain: string, _kind: string, _durationMs?: number) => boolean;
        toggleAdvancedCSS: (_hostname: string, _enabled: boolean) => { ok: boolean; hostname: string; enabled: boolean };
        recordPopupAction?: (_req: {
            url: string; hostname: string; action: 'block' | 'allow' | 'dismiss'; timestamp?: number;
        }) => Promise<{ ok: boolean; rule?: string; reason?: string }>;
        isPopupBlocked?: (_hostname: string) => Promise<boolean>;
    }
) => {
    const { handlePopupPanelMessage } = deps;

    messaging.on('ping', (_, callback) => {
        if (callback) callback({ pong: true, timestamp: Date.now() });
    });

    messaging.on('popupPanel', async (payload, callback) => {
        try {
            const result = await handlePopupPanelMessage(payload);
            if (callback) callback(result);
        } catch (e) {
            if (callback) callback({ error: (e as Error).message });
        }
    });

    messaging.on('getTabId', (_, callback) => {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (callback) {
                callback({ tabId: tabs[0]?.id ?? null });
            }
        });
    });

    messaging.on('userSettings', (_, callback) => {
        chrome.storage.local.get('userSettings', (items) => {
            if (callback) {
                callback(items.userSettings || {});
            }
        });
    });

    messaging.on('setUserSettings', (payload, callback) => {
        chrome.storage.local.get('userSettings', (items: Record<string, any>) => {
            const settings = { ...(items.userSettings || {}), ...payload };
            chrome.storage.local.set({ userSettings: settings }, () => {
                if (callback) callback({ success: true });
            });
        });
    });

    // Continue with more handlers...
    messaging.on('dashboardGetRules', async (_, callback) => {
        try {
            const details = await deps.getDashboardRules();
            if ( callback ) {
                callback(details);
            }
            return details;
        } catch (e) {
            const result = { error: (e as Error).message };
            if ( callback ) {
                callback(result);
            }
            return result;
        }
    });

    messaging.on('dashboardModifyRuleset', async (payload, callback) => {
        try {
            const details = await deps.modifyDashboardRuleset(payload || {});
            if ( callback ) {
                callback(details);
            }
            return details;
        } catch (e) {
            const result = { error: (e as Error).message };
            if ( callback ) {
                callback(result);
            }
            return result;
        }
    });

    messaging.on('dashboardResetRules', async (_, callback) => {
        try {
            const details = await deps.resetDashboardRules();
            if ( callback ) {
                callback(details);
            }
            return details;
        } catch (e) {
            const result = { error: (e as Error).message };
            if ( callback ) {
                callback(result);
            }
            return result;
        }
    });

    messaging.on('getWhitelist', async (_, callback) => {
        const details = await deps.getWhitelist();
        if ( callback ) {
            callback(details);
        }
        return details;
    });

    messaging.on('setWhitelist', async (payload, callback) => {
        const details = await deps.setWhitelist(payload);
        if ( callback ) {
            callback(details);
        }
        return details;
    });

    messaging.on('getAssetContent', async (request, callback) => {
        const url = request.url as string;
        try {
            if (!url) {
                if (callback) callback({ content: '', trustedSource: false });
                return;
            }
            // UBR_ALLOW_FETCH_NON_RULE_DATA — filter list data fetch (core ad-blocking function)
            const response = await fetch(url);
            const content = await response.text();
            if (callback) callback({ content, trustedSource: false, sourceURL: url });
        } catch (e) {
            console.warn('[uBR] getAssetContent: fetch failed', url, e);
            if (callback) callback({ content: '', trustedSource: false });
        }
    });

    messaging.on('getAutoCompleteDetails', async (_, callback) => {
        try {
            const stored = await chrome.storage.local.get('selectedFilterLists');
            const selectedLists = stored?.selectedFilterLists || [];
            const lists = await deps.getFilterListState();
            if (callback) callback({ selectedFilterLists: selectedLists, lists });
        } catch (e) {
            console.warn('[uBR] getAutoCompleteDetails: storage.get failed', e);
            if (callback) callback({ selectedFilterLists: [], lists: {} });
        }
    });

    messaging.on('getTrustedScriptletTokens', async (_, callback) => {
        try {
            const redirectEngine = (globalThis as any).vAPI?.redirectEngine || (globalThis as any).redirectEngine;
            const tokens = redirectEngine?.getTrustedScriptletTokens?.() || [];
            if (callback) callback(tokens);
        } catch (e) {
            console.warn('[uBR] getTrustedScriptletTokens: redirectEngine failed', e);
            if (callback) callback([]);
        }
    });

    // === Rev15 §15.4 attribution and diagnostics handlers (Release 0.8) ===
    //
    // Each handler is a thin pass-through to the pure modules in
    // src/attribution/ and src/diagnostics/. The pure modules are
    // testable in isolation; the SW layer is responsible only for
    // resolving the active tab id (via `chrome.tabs.query`) and
    // for the chrome surface (DNR, static-rule disable manager).
    //
    // These handlers are user-gesture-driven only (§7.2): they
    // are called from a popup click, never from background or
    // timer code. They do not cache results.
    messaging.on('getMatchedRuleInfo', async (payload, callback) => {
        try {
            const chromeTabs = (globalThis as any).chrome?.tabs;
            const tabs = chromeTabs && typeof chromeTabs.query === 'function'
                ? await chromeTabs.query({ active: true, currentWindow: true })
                : [];
            const tabId = Array.isArray(tabs) && tabs[0] && Number.isInteger(tabs[0].id)
                ? tabs[0].id as number
                : (payload?.tabId ?? 0);
            const sinceMs = typeof payload?.sinceMs === 'number' ? payload.sinceMs : undefined;
            const result = await deps.handleGetMatchedRuleInfo({ tabId, sinceMs });
            if (callback) callback(result);
        } catch (e) {
            if (callback) callback({ ok: false, reason: (e as Error).message, matches: [] });
        }
    });

    messaging.on('disableMatchedRule', async (payload, callback) => {
        try {
            const result = await deps.handleDisableMatchedRule({
                rulesetId: payload?.rulesetId,
                ruleId: payload?.ruleId,
            });
            if (callback) callback(result);
        } catch (e) {
            if (callback) callback({ ok: false, reason: (e as Error).message, rulesetId: payload?.rulesetId ?? '', ruleId: payload?.ruleId ?? -1, disabledRuleIds: [] });
        }
    });

    messaging.on('getSanitizedExport', (payload, callback) => {
        try {
            const result = deps.handleGetSanitizedExport({
                urls: payload?.urls,
                redactionMode: payload?.redactionMode,
                userConfirmed: payload?.userConfirmed,
                matches: payload?.matches,
            });
            if (callback) callback(result);
        } catch (e) {
            if (callback) callback({ ok: false, reason: (e as Error).message });
        }
    });

    // === Rev15 §6 cosmetic engine handlers (Layer 3) ===
    //
    // Three handlers. Pure pass-throughs to the
    // `CosmeticSelectorStore` and `HighRiskSitePolicy`
    // singletons on the SW side.
    //
    //   'getCosmeticSelectorsForDomain':
    //     content-script asks for the de-exceptioned
    //     selector list for the active hostname.
    //   'cosmeticTelemetry':
    //     content-script forwards long-task / cumulative-
    //     time / mutation-throttle events. Updates
    //     HighRiskSitePolicy.
    //   'toggleAdvancedCSS':
    //     popup toggles `:has()` for a domain.
    messaging.on('getCosmeticSelectorsForDomain', (payload, callback) => {
        try {
            const domain = (payload && typeof payload.hostname === 'string')
                ? payload.hostname
                : '';
            if (!domain) {
                if (callback) callback({ ok: false, reason: 'hostname missing', selectors: [] });
                return;
            }
            const selectors = deps.getCosmeticSelectorsForDomain(domain).filter(
                selector => deps.selectorIsBlockedForCosmeticDomain?.(domain, selector) !== true
            );
            if (callback) callback({ ok: true, selectors });
        } catch (e) {
            if (callback) callback({ ok: false, reason: (e as Error).message, selectors: [] });
        }
    });

    messaging.on('cosmeticTelemetry', (payload, callback) => {
        try {
            const ok = deps.recordCosmeticTelemetry(
                payload && payload.domain,
                payload && payload.kind,
                payload && payload.durationMs,
            );
            if (callback) callback({ ok });
        } catch (e) {
            if (callback) callback({ ok: false, reason: (e as Error).message });
        }
    });

    messaging.on('toggleAdvancedCSS', (payload, callback) => {
        try {
            const result = deps.toggleAdvancedCSS(
                payload && payload.hostname,
                payload && payload.enabled,
            );
            if (callback) callback(result);
        } catch (e) {
            if (callback) callback({ ok: false, reason: (e as Error).message });
        }
    });

    //
    // Rev15 Phase 5: popup blocker.
    // The popup calls this when the user clicks "block this popup",
    // "allow", or "dismiss". Records the action; future requests
    // to the same hostname are checked via `isPopupBlocked`.
    //
    messaging.on('recordPopupAction', async (payload, callback) => {
        try {
            if (typeof deps.recordPopupAction !== 'function') {
                if (callback) callback({ ok: false, reason: 'recordPopupAction not configured' });
                return;
            }
            const r = await deps.recordPopupAction({
                url: payload && payload.url,
                hostname: payload && payload.hostname,
                action: payload && payload.action,
                timestamp: payload && payload.timestamp,
            });
            if (callback) callback(r);
        } catch (e) {
            if (callback) callback({ ok: false, reason: (e as Error).message });
        }
    });

    messaging.on('isPopupBlocked', async (payload, callback) => {
        try {
            if (typeof deps.isPopupBlocked !== 'function') {
                if (callback) callback({ blocked: false, reason: 'isPopupBlocked not configured' });
                return;
            }
            const hostname = payload && payload.hostname;
            if (!hostname) {
                if (callback) callback({ blocked: false });
                return;
            }
            const blocked = await deps.isPopupBlocked(hostname);
            if (callback) callback({ blocked });
        } catch (e) {
            if (callback) callback({ blocked: false, reason: (e as Error).message });
        }
    });
};
