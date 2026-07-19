/*******************************************************************************

    uBlock Origin - MV3 Zapper
    https://github.com/gorhill/uBlock

    This file contains the Zapper element blocking functionality.

*******************************************************************************/

import type { LegacyMessagingAPI } from './sw-types.js';
import { epickerArgs } from './sw-messaging.js';

export const createZapper = (messaging: LegacyMessagingAPI) => {
    let active = false;
    let tabId: number | null = null;
    let sessionId: string | null = null;

    function safeTabsSendMessage(
        targetTabId: number,
        message: any,
        callback?: (_response: any) => void
    ) {
        try {
            chrome.tabs.sendMessage(targetTabId, message, (response) => {
                const err = chrome.runtime.lastError;
                if ( err ) {
                    callback?.({ error: err.message });
                    return;
                }
                callback?.(response);
            });
        } catch (e) {
            console.warn('[uBR] zapper: sendMessage failed', e);
            callback?.({ error: (e as Error).message });
        }
    }

    function activate(targetTabId: number | null, callback?: (_response: any) => void) {
        if (targetTabId === null) {
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                if (tabs[0]?.id) {
                    activate(tabs[0].id, callback);
                } else if (callback) {
                    callback({ error: 'No active tab' });
                }
            });
            return;
        }

        active = true;
        tabId = targetTabId;
        sessionId = Date.now().toString(36) + Math.random().toString(36).slice(2);
        // Ensure element picker arguments are in zapper mode.
        epickerArgs.zap = true;

        // Prefer direct injection: avoids timing issues if the content script
        // listener isn't ready yet, and matches the MV3 context-menu approach.
        chrome.scripting.executeScript({
            target: { tabId },
            files: ['/js/scripting/tool-overlay.js', '/js/scripting/zapper.js'],
        }).then(() => {
            callback?.({ success: true });
        }).catch((e) => {
            console.warn('[uBR] zapper activate: executeScript failed, falling back to sendMessage', e);
            // Fallback to message-based launch if injection fails for some reason.
            safeTabsSendMessage(tabId, {
                topic: 'zapperActivate',
                payload: { sessionId }
            }, (response) => {
                callback?.(response || { success: true });
            });
        });
    }

    function deactivate(callback?: (_response: any) => void) {
        if (tabId) {
            // Stop the overlay if present.
            chrome.scripting.executeScript({
                target: { tabId },
                func: () => {
                    try {
                        (globalThis as any).ubolOverlay?.stop?.();
                    } catch (e) {
                        console.warn('[uBR] zapperOverlay.stop: failed', e);
                    }
                },
            }).catch((e) => {
                console.warn('[uBR] zapperDeactivate: executeScript failed for tab', tabId, e);
            });

            safeTabsSendMessage(tabId, { topic: 'zapperDeactivate' }, () => {
                active = false;
                tabId = null;
                sessionId = null;
                epickerArgs.zap = false;
                if (callback) callback({ success: true });
            });
        } else {
            active = false;
            sessionId = null;
            epickerArgs.zap = false;
            if (callback) callback({ success: true });
        }
    }

    function isActive() { return active; }
    function getSessionId() { return sessionId; }
    function getTabId() { return tabId; }

    function highlight(details: any, callback?: (_response: any) => void) {
        if (!tabId) {
            if (callback) callback({ error: 'No active zapper session' });
            return;
        }
        safeTabsSendMessage(tabId, { topic: 'zapperHighlight', payload: details }, callback);
    }

    function click(details: any, callback?: (_response: any) => void) {
        if (!tabId) {
            if (callback) callback({ error: 'No active zapper session' });
            return;
        }
        safeTabsSendMessage(tabId, { topic: 'zapperClick', payload: details }, callback);
    }

    messaging.on('zapperLaunch', (payload, callback) => {
        activate(payload?.tabId ?? null, callback);
    });

    messaging.on('zapperQuery', (_, callback) => {
        if (callback) {
            callback({ active: isActive(), sessionId: getSessionId() });
        }
    });

    messaging.on('zapperHighlight', (payload, callback) => {
        highlight(payload, callback);
    });

    messaging.on('zapperClick', (payload, callback) => {
        click(payload, callback);
    });

    return {
        activate,
        deactivate,
        isActive,
        getSessionId,
        getTabId,
        highlight,
        click,
    };
};
