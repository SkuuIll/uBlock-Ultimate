/*******************************************************************************

    uBlock Origin - MV3 Service Worker Types
    https://github.com/gorhill/uBlock

    This file contains all TypeScript types, interfaces, and constants
    used by the MV3 service worker.

******************************************************************************/

export type LegacyMessage = {
    channel?: string;
    msgId?: number;
    msg?: any;
};

export type PopupRequest = {
    what: string;
    tabId?: number | null;
    name?: string;
    value?: any;
    hostname?: string;
    state?: boolean;
    srcHostname?: string;
    desHostname?: string;
    desHostnames?: Record<string, unknown>;
    requestType?: string;
    action?: number;
    persist?: boolean;
    [key: string]: any;
};

export type FirewallCount = {
    any: number;
    frame: number;
    script: number;
};

export type FirewallCounts = {
    allowed: FirewallCount;
    blocked: FirewallCount;
};

export type HostnameDetails = {
    domain: string;
    counts: FirewallCounts;
    hasSubdomains?: boolean;
    hasScript?: boolean;
    hasFrame?: boolean;
    totals?: FirewallCounts;
};

export type TabRequestState = {
    startedAt: number;
    pageHostname: string;
    pageCounts: FirewallCounts;
    hostnameDict: Record<string, HostnameDetails>;
};

export type PendingRequestInfo = {
    tabId: number;
    url: string;
    type: chrome.webRequest.ResourceType;
};

export type TabSwitchMetrics = {
    popupBlockedCount: number;
    largeMediaCount: number;
    remoteFontCount: number;
    scriptCount: number;
};

export type CollectedHostnameData = {
    pageCounts: FirewallCounts;
    hostnameDict: Record<string, HostnameDetails>;
};

export type HostnameSwitchValues = {
    [name: string]: boolean | undefined;
    noPopups?: boolean;
    noLargeMedia?: boolean;
    noCosmeticFiltering?: boolean;
    noRemoteFonts?: boolean;
    noScripting?: boolean;
    noCSPReports?: boolean;
};

export type HostnameSwitchState = Record<string, HostnameSwitchValues>;

export type LegacyMessagingAPI = {
    ports: Map<string, any>;
    listeners: Map<string, { fn: (_request: any, _sender: any, _callback: (_response?: any) => void) => any; privileged?: boolean }>;
    defaultHandler: null | ((_request: any, _sender: any, _callback: (_response?: any) => void) => any);
    PRIVILEGED_ORIGIN: string;
    UNHANDLED: string;
    on?: (_topic: string, _handler: any) => void;
    onFrameworkMessage?: (_request: any, _port: chrome.runtime.Port, _callback: (_response?: any) => void) => void;
    onPortDisconnect?: (_port: chrome.runtime.Port) => void;
};

export type LegacyPortDetails = {
    port: chrome.runtime.Port;
    frameId?: number;
    frameURL?: string;
    privileged: boolean;
    tabId?: number;
    tabURL?: string;
};

export const hostnameSwitchNames = new Set([
    'no-popups',
    'no-large-media',
    'no-cosmetic-filtering',
    'no-remote-fonts',
    'no-scripting',
    'no-csp-reports',
]);

export const HOSTNAME_SWITCHES_SCHEMA_VERSION = 2;

export const firewallRuleTypes = [
    '*',
    'image',
    '3p',
    'inline-script',
    '1p-script',
    '3p-script',
    '3p-frame',
];

export const firewallTypeBitOffsets: Record<string, number> = {
    '*': 0,
    'inline-script': 2,
    '1p-script': 4,
    '3p-script': 6,
    '3p-frame': 8,
    image: 10,
    '3p': 12,
};

export const firewallActionNames: Record<number, string> = {
    1: 'block',
    2: 'allow',
    3: 'noop',
};

export const firewallActionValues: Record<string, number> = {
    block: 1,
    allow: 2,
    noop: 3,
};

export const FIREWALL_RULE_ID_MIN = 9_000_000;
export const FIREWALL_RULE_ID_MAX = 9_099_999;
export const STEALTH_SURROGATE_RULE_ID_MIN = 8_800_000;
export const STEALTH_SURROGATE_RULE_ID_MAX = 8_800_099;
export const POWER_RULE_ID_MIN = 9_100_000;
export const POWER_RULE_ID_MAX = 9_199_999;
export const HOSTNAME_SWITCH_RULE_ID_MIN = 9_200_000;
export const HOSTNAME_SWITCH_RULE_ID_MAX = 9_299_999;
export const WHITELIST_RULE_ID_MIN = 9_300_000;
export const WHITELIST_RULE_ID_MAX = 9_399_999;

export const MAX_DNR_RULES = 30000;

export const reWhitelistBadHostname = /[^a-z0-9.\-_[\]:]/;
export const reWhitelistHostnameExtractor = /([a-z0-9.\-_[\]]+)(?::[\d*]+)?\/(?:[^\x00-\x20/]|$)[^\x00-\x20]*$/;

export const userSettingsDefault = {
    advancedUserEnabled: false,
    autoUpdate: true,
    cloudStorageEnabled: false,
    collapseBlocked: true,
    colorBlindFriendly: false,
    contextMenuEnabled: true,
    cnameUncloakEnabled: false,
    hyperlinkAuditingDisabled: true,
    ignoreGenericCosmeticFilters: false,
    importedLists: [] as string[],
    largeMediaSize: 10485760,
    netWhitelistDefault: [
        'about-scheme',
        'chrome-scheme',
        'chrome-extension-scheme',
        'edge-scheme',
        'moz-extension-scheme',
        'opera-scheme',
        'vivaldi-scheme',
        'wyciwyg-scheme',
    ],
    noCosmeticFiltering: false,
    noLargeMedia: false,
    noRemoteFonts: false,
    noScripting: false,
    noCSPReports: true,
    prefetchingDisabled: false,
    firewallPaneMinimized: true,
    popupPanelSections: 0b111,
    showIconBadge: true,
    stealthModeEnabled: true,
    suspendUntilListsAreLoaded: false,
    tooltipsDisabled: false,
    uiAccentCustom: false,
    uiAccentCustom0: '#3498d6',
    autoReload: false,
    beautify: false,
    consoleLogEnabled: false,
    darkMode: false,
    debugScriptlet: false,
    deviceName: '',
    extensionPopupEnabled: true,
    hidePlaceholders: false,
    netFilteringEnabled: true,
    syncEnabled: true,
    uiStyles: 'unset',
    userFiltersTrusted: true,
    uiTheme: 'auto',

    // V17 YouTube Detection-Neutral Engine (§8 feature gates)
    youtubeSmartBlockingEnabled: false,
    youtubeDetectionNeutralMode: true,
    youtubeShadowMode: true,
    youtubeSurrogatesEnabled: true,
    youtubeDataSanitizerEnabled: true,
    youtubeConfigSanitizerEnabled: true,
    youtubeCosmeticCleanupEnabled: true,
    youtubePromptDetectorEnabled: true,
    youtubeAutoBackoffEnabled: true,
    youtubeBeaconLocalComplete: true,
    youtubeInstrumentedShadow: false,
    youtubeAggressiveMode: false,
};
