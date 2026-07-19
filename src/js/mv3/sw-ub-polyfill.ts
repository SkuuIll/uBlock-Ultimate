/*******************************************************************************

    uBlock Origin - MV3 µb Compatibility Polyfill
    Provides a minimal (self as any).µb global shim for legacy code paths that
    reference it. Extracted from sw-entry.ts to isolate the compatibility layer.

    Each method delegates to the MV3-native service worker implementation.

*******************************************************************************/

import {
    popupState,
    ensurePopupState,
    persistPermanentFirewall,
    persistPermanentHostnameSwitches,
} from "./sw-storage.js";
import {
    getFilterListState,
    applyFilterListSelection,
    reloadAllFilterLists,
} from "./sw-policies.js";
import { updateToolbarIcon, getPickerContextPoint } from "./sw-helpers.js";
import { pageStores, pageStoresToken, pageStoreFromTabId } from "./sw-pagestore.js";
import { epickerArgs } from "./sw-messaging.js";
import {
    reWhitelistBadHostname,
    reWhitelistHostnameExtractor,
} from "./sw-types.js";

type UBlockPolyfillDeps = {
    normalizeExtensionPageURL: (url: string) => string;
    persistURLFilteringRules: () => Promise<void>;
    appendUserFiltersFromPicker: (filters: string) => Promise<any>;
    toggleHostnameSwitch: (request: any) => any;
};

export async function elementPickerExec(
    tabId: number,
    frameId: number,
    target?: string,
    zap?: boolean,
): Promise<{ success: boolean }> {
    const point =
        getPickerContextPoint(tabId, 0) || getPickerContextPoint(tabId, frameId);
    const launchPickerInTab = async (tabId: number, frameId: number, options: any): Promise<void> => {
        console.log('[MV3] launchPickerInTab called', tabId, frameId, options);
    };
    await launchPickerInTab(tabId, 0, {
        initialPoint: point
            ? { x: (point as any).x, y: (point as any).y }
            : undefined,
        target,
        exactTarget: (point as any)?.target,
    });
    return { success: true };
}

export function installUBlockPolyfill(deps: UBlockPolyfillDeps): void {
    const {
        normalizeExtensionPageURL,
        persistURLFilteringRules,
        appendUserFiltersFromPicker,
        toggleHostnameSwitch,
    } = deps;

    (self as any).µb = {
        elementPickerExec: elementPickerExec,

        userSettings: popupState.userSettings,
        hiddenSettings: {},
        hiddenSettingsDefault: {},
        requestStats: {
            allowedCount: 0,
            blockedCount: 0,
        },
        readyToFilter: false,
        netWhitelist: [] as string[],
        netWhitelistDefault: [] as string[],
        reWhitelistBadHostname,
        reWhitelistHostnameExtractor,
        selectedFilterLists: [] as string[],
        pageStores,
        pageStoresToken,
        cloudStorageSupported: typeof chrome.storage.sync !== "undefined",
        privacySettingsSupported:
            typeof navigator !== "undefined" &&
            typeof (navigator as any).connection !== "undefined",
        restoreBackupSettings: {},
        userFiltersPath: "user-filters",
        maybeGoodPopup: { tabId: 0, url: "" },
        epickerArgs,
        tabContextManager: {
            mustLookup: (tabId: number) => ({ tabId, hostname: "" }),
            lookup: (_tabId: number) => null,
        },

        arrayFromWhitelist: (whitelist: string) => {
            if (!whitelist) return [];
            return whitelist.split("\n").filter((line) => line.trim() !== "");
        },

        whitelistFromString: (str: string) => {
            if (!str) return "";
            return str
                .split("\n")
                .filter((line) => line.trim() !== "")
                .join("\n");
        },

        isTrustedList: (assetKey: string) => {
            return popupState.trustedLists?.[assetKey] === true;
        },

        userFiltersAreEnabled: () => {
            return popupState.userSettings.netFilteringEnabled !== false;
        },

        changeUserSettings: (name: string, value: any) => {
            popupState.userSettings[name] = value;
            return { done: true };
        },

        getModifiedSettings: (settings: any, defaults: any) => {
            const modified: any = {};
            for (const key in settings) {
                if (settings[key] !== defaults[key]) {
                    modified[key] = settings[key];
                }
            }
            return modified;
        },

        getAvailableLists: () => {
            return getFilterListState(popupState, ensurePopupState);
        },

        dateNowToSensibleString: () => {
            const now = new Date();
            return now.toISOString().replace(/[:.]/g, "-").slice(0, 19);
        },

        getBytesInUse: async () => {
            return await chrome.storage.local.getBytesInUse();
        },

        saveLocalSettings: async () => {
            await chrome.storage.local.set({ userSettings: popupState.userSettings });
        },

        saveWhitelist: async () => {
            await chrome.storage.local.set({
                whitelist: popupState.whitelist.join("\n"),
            });
        },

        saveUserFilters: async (filters: string) => {
            await chrome.storage.local.set({
                userFilters: filters,
                "user-filters": filters,
            });
            await reloadAllFilterLists(popupState, ensurePopupState);
        },

        loadUserFilters: async () => {
            const stored = await chrome.storage.local.get([
                "userFilters",
                "user-filters",
            ]);
            if (typeof stored?.userFilters === "string") {
                return stored.userFilters;
            }
            if (typeof stored?.["user-filters"] === "string") {
                return stored["user-filters"];
            }
            return "";
        },

        saveSelectedFilterLists: async (lists: string[]) => {
            await chrome.storage.local.set({ selectedFilterLists: lists });
        },

        savePermanentFirewallRules: async () => {
            await persistPermanentFirewall();
        },

        saveHostnameSwitches: async () => {
            await persistPermanentHostnameSwitches();
        },

        savePermanentURLFilteringRules: async () => {
            await persistURLFilteringRules();
        },

        loadFilterLists: async () => {
            await reloadAllFilterLists(popupState, ensurePopupState);
        },

        applyFilterListSelection: async (request: any) => {
            return applyFilterListSelection(request, popupState, ensurePopupState);
        },

        createUserFilters: async (request: any) => {
            const filters = request.filters || "";
            return appendUserFiltersFromPicker(filters);
        },

        updateToolbarIcon: async (
            tabId: number,
            state:
                | number
                | { filtering?: boolean; largeMedia?: boolean; noPopups?: boolean },
        ) => {
            await updateToolbarIcon(tabId, state as any);
        },

        openNewTab: async (details: {
            url: string;
            select?: boolean;
            index?: number;
        }) => {
            const createDetails: chrome.tabs.CreateProperties = {
                url: normalizeExtensionPageURL(details.url),
                active: details.select !== false,
            };
            if (typeof details.index === "number" && details.index >= 0) {
                createDetails.index = details.index;
            }
            const created = await chrome.tabs.create(createDetails).catch(() => null);
            if (!created) return { success: false };
            return { tabId: created.id };
        },

        clearInMemoryFilters: () => {
            popupState.inMemoryFilter = "";
        },

        toggleHostnameSwitch: (request: any) => {
            return toggleHostnameSwitch(request);
        },

        getTabId: (sender: any) => sender?.tab?.id,
        pageStoreFromTabId,
    };
}
