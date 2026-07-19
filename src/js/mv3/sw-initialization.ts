/*******************************************************************************

    uBlock Origin - MV3 Service Worker Initialization
    Handles backend initialization, engine references, and state management

*******************************************************************************/

import { withDisabledRuntimeOnConnect } from './sw-messaging.js';
import type { LegacyMessagingAPI, LegacyPortDetails } from './sw-types.js';
import { setEngineReferences } from './sw-engine-references.js';

export const getLegacyMessaging = (): LegacyMessagingAPI | undefined => {
    return (globalThis as any).vAPI?.messaging;
};

export const legacyBackendState = {
    initialized: false,
    initializing: null as Promise<void> | null,
};

export const ensureLegacyBackend = async (): Promise<void> => {
    if ( legacyBackendState.initialized ) { return; }
    if ( legacyBackendState.initializing ) { return legacyBackendState.initializing; }

    legacyBackendState.initializing = withDisabledRuntimeOnConnect(async () => {
        if ( typeof (globalThis as any).window === 'undefined' ) {
            (globalThis as any).window = globalThis;
        }
        const vAPI = ((globalThis as any).vAPI ||= {});
        if ( typeof (globalThis as any).window.vAPI === 'undefined' ) {
            (globalThis as any).window.vAPI = vAPI;
        }
        if ( typeof vAPI.T0 !== 'number' ) {
            vAPI.T0 = Date.now();
        }
        if ( typeof vAPI.sessionId !== 'string' ) {
            vAPI.sessionId = 'mv3-sw';
        }
        if ( typeof vAPI.getURL !== 'function' ) {
            vAPI.getURL = (path = '') => chrome.runtime.getURL(path);
        }
        if ( typeof vAPI.setTimeout !== 'function' ) {
            vAPI.setTimeout = globalThis.setTimeout.bind(globalThis);
        }
        if ( typeof vAPI.clearTimeout !== 'function' ) {
            vAPI.clearTimeout = globalThis.clearTimeout.bind(globalThis);
        }
        if ( typeof vAPI.localStorage !== 'object' || vAPI.localStorage === null ) {
            const storageMap = new Map<string, string>();
            vAPI.localStorage = {
                getItem(key: string) { return Promise.resolve(storageMap.has(key) ? storageMap.get(key) : null); },
                setItem(key: string, value: string) { storageMap.set(key, `${value}`); return Promise.resolve(); },
                removeItem(key: string) { storageMap.delete(key); return Promise.resolve(); },
                clear() { storageMap.clear(); return Promise.resolve(); },
            };
        }
        if ( typeof vAPI.webextFlavor !== 'object' || vAPI.webextFlavor === null || typeof vAPI.webextFlavor.soup?.has !== 'function' ) {
            vAPI.webextFlavor = { major: 120, env: [], soup: new Set([ 'chromium', 'mv3', 'ublock' ]) };
        } else {
            vAPI.webextFlavor.major ??= 120;
            vAPI.webextFlavor.env ??= [];
            vAPI.webextFlavor.soup?.add?.('chromium');
            vAPI.webextFlavor.soup?.add?.('mv3');
            vAPI.webextFlavor.soup?.add?.('ublock');
        }
        if ( typeof (globalThis as any).screen === 'undefined' ) {
            (globalThis as any).screen = { width: 1280, height: 720 };
        }
        if ( typeof (globalThis as any).window.screen === 'undefined' ) {
            (globalThis as any).window.screen = (globalThis as any).screen;
        }
        if ( typeof (globalThis as any).document === 'undefined' ) {
            const noop = () => {};
            const nullFn = () => null;
            (globalThis as any).document = {
                body: null, head: null, documentElement: null, hidden: true, visibilityState: 'hidden', readyState: 'complete',
                addEventListener: noop, removeEventListener: noop, dispatchEvent: noop,
                createElement: () => ({ style: {}, setAttribute: noop, removeAttribute: noop, addEventListener: noop, removeEventListener: noop, appendChild: noop, remove: noop, classList: { add: noop, remove: noop, contains: () => false } }),
                querySelector: nullFn, querySelectorAll: () => [], getElementById: nullFn,
            };
        }
        if ( typeof (globalThis as any).window.document === 'undefined' ) {
            (globalThis as any).window.document = (globalThis as any).document;
        }
        if ( typeof (globalThis as any).Image === 'undefined' ) {
            (globalThis as any).Image = class {
                onload: null | (() => void) = null;
                onerror: null | (() => void) = null;
                width = 0; height = 0; complete = false;
                private listeners = new Map<string, Set<() => void>>();
                addEventListener(type: string, listener: () => void) {
                    const bucket = this.listeners.get(type) || new Set<() => void>();
                    bucket.add(listener);
                    this.listeners.set(type, bucket);
                }
                removeEventListener(type: string, listener: () => void) { this.listeners.get(type)?.delete(listener); }
                set src(_value: string) {
                    this.complete = true;
                    queueMicrotask(() => {
                        if (typeof this.onload === 'function') this.onload();
                        for (const listener of this.listeners.get('load') || []) listener();
                    });
                }
            };
        }
        await import('../start.ts');
        const backgroundModule = await import('../background.js');
        const legacyBackground = backgroundModule.default as { isReadyPromise?: Promise<unknown> };
        if (legacyBackground?.isReadyPromise instanceof Promise) {
            await legacyBackground.isReadyPromise.catch((e) => {
                console.warn('[uBR] ensureLegacyBackend: legacy isReadyPromise failed', e);
            });
        }
        legacyBackendState.initialized = true;
        setEngineReferences();
    });

    try {
        await legacyBackendState.initializing;
    } finally {
        legacyBackendState.initializing = null;
    }
};

export const registerLegacyPort = (port: chrome.runtime.Port): LegacyPortDetails | undefined => {
    const messaging = getLegacyMessaging();
    if (messaging === undefined) return;

    const sender = port.sender || {};
    const { origin, tab, url } = sender;
    const details: LegacyPortDetails = {
        port, frameId: sender.frameId, frameURL: url,
        privileged: origin !== undefined ? origin === messaging.PRIVILEGED_ORIGIN : typeof url === 'string' && url.startsWith(messaging.PRIVILEGED_ORIGIN),
    };
    if (tab) { details.tabId = tab.id; details.tabURL = tab.url; }
    messaging.ports.set(port.name, details);
    return details;
};

export const applyRuleTextDelta = (
    ruleset: any,
    text: string,
    method: 'addFromRuleParts' | 'removeFromRuleParts',
) => {
    for (const rawRule of text.split(/\s*[\n\r]+\s*/)) {
        const rule = rawRule.trim();
        if (rule === '') continue;
        const parts = rule.split(/\s+/);
        if (method === 'addFromRuleParts') {
            ruleset.addFromRuleParts(parts as [string, string, string, string]);
        } else {
            ruleset.removeFromRuleParts(parts as [string, string, string, string]);
        }
    }
};

export const modifyDashboardRuleset = async (payload: {
    permanent?: boolean;
    toAdd?: string;
    toRemove?: string;
}, popupState: any, ensurePopupState: () => Promise<void>, persistPermanentFirewall: () => Promise<void>, syncFirewallDnrRules: () => Promise<void>) => {
    await ensurePopupState();
    const ruleset = payload.permanent ? popupState.permanentFirewall : popupState.sessionFirewall;
    applyRuleTextDelta(ruleset, payload.toRemove || '', 'removeFromRuleParts');
    applyRuleTextDelta(ruleset, payload.toAdd || '', 'addFromRuleParts');

    if (payload.permanent) {
        await persistPermanentFirewall();
    }

    await syncFirewallDnrRules();

    return {
        permanentRules: popupState.permanentFirewall.toArray(),
        sessionRules: popupState.sessionFirewall.toArray(),
    };
};

export const resetDashboardRules = async (popupState: any, ensurePopupState: () => Promise<void>, syncFirewallDnrRules: () => Promise<void>) => {
    await ensurePopupState();
    popupState.sessionFirewall.assign(popupState.permanentFirewall);
    await syncFirewallDnrRules();
    return {
        permanentRules: popupState.permanentFirewall.toArray(),
        sessionRules: popupState.sessionFirewall.toArray(),
    };
};
