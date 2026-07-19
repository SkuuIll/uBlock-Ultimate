/*******************************************************************************

    uBlock Origin - MV3 Default Handler
    https://github.com/gorhill/uBlock

    Extracted from sw-entry.ts. Handles the "default" messaging channel,
    dispatching by request.what.

*******************************************************************************/

import {
    reloadAllFilterLists,
} from "./sw-policies.js";
import { PopupState } from "./sw-storage.js";

export type DefaultDeps = {
    popupState: PopupState;
    ensurePopupState: () => Promise<void>;
    handleDashboardMessage: (request: any) => Promise<any>;
    updateToolbarIcon: (_tabId: number, _options: { filtering?: boolean; clickToLoad?: string }) => Promise<void>;
    adjustColor: (_color: string, _amount: number) => string;
    generateAccentStylesheet: (_accent: string, _dark: boolean) => string;
    appendUserFiltersFromPicker: (_filters: string) => Promise<any>;
    purgeAllCachesForDevTools: () => Promise<any>;
};

export function createDefaultHandler(deps: DefaultDeps) {
    const {
        popupState,
        ensurePopupState,
        handleDashboardMessage,
        updateToolbarIcon,
        adjustColor,
        generateAccentStylesheet,
        appendUserFiltersFromPicker,
        purgeAllCachesForDevTools,
    } = deps;

    const defaultDashboardRoutedRequests = new Set([
        "gotoURL",
        "reloadTab",
        "dismissUnprocessedRequest",
        "launchElementPicker",
        "scriptlet",
        "getAssetContent",
        "getTrustedScriptletTokens",
        "listsFromNetFilter",
        "listsFromCosmeticFilter",
        "loggerDisabled",
        "readAll",
        "toggleInMemoryFilter",
        "hasInMemoryFilter",
        "releaseView",
        "snfeBenchmark",
        "cfeBenchmark",
        "sfeBenchmark",
        "snfeToDNR",
        "snfeDump",
        "snfeQuery",
        "cfeDump",
    ]);

    return async (request: any, callback?: (result: any) => void) => {
        const what = request.what || request?.details?.what;

        if (typeof what === "string" && defaultDashboardRoutedRequests.has(what)) {
            const delegated = await handleDashboardMessage({ ...request, what });
            if (callback) callback(delegated);
            return delegated;
        }

        if (what === "assetViewerRead") {
            const assetKey = request.assetKey as string;
            if (assetKey) {
                const items = await chrome.storage.local.get("assetViewerReadList");
                const readList: string[] = (items.assetViewerReadList as string[]) || [];
                if (!readList.includes(assetKey)) {
                    readList.push(assetKey);
                    await chrome.storage.local.set({ assetViewerReadList: readList });
                }
            }
            if (callback) callback({ success: true });
            return { success: true };
        }
        if (request.what === "getHiddenElementCount") {
            const tabId = request.tabId as number;
            if (typeof tabId === "number") {
                try {
                    const results = await chrome.tabs.sendMessage(tabId, {
                        what: "getHiddenElementCount",
                    });
                    if (callback) callback(results);
                    return results;
                } catch (e) {
                    console.warn('[uBR] getHiddenElementCount: sendMessage failed', tabId, e);
                    if (callback) callback({ count: 0 });
                    return { count: 0 };
                }
            }
            if (callback) callback({ count: 0 });
            return { count: 0 };
        }
        if (request.what === "getScriptCount") {
            const tabId = request.tabId as number;
            if (typeof tabId === "number") {
                try {
                    const results = await chrome.tabs.sendMessage(tabId, {
                        what: "getScriptCount",
                    });
                    if (callback) callback(results);
                    return results;
                } catch (e) {
                    console.warn('[uBR] getScriptCount: sendMessage failed', tabId, e);
                    if (callback) callback({ count: 0 });
                    return { count: 0 };
                }
            }
            if (callback) callback({ count: 0 });
            return { count: 0 };
        }
        if (request.what === "readyToFilter") {
            const tabId = request.tabId as number;
            const url = request.url as string;

            const isReady = popupState.initialized === true;

            if (typeof tabId === "number") {
                try {
                    await chrome.tabs.sendMessage(tabId, { what: "readyToFilter", url });
                    await updateToolbarIcon(tabId, { filtering: true });
                } catch (e) {
                    console.warn('[uBR] readyToFilter: tabs.sendMessage failed for tab', tabId, e);
                }
            }
            if (callback) callback(isReady);
            return isReady;
        }
        if (request.what === "clickToLoad") {
            const tabId = request.tabId as number;
            const hostname = request.hostname as string;
            if (typeof tabId === "number" && hostname) {
                try {
                    await chrome.tabs.sendMessage(tabId, { what: "clickToLoad", hostname });
                    await updateToolbarIcon(tabId, { clickToLoad: hostname });
                } catch (e) {
                    console.warn('[uBR] clickToLoad: tabs.sendMessage failed for tab', tabId, e);
                }
            }
            if (callback) callback({ success: true });
            return { success: true };
        }
        if (request.what === "updateLists") {
            await reloadAllFilterLists(popupState, ensurePopupState);
            if (callback) callback({ success: true });
            return { success: true };
        }
        if (request.what === "createUserFilter") {
            const filter = String(request.filter || request.filters || "");
            if (filter) {
                try {
                    const lines = filter.split("\n").map(l => l.trim()).filter(Boolean);
                    const smartLines: string[] = [];
                    const networkLines: string[] = [];
                    for (const line of lines) {
                        if (line.startsWith("hide|") || line.startsWith("unhide|")) {
                            smartLines.push(line);
                            networkLines.push(line);
                        } else if (/##/.test(line)) {
                            const m = line.match(/^(.*?)(#@?#)(.+)$/);
                            if (m) {
                                const domain = m[1] || "*";
                                const isException = m[2] === "#@#";
                                const selector = m[3];
                                smartLines.push(`${isException ? "unhide" : "hide"}|${domain}|${selector}`);
                            }
                            networkLines.push(line);
                        } else {
                            networkLines.push(line);
                        }
                    }
                    if (smartLines.length > 0) {
                        const { smartRuleStore } = await import("../../core/smart-cosmetic/smart-rule-store");
                        await smartRuleStore.load();
                        for (const smartLine of smartLines) {
                            const parts = smartLine.split("|");
                            const isUnhide = parts[0] === "unhide";
                            const selector = parts[parts.length - 1];
                            const domain = parts.length > 2 ? parts.slice(1, -1).join("|") : "*";
                            if (!selector) continue;
                            const targets = domain === "*"
                                ? [{ form: "host" as const, value: "*" }]
                                : domain.split(",").filter(Boolean).map(d => ({ form: "host" as const, value: d }));
                            const rule = {
                                type: isUnhide ? "show-exact" as const : "hide-exact" as const,
                                id: `ubr:smart:filter-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                                syntaxVersion: 1,
                                state: "active" as const,
                                targets,
                                selector,
                                action: { action: isUnhide ? "show" as const : "hide" as const },
                                metadata: { createdAt: new Date().toISOString(), source: "user-filter" as const },
                                collectionId: "user-filters",
                            };
                            await smartRuleStore.addRule(rule as any);
                        }
                    }
                    if (networkLines.length > 0) {
                        await appendUserFiltersFromPicker(networkLines.join("\n"));
                    }
                } catch (e) {
                    console.warn('[uBR] createUserFilters: failed', e);
                }
            }
            if (callback) callback({ success: true });
            return { success: true };
        }
        if (request.what === "purgeAllCaches") {
            try {
                const result = {
                    success: true,
                    report: await purgeAllCachesForDevTools(),
                };
                if (callback) callback(result);
                return result;
            } catch (e) {
                const result = { success: false, error: (e as Error).message };
                if (callback) callback(result);
                return result;
            }
        }
        if (request.what === "saveURLFilteringRules") {
            const rules = request.rules as any[];
            const colors = request.colors as Record<string, string>;
            if (rules) {
                await chrome.storage.local.set({
                    urlFilteringRules: rules,
                    urlFilteringColors: colors || {
                        allow: "#4caf50",
                        block: "#f44336",
                        noop: "#ff9800",
                    },
                    urlFilteringDirty: false,
                });
            }
            if (callback) callback({ success: true });
            return { success: true };
        }
        if (request.what === "setURLFilteringRule") {
            const rule = request.rule as any;
            if (rule) {
                const stored = await chrome.storage.local.get("urlFilteringRules") as Record<string, any>;
                const rules = stored?.urlFilteringRules || [];

                const existingIndex = rules.findIndex(
                    (r: any) =>
                        r.urlPattern === rule.urlPattern && r.action === rule.action,
                );

                if (existingIndex >= 0) {
                    rules.splice(existingIndex, 1);
                } else {
                    rules.push({
                        ...rule,
                        id: Date.now(),
                        created: Date.now(),
                    });
                }

                await chrome.storage.local.set({
                    urlFilteringRules: rules,
                    urlFilteringDirty: true,
                });
            }
            if (callback) callback({ success: true });
            return { success: true };
        }
        if (request.what === "getURLFilteringData") {
            const stored = await chrome.storage.local.get("urlFilteringRules");
            const storedColors = await chrome.storage.local.get("urlFilteringColors");
            const storedDirty = await chrome.storage.local.get("urlFilteringDirty");

            const defaultColors = {
                allow: "#4caf50",
                block: "#f44336",
                noop: "#ff9800",
            };

            const result = {
                urlFilters: stored?.urlFilteringRules || [],
                colors: storedColors?.urlFilteringColors || defaultColors,
                dirty: storedDirty?.urlFilteringDirty || false,
            };
            if (callback) callback(result);
            return result;
        }
        if (request.what === "uiStyles") {
            const stored = await chrome.storage.local.get("userSettings") as Record<string, any>;
            const hiddenStored = await chrome.storage.local.get("hiddenSettings") as Record<string, any>;
            const userSettings = stored?.userSettings || {};
            const hiddenSettings = hiddenStored?.hiddenSettings || {};
            const dark =
                typeof self.matchMedia === "function" &&
                self.matchMedia("(prefers-color-scheme: dark)").matches;
            const accent = userSettings.uiAccentCustom || "#717191";

            const accentStylesheet =
                popupState.uiAccentStylesheet || generateAccentStylesheet(accent, dark);

            const result = {
                dark,
                accent,
                uiAccentCustom: userSettings.uiAccentCustom || false,
                uiAccentCustom0: userSettings.uiAccentCustom0 || "#3498d6",
                uiAccentStylesheet: accentStylesheet,
                uiStyles: hiddenSettings.uiStyles || "",
                uiTheme: userSettings.uiTheme || "default",
            };
            if (callback) callback(result);
            return result;
        }
        if (request.what === "uiAccentStylesheet") {
            const stored = await chrome.storage.local.get("userSettings") as Record<string, any>;
            const userSettings = stored?.userSettings || {};

            const accent = userSettings.uiAccentCustom || "#717191";
            const dark =
                userSettings.darkMode === true ||
                (userSettings.darkMode === undefined &&
                    typeof window.matchMedia === "function" &&
                    window.matchMedia("(prefers-color-scheme: dark)").matches);

            const result = `
:root {
    --accent: ${accent};
    --accent-light: ${adjustColor(accent, 20)};
    --accent-dark: ${adjustColor(accent, -20)};
    --accent-alpha: ${accent}20;
}

.accent { 
    --accent: ${accent};
}

.accent-light {
    --accent: ${adjustColor(accent, 20)};
}

.accent-dark {
    --accent: ${adjustColor(accent, -20)};
}

${
  dark
      ? `
:root {
    --dark: 1;
}
`
      : ""
}
`;

            popupState.uiAccentStylesheet = result;

            if (callback) callback(result);
            return result;
        }
        if (request.what === "saveUiAccentStylesheet") {
            const stylesheet = request.stylesheet as string;
            if (typeof stylesheet === "string") {
                popupState.uiAccentStylesheet = stylesheet;
                await chrome.storage.local.set({ uiAccentStylesheet: stylesheet });
            }
            if (callback) callback({ success: true });
            return { success: true };
        }
        if (request.what === "getInspectorArgs") {
            const tabId = request.tabId as number;
            const frameId = request.frameId as number;

            try {
                const bc = new BroadcastChannel("contentInspectorChannel");
                bc.postMessage({
                    topic: "inspector",
                    tabId,
                    frameId,
                    timestamp: Date.now(),
                });
                bc.close();
            } catch (e) {
                console.warn('[uBR] contentInspectorChannel: BroadcastChannel postMessage failed', e);
            }

            const warSecret =
                (globalThis as any).vAPI?.warSecret?.short?.() ||
                Math.random().toString(36).slice(2, 10);

            const result = {
                tabId,
                frameId,
                inspectorURL: `/web_accessible_resources/dom-inspector.html?secret=${warSecret}`,
            };
            if (callback) callback(result);
            return result;
        }
        if (callback) callback(undefined);
        return undefined;
    };
}
