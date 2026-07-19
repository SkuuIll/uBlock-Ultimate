/**
 * Chrome Extension API Type Augmentations
 * 
 * These types augment the @types/chrome package with MV3-specific
 * and uBlock Ultimate-specific extensions.
 */

declare namespace chrome {
    namespace runtime {
        interface MessageOptions {
            /** Whether the message is expected to result in a response. */
            includeTlsChannelId?: boolean;
        }

        interface SendResponseOptions {
            /** Whether the response is from a service worker. */
            toNativePage?: boolean;
        }

        interface Port {
            onDisconnect: chrome.events.Event<(_port: Port) => void>;
            onMessage: chrome.events.Event<(_message: unknown, _port: Port) => void>;
        }

        function connect(_connectInfo?: { name?: string; includeTlsChannelId?: boolean }): Port;
        function sendMessage(_message: unknown, _options?: SendResponseOptions): Promise<unknown>;
    }

    namespace scripting {
        interface InjectionResult {
            frameId: number;
            result: unknown;
            error?: string;
        }

        interface ExecuteScriptOptions {
            target: {
                tabId: number;
                allFrames?: boolean;
                frameIds?: number[];
            };
            files?: string[];
            world?: 'MAIN' | 'ISOLATED';
        }

        function executeScript(_options: ExecuteScriptOptions): Promise<InjectionResult[]>;
    }

    namespace tabs {
        interface Tab {
            id?: number;
            index?: number;
            windowId?: number;
            openerTabId?: number;
            highlighted?: boolean;
            active?: boolean;
            pinned?: boolean;
            status?: string;
            incognito?: boolean;
            width?: number;
            height?: number;
            sessionId?: string;
            title?: string;
            url?: string;
            favIconUrl?: string;
        }

        function get(_tabId: number): Promise<Tab>;
        function query(_queryInfo: {
            active?: boolean;
            currentWindow?: boolean;
            lastFocusedWindow?: boolean;
            windowId?: number;
            windowType?: string;
        }): Promise<Tab[]>;
        function create(_createProperties: {
            url?: string;
            active?: boolean;
            index?: number;
            openerTabId?: number;
            pinned?: boolean;
            windowId?: number;
        }): Promise<Tab>;
        function remove(_tabId: number): Promise<void>;
        function update(_tabId: number, _updateProperties: {
            url?: string;
            active?: boolean;
            highlighted?: boolean;
            pinned?: boolean;
        }): Promise<Tab>;
    }

    namespace commands {
        interface Command {
            name?: string;
            description?: string;
            shortcut?: string;
        }

        function getAll(): Promise<Command[]>;
    }
}

/**
 * Browser WebExtensions API — used as a runtime alias for chrome.*
 * in MV3 service workers and content scripts. Present on `self` or `window`.
 */
declare let browser: typeof chrome;

/**
 * Service Worker global type augmentation
 */
declare const self: ServiceWorkerGlobalScope & typeof globalThis;
