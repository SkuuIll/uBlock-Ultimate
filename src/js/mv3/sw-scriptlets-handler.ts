/*******************************************************************************

    uBlock Origin - MV3 Scriptlets Handler
    https://github.com/gorhill/uBlock

    Extracted from sw-entry.ts. Handles the "scriptlets" messaging channel.

*******************************************************************************/

import {
    applyFilterListSelection,
    reloadAllFilterLists,
} from "./sw-policies.js";

export type ScriptletsDeps = {
    popupState: any;
    ensurePopupState: () => Promise<void>;
};

export function createScriptletsHandler(deps: ScriptletsDeps): (_request: any, _callback?: (_result: any) => void) => any {
    const { popupState, ensurePopupState } = deps;

    return async (request: any, callback?: (result: any) => void) => {
        if (request.what === "applyFilterListSelection") {
            const result = await applyFilterListSelection(
                request as {
                    toSelect?: string[];
                    toImport?: string;
                    toRemove?: string[];
                },
                popupState,
                ensurePopupState,
            );
            if (callback) callback(result);
            return result;
        }
        if (request.what === "reloadAllFilters") {
            const result = await reloadAllFilterLists(popupState, ensurePopupState);
            if (callback) callback(result);
            return result;
        }
        if (request.what === "getAdvancedSettings") {
            const items = await chrome.storage.local.get("advancedSettings");
            const result = items.advancedSettings || {};
            if (callback) callback(result);
            return result;
        }
        if (request.what === "setAdvancedSettings") {
            const settings = request.settings as Record<string, string>;
            if (settings) {
                await chrome.storage.local.set({ advancedSettings: settings });
            }
            if (callback) callback({ success: true });
            return { success: true };
        }
        if (request.what === "readHiddenSettings") {
            const items = await chrome.storage.local.get("hiddenSettings");
            const result = items.hiddenSettings || {};
            if (callback) callback(result);
            return result;
        }
        if (request.what === "writeHiddenSettings") {
            const settings = request.settings as Record<string, any>;
            if (settings) {
                await chrome.storage.local.set({ hiddenSettings: settings });
            }
            if (callback) callback({ success: true });
            return { success: true };
        }
        if (request.what === "cloudUsed") {
            const now = Date.now();
            await chrome.storage.local.set({ lastCloudSync: now });
            if (callback) callback({ success: true });
            return { success: true };
        }
        if (callback) callback({ success: false });
        return { success: false };
    };
}
