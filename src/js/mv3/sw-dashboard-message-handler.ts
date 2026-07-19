/*******************************************************************************

    uBlock Origin - MV3 Dashboard Message Handler
    https://github.com/gorhill/uBlock

    Handles the dashboard messaging channel. Uses a what-handler registry
    instead of a monolithic switch — adding a new what-value just registers
    a handler in the map.

*******************************************************************************/

import {
    getFilterListState,
    applyFilterListSelection,
    FILTER_LIST_USER_PATH,
} from './sw-policies.js';
import {
    userSettingsDefault,
    reWhitelistBadHostname,
    reWhitelistHostnameExtractor,
} from './sw-types.js';

const MV3_HIDDEN_SETTINGS_DEFAULTS = {
    allowGenericProceduralFilters: false,
    assetFetchTimeout: 30,
    autoCommentFilterTemplate: '{{date}} {{origin}}',
    autoUpdateAssetFetchPeriod: 5,
    autoUpdateDelayAfterLaunch: 37,
    autoUpdatePeriod: 1,
    benchmarkDatasetURL: 'unset',
    blockingProfiles: '11111/#F00 11010/#C0F 11001/#00F 00001',
    cacheStorageCompression: true,
    cacheStorageCompressionThreshold: 65536,
    cacheStorageMultithread: 2,
    cacheControlForFirefox1376932: 'unset',
    cloudStorageCompression: true,
    cnameIgnoreList: 'unset',
    cnameIgnore1stParty: true,
    cnameIgnoreExceptions: true,
    cnameIgnoreRootDocument: true,
    cnameReplayFullURL: false,
    consoleLogLevel: 'unset',
    debugAssetsJson: false,
    debugScriptlets: false,
    debugScriptletInjector: false,
    differentialUpdate: true,
    disableWebAssembly: false,
    dnsCacheTTL: 600,
    dnsResolveEnabled: true,
    extensionUpdateForceReload: false,
    filterAuthorMode: false,
    loggerPopupType: 'popup',
    manualUpdateAssetFetchPeriod: 500,
    modifyWebextFlavor: 'unset',
    noScriptingCSP: 'script-src http: https:',
    popupFontSize: 'unset',
    popupPanelDisabledSections: 0,
    popupPanelHeightMode: 0,
    popupPanelLockedSections: 0,
    popupPanelOrientation: 'unset',
    requestJournalProcessPeriod: 1000,
    requestStatsDisabled: false,
    selfieDelayInSeconds: 53,
    strictBlockingBypassDuration: 120,
    toolbarWarningTimeout: 60,
    trustedListPrefixes: 'ublock-',
    uiPopupConfig: 'unset',
    uiStyles: 'unset',
    updateAssetBypassBrowserCache: false,
    userResourcesLocation: 'unset',
};

const coerceHiddenSettingValue = (raw: string): unknown => {
    if ( raw === 'true' ) { return true; }
    if ( raw === 'false' ) { return false; }
    if ( raw === 'null' ) { return null; }
    if ( /^-?\d+(?:\.\d+)?$/.test(raw) ) {
        return Number(raw);
    }
    return raw;
};

type DashboardRequest = {
    what: string;
    [key: string]: any;
};

type EngineState = {
    logger: any;
    staticFilteringEngine: any;
    staticFilteringReverseLookup: any;
    publicSuffixList: any;
    redirectEngine: any;
};

export type DashboardMessageHandlerDeps = {
    popupState: any;
    ensurePopupState: () => Promise<void>;
    setUserSetting: (_request: any) => Promise<any>;
    getLocalData: () => Promise<any>;
    backupUserData: () => Promise<void>;
    restoreUserData: (_request: { userData?: unknown; file?: string }) => Promise<void>;
    resetUserData: () => Promise<void>;
    getDeviceName: () => Promise<string>;
    encodeCloudData: (_data: any) => Promise<string>;
    decodeCloudData: (_encoded: string) => Promise<any>;
    getPopupData: (_request: DashboardRequest) => Promise<any>;
    updateToolbarIcon: (_tabId: number, _options: { filtering?: boolean }) => Promise<void>;
    reloadAllFilterLists: () => Promise<any>;
    updateFilterListsNow: (_request?: { assetKeys?: string[]; preferOrigin?: boolean }) => Promise<any>;
    syncFirewallDnrRules: () => Promise<void>;
    syncPowerSwitchDnrRules: () => Promise<void>;
    findFilterListFromNetFilter: (_rawFilter: string) => Promise<any[]>;
    findFilterListFromCosmeticFilter: (_rawFilter: string) => Promise<any[]>;
    parseStoredCosmeticFilterData: (_data: any) => any;
    elementPickerExec: (_tabId: number, _frameId: number, _target?: string, _zap?: boolean) => Promise<any>;
    getEngineState: () => EngineState;
    persistPermanentFirewall: () => Promise<void>;
    persistPermanentHostnameSwitches: () => Promise<void>;
    persistURLFilteringRules: () => Promise<void>;
};

const waitForStoredUserFilters = async (expectedContent: string): Promise<void> => {
    for ( let i = 0; i < 20; i++ ) {
        const stored = await chrome.storage.local.get([
            'userFilters',
            FILTER_LIST_USER_PATH,
        ]);
        const content = typeof stored?.userFilters === 'string'
            ? stored.userFilters
            : typeof stored?.[FILTER_LIST_USER_PATH] === 'string'
                ? stored[FILTER_LIST_USER_PATH]
                : '';
        if ( content === expectedContent ) { return; }
        await new Promise(resolve => setTimeout(resolve, 50));
    }
};

const getSwitchRuleset = (permanent: boolean, popupState: any) => {
    return permanent
        ? popupState.permanentSwitches
        : popupState.sessionSwitches;
};

const getURLRuleset = (permanent: boolean, popupState: any) => {
    return permanent
        ? popupState.permanentURLFiltering
        : popupState.sessionURLFiltering;
};

const getPslSelfie = (engineState: EngineState) => {
    let pslSelfieValue: any = null;
    if ( engineState.publicSuffixList?.toSelfie ) {
        try {
            const selfie = engineState.publicSuffixList.toSelfie();
            if ( selfie && typeof selfie === 'object' && selfie.buf32 instanceof Uint32Array ) {
                pslSelfieValue = {
                    magic: selfie.magic,
                    buf32: Array.from(selfie.buf32),
                };
            } else {
                pslSelfieValue = selfie;
            }
        } catch (e) {
            console.warn('[uBR] getPslSelfie: publicSuffixList.toSelfie failed', e);
        }
    }
    return { pslSelfie: pslSelfieValue };
};

const extractDomain = (hostname: string): string | null => {
    if ( !hostname ) return null;
    const parts = hostname.split('.');
    return parts.length >= 2 ? parts.slice(-2).join('.') : hostname;
};

const arrayFromWhitelist = (whitelist: string): string[] => {
    if (!whitelist) return [];
    return whitelist.split("\n").filter((line) => line.trim() !== "");
};

const whitelistFromString = (str: string): string => {
    if (!str) return "";
    return str.split("\n").filter((line) => line.trim() !== "").join("\n");
};

const netWhitelistDefault: string[] = userSettingsDefault.netWhitelistDefault || [];

export const createDashboardMessageHandler = (deps: DashboardMessageHandlerDeps) => {
    const {
        popupState,
        ensurePopupState,
        setUserSetting,
        getLocalData,
        backupUserData,
        restoreUserData,
        resetUserData,
        getDeviceName,
        encodeCloudData,
        decodeCloudData,
        getPopupData,
        updateToolbarIcon,
        reloadAllFilterLists,
        updateFilterListsNow,
        syncFirewallDnrRules,
        syncPowerSwitchDnrRules,
        findFilterListFromNetFilter,
        findFilterListFromCosmeticFilter,
        parseStoredCosmeticFilterData,
        elementPickerExec,
        getEngineState,
        persistPermanentFirewall,
        persistPermanentHostnameSwitches,
        persistURLFilteringRules,
    } = deps;

    const getRulesSnapshot = () => {
        const permanentSwitches = popupState.permanentSwitches;
        const permanentURLFiltering = popupState.permanentURLFiltering;
        const sessionSwitches = popupState.sessionSwitches;
        const sessionURLFiltering = popupState.sessionURLFiltering;
        return {
            permanentRules: popupState.permanentFirewall.toArray().concat(
                permanentSwitches?.toArray?.() || [],
                permanentURLFiltering?.toArray?.() || [],
            ),
            sessionRules: popupState.sessionFirewall.toArray().concat(
                sessionSwitches?.toArray?.() || [],
                sessionURLFiltering?.toArray?.() || [],
            ),
            pslSelfie: getPslSelfie(getEngineState()).pslSelfie,
        };
    };

    const handlers = new Map<string, (request: DashboardRequest) => any>();

    handlers.set('getLists', () =>
        getFilterListState(popupState, ensurePopupState));
    handlers.set('applyFilterListSelection', (request) =>
        applyFilterListSelection(request as {
            toSelect?: string[]; toImport?: string; toRemove?: string[];
        }, popupState, ensurePopupState));
    handlers.set('reloadAllFilters', () => reloadAllFilterLists());
    handlers.set('updateNow', () => updateFilterListsNow());
    handlers.set('listsUpdateNow', (request) =>
        updateFilterListsNow(request as { assetKeys?: string[]; preferOrigin?: boolean }));
    handlers.set('userSettings', (request) => setUserSetting(request));
    handlers.set('getLocalData', () => getLocalData());
    handlers.set('backupUserData', () => backupUserData());
    handlers.set('restoreUserData', (request) =>
        restoreUserData(request as { userData?: unknown; file?: string }));
    handlers.set('resetUserData', () => resetUserData());

    handlers.set('readUserFilters', async () => {
        const items = await chrome.storage.local.get([
            'userFilters',
            FILTER_LIST_USER_PATH,
        ]);
        const selectedLists = await chrome.storage.local.get('selectedFilterLists') as Record<string, any>;
        const userSettingsStored = await chrome.storage.local.get('userSettings') as Record<string, any>;
        const selected = Array.isArray(selectedLists?.selectedFilterLists)
            ? selectedLists.selectedFilterLists
            : [];
        const userSettings = userSettingsStored?.userSettings || popupState.userSettings || {};
        const content = typeof items.userFilters === 'string'
            ? items.userFilters
            : typeof items[FILTER_LIST_USER_PATH] === 'string'
                ? items[FILTER_LIST_USER_PATH]
                : '';
        let enabled = selected.includes(FILTER_LIST_USER_PATH);
        if ( enabled === false && content.trim() === '' ) {
            enabled = true;
            await chrome.storage.local.set({
                selectedFilterLists: [ FILTER_LIST_USER_PATH, ...selected ],
            });
        }
        return {
            content,
            enabled,
            trusted: userSettings.userFiltersTrusted === true,
        };
    });

    handlers.set('writeUserFilters', async (request) => {
        let rawFilters = (request.content ?? request.userFilters) as string;
        const enabled = request.enabled as boolean;
        const trusted = request.trusted === true;
        if (typeof rawFilters === 'string' && rawFilters.includes('##')) {
            const lines = rawFilters.split('\n');
            const smartConverted: string[] = [];
            const cleaned: string[] = [];
            for (const line of lines) {
                if (line.includes('##')) {
                    smartConverted.push(line);
                } else {
                    cleaned.push(line);
                }
            }
            if (smartConverted.length > 0) {
                await (async () => {
                    try {
                        const { smartRuleStore } = await import('../../core/smart-cosmetic/smart-rule-store');
                        await smartRuleStore.load();
                        for (const line of smartConverted) {
                            const hashIdx = line.indexOf('##');
                            const domainPart = hashIdx > 0 ? line.slice(0, hashIdx) : '*';
                            const selector = line.slice(hashIdx + 2);
                            if (!selector) continue;
                            const targets = domainPart === '*'
                                ? [{ form: 'host' as const, value: '*' }]
                                : domainPart.split(',').filter(Boolean).map(d => ({ form: 'host' as const, value: d }));
                            const rule = {
                                type: 'hide-exact' as const,
                                id: `migrated:msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                                syntaxVersion: 1,
                                state: 'active' as const,
                                targets,
                                selector,
                                action: { action: 'hide' as const },
                                metadata: { createdAt: new Date().toISOString(), source: 'migration' as const },
                                collectionId: 'migrated-cosmetic',
                            };
                            await smartRuleStore.addRule(rule as any);
                        }
                    } catch (e) {
                        console.error('[sw-dashboard-msg] Failed to migrate ## filters:', e);
                    }
                })();
            }
            rawFilters = cleaned.join('\n');
        }
        const userFilters = rawFilters;
        if ( typeof userFilters === 'string' ) {
            const maxFilterSize = 10 * 1024 * 1024;
            if ( userFilters.length > maxFilterSize ) {
                return { success: false, error: 'Filter size exceeds limit' };
            }
            const selectedStored = await chrome.storage.local.get('selectedFilterLists');
            const selected = new Set(
                Array.isArray(selectedStored?.selectedFilterLists)
                    ? selectedStored.selectedFilterLists
                    : []
            );
            if ( enabled ) {
                selected.add(FILTER_LIST_USER_PATH);
            } else {
                selected.delete(FILTER_LIST_USER_PATH);
            }
            const userSettingsStored = await chrome.storage.local.get('userSettings') as Record<string, any>;
            const nextUserSettings = {
                ...(popupState.userSettings || {}),
                ...(userSettingsStored?.userSettings || {}),
                userFiltersTrusted: trusted,
            };
            popupState.userSettings = nextUserSettings;
            await chrome.storage.local.set({
                userFilters,
                [FILTER_LIST_USER_PATH]: userFilters,
                selectedFilterLists: Array.from(selected),
                userSettings: nextUserSettings,
            });
            await waitForStoredUserFilters(userFilters);
            await reloadAllFilterLists();
            new BroadcastChannel("uBR").postMessage({ what: "userFiltersUpdated" });
            return { success: true };
        }
        return { success: false, error: 'Invalid userFilters' };
    });

    handlers.set('cloudGetOptions', async () => {
        const stored = await chrome.storage.local.get('cloudOptions') as Record<string, any>;
        const userSettingsStored = await chrome.storage.local.get('userSettings') as Record<string, any>;
        const userSettings = userSettingsStored.userSettings || {};
        const options = stored?.cloudOptions || {};
        const deviceName = options.deviceName || await getDeviceName();
        return {
            deviceName,
            defaultDeviceName: 'Default device',
            syncEnabled: options.syncEnabled !== false,
            enabled: userSettings.cloudStorageEnabled === true,
            cloudStorageSupported: typeof chrome.storage.sync !== 'undefined',
        };
    });

    handlers.set('cloudSetOptions', async (request) => {
        const innerOptions = (request.options || {}) as { deviceName?: string; syncEnabled?: boolean };
        const stored = await chrome.storage.local.get('cloudOptions') as Record<string, any>;
        const existing = stored?.cloudOptions || {};
        if ( typeof innerOptions.deviceName === 'string' ) {
            existing.deviceName = innerOptions.deviceName;
        }
        if ( typeof innerOptions.syncEnabled === 'boolean' ) {
            existing.syncEnabled = innerOptions.syncEnabled;
        }
        await chrome.storage.local.set({ cloudOptions: existing });
        const deviceName = existing.deviceName || await getDeviceName();
        return {
            deviceName,
            defaultDeviceName: 'Default device',
            enabled: true,
        };
    });

    handlers.set('cloudPull', async () => {
        const useSync = typeof chrome.storage.sync !== 'undefined';
        const cloudKey = 'cloudData';
        const stored = useSync ? await chrome.storage.sync.get(cloudKey) : await chrome.storage.local.get(cloudKey);
        const cloudData = stored?.[cloudKey];
        if ( !cloudData ) return null;
        try {
            const decoded = await decodeCloudData(cloudData as string);
            return {
                data: decoded.data,
                source: decoded.source ?? 'unknown',
                tstamp: decoded.tstamp ?? Date.now(),
            };
        } catch (e) {
            console.warn('[uBR] cloudPull: decodeCloudData failed', e);
            return (e as Error).message;
        }
    });

    handlers.set('cloudPush', async (request) => {
        const cloudData = request.data;
        if ( !cloudData ) return 'No data to push';
        try {
            const source = await getDeviceName();
            const dataToPush = { data: cloudData, source, tstamp: Date.now() };
            const encoded = await encodeCloudData(dataToPush);
            const useSync = typeof chrome.storage.sync !== 'undefined';
            if ( useSync ) {
                await chrome.storage.sync.set({ cloudData: encoded });
            } else {
                await chrome.storage.local.set({ cloudData: encoded });
            }
            const storageUsed = useSync
                ? await chrome.storage.sync.getBytesInUse()
                : await chrome.storage.local.getBytesInUse();
            if ( useSync ) {
                await chrome.storage.sync.set({ cloudStorageUsed: storageUsed, lastCloudSync: Date.now() });
            } else {
                await chrome.storage.local.set({ cloudStorageUsed: storageUsed, lastCloudSync: Date.now() });
            }
            return { success: true };
        } catch (e) {
            console.warn('[uBR] cloudPush: storage operation failed', e);
            return (e as Error).message;
        }
    });

    handlers.set('cloudUsed', async () => {
        const useSync = typeof chrome.storage.sync !== 'undefined';
        const storageUsed = useSync
            ? await chrome.storage.sync.getBytesInUse()
            : await chrome.storage.local.getBytesInUse();
        const cloudData = useSync
            ? await chrome.storage.sync.get('cloudData')
            : await chrome.storage.local.get('cloudData');
        const cloudSize = cloudData?.cloudData ? JSON.stringify(cloudData.cloudData).length : 0;
        const lastCloudSync = useSync
            ? await chrome.storage.sync.get('lastCloudSync')
            : await chrome.storage.local.get('lastCloudSync');
        const max = useSync
            ? (chrome.storage.sync as any).QUOTA_BYTES ?? 102400
            : 10485760;
        return {
            used: cloudSize,
            total: storageUsed,
            max,
            lastSync: lastCloudSync?.lastCloudSync || 0,
        };
    });

    handlers.set('getAppData', async () => {
        const manifest = chrome.runtime.getManifest();
        const stored = await chrome.storage.local.get('hiddenSettings') as Record<string, any>;
        const hiddenSettings = stored?.hiddenSettings || {};
        const whitelistStored = await chrome.storage.local.get('whitelist') as Record<string, any>;
        const whitelist = (whitelistStored?.whitelist as string) || '';
        return {
            name: manifest.name || 'uBlock Ultimate',
            version: manifest.version || '1.0.0',
            canBenchmark: hiddenSettings?.benchmarkDatasetURL !== 'unset',
            whitelist: arrayFromWhitelist(whitelist),
            whitelistDefault: netWhitelistDefault,
            reBadHostname: reWhitelistBadHostname.source || '(^|\\.)(localhost|localhost\\.localdomain|127\\.0\\.0\\.1|0\\.0\\.0\\.0|255\\.255\\.255\\.255)$',
            reHostnameExtractor: reWhitelistHostnameExtractor.source || '^https?:\\/\\/([^/:]+)',
        };
    });

    handlers.set('getTrustedScriptletTokens', () =>
        getEngineState().redirectEngine?.getTrustedScriptletTokens?.() || []);

    handlers.set('getWhitelist', async () => {
        const whitelistStored = await chrome.storage.local.get('whitelist');
        const whitelist = (whitelistStored?.whitelist as string) || '';
        return {
            whitelist: arrayFromWhitelist(whitelist),
            whitelistDefault: netWhitelistDefault,
            reBadHostname: reWhitelistBadHostname.source || '(^|\\.)(localhost|localhost\\.localdomain|127\\.0\\.0\\.1|0\\.0\\.0\\.0|255\\.255\\.255\\.255)$',
            reHostnameExtractor: reWhitelistHostnameExtractor.source || '^https?:\\/\\/([^/:]+)',
        };
    });

    handlers.set('setWhitelist', async (request) => {
        const whitelist = request.whitelist as string;
        if ( typeof whitelist !== 'string' ) {
            return { success: false, error: 'Invalid whitelist' };
        }
        popupState.whitelist = arrayFromWhitelist(whitelist);
        try {
            await chrome.storage.local.set({ whitelist });
            return { success: true };
        } catch (e) {
            console.warn('[uBR] saveWhitelist: storage.set failed', e);
            return { success: false, error: (e as Error).message };
        }
    });

    handlers.set('getDomainNames', async (request) => {
        const target = request.target as string;
        if ( typeof target !== 'string' || target === '' ) return [];
        const domains: string[] = [];
        try {
            if ( target.includes('/') || target.includes(':') ) {
                const url = new URL(target);
                const domain = extractDomain(url.hostname);
                if ( domain ) domains.push(domain);
            } else {
                const domain = extractDomain(target);
                if ( domain ) domains.push(domain);
            }
        } catch (e) {
            console.warn('[uBR] getDomainNames: URL parsing failed', target, e);
            const domain = extractDomain(target);
            if ( domain ) domains.push(domain);
        }
        return domains;
    });

    handlers.set('getCollapsibleBlockedRequests', async (request) => {
        const tabId = request.tabId as number;
        if ( typeof tabId !== 'number' ) return { requests: [] };
        try {
            return await chrome.tabs.sendMessage(tabId, { what: 'getCollapsibleBlockedRequests' }) || { requests: [] };
        } catch (e) {
            console.warn('[uBR] getCollapsibleBlockedRequests: sendMessage failed', tabId, e);
            return { requests: [] };
        }
    });

    handlers.set('hasPopupContentChanged', async (request) => {
        const tabId = request.tabId as number;
        const contentLastModified = request.contentLastModified as number;
        if ( typeof tabId !== 'number' ) return { changed: false };
        const stored = await chrome.storage.local.get('popupContentVersions');
        const versions = stored?.popupContentVersions || {};
        const storedVersion = versions[tabId] || 0;
        const changed = storedVersion !== 0 && storedVersion !== contentLastModified;
        if ( changed || storedVersion === 0 ) {
            versions[tabId] = Date.now();
            await chrome.storage.local.set({ popupContentVersions: versions });
        }
        return { changed };
    });

    handlers.set('toggleInMemoryFilter', async (request) => {
        const filter = request.filter as string;
        const tabId = request.tabId as number;
        if ( filter && typeof tabId === 'number' ) {
            try {
                await chrome.tabs.sendMessage(tabId, { what: 'toggleInMemoryFilter', filter });
            } catch (e) {
                console.warn('[uBR] toggleInMemoryFilter: sendMessage failed for tab', tabId, e);
            }
        }
        return { success: true };
    });

    handlers.set('hasInMemoryFilter', async (request) => {
        const tabId = request.tabId as number;
        if ( typeof tabId === 'number' ) {
            try {
                return await chrome.tabs.sendMessage(tabId, { what: 'hasInMemoryFilter' }) || { hasFilter: false };
            } catch (e) {
                console.warn('[uBR] hasInMemoryFilter: sendMessage failed', tabId, e);
                return { hasFilter: false };
            }
        }
        return { hasFilter: false };
    });

    handlers.set('readAll', async (request) => {
        const ownerId = request.ownerId as number;
        if ( getEngineState().logger?.ownerId !== undefined && getEngineState().logger?.ownerId !== ownerId ) {
            return { unavailable: true };
        }
        try {
            return await chrome.storage.local.get(null);
        } catch (e) {
            console.warn('[uBR] readAll: storage.local.get failed', e);
            return { error: (e as Error).message };
        }
    });

    handlers.set('toggleNetFiltering', async (request) => {
        const { url, scope, state, tabId } = request;
        if ( !url || !tabId ) return getPopupData(request);
        let hostname = '';
        try {
            hostname = new URL(url).hostname;
        } catch (e) {
            console.warn('[uBR] toggleNetFiltering: invalid URL', url, e);
            return getPopupData(request);
        }
        const stored = await chrome.storage.local.get('perSiteFiltering');
        const perSiteFiltering: Record<string, boolean> = (stored?.perSiteFiltering as Record<string, boolean>) || {};
        const scopeKey = scope === 'page' ? `${hostname}:${url}` : hostname;
        perSiteFiltering[scopeKey] = state;
        await chrome.storage.local.set({ perSiteFiltering });
        await syncPowerSwitchDnrRules();
        if ( tabId ) {
            try {
                const result = chrome.tabs.sendMessage(tabId, {
                    topic: 'uBlockPowerSwitch',
                    payload: { enabled: state === true },
                }) as Promise<unknown> | undefined;
                result?.catch((e) => {
                    console.warn('[uBR] toggleNetFiltering: sendMessage failed for tab', tabId, e);
                });
            } catch (e) {
                console.warn('[uBR] toggleNetFiltering: error during sendMessage for tab', tabId, e);
            }
        }
        return getPopupData(request);
    });

    handlers.set('reloadTab', (request) => {
        const { tabId, bypassCache, url } = request;
        if ( tabId ) {
            if ( typeof url === 'string' && url !== '' ) {
                chrome.tabs.get(tabId, (tab) => {
                    if ( chrome.runtime.lastError ) return;
                    if ( tab?.url && tab.url !== url ) {
                        chrome.tabs.update(tabId, { url }).catch(() => {});
                    } else {
                        chrome.tabs.reload(tabId, { bypassCache: !!bypassCache }).catch(() => {});
                    }
                });
            } else {
                chrome.tabs.reload(tabId, { bypassCache: !!bypassCache }).catch(() => {});
            }
        }
        return {};
    });

    handlers.set('dismissUnprocessedRequest', async (request) => {
        const tabId = request.tabId as number;
        if ( typeof tabId === 'number' ) {
            const vAPINet = (globalThis as any).vAPI?.net;
            vAPINet?.removeUnprocessedRequest?.(tabId);
            const stored = await chrome.storage.local.get('unprocessedRequests');
            const unprocessed = stored?.unprocessedRequests || {};
            delete unprocessed[tabId];
            await chrome.storage.local.set({ unprocessedRequests: unprocessed });
            await updateToolbarIcon(tabId, { filtering: true });
        }
        return { success: true };
    });

    handlers.set('gotoURL', async (request) => {
        const { url, newTab, tabId: targetTabId, select, index, shiftKey } = request as {
            url?: string; newTab?: boolean; tabId?: number; select?: boolean; index?: number; shiftKey?: boolean;
        };
        if ( !url ) return { success: false };
        const createProps: chrome.tabs.CreateProperties = { url, active: select !== false };
        if ( typeof index === 'number' ) createProps.index = index;
        if ( shiftKey ) createProps.active = false;
        if ( newTab ) {
            const created = await chrome.tabs.create(createProps).catch(() => null);
            if ( !created ) return { success: false };
            return { tabId: created.id };
        }
        if ( targetTabId ) {
            await chrome.tabs.update(targetTabId, { url, active: true }).catch(() => {});
            return { tabId: targetTabId };
        }
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        if ( tabs[0]?.id ) {
            await chrome.tabs.update(tabs[0].id, { url, active: true }).catch(() => {});
            return { tabId: tabs[0].id };
        }
        return { success: false };
    });

    handlers.set('getAssetContent', async (request) => {
        const url = request.url as string;
        if ( !url ) return { error: 'No URL provided' };
        try {
            const response = await fetch(url);
            const text = await response.text();
            return {
                content: text,
                assetKey: url,
                sourceURL: url,
                trustedSource: popupState.trustedLists?.[url] === true,
            };
        } catch (e) {
            console.warn('[uBR] fetchURL: fetch failed', e);
            return { error: (e as Error).message };
        }
    });

    handlers.set('listsFromNetFilter', async (request) => {
        const rawFilter = request.rawFilter as string;
        if ( !rawFilter ) return {};
        const reverseLookup = getEngineState().staticFilteringReverseLookup;
        if ( reverseLookup ) {
            try {
                return await reverseLookup.fromNetFilter(rawFilter);
            } catch (e) {
                console.warn('[uBR] listsFromNetFilter: reverseLookup failed', e);
                return {};
            }
        }
        const results = await findFilterListFromNetFilter(rawFilter);
        return results.length > 0 ? { [rawFilter]: results } : {};
    });

    handlers.set('listsFromCosmeticFilter', async (request) => {
        const rawFilter = request.rawFilter as string;
        if ( !rawFilter ) return {};
        const reverseLookup = getEngineState().staticFilteringReverseLookup;
        if ( reverseLookup ) {
            try {
                return await reverseLookup.fromExtendedFilter({ rawFilter });
            } catch (e) {
                console.warn('[uBR] listsFromCosmeticFilter: reverseLookup failed', e);
                return {};
            }
        }
        const results = await findFilterListFromCosmeticFilter(rawFilter);
        return results.length > 0 ? { [rawFilter]: results } : {};
    });

    handlers.set('scriptlet', async (request) => {
        const tabId = request.tabId as number;
        const scriptletName = request.scriptlet as string;
        if ( tabId && scriptletName ) {
            try {
                await chrome.scripting.executeScript({
                    target: { tabId },
                    files: [`/js/scriptlets/${scriptletName}.js`],
                });
                return { success: true };
            } catch (e) {
                console.warn('[uBR] scriptletExecute: executeScript failed', e);
                return { error: (e as Error).message };
            }
        }
        return { error: 'Invalid parameters' };
    });

    handlers.set('loggerDisabled', () =>
        getEngineState().logger?.enabled !== true);

    handlers.set('launchElementPicker', async (request) => {
        const tabId = request.tabId as number;
        const target = request.target as string;
        const zap = request.zap as boolean;
        if ( tabId ) {
            await elementPickerExec(tabId, 0, target, zap);
        }
        return { success: true };
    });

    handlers.set('snfeBenchmark', () => ({ result: 'Benchmark not implemented in MV3' }));
    handlers.set('cfeBenchmark', () => ({ result: 'Benchmark not implemented in MV3' }));
    handlers.set('sfeBenchmark', () => ({ result: 'Benchmark not implemented in MV3' }));
    handlers.set('snfeToDNR', () => ({ success: true, message: 'Static network filters already use DNR in MV3' }));
    handlers.set('snfeDump', () => ({
        dump: getEngineState().staticFilteringEngine
            ? 'Static filtering engine state not available'
            : 'No engine',
    }));

    handlers.set('snfeQuery', (request) => {
        const filter = request.filter as string;
        if ( !filter || !getEngineState().staticFilteringEngine ) return { result: [] };
        return { result: [] };
    });

    handlers.set('cfeDump', () => ({ dump: 'Cosmetic filtering engine not available in MV3' }));
    handlers.set('readyToFilter', async () => {
        await ensurePopupState();
        return true;
    });

    handlers.set('dashboardConfig', () => ({
        defaultURL: '/dashboard.html',
        noDashboardURL: '/no-dashboard.html',
        noDashboard: popupState.noDashboard === true,
    }));

    handlers.set('getRules', () => getRulesSnapshot());
    handlers.set('getPslSelfie', () => getPslSelfie(getEngineState()));

    handlers.set('modifyRuleset', async (request) => {
        const permanent = request.permanent === true;
        const switchRuleset = getSwitchRuleset(permanent, popupState);
        const firewallRuleset = permanent
            ? popupState.permanentFirewall
            : popupState.sessionFirewall;
        const urlRuleset = getURLRuleset(permanent, popupState);

        for ( const rawRule of String(request.toRemove || '').trim().split(/\s*[\n\r]+\s*/) ) {
            const rule = rawRule.trim();
            if ( rule === '' ) continue;
            const parts = rule.split(/\s+/);
            if ( firewallRuleset.removeFromRuleParts(parts) === false ) {
                if ( switchRuleset?.removeFromRuleParts?.(parts) === false ) {
                    urlRuleset?.removeFromRuleParts?.(parts);
                }
            }
        }
        for ( const rawRule of String(request.toAdd || '').trim().split(/\s*[\n\r]+\s*/) ) {
            const rule = rawRule.trim();
            if ( rule === '' ) continue;
            const parts = rule.split(/\s+/);
            if ( firewallRuleset.addFromRuleParts(parts) === false ) {
                if ( switchRuleset?.addFromRuleParts?.(parts) === false ) {
                    urlRuleset?.addFromRuleParts?.(parts);
                }
            }
        }

        if ( permanent ) {
            if ( switchRuleset?.changed ) {
                await persistPermanentHostnameSwitches();
                switchRuleset.changed = false;
            }
            if ( firewallRuleset.changed ) {
                await persistPermanentFirewall();
                firewallRuleset.changed = false;
            }
            if ( urlRuleset?.changed ) {
                await persistURLFilteringRules();
                urlRuleset.changed = false;
            }
        }

        await syncFirewallDnrRules();
        return getRulesSnapshot();
    });

    handlers.set('readHiddenSettings', async () => {
        const stored = await chrome.storage.local.get('hiddenSettings') as Record<string, any>;
        const storedAdmin = await chrome.storage.local.get('adminHiddenSettings') as Record<string, any>;
        const current = {
            ...MV3_HIDDEN_SETTINGS_DEFAULTS,
            ...(stored?.hiddenSettings || {}),
        };
        return {
            default: MV3_HIDDEN_SETTINGS_DEFAULTS,
            admin: storedAdmin?.adminHiddenSettings || {},
            current,
        };
    });

    handlers.set('writeHiddenSettings', async (request) => {
        const content = request.content as string;
        const hiddenSettings = request.hiddenSettings as Record<string, unknown> | undefined;
        let parsedSettings: Record<string, unknown> = {};
        if ( typeof content === 'string' && content.trim() !== '' ) {
            try {
                parsedSettings = JSON.parse(content);
            } catch (e) {
                console.warn('[uBR] writeHiddenSettings: JSON parse failed, falling back to line-by-line', e);
                const lines = content.split(/\r?\n/);
                for ( const rawLine of lines ) {
                    const line = rawLine.trim();
                    if ( line === '' ) continue;
                    const pos = line.indexOf(' ');
                    const key = pos === -1 ? line : line.slice(0, pos).trim();
                    const value = pos === -1 ? '' : line.slice(pos + 1).trim();
                    if ( key === '' ) continue;
                    parsedSettings[key] = coerceHiddenSettingValue(value);
                }
            }
        } else if ( hiddenSettings ) {
            parsedSettings = hiddenSettings;
        }
        if ( Object.keys(parsedSettings).length > 0 ) {
            const stored = await chrome.storage.local.get('hiddenSettings') as Record<string, any>;
            const existing = stored?.hiddenSettings || {};
            const updated = { ...existing };
            for ( const [ key, value ] of Object.entries(parsedSettings) ) {
                if ( value !== undefined ) {
                    updated[key] = value;
                }
            }
            await chrome.storage.local.set({ hiddenSettings: updated });
        }
        return { success: true };
    });

    handlers.set('getAutoCompleteDetails', async () => {
        const stored = await chrome.storage.local.get([
            'userFilters',
            FILTER_LIST_USER_PATH,
        ]);
        const userFilters = typeof stored?.userFilters === 'string'
            ? stored.userFilters
            : typeof stored?.[FILTER_LIST_USER_PATH] === 'string'
                ? stored[FILTER_LIST_USER_PATH]
                : '';
        const lines = userFilters.split('\n').filter(line => line.trim() !== '');
        const redirectResources: string[] = [];
        try {
            const redirectEngine = getEngineState().redirectEngine;
            if ( redirectEngine?.getResourceDetails ) {
                const details = redirectEngine.getResourceDetails();
                redirectResources.push(...Object.keys(details));
            } else if ( redirectEngine?.resources ) {
                redirectResources.push(...redirectEngine.resources);
            }
        } catch (e) {
            console.warn('[uBR] getUserFilters: redirectEngine access failed', e);
        }
        const originHintsSet = new Set<string>(['127.0.0.1', 'localhost', 'chrome-extension:', 'chrome:', 'about:']);
        try {
            const tabs = await chrome.tabs.query({});
            for ( const tab of tabs ) {
                if ( tab?.url ) {
                    try {
                        const url = new URL(tab.url);
                        if ( url.hostname ) originHintsSet.add(url.hostname);
                        if ( url.origin ) originHintsSet.add(url.origin);
                    } catch (e) {
                        console.warn('[uBR] getUserFilters: invalid tab URL', tab.url, e);
                    }
                }
            }
        } catch (e) {
            console.warn('[uBR] getUserFilters: chrome.tabs.query failed', e);
        }
        return {
            filterCount: lines.length,
            filterCharCount: userFilters.length,
            filterParts: lines.filter(l => !l.startsWith('!') && !l.startsWith('#')),
            filterRegexes: lines.filter(l => l.includes(' regexp')),
            whitelistParts: lines.filter(l => l.startsWith('@@')),
            needCommit: false,
            originHints: Array.from(originHintsSet),
            redirectResources,
            preparseDirectiveHints: ['|', '||', '|https:', '|http:', '^', '*', '~'],
            preparseDirectiveEnv: { flavor: 'chromium', hasWebSocket: true },
            hintUpdateToken: Date.now().toString(36),
        };
    });

    return async (request: DashboardRequest) => {
        const handler = handlers.get(request.what);
        if ( handler ) return handler(request);
        return undefined;
    };
};
