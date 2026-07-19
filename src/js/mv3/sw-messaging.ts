/*******************************************************************************

    uBlock Origin - MV3 Messaging
    https://github.com/gorhill/uBlock

    This file contains legacy messaging and port management.

******************************************************************************/

import type { LegacyMessagingAPI, LegacyPortDetails } from './sw-types.js';

export const legacyBackendState = {
    initializing: null as Promise<void> | null,
    initialized: false,
};

export const epickerArgs = {
    target: '',
    mouse: '',
    zap: false,
    eprom: null as any,
};

export const getLegacyMessaging = (): LegacyMessagingAPI | undefined => {
    return (globalThis as any).vAPI?.messaging;
};

export const registerLegacyPort = (port: chrome.runtime.Port): LegacyPortDetails | undefined => {
    const messaging = getLegacyMessaging();
    if (!messaging) return undefined;
    
    const details: LegacyPortDetails = {
        port,
        privileged: false,
    };
    
    messaging.ports.set(port.name, details);
    return details;
};

export const broadcastFilteringBehaviorChanged = async (): Promise<void> => {
    const messaging = getLegacyMessaging();
    if (!messaging) return;
    
    for (const [name, details] of messaging.ports) {
        try {
            details.port.postMessage({
                channel: 'filtersBehaviorChanged',
                payload: null,
            });
        } catch (e) {
            console.warn('[uBR] broadcastFilteringBehaviorChanged: failed to send to port', name, e);
        }
    }
};

export const broadcastFilteringBehaviorChangedToTabs = async (): Promise<void> => {
    try {
        const tabs = await chrome.tabs.query({});
        for (const tab of tabs) {
            if (tab.id) {
                try {
                    await chrome.tabs.sendMessage(tab.id, { what: 'filteringBehaviorChanged' });
                } catch (e) {
                    console.warn('[uBR] broadcastFilteringBehaviorChangedToTabs: failed to notify tab', tab.id, e);
                }
            }
        }
    } catch (e) {
        console.warn('[uBR] broadcastFilteringBehaviorChangedToTabs: chrome.tabs.query failed', e);
    }
};

export const withDisabledRuntimeOnConnect = async <T>(callback: () => Promise<T>): Promise<T> => {
    return await callback();
};
