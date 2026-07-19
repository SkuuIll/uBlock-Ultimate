/**
 * Messaging Types for uBlock Ultimate MV3
 * 
 * Defines all message interfaces used for communication between:
 * - Service Worker and Content Scripts
 * - Service Worker and Popup
 * - Service Worker and Dashboard
 * - Content Scripts and Element Picker
 */

/**
 * Basic port connection details
 */
export interface PortDetails {
    tabId?: number;
    frameId?: number;
    privileged?: boolean;
}

/**
 * Generic message request
 */
export interface MessageRequest {
    what?: string;
    channel?: string;
    msg?: MessageRequest;
    tabId?: number;
    zap?: boolean;
    filters?: string | string[] | { filter: string };
    details?: {
        url?: string;
        select?: boolean;
    };
    url?: string;
    broad?: boolean;
    mx?: number;
    my?: number;
    options?: Record<string, unknown>;
    state?: boolean;
    compiled?: string;
    filter?: string;
    candidates?: string[][];
    slot?: number;
    hostname?: string;
    needScriptlets?: boolean;
    [key: string]: unknown;
}

/**
 * Message callback function type
 */
export type MessageCallback = (_response?: unknown) => void;

/**
 * Message handler function type
 */
export type MessageHandler = (
    _request: MessageRequest,
    _portDetails: PortDetails,
    _callback: MessageCallback
) => void;

/**
 * Listener registration options
 */
export interface ListenerOptions {
    name: string;
    listener: MessageHandler;
    privileged?: boolean;
}

/**
 * Port message format
 */
export interface PortMessage {
    channel: string;
    msg: MessageRequest;
}

// ============================================
// Popup Handler Types
// ============================================

export interface PopupData {
    advancedUserEnabled: boolean;
    appName: string;
    appVersion: string;
    colorBlindFriendly: boolean;
    cosmeticFilteringSwitch: boolean;
    firewallPaneMinimized: boolean;
    fontSize?: string;
    godMode: boolean;
    tooltipsDisabled: boolean;
    uiPopupConfig?: unknown;
    hasUnprocessedRequest: boolean;
    netFilteringSwitch: boolean;
    userFiltersAreEnabled: boolean;
    tabId: number;
    tabTitle: string;
    rawURL: string;
    pageURL: string;
    pageHostname: string;
    pageDomain: string;
    pageCounts: PageCounts;
    globalBlockedRequestCount: number;
    globalAllowedRequestCount: number;
    popupBlockedCount: number;
    largeMediaCount: number;
    remoteFontCount: number;
    contentLastModified: number;
    noPopups: boolean;
    noLargeMedia: boolean;
    noCosmeticFiltering: boolean;
    noRemoteFonts: boolean;
    noScripting: boolean;
    hostnameDict: Record<string, unknown>;
    cnameMap: unknown[];
    firewallRules: Record<string, unknown>;
    canElementPicker: boolean;
    matrixIsDirty: boolean;
    popupPanelSections: number;
    popupPanelDisabledSections: number;
    popupPanelLockedSections: number;
    popupPanelHeightMode: number;
    popupPanelOrientation: string;
}

export interface PageCounts {
    blocked: RequestCount;
    allowed: RequestCount;
}

export interface RequestCount {
    any: number;
    image: number;
    script: number;
    stylesheet: number;
    font: number;
    object: number;
    xmlhttprequest: number;
    ping: number;
    websocket: number;
    other: number;
}

// ============================================
// Content Script Handler Types
// ============================================

export interface ContentScriptParameters {
    ready: boolean;
    noSpecificCosmeticFiltering: boolean;
    noGenericCosmeticFiltering: boolean;
    specificCosmeticFilters?: SpecificCosmeticFilters;
}

export interface SpecificCosmeticFilters {
    injectedCSS: string[];
    exceptionFilters: string[];
    proceduralFilters: string[];
    convertedProceduralFilters: unknown;
    disableSurveyor: boolean;
    genericCosmeticHashes?: number[];
}

export interface UserCSSData {
    add: string[];
    remove: string[];
}

// ============================================
// Picker Handler Types
// ============================================

export interface PickerArguments {
    pickerURL: string;
    target: string;
    zap: boolean;
    eprom: unknown;
}

export interface CreateFilterResult {
    saved: boolean;
    filters?: string[];
    error?: string;
}

export interface ActivatePickerResult {
    success: boolean;
    error?: string;
}

// ============================================
// Dashboard Handler Types
// ============================================

export interface DashboardData {
    uiColors: UIColors;
    advancedUserEnabled: boolean;
    [key: string]: unknown;
}

export interface UIColors {
    border: string;
    button: string;
    primary: string;
    text: string;
}

// ============================================
// DNR Types (declarativeNetRequest)
// ============================================

export interface DNRRule {
    id: number;
    priority: number;
    action: {
        type: 'block' | 'allow' | 'upgradeScheme' | 'modifyHeaders' | 'redirect';
        redirect?: {
            url: string;
        };
        responseHeaders?: Array<{
            header: string;
            operation: 'set' | 'remove';
            value?: string;
        }>;
    };
    condition: {
        urlFilter: string;
        resourceTypes?: string[];
        excludedDomains?: string[];
        domains?: string[];
        requestDomains?: string[];
        initiatorDomains?: string[];
    };
}

// ============================================
// Storage Types
// ============================================

export interface StorageData {
    version: number;
    lastSaveTime: number;
    userFilters: string;
    externalFilters: string;
    dynamicFilteringString: string;
    sessionFilters: string;
    urlFilteringRules: string;
    hostnameSwitches: string;
    lastBackgroundTabId: number;
    lastVisitTime: number;
    [key: string]: unknown;
}

export interface UserFiltersResult {
    saved: boolean;
    error?: string;
}
