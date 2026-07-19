/*******************************************************************************

    uBlock Origin - MV3 Logger Buffer Chrome Event Module
    https://github.com/gorhill/uBlock

    Captures webRequest events for the logger UI. Moves the inline
    webRequest listener registrations from sw-entry.ts into the typed
    ChromeEventModule pattern.

*******************************************************************************/

import type { ChromeEventModule, Unregister } from "../chrome-event-registry.js";
import { domainFromHostname } from "../sw-helpers.js";

function hostnameFromURL(url: string): string {
    try { return new URL(url).hostname; }
    catch (e) { console.warn('[uBR] logger-buffer: invalid URL', url, e); return ""; }
}

const loggerBuffer: string[] = [];
const loggerBufferMax = 5000;

function pushLoggerJSON(entry: Record<string, any>) {
    loggerBuffer.push(JSON.stringify(entry));
    if (loggerBuffer.length > loggerBufferMax) {
        loggerBuffer.splice(0, loggerBuffer.length - loggerBufferMax);
    }
}

export function getLoggerBuffer(): string[] {
    return loggerBuffer;
}

export interface LoggerBufferDeps {
}

export function createLoggerBufferModule(_deps?: LoggerBufferDeps): ChromeEventModule {

    async function pushNetworkEntry(details: any, entryType: string) {
        if (typeof details.tabId !== 'number' || details.tabId < 0) return;

        const url = details.url || '';
        if (url.startsWith(chrome.runtime.getURL(''))) return;

        const requestHostname = hostnameFromURL(url);
        const requestDomain = domainFromHostname(requestHostname);

        let tabURL = '';
        let tabHostname = '';
        let tabDomain = '';
        try {
            const tab = await chrome.tabs.get(details.tabId);
            tabURL = tab?.url || '';
            tabHostname = hostnameFromURL(tabURL);
            tabDomain = domainFromHostname(tabHostname);
        } catch (e) {
            console.warn('[uBR] pushLoggerJSON: tabs.get failed', details.tabId, e);
            tabHostname = requestHostname;
            tabDomain = requestDomain;
        }

        pushLoggerJSON({
            tstamp: Date.now() / 1000,
            realm: 'network',
            tabId: details.tabId,
            type: entryType,
            method: details.method || '',
            url,
            docHostname: tabHostname,
            docDomain: tabDomain,
            tabHostname,
            tabDomain,
            domain: requestDomain,
        });
    }

    return {
        domain: "logger-buffer",
        register: () => {
            const cleanups: Unregister[] = [];

            const beforeRequestHandler = (details: any) => { void pushNetworkEntry(details, 'request'); return undefined; };
            chrome.webRequest.onBeforeRequest.addListener(
                beforeRequestHandler,
                { urls: ['<all_urls>'] },
                [],
            );
            cleanups.push(() => chrome.webRequest.onBeforeRequest.removeListener(beforeRequestHandler));

            const completedHandler = (details: any) => { void pushNetworkEntry(details, 'completed'); };
            chrome.webRequest.onCompleted.addListener(
                completedHandler,
                { urls: ['<all_urls>'] },
                [],
            );
            cleanups.push(() => chrome.webRequest.onCompleted.removeListener(completedHandler));

            const errorHandler = (details: any) => { void pushNetworkEntry(details, 'error'); };
            chrome.webRequest.onErrorOccurred.addListener(
                errorHandler,
                { urls: ['<all_urls>'] },
                [],
            );
            cleanups.push(() => chrome.webRequest.onErrorOccurred.removeListener(errorHandler));

            console.log('[MV3] webRequest logger listeners registered');
            return cleanups;
        },
    };
}
