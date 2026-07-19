/*******************************************************************************

    uBlock Origin - MV3 Document Blocked Handler
    https://github.com/gorhill/uBlock

    Extracted from sw-entry.ts. Handles the "documentBlocked" messaging channel.

*******************************************************************************/

import { PopupState } from "./sw-storage.js";

export type DocumentBlockedDeps = {
    popupState: PopupState;
    ensurePopupState: () => Promise<void>;
    handleDashboardMessage: (request: any) => Promise<any>;
    persistPermanentHostnameSwitches: () => Promise<void>;
    syncHostnameSwitchDnrRules: () => Promise<void>;
    broadcastFilteringBehaviorChanged: () => void;
    toggleHostnameSwitch: (request: any) => Promise<any>;
    cloneHostnameSwitchState: (state: any) => any;
};

export function createDocumentBlockedHandler(deps: DocumentBlockedDeps) {
    const {
        popupState,
        ensurePopupState,
        handleDashboardMessage,
        persistPermanentHostnameSwitches,
        syncHostnameSwitchDnrRules,
        broadcastFilteringBehaviorChanged,
        toggleHostnameSwitch,
        cloneHostnameSwitchState,
    } = deps;

    return async (request: any, callback?: (result: any) => void) => {
        if (
            request.what === "listsFromNetFilter" ||
            request.what === "listsFromCosmeticFilter"
        ) {
            const result = await handleDashboardMessage(request);
            if (callback) callback(result);
            return result;
        }
        if (request.what === "closeThisTab") {
            const tabId = request._sender?.tab?.id;
            if (typeof tabId === "number") {
                chrome.tabs.remove(tabId).catch(() => {});
            }
            if (callback) callback({ success: true });
            return { success: true };
        }
        if (request.what === "temporarilyWhitelistDocument") {
            const hostname = request.hostname as string;
            if (hostname) {
                const webRequest = (globalThis as any).vAPI?.webRequest;
                if (webRequest?.strictBlockBypass) {
                    webRequest.strictBlockBypass(hostname);
                }
                await ensurePopupState();
                popupState.sessionHostnameSwitches[hostname] = {
                    ...(popupState.sessionHostnameSwitches[hostname] || {}),
                    "no-strict-blocking": true,
                };
                await persistPermanentHostnameSwitches();
                await syncHostnameSwitchDnrRules();
            }
            if (callback) callback({ success: true });
            return { success: true };
        }
        if (request.what === "toggleHostnameSwitch") {
            const hostname = request.hostname as string;
            const switchName = request.name as string;
            const state = request.state !== false;
            const persist = request.persist === true;

            if (hostname && switchName === "no-strict-blocking") {
                await ensurePopupState();
                const sessionSwitches = cloneHostnameSwitchState(
                    popupState.sessionHostnameSwitches,
                );
                sessionSwitches[hostname] = {
                    ...(sessionSwitches[hostname] || {}),
                    [switchName]: state,
                };
                popupState.sessionHostnameSwitches = sessionSwitches;

                if (persist) {
                    popupState.permanentHostnameSwitches = cloneHostnameSwitchState(
                        sessionSwitches,
                    );
                    await persistPermanentHostnameSwitches();
                }

                await syncHostnameSwitchDnrRules();
                void broadcastFilteringBehaviorChanged();

                const result = { success: true };
                if (callback) callback(result);
                return result;
            }

            const result = await toggleHostnameSwitch(request);
            if (callback) callback(result);
            return result;
        }
        if (callback) callback({ success: false });
        return { success: false };
    };
}
