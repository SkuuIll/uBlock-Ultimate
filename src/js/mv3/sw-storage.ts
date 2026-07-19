/*******************************************************************************

    uBlock Origin - MV3 Storage
    https://github.com/gorhill/uBlock

    This file contains storage operations and popup state management.

*******************************************************************************/

import {
    userSettingsDefault,
    type HostnameSwitchState,
} from './sw-types.js';
import { DynamicFirewallRules } from './sw-classes.js';
import { updateToolbarIcon } from './sw-helpers.js';
import { runMigrations } from './sw-storage-schema.js';

export interface PopupState {
    userSettings: typeof userSettingsDefault;
    permanentFirewall: DynamicFirewallRules;
    sessionFirewall: DynamicFirewallRules;
    permanentHostnameSwitches: HostnameSwitchState;
    sessionHostnameSwitches: HostnameSwitchState;
    globalAllowedRequestCount: number;
    globalBlockedRequestCount: number;
    whitelist: string[];
    initialized: boolean;
    initPromise: Promise<void>;
    tabMetrics: Record<number, { blocked?: number; allowed?: number; hasUnprocessedRequest?: boolean }>;
    noDashboard?: boolean;
    specificCosmeticFilters?: unknown;
    uiAccentStylesheet?: string;
    trustedLists?: Record<string, boolean>;
    inMemoryFilter?: string;
    lastBackupFile?: string;
    lastBackupTime?: number;
    lastRestoreFile?: string;
    lastRestoreTime?: number;
}

export const popupState: PopupState = {
    userSettings: { ...userSettingsDefault },
    permanentFirewall: new DynamicFirewallRules(),
    sessionFirewall: new DynamicFirewallRules(),
    permanentHostnameSwitches: {},
    sessionHostnameSwitches: {},
    globalAllowedRequestCount: 0,
    globalBlockedRequestCount: 0,
    whitelist: [],
    initialized: false,
    initPromise: Promise.resolve(),
    tabMetrics: {},
};

export const ensurePopupState = async (): Promise<void> => {
    if (popupState.initialized) return;
    popupState.initPromise = popupState.initPromise.then(async () => {
        if (popupState.initialized) return;
        await runMigrations();
        const stored = await chrome.storage.local.get([
            'userSettings',
            'dynamicFilteringString',
            'permanentSwitches',
            'whitelist',
            'globalAllowedRequestCount',
            'globalBlockedRequestCount',
        ]) as Record<string, any>;

        popupState.userSettings = {
            ...userSettingsDefault,
            ...(stored.userSettings || {}),
        };

        popupState.permanentFirewall.reset();
        if ( typeof stored.dynamicFilteringString === 'string' ) {
            popupState.permanentFirewall.fromString(stored.dynamicFilteringString);
        }
        popupState.sessionFirewall.assign(popupState.permanentFirewall);

        const permanentSwitches = stored.permanentSwitches instanceof Object
            ? stored.permanentSwitches as HostnameSwitchState
            : {};
        popupState.permanentHostnameSwitches = cloneHostnameSwitchState(permanentSwitches);
        popupState.sessionHostnameSwitches = cloneHostnameSwitchState(permanentSwitches);

        if ( Array.isArray(stored.whitelist) ) {
            popupState.whitelist = stored.whitelist.filter((entry): entry is string => typeof entry === 'string');
        } else if ( typeof stored.whitelist === 'string' ) {
            popupState.whitelist = stored.whitelist.split('\n').filter(Boolean);
        } else {
            popupState.whitelist = [];
        }

        popupState.globalAllowedRequestCount =
            typeof stored.globalAllowedRequestCount === 'number'
                ? stored.globalAllowedRequestCount
                : 0;
        popupState.globalBlockedRequestCount =
            typeof stored.globalBlockedRequestCount === 'number'
                ? stored.globalBlockedRequestCount
                : 0;

        popupState.initialized = true;
    });
    await popupState.initPromise;
};

export const persistUserSettings = async (): Promise<void> => {
    await chrome.storage.local.set({ userSettings: popupState.userSettings });
};

export const persistPermanentFirewall = async (): Promise<void> => {
    await chrome.storage.local.set({
        dynamicFilteringString: popupState.permanentFirewall.toString(),
    });
};

export const persistPermanentHostnameSwitches = async (): Promise<void> => {
    await chrome.storage.local.set({
        permanentSwitches: popupState.permanentHostnameSwitches,
    });
};

export const getModifiedSettings = (current: Record<string, unknown>, defaults: Record<string, unknown>): Record<string, unknown> => {
    const modified: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(current)) {
        if (value !== defaults[key]) {
            modified[key] = value;
        }
    }
    return modified;
};

export const backupUserData = async (): Promise<void> => {
    await ensurePopupState();
    const storage = await chrome.storage.local.get(null);
    const json = JSON.stringify(storage);
    const base64 = btoa(json);
    const dataUrl = `data:application/json;base64,${base64}`;
    const filename = `ublock-backup-${Date.now()}.json`;
    await chrome.downloads.download({ url: dataUrl, filename, saveAs: true });
};

export const restoreUserData = async (request: { userData?: unknown; file?: string }): Promise<void> => {
    await ensurePopupState();
    if (request.userData && typeof request.userData === 'object') {
        await chrome.storage.local.set(request.userData as Record<string, unknown>);
    }
};

export const getLocalData = async (): Promise<Record<string, unknown>> => {
    const storageUsed = await chrome.storage.local.getBytesInUse(null);
    const localData = ((await chrome.storage.local.get('localData') as Record<string, any>)).localData || {} as Record<string, any>;
    const userSettings = ((await chrome.storage.local.get('userSettings') as Record<string, any>)).userSettings || {};
    return {
        storageUsed,
        lastBackupFile: localData.lastBackupFile || '',
        lastBackupTime: localData.lastBackupTime || 0,
        lastRestoreFile: localData.lastRestoreFile || '',
        lastRestoreTime: localData.lastRestoreTime || 0,
        cloudStorageSupported: userSettings.cloudStorageEnabled === true && typeof chrome.storage.sync !== 'undefined',
    };
};

export const resetUserData = async (): Promise<void> => {
    popupState.userSettings = { ...userSettingsDefault };
    await persistUserSettings();
    await chrome.storage.local.set({
        selectedFilterLists: [],
        filterLists: {},
        netWhitelist: '',
        whitelist: '',
        dynamicRules: [],
    });
};

export const cloneHostnameSwitchState = (state: HostnameSwitchState): HostnameSwitchState => {
    const cloned: HostnameSwitchState = {};
    for (const hostname of Object.keys(state)) {
        cloned[hostname] = { ...state[hostname] };
    }
    return cloned;
};

export const applyImmediateHostnameSwitchEffects = async (tabId: number, name: string, enabled: boolean): Promise<void> => {
    if (name === 'no-popups' || name === 'no-cosmetic-filtering') {
        await updateToolbarIcon(tabId, { filtering: true });
    }
};
