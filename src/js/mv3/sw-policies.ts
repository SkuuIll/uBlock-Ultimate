/*******************************************************************************

    uBlock Origin - MV3 Policies
    https://github.com/gorhill/uBlock

    This file contains DNR rule compilation and filter list management.

*******************************************************************************/

import {
    normalizeImportedLists,
    normalizeSelectedFilterLists,
    deriveDefaultSelectedFilterLists,
    buildAvailableFilterLists,
    estimateFilterCounts,
    extractListURLs,
    resolveStockAssetKeyFromURL,
    resolveBundledFilterListPath,
    cloneObject,
} from './sw-helpers.js';
import { dnrRulesetFromRawLists } from '../static-dnr-filtering.js';

export const FILTER_LIST_USER_PATH = 'user-filters';
export const FILTER_LIST_ASSETS_URL_DEV = 'assets/assets.dev.json';
export const FILTER_LIST_ASSETS_URL_RELEASE = 'assets/assets.json';
export let filterListsUpdating = false;

export interface FilterListDetails {
    requires: string[];
    dependencies: string[];
    title: string;
    keywords: string[];
    group: string;
    properties: Record<string, unknown>;
    uuid: string;
    path: string;
    license: string;
    description: string;
    cdnURLs: string[];
    version: string;
    lastModified: string;
    cacheExpiry: number;
}

export interface FilterListResponse {
    available: Record<string, FilterListDetails>;
    current: Record<string, FilterListDetails>;
    selectedFilterLists: string[];
    filterLists: Record<string, FilterListDetails>;
    isUpdating: boolean;
    filterListStats: Record<string, { assetKey: string; count: number }>;
    autoUpdate?: boolean;
    cache?: Record<string, unknown>;
    cosmeticFilterCount?: number;
    ignoreGenericCosmeticFilters?: boolean;
    netFilterCount?: number;
    suspendUntilListsAreLoaded?: boolean;
    userFiltersPath?: string;
}

export const MAX_DNR_RULES = 30000;

export interface PopupState {
    userSettings: Record<string, unknown>;
    permanentFirewall: any;
    sessionFirewall: any;
    permanentHostnameSwitches: Record<string, Record<string, boolean>>;
    sessionHostnameSwitches: Record<string, Record<string, boolean>>;
    globalAllowedRequestCount: number;
    globalBlockedRequestCount: number;
    whitelist: string[];
    initialized: boolean;
    initPromise: Promise<void>;
    tabMetrics: Record<number, { blocked?: number; allowed?: number; hasUnprocessedRequest?: boolean }>;
}

export type FilterListSelectionPayload = {
    toSelect?: string[];
    toImport?: string;
    toRemove?: string[];
};

export type UpdateFilterListsPayload = {
    assetKeys?: string[];
    preferOrigin?: boolean;
};

export type AssetsProfile = 'dev' | 'release';

const fetchFilterListCatalog = async (profile: AssetsProfile = 'release'): Promise<Record<string, FilterListDetails>> => {
    const url = profile === 'dev' ? FILTER_LIST_ASSETS_URL_DEV : FILTER_LIST_ASSETS_URL_RELEASE;
    const response = await fetch(chrome.runtime.getURL(url));
    const json = await response.json() as Record<string, FilterListDetails>;
    return json;
};

type StoredCosmeticFilterData = {
    genericCosmeticFilters: Array<{ key?: number; selector?: string }>;
    genericCosmeticExceptions: Array<{ key?: number; selector?: string }>;
    specificCosmeticFilters: Array<[string, {
        key?: number;
        matches?: string[];
        excludeMatches?: string[];
        rejected?: boolean;
    }]>;
    scriptletFilters: Array<[string, {
        args?: string[];
        matches?: string[];
        excludeMatches?: string[];
        trustedSource?: boolean;
    }]>;
};

const serializeCosmeticFilterData = (dnrData: any): StoredCosmeticFilterData => ({
    genericCosmeticFilters: Array.isArray(dnrData?.genericCosmeticFilters)
        ? dnrData.genericCosmeticFilters
        : [],
    genericCosmeticExceptions: Array.isArray(dnrData?.genericCosmeticExceptions)
        ? dnrData.genericCosmeticExceptions
        : [],
    specificCosmeticFilters: dnrData?.specificCosmetic instanceof Map
        ? Array.from(dnrData.specificCosmetic.entries())
        : Array.isArray(dnrData?.specificCosmetic)
            ? dnrData.specificCosmetic
            : [],
    scriptletFilters: dnrData?.scriptlet instanceof Map
        ? Array.from(dnrData.scriptlet.entries())
        : Array.isArray(dnrData?.scriptlet)
            ? dnrData.scriptlet
            : [],
});

const generateFallbackRules = (): chrome.declarativeNetRequest.Rule[] => {
    const rules: chrome.declarativeNetRequest.Rule[] = [];
    const baseId = 100;
    
    const adDomains = [
        'doubleclick.net',
        'googlesyndication.com',
        'googleadservices.com',
        'adnxs.com',
        'adsrvr.org',
        'criteo.com',
        'pubmatic.com',
        'rubiconproject.com',
        'openx.net',
        'advertising.com',
    ];
    
    for (let i = 0; i < adDomains.length; i++) {
        rules.push({
            id: baseId + i,
            priority: 1,
            action: { type: 'block' },
            condition: {
                urlFilter: `||${adDomains[i]}^`,
                resourceTypes: ['main_frame', 'sub_frame', 'script', 'image', 'xmlhttprequest', 'websocket', 'other'],
            },
        });
    }
    
    return rules;
};

const replaceDynamicRules = async (
    addRules: chrome.declarativeNetRequest.Rule[],
    idRange: { min: number; max: number } = { min: 100, max: 10000 },
): Promise<number> => {
    const existingRules = await chrome.declarativeNetRequest.getDynamicRules();
    const removeRuleIds = existingRules
        .map(rule => rule.id)
        .filter(id => id >= idRange.min && id < idRange.max);

    await chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds,
        addRules,
    });

    const refreshedRules = await chrome.declarativeNetRequest.getDynamicRules();
    return refreshedRules.filter(rule => (
        rule.id >= idRange.min && rule.id < idRange.max
    )).length;
};

const installFallbackRules = async (): Promise<number> => {
    const fallbackRules = generateFallbackRules();
    try {
        return await replaceDynamicRules(fallbackRules);
    } catch (e) {
        console.warn('[DNR] Fallback rule installation failed:', e);
        return 0;
    }
};

export const getFilterListState = async (
    popupState: PopupState,
    ensurePopupState: () => Promise<void>
): Promise<FilterListResponse> => {
    await ensurePopupState();
    const catalog = await fetchFilterListCatalog();
    const stored = await chrome.storage.local.get([
        'selectedFilterLists',
        'availableFilterLists',
        'userSettings',
    ]) as Record<string, any>;
    const storedUserSettings = stored.userSettings || {};
    const importedLists = normalizeImportedLists(
        storedUserSettings.importedLists ?? popupState.userSettings.importedLists
    );
    const availableFromStorage = stored.availableFilterLists as Record<string, any> | undefined;
    let selectedFilterLists = normalizeSelectedFilterLists(stored.selectedFilterLists);

    if ( selectedFilterLists.length === 0 ) {
        if ( availableFromStorage && Object.keys(availableFromStorage).length !== 0 ) {
            selectedFilterLists = Object.entries(availableFromStorage)
                .filter(([, details]) => details?.content === 'filters' && details?.off !== true)
                .map(([ key ]) => key);
            if ( selectedFilterLists.includes(FILTER_LIST_USER_PATH) === false ) {
                selectedFilterLists.unshift(FILTER_LIST_USER_PATH);
            }
        } else {
            selectedFilterLists = deriveDefaultSelectedFilterLists(catalog, FILTER_LIST_USER_PATH);
            await chrome.storage.local.set({ selectedFilterLists });
        }
    }

    const selectedListSet = new Set(selectedFilterLists);
    selectedListSet.add(FILTER_LIST_USER_PATH);
    const available = buildAvailableFilterLists(catalog, importedLists, selectedListSet, FILTER_LIST_USER_PATH);
    for ( const details of Object.values(available) ) {
        if ( details?.parent === null ) {
            delete details.parent;
        }
    }
    const counts = estimateFilterCounts(available);

    await chrome.storage.local.set({
        availableFilterLists: available,
    });

    return {
        autoUpdate: storedUserSettings.autoUpdate ?? popupState.userSettings.autoUpdate as boolean,
        available,
        cache: {},
        cosmeticFilterCount: counts.cosmeticFilterCount,
        current: cloneObject(available),
        filterLists: available,
        filterListStats: {},
        ignoreGenericCosmeticFilters:
            storedUserSettings.ignoreGenericCosmeticFilters ??
            popupState.userSettings.ignoreGenericCosmeticFilters as boolean,
        isUpdating: filterListsUpdating,
        netFilterCount: counts.netFilterCount,
        selectedFilterLists,
        suspendUntilListsAreLoaded:
            storedUserSettings.suspendUntilListsAreLoaded ??
            popupState.userSettings.suspendUntilListsAreLoaded as boolean,
        userFiltersPath: FILTER_LIST_USER_PATH,
    };
};

export const applyFilterListSelection = async (
    payload: FilterListSelectionPayload,
    popupState: PopupState,
    ensurePopupState: () => Promise<void>
): Promise<FilterListResponse> => {
    await ensurePopupState();
    const catalog = await fetchFilterListCatalog();
    const stored = await chrome.storage.local.get([ 'selectedFilterLists', 'userSettings' ]) as Record<string, any>;
    const currentUserSettings = {
        ...popupState.userSettings,
        ...(stored.userSettings || {}),
    };
    const importedSet = new Set(normalizeImportedLists(currentUserSettings.importedLists as string[]));
    const selectedSet = new Set(normalizeSelectedFilterLists(stored.selectedFilterLists));
    selectedSet.add(FILTER_LIST_USER_PATH);

    if ( Array.isArray(payload.toSelect) ) {
        selectedSet.clear();
        selectedSet.add(FILTER_LIST_USER_PATH);
        for ( const key of payload.toSelect ) {
            if ( typeof key === 'string' && key.trim() !== '' ) {
                selectedSet.add(key.trim());
            }
        }
    }

    if ( typeof payload.toImport === 'string' && payload.toImport.trim() !== '' ) {
        for ( const imported of extractListURLs(payload.toImport) ) {
            const resolved = resolveStockAssetKeyFromURL(catalog, imported);
            if ( resolved === imported ) {
                importedSet.add(imported);
            }
            selectedSet.add(resolved);
        }
    }

    if ( Array.isArray(payload.toRemove) ) {
        for ( const key of payload.toRemove ) {
            if ( typeof key !== 'string' || key.trim() === '' ) { continue; }
            const normalized = key.trim();
            importedSet.delete(normalized);
            selectedSet.delete(normalized);
        }
    }

    const nextUserSettings = {
        ...currentUserSettings,
        importedLists: Array.from(importedSet).sort(),
    };
    popupState.userSettings = nextUserSettings;
    await chrome.storage.local.set({
        selectedFilterLists: Array.from(selectedSet),
        userSettings: nextUserSettings,
    });

    await syncFilterListDnrRules();

    return getFilterListState(popupState, ensurePopupState);
};

export const reloadAllFilterLists = async (
    popupState: PopupState,
    ensurePopupState: () => Promise<void>
): Promise<FilterListResponse> => {
    filterListsUpdating = true;
    try {
        await syncFilterListDnrRules();
        return await getFilterListState(popupState, ensurePopupState);
    } finally {
        filterListsUpdating = false;
    }
};

export const updateFilterListsNow = async (
    payload: UpdateFilterListsPayload | undefined,
    popupState: PopupState,
    ensurePopupState: () => Promise<void>
): Promise<FilterListResponse> => {
    void payload;
    filterListsUpdating = true;
    try {
        await syncFilterListDnrRules();
        return await getFilterListState(popupState, ensurePopupState);
    } finally {
        filterListsUpdating = false;
    }
};

export const syncFilterListDnrRules = async (): Promise<void> => {
    if ( chrome.declarativeNetRequest === undefined ) { 
        console.log('[DNR] DNR not available');
        return; 
    }
    
    try {
        const stored = await chrome.storage.local.get([
            'selectedFilterLists',
            'availableFilterLists',
            'userSettings',
        ]) as Record<string, any>;
        let selectedLists = normalizeSelectedFilterLists(stored.selectedFilterLists);
        
        console.log('[DNR] Selected lists:', selectedLists);
        
        if ( selectedLists.length === 0 ) {
            const catalogForDefaults = await fetchFilterListCatalog();
            selectedLists = deriveDefaultSelectedFilterLists(catalogForDefaults, FILTER_LIST_USER_PATH);
            const storedUserSettings = stored.userSettings || {};
            const importedLists = normalizeImportedLists(storedUserSettings.importedLists);
            const selectedListSet = new Set(selectedLists);
            selectedListSet.add(FILTER_LIST_USER_PATH);
            const available = buildAvailableFilterLists(
                catalogForDefaults,
                importedLists,
                selectedListSet,
                FILTER_LIST_USER_PATH,
            );
            selectedLists = Array.from(selectedListSet);
            await chrome.storage.local.set({
                selectedFilterLists: selectedLists,
                availableFilterLists: available,
            });
            console.log('[DNR] Bootstrapped default filter lists:', selectedLists);
        }

        const refreshedStorage = await chrome.storage.local.get('selectedFilterLists');
        selectedLists = normalizeSelectedFilterLists(refreshedStorage.selectedFilterLists);
        console.log('[DNR] Final selected lists:', selectedLists);

        const catalog = await fetchFilterListCatalog();
        console.log('[DNR] Catalog keys count:', Object.keys(catalog).length);
        
        const filterLists: { key: string; text: string }[] = [];
        for ( const listKey of selectedLists ) {
            if ( listKey === FILTER_LIST_USER_PATH ) {
                const userFiltersStored = await chrome.storage.local.get([
                    'userFilters',
                    FILTER_LIST_USER_PATH,
                ]);
                const userFilters = typeof userFiltersStored.userFilters === 'string'
                    ? userFiltersStored.userFilters
                    : typeof userFiltersStored[FILTER_LIST_USER_PATH] === 'string'
                        ? userFiltersStored[FILTER_LIST_USER_PATH]
                        : '';
                if ( userFilters ) {
                    filterLists.push({ key: FILTER_LIST_USER_PATH, text: userFilters });
                    console.log('[DNR] Loaded user filters:', userFilters.length, 'chars');
                }
                continue;
            }
            
            const asset = catalog[listKey];
            if ( !asset ) { 
                console.log('[DNR] Skipping list (missing catalog entry):', listKey);
                continue; 
            }
            
            const bundledPath = resolveBundledFilterListPath(asset);
            let filterText = '';
            
            if ( bundledPath !== undefined ) {
                try {
                    const response = await fetch(chrome.runtime.getURL(bundledPath));
                    if ( response.ok ) {
                        filterText = await response.text();
                        filterLists.push({ key: listKey, text: filterText });
                        console.log('[DNR] Loaded from bundled:', listKey, filterText.length, 'chars');
                    } else {
                        console.log('[DNR] Bundled load failed:', listKey, response.status);
                    }
                } catch ( e ) {
                    console.warn('[DNR] Failed to load bundled:', listKey, e);
                }
            }
            
            if ( filterText === '' && asset.cdnURLs && asset.cdnURLs.length > 0 ) {
                console.log('[DNR] Skipping CDN fallback in strict-store profile:', listKey);
            }
            
            if ( filterText === '' ) {
                console.log('[DNR] Skipping list (no content loaded):', listKey);
            }
        }

        console.log('[DNR] Total lists loaded:', filterLists.length);
        
        let dnrData: any = null;
        
        if ( filterLists.length === 0 ) {
            console.log('[DNR] No filter lists loaded, using fallback rules');
        } else {
            console.log('[DNR] Compiling', filterLists.length, 'filter lists to DNR rules...');

            console.log('[DNR] Input lists:', filterLists.map(f => ({ key: f.key, textLen: f.text.length })));
            
            dnrData = await dnrRulesetFromRawLists(
                filterLists.map(f => ({ text: f.text })),
                { env: [] }
            );
            
            console.log('[DNR] Raw result keys:', Object.keys(dnrData || {}));
            console.log('[DNR] genericCosmeticFilters:', dnrData?.genericCosmeticFilters?.length);
            console.log('[DNR] specificCosmetic (Map):', dnrData?.specificCosmetic instanceof Map);
            if (dnrData?.specificCosmetic instanceof Map) {
                console.log('[DNR] specificCosmetic size:', dnrData.specificCosmetic.size);
                console.log('[DNR] specificCosmetic sample:', Array.from(dnrData.specificCosmetic.entries()).slice(0, 3));
            }

            console.log('[DNR] Result:', dnrData);
        }
        
        let installedRuleCount = 0;
        
        if ( dnrData?.network?.ruleset && dnrData.network.ruleset.length > 0 ) {
            console.log('[DNR] Generated rules:', dnrData.network.ruleset.length);
            const addRules = dnrData.network.ruleset.slice(0, 3000).map((rule: any, index: number) => {
                // Skip rules with regexFilter over 2KB (DNR limit)
                const regexFilter = rule.condition?.regexFilter;
                if (regexFilter && regexFilter.length > 2048) {
                    return null;
                }
                return {
                    id: 100 + index,
                    action: { type: rule.action?.type },
                    condition: {
                        urlFilter: rule.condition?.urlFilter,
                        regexFilter: regexFilter,
                        requestDomains: rule.condition?.requestDomains,
                        resourceTypes: rule.condition?.resourceTypes,
                    },
                    priority: rule.priority,
                };
            }).filter(Boolean);
            
            try {
                installedRuleCount = await replaceDynamicRules(addRules);
                console.log('[DNR] Installed', installedRuleCount, 'filter list rules');
            } catch (e) {
                console.warn('[DNR] Compiled filter rule installation failed, falling back:', e);
                installedRuleCount = await installFallbackRules();
            }
            
            const cosmeticFiltersData = serializeCosmeticFilterData(dnrData);
            await chrome.storage.local.set({ cosmeticFiltersData: JSON.stringify(cosmeticFiltersData) });
            console.log('[DNR] Stored cosmetic filters:', 
                cosmeticFiltersData.genericCosmeticFilters.length, 'generic,',
                cosmeticFiltersData.specificCosmeticFilters.length, 'specific');

            if ( installedRuleCount === 0 ) {
                console.log('[DNR] No compiled rules were active after install, using fallback rules');
                installedRuleCount = await installFallbackRules();
            }
        } else {
            console.log('[DNR] No rules from filter lists, installing fallback blocking rules');
            installedRuleCount = await installFallbackRules();
            console.log('[DNR] Installed', installedRuleCount, 'fallback rules');
        }
        
    } catch ( e ) {
        console.error('[DNR] Failed to sync filter list rules:', e);
    }
};

export const getMatchedBlockedRequestCountForTab = async (
    tabId: number,
    minTimeStamp = 0,
): Promise<number | undefined> => {
    if ( chrome.declarativeNetRequest?.getMatchedRules === undefined ) {
        return;
    }
    try {
        const result = await chrome.declarativeNetRequest.getMatchedRules({
            tabId,
            minTimeStamp,
        });
        const rulesMatchedInfo = Array.isArray(result?.rulesMatchedInfo)
            ? result.rulesMatchedInfo
            : [];
        return rulesMatchedInfo.length;
    } catch (e) {
        console.warn('[uBR] getDnrMatchedRequestCount: getMatchedRules failed', tabId, e);
    }
};

export const getDnrMatchedHostnamesForTab = async (
    tabId: number,
    minTimeStamp = 0,
): Promise<{hostnameDict: Record<string, any>; pageCounts: any} | undefined> => {
    if ( chrome.declarativeNetRequest?.getMatchedRules === undefined ) {
        return undefined;
    }
    try {
        const result = await chrome.declarativeNetRequest.getMatchedRules({
            tabId,
            minTimeStamp,
        });
        const rulesMatchedInfo = Array.isArray(result?.rulesMatchedInfo)
            ? result.rulesMatchedInfo
            : [];
        if (rulesMatchedInfo.length === 0) {
            return undefined;
        }
        const hostnameDict: Record<string, any> = Object.create(null);
        const pageCounts = { allowed: { any: 0, frame: 0, script: 0 }, blocked: { any: 0, frame: 0, script: 0 } };
        for (const info of rulesMatchedInfo) {
            const rule = info.rule as any;
            if (!rule || !rule.condition) continue;
            const condition = rule.condition;
            if (!condition.urlFilter) continue;
            let hostname = '';
            try {
                if (condition.urlFilter.startsWith('||')) {
                    hostname = condition.urlFilter.slice(2);
                } else if (condition.urlFilter.startsWith('|')) {
                    hostname = new URL(condition.urlFilter.slice(1)).hostname;
                } else {
                    hostname = new URL(`http://${  condition.urlFilter}`).hostname;
                }
            } catch (e) {
                console.warn('[uBR] buildHostnameAggregation: invalid URL filter', condition.urlFilter, e);
                continue;
            }
            if (!hostname || hostname === '') continue;
            if (hostnameDict[hostname] === undefined) {
                hostnameDict[hostname] = {
                    domain: hostname,
                    counts: { allowed: { any: 0, frame: 0, script: 0 }, blocked: { any: 0, frame: 0, script: 0 } },
                };
            }
            const blocked = rule.action?.type === 'block' || rule.action?.type === 'upgradeScheme';
            const type = condition.resourceTypes?.[0] || 'other';
            const countKey = blocked ? 'blocked' : 'allowed';
            const kindKey = type === 'script' ? 'script' : type === 'sub_frame' ? 'frame' : 'any';
            hostnameDict[hostname].counts[countKey][kindKey]++;
            pageCounts[countKey][kindKey]++;
        }
        return { hostnameDict, pageCounts };
    } catch (e) {
        console.warn('[uBR] getDnrMatchedHostnamesForTab: failed for tab', tabId, e);
        return undefined;
    }
};

