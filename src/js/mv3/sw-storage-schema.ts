/*******************************************************************************

    uBlock Ultimate - MV3 Storage Schema
    https://github.com/SkuuIll/uBlock-Ultimate

    Centralized storage key definitions with types, defaults, and migration
    version tracking. All chrome.storage.local access should use keys
    defined here.

*******************************************************************************/

export const STORAGE_VERSION = 1;

/** Known storage keys with their expected types and default values. */
export const STORAGE_KEYS = {
  userSettings: "userSettings",
  dynamicFilteringString: "dynamicFilteringString",
  permanentSwitches: "permanentSwitches",
  whitelist: "whitelist",
  netWhitelist: "netWhitelist",
  selectedFilterLists: "selectedFilterLists",
  availableFilterLists: "availableFilterLists",
  filterLists: "filterLists",
  userFilters: "userFilters",
  "user-filters": "user-filters",
  perSiteFiltering: "perSiteFiltering",
  cosmeticFiltersData: "cosmeticFiltersData",
  globalAllowedRequestCount: "globalAllowedRequestCount",
  globalBlockedRequestCount: "globalBlockedRequestCount",
  ubrURLFilteringRules: "ubrURLFilteringRules",
  popupPanelSections: "popupPanelSections",
  popupPanelOrientation: "popupPanelOrientation",
  popupPanelDisabledSections: "popupPanelDisabledSections",
  popupPanelLockedSections: "popupPanelLockedSections",
  firewalPaneMinimized: "firewallPaneMinimized",
  localData: "localData",
  dynamicRules: "dynamicRules",
  cloudData: "cloudData",
  cloudOptions: "cloudOptions",
  storageVersion: "storageVersion",
} as const;

export type StorageKey = (typeof STORAGE_KEYS)[keyof typeof STORAGE_KEYS];

export interface StorageKeyMeta {
  key: string;
  type: "string" | "object" | "number" | "boolean" | "array";
  default: unknown;
  sinceVersion: number;
  deprecated?: string;
}

export const STORAGE_SCHEMA: Record<string, StorageKeyMeta> = {
  [STORAGE_KEYS.userSettings]: {
    key: STORAGE_KEYS.userSettings,
    type: "object",
    default: {},
    sinceVersion: 1,
  },
  [STORAGE_KEYS.dynamicFilteringString]: {
    key: STORAGE_KEYS.dynamicFilteringString,
    type: "string",
    default: "",
    sinceVersion: 1,
  },
  [STORAGE_KEYS.permanentSwitches]: {
    key: STORAGE_KEYS.permanentSwitches,
    type: "object",
    default: {},
    sinceVersion: 1,
  },
  [STORAGE_KEYS.whitelist]: {
    key: STORAGE_KEYS.whitelist,
    type: "array",
    default: [],
    sinceVersion: 1,
  },
  [STORAGE_KEYS.netWhitelist]: {
    key: STORAGE_KEYS.netWhitelist,
    type: "string",
    default: "",
    sinceVersion: 1,
    deprecated: "Use whitelist instead",
  },
  [STORAGE_KEYS.selectedFilterLists]: {
    key: STORAGE_KEYS.selectedFilterLists,
    type: "array",
    default: [],
    sinceVersion: 1,
  },
  [STORAGE_KEYS.availableFilterLists]: {
    key: STORAGE_KEYS.availableFilterLists,
    type: "object",
    default: {},
    sinceVersion: 1,
  },
  [STORAGE_KEYS.filterLists]: {
    key: STORAGE_KEYS.filterLists,
    type: "object",
    default: {},
    sinceVersion: 1,
  },
  [STORAGE_KEYS.userFilters]: {
    key: STORAGE_KEYS.userFilters,
    type: "string",
    default: "",
    sinceVersion: 1,
  },
  [STORAGE_KEYS["user-filters"]]: {
    key: STORAGE_KEYS["user-filters"],
    type: "string",
    default: "",
    sinceVersion: 1,
    deprecated: "Use userFilters instead",
  },
  [STORAGE_KEYS.perSiteFiltering]: {
    key: STORAGE_KEYS.perSiteFiltering,
    type: "object",
    default: {},
    sinceVersion: 1,
  },
  [STORAGE_KEYS.cosmeticFiltersData]: {
    key: STORAGE_KEYS.cosmeticFiltersData,
    type: "object",
    default: {},
    sinceVersion: 1,
  },
  [STORAGE_KEYS.globalAllowedRequestCount]: {
    key: STORAGE_KEYS.globalAllowedRequestCount,
    type: "number",
    default: 0,
    sinceVersion: 1,
  },
  [STORAGE_KEYS.globalBlockedRequestCount]: {
    key: STORAGE_KEYS.globalBlockedRequestCount,
    type: "number",
    default: 0,
    sinceVersion: 1,
  },
  [STORAGE_KEYS.ubrURLFilteringRules]: {
    key: STORAGE_KEYS.ubrURLFilteringRules,
    type: "object",
    default: {},
    sinceVersion: 1,
  },
  [STORAGE_KEYS.popupPanelSections]: {
    key: STORAGE_KEYS.popupPanelSections,
    type: "object",
    default: {},
    sinceVersion: 1,
  },
  [STORAGE_KEYS.popupPanelOrientation]: {
    key: STORAGE_KEYS.popupPanelOrientation,
    type: "string",
    default: "vertical",
    sinceVersion: 1,
  },
  [STORAGE_KEYS.popupPanelDisabledSections]: {
    key: STORAGE_KEYS.popupPanelDisabledSections,
    type: "object",
    default: {},
    sinceVersion: 1,
  },
  [STORAGE_KEYS.popupPanelLockedSections]: {
    key: STORAGE_KEYS.popupPanelLockedSections,
    type: "object",
    default: {},
    sinceVersion: 1,
  },
  [STORAGE_KEYS.firewalPaneMinimized]: {
    key: STORAGE_KEYS.firewalPaneMinimized,
    type: "boolean",
    default: false,
    sinceVersion: 1,
  },
  [STORAGE_KEYS.localData]: {
    key: STORAGE_KEYS.localData,
    type: "object",
    default: {},
    sinceVersion: 1,
  },
  [STORAGE_KEYS.dynamicRules]: {
    key: STORAGE_KEYS.dynamicRules,
    type: "object",
    default: {},
    sinceVersion: 1,
  },
  [STORAGE_KEYS.cloudData]: {
    key: STORAGE_KEYS.cloudData,
    type: "string",
    default: "",
    sinceVersion: 1,
  },
  [STORAGE_KEYS.cloudOptions]: {
    key: STORAGE_KEYS.cloudOptions,
    type: "object",
    default: {},
    sinceVersion: 1,
  },
  [STORAGE_KEYS.storageVersion]: {
    key: STORAGE_KEYS.storageVersion,
    type: "number",
    default: STORAGE_VERSION,
    sinceVersion: 1,
  },
};

export const INITIAL_LOAD_KEYS = [
  STORAGE_KEYS.userSettings,
  STORAGE_KEYS.dynamicFilteringString,
  STORAGE_KEYS.permanentSwitches,
  STORAGE_KEYS.whitelist,
  STORAGE_KEYS.globalAllowedRequestCount,
  STORAGE_KEYS.globalBlockedRequestCount,
];

/**
 * A migration transforms the full stored data from one version to the next.
 * It receives all chrome.storage.local data and returns the transformed data.
 */
export type Migration = (_data: Record<string, unknown>) => Record<string, unknown> | Promise<Record<string, unknown>>;

/**
 * Registered migrations indexed by the source version they upgrade FROM.
 * MIGRATIONS[0] upgrades version 0 → 1, MIGRATIONS[1] upgrades 1 → 2, etc.
 * Push new migrations at the end when STORAGE_VERSION is bumped.
 */
export const MIGRATIONS: Migration[] = [];

/**
 * Run all pending migrations. Called once at startup before any storage reads.
 * Reads the current `storageVersion` key, runs each missing migration in
 * sequence, and writes the updated version after each success.
 */
export async function runMigrations(): Promise<void> {
    const stored = await chrome.storage.local.get(STORAGE_KEYS.storageVersion);
    const currentVersion = (stored[STORAGE_KEYS.storageVersion] as number) ?? 0;

    if (currentVersion >= STORAGE_VERSION) return;

    for (let v = currentVersion; v < STORAGE_VERSION; v++) {
        const fn = MIGRATIONS[v];
        if (fn) {
            const allData = await chrome.storage.local.get(null);
            const migrated = await fn(allData);
            await chrome.storage.local.set(migrated);
        }
        await chrome.storage.local.set({ [STORAGE_KEYS.storageVersion]: v + 1 });
    }
}
