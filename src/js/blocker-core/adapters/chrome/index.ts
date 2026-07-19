// @ts-nocheck
interface DNRRule {
    id: number;
    priority?: number;
    action: unknown;
    condition: unknown;
}

interface UpdateRulesOptions {
    addRules?: DNRRule[];
    removeRuleIds?: number[];
}

interface MatchedRulesOptions {
    tabId?: number;
    initiator?: string;
}

interface StorageAdapter {
    get(keys: string | string[]): Promise<Record<string, unknown>>;
    set(items: Record<string, unknown>): Promise<void>;
    remove(keys: string | string[]): Promise<void>;
}

interface TabsAdapter {
    query(queryInfo: chrome.tabs.QueryInfo): Promise<chrome.tabs.Tab[]>;
    get(tabId: number): Promise<chrome.tabs.Tab>;
    reload(tabId: number, bypassCache?: boolean): Promise<void>;
}

interface SidePanelAdapter {
    setOptions(options: chrome.sidePanel.SidePanelOptions): Promise<void>;
}

interface WebNavigationAdapter {
    onCommitted: {
        addListener(callback: (details: chrome.webNavigation.WebNavigationFramedCallbackDetails) => void): void;
        removeListener(callback: (details: chrome.webNavigation.WebNavigationFramedCallbackDetails) => void): void;
    };
}

interface ScriptingAdapter {
    insertCSS(options: chrome.scripting.InjectionOptions): Promise<void>;
    executeScript(options: chrome.scripting.InjectionOptions): Promise<chrome.scripting.InjectionResult[]>;
}

export interface ChromeAdapter {
    storage: StorageAdapter;
    tabs: TabsAdapter;
    sidePanel: SidePanelAdapter;
    webNavigation: WebNavigationAdapter;
    scripting: ScriptingAdapter;
}

export class ChromeAPIAdapter implements ChromeAdapter {
    storage: StorageAdapter = {
        async get(keys) {
            return chrome.storage.local.get(keys);
        },
        async set(items) {
            return chrome.storage.local.set(items);
        },
        async remove(keys) {
            return chrome.storage.local.remove(keys);
        },
    };
    
    tabs: TabsAdapter = {
        async query(queryInfo) {
            return chrome.tabs.query(queryInfo);
        },
        async get(tabId) {
            return chrome.tabs.get(tabId);
        },
        async reload(tabId, bypassCache) {
            return chrome.tabs.reload(tabId, { bypassCache });
        },
    };
    
    sidePanel: SidePanelAdapter = {
        async setOptions(options) {
            return chrome.sidePanel.setOptions(options);
        },
    };
    
    webNavigation: WebNavigationAdapter = {
        onCommitted: {
            addListener(callback) {
                chrome.webNavigation.onCommitted.addListener(callback);
            },
            removeListener(callback) {
                chrome.webNavigation.onCommitted.removeListener(callback);
            },
        },
    };
    
    scripting: ScriptingAdapter = {
        async insertCSS(options) {
            return chrome.scripting.insertCSS(options);
        },
        async executeScript(options) {
            return chrome.scripting.executeScript(options);
        },
    };
}

let instance: ChromeAdapter | null = null;

export function getChromeAdapter(): ChromeAdapter {
    if (!instance) {
        instance = new ChromeAPIAdapter();
    }
    return instance;
}

export function setChromeAdapter(adapter: ChromeAdapter): void {
    instance = adapter;
}
