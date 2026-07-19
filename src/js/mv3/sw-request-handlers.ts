/*******************************************************************************

    uBlock Origin - MV3 Request Handlers
    https://github.com/gorhill/uBlock

    This file contains webRequest handlers for tracking requests.

*******************************************************************************/

import { popupState } from './sw-storage.js';
import { createCounts, zeroHostnameDetails, domainFromHostname } from './sw-helpers.js';
import {
    ensureTabRequestState,
    persistTabRequestState,
    incrementCounts,
} from './sw-request-tracking.js';
import { persistGlobalRequestCounts } from './sw-tab-metrics.js';

export type TabRequestState = {
    startedAt: number;
    pageHostname: string;
    pageCounts: any;
    hostnameDict: Record<string, any>;
};

export type CollectedHostnameData = {
    pageCounts: any;
    hostnameDict: Record<string, any>;
};

const getLogger = () => (globalThis as any).vAPI?.logger || (globalThis as any).logger;

const writeNetworkLogEntry = (
    details: {
        tabId: number;
        type: string;
        method?: string;
        url: string;
    },
    blocked?: boolean,
) => {
    const logger = getLogger();
    if (logger?.enabled !== true || typeof details.url !== 'string' || details.url === '') {
        return;
    }

    let hostname = '';
    try {
        hostname = new URL(details.url).hostname;
    } catch (e) {
        console.warn('[uBR] writeNetworkLogEntry: invalid URL', details.url, e);
        return;
    }

    const domain = domainFromHostname(hostname);
    logger.writeOne({
        realm: 'network',
        method: details.method || 'GET',
        type: details.type,
        tabId: details.tabId,
        tabDomain: domain,
        tabHostname: hostname,
        docDomain: domain,
        docHostname: hostname,
        domain,
        hostname,
        url: details.url,
        filter: blocked === undefined
            ? undefined
            : {
                raw: blocked ? 'blocked' : 'allowed',
                result: blocked ? 1 : 2,
            },
    });
};

export const recordTabRequest = (details: chrome.webRequest.WebRequestDetails) => {
    if (details.tabId < 0) { return; }
    let hostname = '';
    try {
        hostname = new URL(details.url).hostname;
    } catch (e) {
        console.warn('[uBR] recordTabRequest: invalid URL', details.url, e);
        return;
    }

    if (details.type === 'main_frame') {
        const state = ensureTabRequestState(details.tabId, hostname);
        state.startedAt = typeof (details as { timeStamp?: number }).timeStamp === 'number'
            ? (details as { timeStamp?: number }).timeStamp as number
            : Date.now();
        state.pageHostname = hostname;
        state.pageCounts = createCounts();
        state.hostnameDict = {
            [hostname]: zeroHostnameDetails(hostname),
        };
        incrementCounts(state.pageCounts, details.type, false);
        incrementCounts(state.hostnameDict[hostname].counts, details.type, false);
        writeNetworkLogEntry(details);
        popupState.globalAllowedRequestCount += 1;
        void Promise.all([
            persistTabRequestState(details.tabId),
            persistGlobalRequestCounts(),
        ]);
        return;
    }

    const state = ensureTabRequestState(details.tabId);
    if (state.hostnameDict[hostname] === undefined) {
        state.hostnameDict[hostname] = zeroHostnameDetails(hostname);
    }
    incrementCounts(state.pageCounts, details.type, false);
    incrementCounts(state.hostnameDict[hostname].counts, details.type, false);
    void persistTabRequestState(details.tabId);
};

export const trackPendingRequest = (details: chrome.webRequest.WebRequestDetails) => {
    if (details.tabId < 0) { return; }
    if (details.type === 'main_frame') {
        recordTabRequest(details);
    }
};

export const finalizeTrackedRequest = async (
    details: chrome.webRequest.WebRequestDetails & { error?: string; fromCache?: boolean; ip?: string },
    blocked: boolean,
) => {
    if (details.tabId < 0 || details.type === 'main_frame') { return; }
    if (
        blocked &&
        details.error !== 'net::ERR_BLOCKED_BY_CLIENT' &&
        details.error !== 'ERR_BLOCKED_BY_CLIENT'
    ) {
        return;
    }

    let hostname = '';
    try {
        hostname = new URL(details.url).hostname;
    } catch (e) {
        console.warn('[uBR] finalizeTrackedRequest: invalid URL', details.url, e);
        return;
    }

    const state = ensureTabRequestState(details.tabId);
    if (state.hostnameDict[hostname] === undefined) {
        state.hostnameDict[hostname] = zeroHostnameDetails(hostname);
    }
    incrementCounts(state.pageCounts, details.type, blocked);
    incrementCounts(state.hostnameDict[hostname].counts, details.type, blocked);
    writeNetworkLogEntry(details, blocked);
    if (blocked) {
        popupState.globalBlockedRequestCount += 1;
    } else {
        popupState.globalAllowedRequestCount += 1;
    }
    await Promise.all([
        persistTabRequestState(details.tabId),
        persistGlobalRequestCounts(),
    ]);
};

export const collectTabHostnameData = async (
    tabId: number,
    pageHostname: string,
): Promise<CollectedHostnameData | undefined> => {
    if (chrome.scripting?.executeScript === undefined) { return; }
    try {
        const [result] = await chrome.scripting.executeScript({
            target: { tabId },
            world: 'MAIN',
            func: (currentPageHostname: string) => {
                const createCounts = () => ({
                    allowed: { any: 0, frame: 0, script: 0 },
                    blocked: { any: 0, frame: 0, script: 0 },
                });
                const isIPAddress = (hostname: string) =>
                    /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname) || hostname.includes(':');
                const domainFromHostname = (hostname: string) => {
                    if (hostname === '' || hostname === '*') { return hostname; }
                    if (hostname === 'localhost' || isIPAddress(hostname)) { return hostname; }
                    const parts = hostname.split('.').filter(Boolean);
                    if (parts.length <= 2) { return hostname; }
                    return parts.slice(-2).join('.');
                };
                const hostnameDict = Object.create(null);
                const ensureHostname = (hostname: string) => {
                    if (hostnameDict[hostname] !== undefined) { return hostnameDict[hostname]; }
                    hostnameDict[hostname] = {
                        domain: domainFromHostname(hostname),
                        counts: createCounts(),
                    };
                    return hostnameDict[hostname];
                };
                ensureHostname(currentPageHostname);
                const pageCounts = createCounts();
                const increment = (hostname: string, kind: 'image' | 'script' | 'frame' | 'any') => {
                    const details = ensureHostname(hostname);
                    details.counts.allowed.any += 1;
                    pageCounts.allowed.any += 1;
                    if ( kind === 'script' ) {
                        details.counts.allowed.script += 1;
                        pageCounts.allowed.script += 1;
                    } else if ( kind === 'frame' ) {
                        details.counts.allowed.frame += 1;
                        pageCounts.allowed.frame += 1;
                    }
                };

                const recordURL = (rawURL: string, kind: 'image' | 'script' | 'frame' | 'any') => {
                    if ( typeof rawURL !== 'string' || rawURL === '' ) { return; }
                    try {
                        const hostname = new URL(rawURL, document.baseURI).hostname;
                        if ( hostname === '' ) { return; }
                        increment(hostname, kind);
                    } catch (e) {
                        console.warn('[uBR] recordURL: invalid URL', rawURL, e);
                    }
                };

                recordURL(document.URL, 'any');

                for ( const img of document.images ) {
                    recordURL(img.currentSrc || img.src, 'image');
                }
                for ( const script of document.scripts ) {
                    recordURL(script.src, 'script');
                }
                for ( const frame of document.querySelectorAll('iframe,frame') ) {
                    recordURL((frame as HTMLIFrameElement).src, 'frame');
                }
                for ( const objectEl of document.querySelectorAll('object,embed') ) {
                    recordURL(
                        (objectEl as HTMLObjectElement).data ||
                        (objectEl as HTMLEmbedElement).src ||
                        '',
                        'frame',
                    );
                }

                return {
                    pageCounts,
                    hostnameDict,
                };
            },
            args: [pageHostname],
        });

        if (result?.result) {
            return result.result as CollectedHostnameData;
        }
    } catch (e) {
        console.warn('[uBR] collectHostnameDataFromTab: executeScript failed', tabId, e);
    }
    return undefined;
};

export const getMatchedBlockedRequestCountForTab = async (
    tabId: number,
    minTimeStamp = 0,
): Promise<number | undefined> => {
    if (chrome.declarativeNetRequest?.getMatchedRules === undefined) {
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
        console.warn('[uBR] getMatchedBlockedRequestCountForTab: getMatchedRules failed', tabId, e);
    }
};
