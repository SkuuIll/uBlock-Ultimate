import {
    STEALTH_SURROGATE_RULE_ID_MIN,
    STEALTH_SURROGATE_RULE_ID_MAX,
} from './sw-types.js';

/**
 * Packaged anti-adblock surrogates.
 *
 * These rules are deliberately limited to extension-owned resources. They
 * never redirect a request to a remote or user-provided URL. The live service
 * worker installs them as session rules while stealth mode is enabled.
 */

export const STEALTH_MODE_SETTING = 'stealthModeEnabled';
export const STEALTH_SURROGATE_RULE_ID_BASE = STEALTH_SURROGATE_RULE_ID_MIN;
export const STEALTH_SURROGATE_RULE_ID_LIMIT = STEALTH_SURROGATE_RULE_ID_MAX;
export const STEALTH_SURROGATE_PRIORITY = 500_000;

type DNRResourceType =
    | "main_frame" | "sub_frame" | "stylesheet" | "script" | "image" | "font"
    | "object" | "xmlhttprequest" | "ping" | "csp_report" | "media" | "websocket"
    | "webtransport" | "webbundle" | "other";

type RedirectSurrogateDefinition = Readonly<{
    urlFilter: string;
    resourceTypes: readonly DNRResourceType[];
    action?: 'redirect';
    extensionPath: string;
    priority?: number;
    initiatorDomains?: never;
}>;

type AllowSurrogateDefinition = Readonly<{
    urlFilter: string;
    resourceTypes: readonly DNRResourceType[];
    action: 'allow';
    priority?: number;
    initiatorDomains?: readonly string[];
}>;

type SurrogateDefinition = RedirectSurrogateDefinition | AllowSurrogateDefinition;

const scriptSurrogates: readonly RedirectSurrogateDefinition[] = [
    {
        urlFilter: '||pagead2.googlesyndication.com^',
        resourceTypes: ['script', 'xmlhttprequest'],
        extensionPath: '/web_accessible_resources/googlesyndication_adsbygoogle.js',
    },
    {
        // Legacy AdSense embeds use this script and synchronously inspect the
        // height of the script's container. It requires a layout surrogate,
        // rather than the modern adsbygoogle API surrogate above.
        urlFilter: '||pagead2.googlesyndication.com/pagead/show_ads.js',
        resourceTypes: ['script'],
        extensionPath: '/web_accessible_resources/googlesyndication_show_ads.js',
        priority: STEALTH_SURROGATE_PRIORITY + 1,
    },
    {
        urlFilter: '||securepubads.g.doubleclick.net^',
        resourceTypes: ['script', 'xmlhttprequest'],
        extensionPath: '/web_accessible_resources/googletagservices_gpt.js',
    },
    {
        urlFilter: '||www.googletagmanager.com^',
        resourceTypes: ['script', 'xmlhttprequest'],
        extensionPath: '/web_accessible_resources/googletagmanager_gtm.js',
    },
    {
        urlFilter: '||www.google-analytics.com^',
        resourceTypes: ['script', 'xmlhttprequest'],
        extensionPath: '/web_accessible_resources/google-analytics_analytics.js',
    },
    {
        urlFilter: '||ssl.google-analytics.com^',
        resourceTypes: ['script', 'xmlhttprequest'],
        extensionPath: '/web_accessible_resources/google-analytics_analytics.js',
    },
];

const imageSurrogates: readonly RedirectSurrogateDefinition[] = [
    'widgets.outbrain.com',
    'www.googleadservices.com',
    'ad.doubleclick.net',
    'securepubads.g.doubleclick.net',
    'googleads.g.doubleclick.net',
    'c.amazon-adsystem.com',
    's.amazon-adsystem.com',
    'adserver.adtech.de',
    'ads.pubmatic.com',
    'ib.adnxs.com',
    'tpc.googlesyndication.com',
    'adservice.google.com',
].map(domain => ({
    urlFilter: `||${domain}^`,
    resourceTypes: ['image'],
    extensionPath: '/web_accessible_resources/2x2.png',
}));

export const STEALTH_SURROGATES: readonly SurrogateDefinition[] = [
    ...scriptSurrogates,
    ...imageSurrogates,
];

export type StealthSurrogateRule = Readonly<{
    id: number;
    priority: number;
    action: Readonly<
        | { type: 'allow' }
        | { type: 'redirect'; redirect: Readonly<{ extensionPath: string }> }
    >;
    condition: Readonly<{
        urlFilter: string;
        resourceTypes: DNRResourceType[];
        initiatorDomains?: string[];
    }>;
}>;

type StealthRuleOptions = Readonly<{
    youtubeDetectionNeutral?: boolean;
}>;

export const createStealthSurrogateRules = (_options: StealthRuleOptions = {}): StealthSurrogateRule[] =>
    STEALTH_SURROGATES
        .map((surrogate, index) => ({
        id: STEALTH_SURROGATE_RULE_ID_BASE + index,
        priority: surrogate.priority ?? STEALTH_SURROGATE_PRIORITY,
        action: surrogate.action === 'allow'
            ? { type: 'allow' }
            : {
                type: 'redirect',
                redirect: { extensionPath: surrogate.extensionPath },
            },
        condition: {
            urlFilter: surrogate.urlFilter,
            resourceTypes: [...surrogate.resourceTypes],
            ...(surrogate.initiatorDomains !== undefined
                ? { initiatorDomains: [...surrogate.initiatorDomains] }
                : {}),
        },
    }));

export const isStealthSurrogateRuleId = (id: number): boolean =>
    Number.isInteger(id) &&
    id >= STEALTH_SURROGATE_RULE_ID_BASE &&
    id <= STEALTH_SURROGATE_RULE_ID_LIMIT;

export const syncStealthSurrogateRules = async (): Promise<void> => {
    if (chrome.declarativeNetRequest?.updateSessionRules === undefined) return

    try {
        const stored = await chrome.storage.local.get('userSettings')
        const settings = (stored?.userSettings ?? {}) as Record<string, unknown>
        const existing = await chrome.declarativeNetRequest.getSessionRules()
        const removeRuleIds = existing
            .map((r) => r.id)
            .filter(isStealthSurrogateRuleId)

        const addRules = settings[STEALTH_MODE_SETTING] === false
            ? []
            : createStealthSurrogateRules({
                youtubeDetectionNeutral: settings.youtubeDetectionNeutralMode !== false,
            })

        await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds, addRules })
    } catch (e) {
        console.warn('[uBR] syncStealthSurrogateRules failed', e)
    }
}
