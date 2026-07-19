/*******************************************************************************

    uBlock Origin - MV3 Toggle Handlers
    https://github.com/gorhill/uBlock

    This file contains toggle handlers for firewall rules, hostname switches,
    and network filtering.

*******************************************************************************/

import { PopupState } from "./sw-storage.js";

export interface PopupRequest {
  what: string;
  tabId?: number | null;
  name?: string;
  value?: any;
  hostname?: string;
  state?: boolean;
  srcHostname?: string;
  desHostname?: string;
  desHostnames?: Record<string, unknown>;
  requestType?: string;
  action?: number;
  persist?: boolean;
  url?: string;
  scope?: string;
  [key: string]: any;
}

export type ToggleHandlersDeps = {
  popupState: PopupState;
  ensurePopupState: () => Promise<void>;
  getPopupData: (_request: PopupRequest) => Promise<any>;
  persistPermanentFirewall: () => Promise<void>;
  persistPermanentHostnameSwitches: () => Promise<void>;
  cloneHostnameSwitchState: (_state: any) => any;
  hostnameSwitchNames: Set<string>;
  applyImmediateHostnameSwitchEffects: (
    _tabId: number,
    _name: string,
    _enabled: boolean,
  ) => Promise<void>;
  pageStoreFromTabId: (_tabId: number) => Promise<any>;
  updateToolbarIcon: (
    _tabId: number,
    _options: { filtering?: boolean; clickToLoad?: string },
  ) => Promise<void>;
  syncFirewallDnrRules: () => Promise<void>;
  syncHostnameSwitchDnrRules: () => Promise<void>;
  syncPowerSwitchDnrRules: () => Promise<void>;
};

export const createToggleHandlers = (deps: ToggleHandlersDeps) => {
    const {
        popupState,
        ensurePopupState,
        getPopupData,
        persistPermanentFirewall,
        persistPermanentHostnameSwitches,
        cloneHostnameSwitchState,
        hostnameSwitchNames,
        applyImmediateHostnameSwitchEffects,
        pageStoreFromTabId,
        updateToolbarIcon,
        syncFirewallDnrRules,
        syncHostnameSwitchDnrRules,
        syncPowerSwitchDnrRules,
    } = deps;

    const toggleFirewallRule = async (request: PopupRequest) => {
        await ensurePopupState();
        const srcHostname = request.srcHostname || "*";
        const desHostname = request.desHostname || "*";
        const requestType = request.requestType || "*";
        const action = Number(request.action) || 0;

        if (action !== 0) {
      popupState.sessionFirewall.setCell(
          srcHostname,
          desHostname,
          requestType,
          action,
      );
        } else {
      popupState.sessionFirewall.unsetCell(
          srcHostname,
          desHostname,
          requestType,
      );
        }

        if (request.persist) {
            if (action !== 0) {
        popupState.permanentFirewall.setCell(
            srcHostname,
            desHostname,
            requestType,
            action,
        );
            } else {
        popupState.permanentFirewall.unsetCell(
            srcHostname,
            desHostname,
            requestType,
        );
            }
            await persistPermanentFirewall();
        }

        await syncFirewallDnrRules();

        return getPopupData(request);
    };

    const saveFirewallRules = async (request: PopupRequest) => {
        await ensurePopupState();
    popupState.permanentFirewall.copyRules(
      popupState.sessionFirewall,
      request.srcHostname || "",
      request.desHostnames || {},
    );

    await persistPermanentFirewall();
    popupState.permanentHostnameSwitches = cloneHostnameSwitchState(
      popupState.sessionHostnameSwitches,
    );
    await persistPermanentHostnameSwitches();
    await syncFirewallDnrRules();
    await syncHostnameSwitchDnrRules();
    return getPopupData(request);
    };

    const revertFirewallRules = async (request: PopupRequest) => {
        await ensurePopupState();
    popupState.sessionFirewall.copyRules(
      popupState.permanentFirewall,
      request.srcHostname || "",
      request.desHostnames || {},
    );

    popupState.sessionHostnameSwitches = cloneHostnameSwitchState(
      popupState.permanentHostnameSwitches,
    );
    await syncFirewallDnrRules();
    await syncHostnameSwitchDnrRules();
    if (typeof request.tabId === "number") {
        const hostname = request.srcHostname || "";
        const sessionSwitches =
        popupState.sessionHostnameSwitches[hostname] || {};
        for (const name of hostnameSwitchNames) {
            await applyImmediateHostnameSwitchEffects(
          request.tabId,
          name,
          sessionSwitches[name] === true,
            );
        }
    }
    return getPopupData(request);
    };

    const toggleHostnameSwitch = async (request: PopupRequest) => {
        await ensurePopupState();
        const name = request.name || "";
        const hostname = request.srcHostname || request.hostname || "";
        const tabId = request.tabId ?? undefined;
        const enabled = request.state === true;

        if (hostname === "" || hostnameSwitchNames.has(name) === false) {
            return getPopupData(request);
        }

        const hostnameSwitches = cloneHostnameSwitchState(
      popupState.sessionHostnameSwitches,
        );
        const current = { ...(hostnameSwitches[hostname] || {}) };
        if (enabled) {
            current[name] = true;
            hostnameSwitches[hostname] = current;
        } else {
            delete current[name];
            if (Object.keys(current).length === 0) {
                delete hostnameSwitches[hostname];
            } else {
                hostnameSwitches[hostname] = current;
            }
        }

        popupState.sessionHostnameSwitches = hostnameSwitches;
        await syncHostnameSwitchDnrRules();

        if (typeof tabId === "number") {
            await applyImmediateHostnameSwitchEffects(tabId, name, enabled);
        }

        return getPopupData(request);
    };

    const toggleNetFiltering = async (request: PopupRequest) => {
        await ensurePopupState();
        const tabId = request.tabId ?? 0;
        const url = request.url || "";
        const scope = request.scope === 'page' ? 'page' : '';
        const state = request.state !== false;

        if (!tabId || !url) {
            return getPopupData(request);
        }

        try {
            const pageStore = await pageStoreFromTabId(tabId);
            if (pageStore) {
                await pageStore.toggleNetFilteringSwitch(url, scope, state);
            } else {
                const hostname = new URL(url).hostname;
                const storedFiltering =
          await chrome.storage.local.get("perSiteFiltering");
                const perSiteFiltering: Record<string, boolean> =
          (storedFiltering?.perSiteFiltering as Record<string, boolean>) || {};
                const key = scope === "page" ? `${hostname}:${url}` : hostname;
                if (state) {
                    delete perSiteFiltering[key];
                    if (scope !== "page") {
                        const prefix = `${hostname}:`;
                        for (const k of Object.keys(perSiteFiltering)) {
                            if (k.startsWith(prefix)) {
                                delete perSiteFiltering[k];
                            }
                        }
                    }
                } else {
                    perSiteFiltering[key] = false;
                }
                await chrome.storage.local.set({ perSiteFiltering });
            }

            await syncPowerSwitchDnrRules();

            if (typeof tabId === "number") {
        await updateToolbarIcon(tabId, { filtering: state });
            }
        } catch (e) {
      console.error("[MV3] toggleNetFiltering error:", e);
        }

        return getPopupData(request);
    };

    return {
    toggleFirewallRule,
    saveFirewallRules,
    revertFirewallRules,
    toggleHostnameSwitch,
    toggleNetFiltering,
    };
};


