/*******************************************************************************

    uBlock Origin - MV3 Shared Service Worker Context
    https://github.com/gorhill/uBlock

    Singleton context assembled by sw-entry.ts and consumed by every handler
    module. This replaces per-handler-factory deps interfaces with a single
    typed contract.

    Handlers destructure what they need rather than receiving opaque factory
    deps. Adding a new service here does not break existing handlers.

*******************************************************************************/

import type { PopupState } from "./sw-storage.js";
import type { DynamicFirewallRules } from "./sw-classes.js";
import type { LegacyMessagingAPI } from "./sw-types.js";
import type { MessagingRouterAPI } from "./sw-message-router.js";

export interface SWContext {
    // State
    popupState: PopupState;
    ensurePopupState: () => Promise<void>;

    // Messaging
    messaging: MessagingRouterAPI;
    getLegacyMessaging: () => LegacyMessagingAPI | undefined;
    broadcastFilteringBehaviorChanged: () => void;

    // Popup data
    getPopupData: (_request: any) => Promise<any>;
    getTabSwitchMetrics: (_tabId: number) => Promise<any>;
    getHiddenElementCountForTab: (_tabId: number) => Promise<number>;
    pageStoreFromTabId: (_tabId: number) => Promise<any>;

    // Settings & toggles
    setUserSetting: (_request: any) => Promise<any>;
    toggleNetFiltering: (_request: any) => Promise<any>;
    toggleFirewallRule: (_request: any) => Promise<any>;
    saveFirewallRules: (_request: any) => Promise<any>;
    revertFirewallRules: (_request: any) => Promise<any>;
    toggleHostnameSwitch: (_request: any) => Promise<any>;

    // Persistence
    persistPermanentFirewall: () => Promise<void>;
    persistPermanentHostnameSwitches: () => Promise<void>;
    cloneHostnameSwitchState: (
        _state: Record<string, Record<string, boolean>>,
    ) => Record<string, Record<string, boolean>>;

    // DNR sync
    syncFirewallDnrRules: () => Promise<void>;
    syncHostnameSwitchDnrRules: () => Promise<void>;
    syncPowerSwitchDnrRules: () => Promise<void>;
    syncWhitelistDnrRules: () => Promise<void>;

    // Filter lists
    getFilterListState: () => Promise<any>;
    applyFilterListSelection: (_request: any) => Promise<any>;
    reloadAllFilterLists: () => Promise<any>;
    updateFilterListsNow: (_request?: any) => Promise<any>;

    // Dashboard
    getLocalData: () => Promise<any>;
    backupUserData: () => Promise<void>;
    restoreUserData: (_request: any) => Promise<void>;
    resetUserData: () => Promise<void>;
    getDeviceName: () => Promise<string>;
    encodeCloudData: (_data: any) => Promise<string>;
    decodeCloudData: (_encoded: string) => Promise<any>;

    // Whitelist
    getWhitelist: () => Promise<any>;
    setWhitelist: (_payload: any) => Promise<any>;

    // Cosmetic filtering
    getHostnameSwitchState: () => Record<string, Record<string, boolean>>;
    parseStoredCosmeticFilterData: (_data: any) => any;
    buildSpecificCosmeticPayload: (_hostname: string, _data: any) => any;
    findFilterListFromNetFilter: (_raw: string) => Promise<any[]>;
    findFilterListFromCosmeticFilter: (_raw: string) => Promise<any[]>;

    // UI helpers
    updateToolbarIcon: (_tabId: number, _options: any) => Promise<void>;
    adjustColor: (_color: string, _amount: number) => string;
    generateAccentStylesheet: (_accent: string, _dark: boolean) => string;

    // Dashboard message handler (legacy bridge)
    handleDashboardMessage: (_request: any) => Promise<any>;

    // Element picker
    elementPickerExec: (_tabId: number, _frameId: number, _target?: string, _zap?: boolean) => Promise<any>;
    appendUserFiltersFromPicker: (_filters: string) => Promise<any>;

    // Engine
    getEngineState: () => any;

    // Dev
    purgeAllCachesForDevTools: () => Promise<any>;
}
