/*******************************************************************************

    uBlock Origin - MV3 Request Tracking
    https://github.com/gorhill/uBlock

    This file contains request tracking and tab metrics.

******************************************************************************/

import type { TabRequestState, HostnameDetails, FirewallCounts } from './sw-types.js';
import { createCounts } from './sw-helpers.js';

export const tabRequestStates = new Map<number, TabRequestState>();

export const getTabRequestStateKey = (tabId: number) => `firewallTabState:${tabId}`;
export const requestStateStorage = (chrome.storage as any).local;

export const zeroHostnameDetails = (hostname: string): HostnameDetails => ({
    domain: hostname,
    counts: createCounts(),
});

export const ensureTabRequestState = (tabId: number, pageHostname = ''): TabRequestState => {
    let state = tabRequestStates.get(tabId);
    if ( state !== undefined ) { return state; }
    state = {
        startedAt: Date.now(),
        pageHostname,
        pageCounts: createCounts(),
        hostnameDict: {},
    };
    if ( pageHostname !== '' ) {
        state.hostnameDict[pageHostname] = zeroHostnameDetails(pageHostname);
    }
    tabRequestStates.set(tabId, state);
    return state;
};

export const persistTabRequestState = async (tabId: number): Promise<void> => {
    const state = tabRequestStates.get(tabId);
    if ( state === undefined ) { return; }
    const stored = await requestStateStorage.get('popupContentVersions');
    const versions = stored?.popupContentVersions || {};
    versions[tabId] = Date.now();
    await requestStateStorage.set({
        [getTabRequestStateKey(tabId)]: state,
        popupContentVersions: versions,
    });
};

export const loadTabRequestState = async (tabId: number): Promise<TabRequestState | undefined> => {
    const inMemory = tabRequestStates.get(tabId);
    if ( inMemory !== undefined ) { return inMemory; }
    const items = await requestStateStorage.get(getTabRequestStateKey(tabId));
    const state = items[getTabRequestStateKey(tabId)] as TabRequestState | undefined;
    if ( state !== undefined ) {
        tabRequestStates.set(tabId, state);
    }
    return state;
};

export const loadTabRequestStateWithRetry = async (tabId: number, attempts = 3): Promise<TabRequestState | undefined> => {
    for ( let i = 0; i < attempts; i++ ) {
        const state = await loadTabRequestState(tabId);
        if ( state !== undefined ) {
            return state;
        }
        if ( i + 1 < attempts ) {
            await new Promise(resolve => setTimeout(resolve, 100));
        }
    }
    return undefined;
};

export const clearTabRequestState = async (tabId: number): Promise<void> => {
    tabRequestStates.delete(tabId);
    const stored = await requestStateStorage.get('popupContentVersions');
    const versions = stored?.popupContentVersions || {};
    delete versions[tabId];
    await requestStateStorage.set({ popupContentVersions: versions });
    await requestStateStorage.remove(getTabRequestStateKey(tabId));
};

export const incrementCounts = (
    counts: FirewallCounts,
    type: string,
    blocked: boolean,
): void => {
    const target = blocked ? counts.blocked : counts.allowed;
    target.any += 1;
    if (type === 'sub_frame' || type === 'subdocument') {
        target.frame += 1;
    } else if (type === 'script') {
        target.script += 1;
    }
};

export const finalizeTrackedRequest = async (
    details: chrome.webRequest.WebRequestDetails & { error?: string; fromCache?: boolean; ip?: string },
    blocked: boolean,
): Promise<void> => {
    if ( details.tabId < 0 || details.type === 'main_frame' ) { return; }

    let hostname = '';
    try {
        hostname = new URL(details.url).hostname;
    } catch (e) {
        console.warn('[uBR] finalizeTrackedRequest: invalid URL', details.url, e);
        return;
    }

    const state = ensureTabRequestState(details.tabId);
    if ( state.hostnameDict[hostname] === undefined ) {
        state.hostnameDict[hostname] = zeroHostnameDetails(hostname);
    }
    incrementCounts(state.pageCounts, details.type, blocked);
    incrementCounts(state.hostnameDict[hostname].counts, details.type, blocked);

    await persistTabRequestState(details.tabId);
};

export const trackPendingRequest = (_details: chrome.webRequest.WebRequestDetails): void => {
    // Placeholder for pending request tracking
};

export const collectTabHostnameData = async (
    tabId: number,
    _pageHostname: string,
): Promise<{ pageCounts: FirewallCounts; hostnameDict: Record<string, HostnameDetails> } | undefined> => {
    if ( chrome.scripting?.executeScript === undefined ) { return; }
    try {
        const [ result ] = await chrome.scripting.executeScript({
            target: { tabId },
            world: 'MAIN',
            func: () => {
                return {
                    pageCounts: { allowed: { any: 0, frame: 0, script: 0 }, blocked: { any: 0, frame: 0, script: 0 } },
                    hostnameDict: {},
                };
            },
        });
        return result?.result as { pageCounts: FirewallCounts; hostnameDict: Record<string, HostnameDetails> } | undefined;
    } catch (e) {
        console.warn('[uBR] getFirewallCountsForTab: executeScript failed', tabId, e);
        return;
    }
};

export const persistGlobalRequestCounts = async (): Promise<void> => {
    // Placeholder
};

export const getTabSwitchMetrics = async (tabId: number): Promise<{
    popupBlockedCount: number;
    largeMediaCount: number;
    remoteFontCount: number;
    scriptCount: number;
}> => {
    if ( chrome.scripting?.executeScript === undefined ) {
        return { popupBlockedCount: 0, largeMediaCount: 0, remoteFontCount: 0, scriptCount: 0 };
    }
    try {
        const [ result ] = await chrome.scripting.executeScript({
            target: { tabId },
            world: 'MAIN',
            func: () => {
                const win = window as Window & Record<string, any>;
                return {
                    popupBlockedCount: typeof win.__ubrPopupBlockedCount === 'number' ? win.__ubrPopupBlockedCount : 0,
                    largeMediaCount: document.querySelectorAll('video, audio').length,
                    scriptCount: document.scripts.length,
                    remoteFontCount: 0,
                };
            },
        });
        return result?.result as { popupBlockedCount: number; largeMediaCount: number; remoteFontCount: number; scriptCount: number } | undefined;
    } catch (e) {
        console.warn('[uBR] getTabSwitchMetrics: executeScript failed', tabId, e);
        return { popupBlockedCount: 0, largeMediaCount: 0, remoteFontCount: 0, scriptCount: 0 };
    }
};
