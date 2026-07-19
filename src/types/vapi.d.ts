/**
 * VAPI Types for uBlock Ultimate
 * 
 * Defines types for the VAPI (uBlock API) shim that provides
 * a consistent interface for both background and content scripts.
 */

/**
 * UserStylesheet API for managing injected CSS
 */
export interface UserStylesheetAPI {
    added: Set<string>;
    removed: Set<string>;
    add(_cssText: string, _now?: boolean): void;
    remove(_cssText: string, _now?: boolean): void;
    apply(_callback?: () => void): void;
}

/**
 * Messaging API for cross-context communication
 */
export interface MessagingAPI {
    send(_channelName: string, _request: unknown): Promise<unknown>;
    setup(_defaultHandler: unknown): void;
    listen(_options: {
        name: string;
        listener: (_request: unknown, _portDetails: unknown, _callback: (_response?: unknown) => void) => void;
        privileged?: boolean;
    }): void;
    UNHANDLED: symbol;
}

/**
 * Cloud Storage API
 */
export interface CloudStorageAPI {
    push(_text: string, _remoteURL?: string): Promise<boolean>;
    get(_expectType: string, _remoteURL?: string): Promise<string | null>;
    delete(_remoteURL?: string): Promise<boolean>;
}

/**
 * Tabs API wrapper
 */
export interface TabsAPI {
    resolve(_tabId: number): Promise<{
        url: string;
        origin: string;
        hostname: string;
    } | null>;
    query(_queryInfo: Record<string, unknown>): Promise<Array<{ id?: number; url?: string; [key: string]: unknown }>>;
    open(_details: { url: string; [key: string]: unknown }): void;
    getCurrent(): Promise<{ id?: number; url?: string; [key: string]: unknown }>;
    insertCSS(_tabId: number, _details: { file?: string; css?: string; [key: string]: unknown }): Promise<void>;
}

/**
 * VAPI main interface
 */
export interface VAPI {
    /** Version string */
    version: string;
    
    /** Whether running in uBR variant */
    uBR: boolean;
    
    /** Session start time */
    T0: number;
    
    /** Session ID */
    sessionId: string;
    
    /** Cloud storage */
    cloud: CloudStorageAPI;
    
    /** User stylesheet management */
    userStylesheet: UserStylesheetAPI;
    
    /** Cross-context messaging */
    messaging: MessagingAPI;
    
    /** Tabs API wrapper */
    tabs: TabsAPI;
    
    /** Zapper mode flag */
    inZapperMode: boolean;
    
    /** Shutdown handlers */
    shutdown: {
        jobs: Array<() => void>;
        add(_job: () => void): void;
        remove(_job: () => void): void;
        exec(): void;
    };
    
    /** DOM filterer instance */
    domFilterer?: unknown;
    
    /** DOM watcher instance */
    domWatcher?: unknown;
    
    /** DOM collapser instance */
    domCollapser?: unknown;
    
    /** DOM surveyor instance */
    domSurveyor?: unknown;
    
    /** Element picker frame flag */
    pickerFrame?: boolean;
    
    /** Mouse click coordinates */
    mouseClick?: { x: number; y: number };
    
    /** Whether specific cosmetic filtering is disabled */
    noSpecificCosmeticFiltering?: boolean;
    
    /** Whether generic cosmetic filtering is disabled */
    noGenericCosmeticFiltering?: boolean;
    
    /** Whether content script is loaded */
    contentScript?: boolean;
    
    /** Random token generator */
    randomToken(): string;
    
    /** Set timeout */
    setTimeout(_fn: () => void, _delay: number): number;
    
    /** Get extension URL */
    getURL(_path: string): string;
    
    /** Close popup (no-op in SW) */
    closePopup(): void;
    
    /** Local storage API */
    localStorage: {
        getItemAsync(_key: string): Promise<unknown>;
        setItemAsync(_key: string, _value: unknown): Promise<void>;
    };
    
    /** Style for hiding elements */
    hideStyle: string;
    
    /** Style proxies map */
    epickerStyleProxies?: Map<string, string>;
    
    /** Effective self (window in content, self in SW) */
    effectiveSelf: typeof globalThis;
    
    /** Create procedural filter */
    createProceduralFilter?: (_o: unknown) => {
        exec(): Element[];
    };

    /** Browser/platform flavor detection */
    webextFlavor: {
        id: string;
        chromium: boolean;
        firefox: boolean;
        safari: boolean;
        mv2: boolean;
        mv3: boolean;
        [key: string]: unknown;
    };

    /** Deferred timer utilities */
    defer: {
        create(_fn: (..._args: unknown[]) => void): { offon?(_delay?: number): void };
        once(_delay?: number | { sec: number }): Promise<void>;
    };

    /** Network request API */
    net: {
        handlerBehaviorChanged(): void;
        suspend(): void;
        unsuspend(_options?: { all?: boolean }): void;
        // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
        setSuspendableListener(_fn: Function): void;
        // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
        addListener(_event: string, _handler: Function, _options?: unknown): void;
        hasUnprocessedRequest(): boolean;
        removeUnprocessedRequest(): void;
        setOptions(_options: unknown): void;
    };

    /** Context menu API */
    contextMenu: {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
        setEntries(_entries: unknown[], _callback: Function): void;
        onMustUpdate?: (_tabId?: number) => Promise<void>;
    };

    /** Element picker executor */
    elementPickerExec?(_args: unknown): void;

    /** Page store lookup */
    pageStoreFromTabId?(_tabId: number): unknown;

    /** User filter state check */
    userFiltersAreEnabled?(): boolean;

    /** Format count utility */
    formatCount?(_count: number): string;

    /** Date to string utility */
    dateNowToSensibleString?(_now?: number): string;

    /** Regex escape utility */
    escapeRegex?(_s: string): string;

    /** Setting helpers */
    getModifiedSettings?(_settings: unknown[], _current: unknown): unknown[];
    settingValueFromString?(_value: string, _type: unknown): unknown;

    /** Compiled filter list accessor */
    getCompiledFilterList?(): string;

    /** Retrieve link header filtering instance */
    getLinkHeaderFiltering?(): { reset?(): void; freeze?(): void; apply?(): void; compile?(): Promise<unknown>; fromCompiledContent?(..._args: unknown[]): unknown; toSelfie?(): unknown; fromSelfie?(..._args: unknown[]): unknown; acceptedCount?: number; discardedCount?: number };
}

/**
 * VAPI for background scripts (service worker)
 */
export interface VAPIBackground extends VAPI {
    /** Initialize the VAPI */
    init(): Promise<void>;
    
    /** Load specific cosmetic filters for a URL */
    loadCssRules(_url: string): Promise<{
        css: string;
        exceptionCSS: string;
        procedurals: unknown[];
    } | null>;
    
    /** Get statistics */
    getStats(): Promise<Record<string, number>>;
    
    /** User filters management */
    userFilters: {
        append(_text: string): Promise<{ saved: boolean }>;
        read(): Promise<string>;
        write(_text: string): Promise<void>;
    };
}

/**
 * VAPI for content scripts
 */
export interface VAPIContent extends VAPI {
    /** The messaging object for sending messages to background */
    messaging: {
        send(_channelName: string, _request: unknown): Promise<unknown>;
    };

    /** Safe animation frame utility */
    SafeAnimationFrame: {
        new(_callback: (_time: number) => void): {
            start(_delay?: number): void;
            clear(): void;
        };
    };

    /** DOM filterer constructor */
    DOMFilterer: new () => {
        addCSS(_css: string, _options?: { mustInject?: boolean }): void;
        addProceduralSelectors(_selectors: string[]): void;
        exceptCSSRules(_selectors: string[]): void;
        commitNow(): void;
        exceptions: string[];
        toggle?(_state: boolean, _filterer?: unknown): void;
    };

    /** Sanitize cosmetic CSS for page */
    sanitizeCosmeticCSSForPage?(_css: string): string;

    /** Picker and zapper URLs */
    pickerURL?: string;
    zap?: boolean;
    eprom?: {
        eprom?: unknown;
        [key: string]: unknown;
    };
}
