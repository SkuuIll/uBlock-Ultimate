/*
 * Popup settings compatibility layer for the canonical service worker.
 * userSettings is the authoritative persisted store. Legacy popup-specific
 * storage keys are read only to migrate/fill missing values.
 */

export const STORAGE_KEY_POPUP_SETTINGS = "ubrPopupSettings";
export const STORAGE_KEY_USER_SETTINGS = "userSettings";

export const popupSettingKeys = [
    "advancedUserEnabled",
    "colorBlindFriendly",
    "tooltipsDisabled",
    "godMode",
    "fontSize",
    "uiPopupConfig",
    "popupPanelHeightMode",
    "firewallPaneMinimized",
    "popupPanelSections",
    "popupPanelDisabledSections",
    "popupPanelLockedSections",
    "popupPanelOrientation",
];

export const topLevelPopupSettingKeys = [
    "advancedUserEnabled",
    "firewallPaneMinimized",
    "popupPanelSections",
    "popupPanelDisabledSections",
    "popupPanelLockedSections",
    "popupPanelOrientation",
    "popupPanelHeightMode",
];

export function popupSettingsStorageKeys() {
    return [
        STORAGE_KEY_USER_SETTINGS,
        STORAGE_KEY_POPUP_SETTINGS,
        ...topLevelPopupSettingKeys,
    ];
}

function hasOwn(object, key) {
    return Object.prototype.hasOwnProperty.call(object || {}, key);
}

export function mergePopupSettings(defaults = {}, storage = {}) {
    const userSettings = storage[STORAGE_KEY_USER_SETTINGS] || {};
    const legacyPopup = storage[STORAGE_KEY_POPUP_SETTINGS] || {};
    const merged = { ...defaults, ...userSettings };
    let changed = false;

    for (const key of popupSettingKeys) {
        if (hasOwn(userSettings, key)) continue;
        if (hasOwn(legacyPopup, key)) {
            merged[key] = legacyPopup[key];
            changed = true;
            continue;
        }
        if (hasOwn(storage, key)) {
            merged[key] = storage[key];
            changed = true;
        }
    }

    return {
        settings: merged,
        migrated: changed,
    };
}

export function popupSettingsToStorage(settings = {}) {
    const out = {
        [STORAGE_KEY_USER_SETTINGS]: { ...settings },
    };
    for (const key of topLevelPopupSettingKeys) {
        if (hasOwn(settings, key)) out[key] = settings[key];
    }
    out[STORAGE_KEY_POPUP_SETTINGS] = {};
    for (const key of popupSettingKeys) {
        if (hasOwn(settings, key)) out[STORAGE_KEY_POPUP_SETTINGS][key] = settings[key];
    }
    return out;
}

export function isPopupSettingsStorageChange(changes = {}) {
    if (hasOwn(changes, STORAGE_KEY_USER_SETTINGS) || hasOwn(changes, STORAGE_KEY_POPUP_SETTINGS)) {
        return true;
    }
    return topLevelPopupSettingKeys.some(key => hasOwn(changes, key));
}
