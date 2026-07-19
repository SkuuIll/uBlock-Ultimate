// @ts-nocheck
export interface ChromeAdapter {
    storage: {
        get(keys: string | string[] | Record<string, unknown>): Promise<Record<string, unknown>>;
        set(items: Record<string, unknown>): Promise<void>;
        remove(keys: string | string[]): Promise<void>;
    };
    tabs: {
        query(queryInfo: chrome.tabs.QueryInfo): Promise<chrome.tabs.Tab[]>;
        get(tabId: number): Promise<chrome.tabs.Tab>;
        reload(tabId: number, bypassCache?: boolean): Promise<void>;
    };
    sidePanel: {
        setOptions(options: {
            path?: string;
            enabled?: boolean;
        }): Promise<void>;
    };
    webNavigation: {
        onCommitted: {
            addListener(callback: (details: {
                url?: string;
                tabId: number;
            }) => void): void;
            removeListener(callback: (details: {
                url?: string;
                tabId: number;
            }) => void): void;
        };
    };
    scripting: {
        insertCSS(options: {
            target: {
                tabId: number;
            };
            css: string;
        }): Promise<void>;
        executeScript(options: {
            target: {
                tabId: number;
            };
            func: () => void;
        }): Promise<unknown[]>;
    };
}
export declare function getChromeAdapter(): ChromeAdapter;
export declare function setChromeAdapter(adapter: ChromeAdapter): void;
