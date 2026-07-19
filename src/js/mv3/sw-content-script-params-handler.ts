/*******************************************************************************

    uBlock Origin - MV3 Content Script Parameters Handler
    https://github.com/gorhill/uBlock

    Builds the parameter object sent to content scripts, including cosmetic
    filtering state, scriptlet injectability, and per-site policy.

******************************************************************************/

import { runPreHooks } from "./site-protector.js";
import { resolvePagePolicy } from "../../../platform/chromium/js/policy-resolver.js";

export interface ContentScriptParamsHandlerDeps {
    getHostnameSwitchState: () => Record<string, Record<string, boolean>>;
    parseStoredCosmeticFilterData: (_data: any) => any;
    buildSpecificCosmeticPayload: (_hostname: string, _cosmeticData: any) => any;
    popupState: { userSettings: Record<string, any>; sessionHostnameSwitches: Record<string, Record<string, boolean>> };
}

export const createContentScriptParamsHandler = (deps: ContentScriptParamsHandlerDeps) => {
    const { getHostnameSwitchState, parseStoredCosmeticFilterData, buildSpecificCosmeticPayload, popupState } = deps;

    return async (payload: any, callback?: any) => {
        try {
            const tabId = payload?._tabId;
            const url = payload?.url || "";
            const frameId = payload?.frameId || 0;
            const hostname = url ? new URL(url).hostname : "";
            const origin = url ? new URL(url).origin : "";

            await runPreHooks(hostname);

            const ancestors: string[] = [];
            if (tabId !== undefined && frameId !== 0) {
                try {
                    const stored = await chrome.storage.local.get("pageStoreMap");
                    const pageStoreData = stored?.pageStoreMap?.[tabId];
                    if (pageStoreData?.frameAncestors) {
                        ancestors.push(...pageStoreData.frameAncestors);
                    }
                } catch (e) {
                    console.warn('[uBR] retrieveContentScriptParameters: failed to read frame ancestors for tab', tabId, e);
                }
            }

            const storedFiltering = await chrome.storage.local.get("perSiteFiltering");
            const perSiteFiltering: Record<string, boolean> =
                (storedFiltering?.perSiteFiltering as Record<string, boolean>) || {};
            const pageScopeKey =
                hostname !== "" && url !== "" ? `${hostname}:${url}` : "";
            const netFilteringEnabled =
                hostname === ""
                    ? true
                    : (perSiteFiltering[pageScopeKey] ??
                    perSiteFiltering[hostname] ??
                    true);

            const stored = await chrome.storage.local.get("userSettings") as Record<string, any>;
            const userSettings = stored.userSettings || popupState.userSettings;

            const hostnameSwitches = await getHostnameSwitchState();
            const noCosmeticFilteringSwitch =
                hostname !== "" &&
                hostnameSwitches[hostname]?.["no-cosmetic-filtering"] === true;
            const noCosmeticFiltering =
                netFilteringEnabled === false || noCosmeticFilteringSwitch;

            const pagePolicy = resolvePagePolicy({
                url,
                hostname,
                trusted: (globalThis as any).isURLTrusted?.(url) ?? false,
                netFilteringEnabled,
                hostnameSwitches,
            });

            const storedCosmeticData = await chrome.storage.local.get(
                "cosmeticFiltersData",
            );
            const cosmeticData = parseStoredCosmeticFilterData(
                storedCosmeticData.cosmeticFiltersData,
            );

            let trustedScriptletTokens: string[] = [];
            try {
                const redirectEngine =
                    (globalThis as any).vAPI?.redirectEngine ||
                    (globalThis as any).redirectEngine;
                if (redirectEngine?.getTrustedScriptletTokens) {
                    trustedScriptletTokens = redirectEngine.getTrustedScriptletTokens();
                }
            } catch (e) {
                console.warn('[uBR] retrieveContentScriptParameters: getTrustedScriptletTokens failed', e);
            }

            const response = {
                advancedUserEnabled: userSettings.advancedUserEnabled === true,
                ancestors,
                autoReload: userSettings.autoReload,
                beautify: userSettings.beautify,
                canDevtoolsBridge: false,
                cloudStorageEnabled: typeof chrome.storage.sync !== "undefined",
                consoleLogEnabled: userSettings.consoleLogEnabled === true,
                contextMenuEnabled: userSettings.contextMenuEnabled === true,
                debugScriptlet: userSettings.debugScriptlet === true,
                extensionPopupEnabled: userSettings.extensionPopupEnabled !== false,
                externalRendererEnabled: false,
                filterAuthorMode: false,
                genericCosmeticFiltersHidden: noCosmeticFiltering,
                getSelection: () => {
                    try {
                        return window.getSelection()?.toString() || "";
                    } catch (e) {
                        console.warn('[uBR] sw-entry: getSelection failed', e);
                        return "";
                    }
                },
                hidePlaceholders: userSettings.hidePlaceholders === true,
                hostname: hostname,
                ignoreGenericCosmeticFilters:
                    userSettings.ignoreGenericCosmeticFilters === true,
                noCosmeticFiltering,
                noGenericCosmeticFiltering: noCosmeticFiltering,
                noSpecificCosmeticFiltering: noCosmeticFiltering,
                origin,
                pageUrl: url,

                popupPanelType: "legacy",
                removeWLCollections: () => {},
                firstPartyDomDetection: pagePolicy?.contentScript?.firstPartyDomDetection === true,
                scriptletInjectable: pagePolicy && pagePolicy.scriptletsEnabled,
                scriptletWillInject: pagePolicy && pagePolicy.scriptletsEnabled,
                specificCosmeticFilters: noCosmeticFiltering
                    ? {
                        ready: true,
                        injectedCSS: "",
                        proceduralFilters: [],
                        exceptionFilters: [],
                        exceptedFilters: [],
                        convertedProceduralFilters: [],
                        genericCosmeticHashes: [],
                        disableSurveyor: true,
                    }
                    : buildSpecificCosmeticPayload(hostname, cosmeticData),
                showIconBadge: userSettings.showIconBadge !== false,
                supportWebSocket: true,
                tabId: tabId,
                trustedScriptletTokens,
                url: url,
                userSettings: userSettings,
                userStyles: "",
                userScripts: "",
                webAllowWildcard: true,
                webextFlavor: "chromium",
            };

            if (callback) callback(response);
        } catch (e) {
            if (callback) callback({ error: (e as Error).message });
        }
    };
};
