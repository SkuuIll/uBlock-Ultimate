/*******************************************************************************

    uBlock Origin - MV3 Message Router
    https://github.com/gorhill/uBlock

    This file contains the core messaging router - port management, message routing,
    and handler registration. Extracted from sw-entry.ts.

******************************************************************************/

import type { LegacyMessagingAPI, LegacyMessage } from './sw-types.js';

type MessageHandler = (_payload: any, _callback?: (_response: any) => void) => any;
type TabListener = (_topic: string, _payload: any) => void;

/** Wraps a payload-to-result function with try/catch and callback dispatch. */
export const safeHandler = (fn: (_payload: any) => any): MessageHandler => {
    return async (payload, callback) => {
        try {
            const result = await fn(payload ?? {});
            if (callback) callback(result);
            return result;
        } catch (e) {
            const errorResult = { error: (e as Error).message };
            if (callback) callback(errorResult);
            return errorResult;
        }
    };
};

export interface MessagingRouterDeps {
    getLegacyMessaging: () => LegacyMessagingAPI | undefined;
}

export interface MessagingRouterAPI {
    on: (_topic: string, _handler: MessageHandler) => void;
    off: (_topic: string, _handler: MessageHandler) => void;
    sendToTab: (_tabId: number, _topic: string, _payload?: any) => Promise<void>;
    sendToAllTabs: (_topic: string, _payload?: any) => Promise<void>;
    getPort: (_name: string) => chrome.runtime.Port | undefined;
    addTabListener: (_tabId: number, _listener: TabListener) => void;
    removeTabListener: (_tabId: number, _listener: TabListener) => void;
    broadcastToTabs: (_topic: string, _payload?: any) => void;
}

export const createMessagingRouter = (deps: MessagingRouterDeps): MessagingRouterAPI => {
    const { getLegacyMessaging } = deps;

    const portMap = new Map<string, chrome.runtime.Port>();
    const handlers = new Map<string, MessageHandler>();
    const tabListeners = new Map<number, Set<TabListener>>();

    function onPortConnected(port: chrome.runtime.Port) {
        portMap.set(port.name || 'unknown', port);

        port.onMessage.addListener((message) => {
            void handlePortMessage(port, message);
        });

        port.onDisconnect.addListener(() => {
            void chrome.runtime.lastError;
            portMap.delete(port.name || 'unknown');
            const legacyMessaging = getLegacyMessaging();
            legacyMessaging?.onPortDisconnect?.(port);
        });
    }

    async function handlePortMessage(port: chrome.runtime.Port, message: any) {
        if (message && typeof message.channel === 'string') {
            await handleLegacyPortMessage(port, message as LegacyMessage);
            return;
        }
        if (!message || !message.topic) return;

        const { topic, payload, seq } = message;

        const handler = handlers.get(topic);

        if (handler) {
            try {
                const result = handler(payload, (response: any) => {
                    if (seq !== undefined) {
                        port.postMessage({ seq, payload: response });
                    }
                });

                if (result instanceof Promise) {
                    result.then((response) => {
                        if (seq !== undefined && response !== undefined) {
                            port.postMessage({ seq, payload: response });
                        }
                    }).catch((error) => {
                        console.warn('[uBR] handlePortMessage: handler promise reject', error);
                        if (seq !== undefined) {
                            port.postMessage({ seq, payload: { error: error.message } });
                        }
                    });
                }
            } catch (e) {
                console.error('Handler error:', e);
                if (seq !== undefined) {
                    port.postMessage({ seq, payload: { error: (e as Error).message } });
                }
            }
        } else {
            if (seq !== undefined) {
                port.postMessage({ seq, payload: { error: `No handler registered for channel ${topic}` } });
            }
        }
    }

    async function handleLegacyPortMessage(port: chrome.runtime.Port, message: LegacyMessage) {
        const { channel, msgId, msg } = message;
        const respond = (response: any) => {
            if (msgId === undefined) { return; }
            port.postMessage({ msgId, msg: response });
        };

        if (typeof channel === 'string') {
            const handler = handlers.get(channel);
            if (handler) {
                try {
                    const result = handler(msg, respond);
                    if (result instanceof Promise) {
                        const response = await result;
                        if (response !== undefined) {
                            respond(response);
                        }
                    } else if (result !== undefined) {
                        respond(result);
                    }
                } catch (error) {
                    console.warn('[uBR] handleLegacyPortMessage: channel handler reject', error);
                    respond({ error: (error as Error).message });
                }
                return;
            }
        }

        respond({ error: `No handler registered for channel ${channel}` });
    }

    function on(topic: string, handler: MessageHandler) {
        handlers.set(topic, handler);
    }

    function off(topic: string, handler: MessageHandler) {
        const existing = handlers.get(topic);
        if (existing === handler) {
            handlers.delete(topic);
        }
    }

    async function sendToTab(tabId: number, topic: string, payload?: any): Promise<void> {
        try {
            await chrome.tabs.sendMessage(tabId, { topic, payload });
        } catch (e) {
            console.log('[MV3] sendToTab error:', e);
        }
    }

    async function sendToAllTabs(topic: string, payload?: any): Promise<void> {
        try {
            const tabs = await chrome.tabs.query({});
            for (const tab of tabs) {
                if (tab.id) {
                    await sendToTab(tab.id, topic, payload);
                }
            }
        } catch (e) {
            console.log('[MV3] sendToAllTabs error:', e);
        }
    }

    function getPort(name: string): chrome.runtime.Port | undefined {
        return portMap.get(name);
    }

    function addTabListener(tabId: number, listener: TabListener) {
        if (!tabListeners.has(tabId)) {
            tabListeners.set(tabId, new Set());
        }
        tabListeners.get(tabId)!.add(listener);
    }

    function removeTabListener(tabId: number, listener: TabListener) {
        tabListeners.get(tabId)?.delete(listener);
    }

    function broadcastToTabs(topic: string, payload?: any) {
        const listeners = Array.from(tabListeners.values());
        for (const listenerSet of listeners) {
            for (const listener of listenerSet) {
                try {
                    listener(topic, payload);
                } catch (e) {
                    console.log('[MV3] broadcastToTabs error:', e);
                }
            }
        }
    }

    chrome.runtime.onConnect.addListener(onPortConnected);
    chrome.runtime.onMessage.addListener(handleRuntimeMessage);

    function handleRuntimeMessage(message: any, sender: chrome.runtime.MessageSender, sendResponse: (_response?: any) => void) {
        // Handle { channel, msg } format (content scripts via vAPI-client.js)
        if (message && typeof message.channel === 'string') {
            const { channel, msgId, msg } = message;
            const respond = (response: any) => {
                if (msgId !== undefined) {
                    sendResponse({ msgId, msg: response });
                } else {
                    sendResponse(response);
                }
            };

            const handler = handlers.get(channel);
            if (handler) {
                try {
                    const result = handler(msg, respond);
                    if (result instanceof Promise) {
                        result.then((response: any) => {
                            if (response !== undefined) respond(response);
                        }).catch((error: any) => {
                            console.warn('[uBR] handleRuntimeMessage: handler promise reject', error);
                            respond({ error: (error as Error).message });
                        });
                    } else if (result !== undefined) {
                        respond(result);
                    }
                } catch (error) {
                    console.warn('[uBR] handleRuntimeMessage: handler throw', error);
                    respond({ error: (error as Error).message });
                }
                return true;
            }

            respond({ error: `No handler registered for channel ${channel}` });
            return true;
        }

        if (!message || !message.topic) {
            return undefined;
        }

        const { topic, payload, seq } = message;

        const handler = handlers.get(topic);

        if (handler) {
            try {
                const result = handler(payload, (response: any) => {
                    if (seq !== undefined) {
                        sendResponse({ seq, payload: response });
                    }
                });

                if (result instanceof Promise) {
                    result.then((response) => {
                        if (response !== undefined) {
                            if (seq !== undefined) {
                                sendResponse({ seq, payload: response });
                            } else {
                                sendResponse(response);
                            }
                        }
                    }).catch((error) => {
                        console.warn('[uBR] handleRuntimeMessage: topic promise reject', error);
                        if (seq !== undefined) {
                            sendResponse({ seq, payload: { error: error.message } });
                        } else {
                            sendResponse({ error: error.message });
                        }
                    });
                    return true;
                }
                if (result !== undefined) {
                    if (seq !== undefined) {
                        sendResponse({ seq, payload: result });
                    } else {
                        sendResponse(result);
                    }
                }
            } catch (e) {
                console.error('Runtime handler error:', e);
                if (seq !== undefined) {
                    sendResponse({ seq, payload: { error: (e as Error).message } });
                } else {
                    sendResponse({ error: (e as Error).message });
                }
            }
        } else {
            if (seq !== undefined) {
                sendResponse({ seq, payload: { error: `No handler registered for channel ${topic}` } });
            } else {
                sendResponse({ error: `No handler registered for channel ${topic}` });
            }
        }

        return undefined;
    }

    return {
        on,
        off,
        sendToTab,
        sendToAllTabs,
        getPort,
        addTabListener,
        removeTabListener,
        broadcastToTabs,
    };
};
