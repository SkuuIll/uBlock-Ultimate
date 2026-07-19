/*******************************************************************************

    uBlock Origin - MV3 Firewall
    https://github.com/gorhill/uBlock

    This file contains firewall rule management and DNR compilation.

******************************************************************************/

import { DynamicFirewallRules } from "./sw-classes.js";
import { popupState } from "./sw-storage.js";
import {
    FIREWALL_RULE_ID_MIN,
    FIREWALL_RULE_ID_MAX,
    POWER_RULE_ID_MIN,
    POWER_RULE_ID_MAX,
    HOSTNAME_SWITCH_RULE_ID_MIN,
    HOSTNAME_SWITCH_RULE_ID_MAX,
    WHITELIST_RULE_ID_MIN,
    WHITELIST_RULE_ID_MAX,
} from "./sw-types.js";

export const firewallRuleTypes = [
  "*",
  "image",
  "3p",
  "inline-script",
  "1p-script",
  "3p-script",
  "3p-frame",
];

export const firewallTypeBitOffsets: Record<string, number> = {
  "*": 0,
  "inline-script": 2,
  "1p-script": 4,
  "3p-script": 6,
  "3p-frame": 8,
  image: 10,
  "3p": 12,
};

export const firewallActionNames: Record<number, string> = {
  1: "block",
  2: "allow",
  3: "noop",
};

export const firewallActionValues: Record<string, number> = {
  block: 1,
  allow: 2,
  noop: 3,
};

export const firewallRuleResourceTypes = (type: string) => {
    switch (type) {
    case "image":
        return ["image"];
    case "3p-script":
    case "1p-script":
        return ["script"];
    case "3p-frame":
        return ["sub_frame", "object"];
    case "3p":
        return [
        "image",
        "script",
        "sub_frame",
        "stylesheet",
        "xmlhttprequest",
        "media",
        "font",
        "object",
        "other",
        "ping",
        "websocket",
        ];
    case "*":
        return [
        "image",
        "script",
        "sub_frame",
        "stylesheet",
        "xmlhttprequest",
        "media",
        "font",
        "object",
        "other",
        "ping",
        "websocket",
        ];
    default:
        return [];
    }
};

const firewallRulePriority = (
    src: string,
    dest: string,
    type: string,
    actionName: string,
) => {
    let precedence = 1000;

    if (dest !== "*" && type === "*") {
        precedence = 7000;
    } else if (type === "3p-script" || type === "1p-script" || type === "3p-frame") {
        precedence = 5000;
    } else if (type === "3p") {
        precedence = 4000;
    } else if (type === "image" || type === "inline-script") {
        precedence = 3000;
    }

    if (src !== "*") {
        precedence += 500;
    }

    if (dest !== "*") {
        precedence += 250;
    }

    const actionRank =
    actionName === "noop" ? 30 : actionName === "allow" ? 20 : 10;

    return 2_000_000 + precedence * 10 + actionRank;
};

export const compileFirewallRulesToDnr = async (
    firewall: DynamicFirewallRules,
): Promise<chrome.declarativeNetRequest.Rule[]> => {
    const addRules: chrome.declarativeNetRequest.Rule[] = [];
    let nextRuleId = FIREWALL_RULE_ID_MIN;

    for (const rule of firewall.toArray()) {
        const [src, dest, type, actionName] = rule.split(" ");
        if (actionName === "noop") {
            continue;
        }
        const resourceTypes = firewallRuleResourceTypes(type);

        if (type === "inline-script") {
            if (nextRuleId > FIREWALL_RULE_ID_MAX) break;
            const condition: chrome.declarativeNetRequest.RuleCondition = {
        resourceTypes: ["main_frame", "sub_frame"],
            };
            if (src !== "*") {
                condition.initiatorDomains = [src];
            }
      addRules.push({
        id: nextRuleId++,
        priority: firewallRulePriority(src, dest, type, actionName),
        action: {
          type: "modifyHeaders",
          responseHeaders: [
            {
              header: "content-security-policy",
              operation: "set",
              value:
                actionName === "block"
                    ? "script-src 'self' 'unsafe-eval' http: https: data: blob:; object-src 'none'; base-uri 'self'"
                    : "script-src 'self' 'unsafe-inline' 'unsafe-eval' http: https: data: blob:; object-src 'none'; base-uri 'self'",
            },
          ],
        },
        condition,
      });
      continue;
        }

        for (const resourceType of resourceTypes) {
            if (nextRuleId > FIREWALL_RULE_ID_MAX) break;
            const condition: chrome.declarativeNetRequest.RuleCondition = {
        resourceTypes: [
          resourceType as chrome.declarativeNetRequest.ResourceType,
        ],
            };
            if (src !== "*") {
                condition.initiatorDomains = [src];
            }
            if (dest !== "*") {
                condition.requestDomains = [dest];
            }
            if (type === "3p" || type === "3p-script" || type === "3p-frame") {
                condition.domainType = "thirdParty";
            } else if (type === "1p-script") {
                condition.domainType = "firstParty";
            }

      addRules.push({
        id: nextRuleId++,
        priority: firewallRulePriority(src, dest, type, actionName),
        action: {
          type: actionName === "allow" ? "allow" : "block",
        },
        condition,
      });
        }
    }

    return addRules;
};

export const syncFirewallDnrRules = async (): Promise<void> => {
    const sessionDiffers = popupState.sessionFirewall.toString() !==
    popupState.permanentFirewall.toString();
    const existing = await chrome.declarativeNetRequest.getDynamicRules();
    const toRemove = existing
    .map((r) => r.id)
    .filter((id) => id >= FIREWALL_RULE_ID_MIN && id < POWER_RULE_ID_MIN);
    const addRules = sessionDiffers
        ? []
        : await compileFirewallRulesToDnr(popupState.permanentFirewall);

    if (toRemove.length > 0) {
        await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: toRemove,
        });
    }
    if (addRules.length > 0) {
        await chrome.declarativeNetRequest.updateDynamicRules({ addRules });
    }

    if ( typeof chrome.declarativeNetRequest.getSessionRules !== "function" ) {
        return;
    }

    const existingSessionRules = await chrome.declarativeNetRequest.getSessionRules();
    const sessionRemoveRuleIds = existingSessionRules
    .map((rule) => rule.id)
    .filter((id) => id >= FIREWALL_RULE_ID_MIN && id < POWER_RULE_ID_MIN);
    const sessionAddRules = sessionDiffers
        ? await compileFirewallRulesToDnr(popupState.sessionFirewall)
        : [];

    await chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: sessionRemoveRuleIds,
    addRules: sessionAddRules,
    });
};

export const compilePowerSwitchDnrRules = async (
    perSiteFiltering: Record<string, boolean>,
): Promise<chrome.declarativeNetRequest.Rule[]> => {
    const entries = Object.entries(perSiteFiltering);

    const rules: chrome.declarativeNetRequest.Rule[] = [];
    let ruleId = POWER_RULE_ID_MIN;

    for (const [domain, enabled] of entries) {
        if (ruleId > POWER_RULE_ID_MAX) break;

        // When enabled is false, filtering is OFF for this specific domain
        // Create ALLOW rule to ensure traffic passes through
        if (enabled === false) {
      rules.push({
        id: ruleId++,
        priority: 1,
        action: { type: "allow" },
        condition: {
          urlFilter: ".*",
          initiatorDomains: [domain],
        },
      });
        }
    // When enabled is true, don't add rules - normal filter lists handle blocking
    }

    return rules;
};

export const syncPowerSwitchDnrRules = async (): Promise<void> => {
    const stored = await chrome.storage.local.get("perSiteFiltering");
    const perSite = (stored?.perSiteFiltering as Record<string, boolean>) || {};
    const rules = await compilePowerSwitchDnrRules(perSite);

    // Get global net filtering state to determine if filtering is globally OFF
    const settings = await chrome.storage.local.get("userSettings") as Record<string, any>;
    const globalSwitchOff = settings?.userSettings?.netFilteringEnabled === false;

    // If filtering is globally OFF, don't add any per-site rules - just clear existing ones
    if (globalSwitchOff) {
    console.log("[DNR] Global filtering OFF, clearing power switch rules");
    }

    const existing = await chrome.declarativeNetRequest.getDynamicRules();
    const toRemove = existing
    .map((r) => r.id)
    .filter((id) => id >= POWER_RULE_ID_MIN && id < HOSTNAME_SWITCH_RULE_ID_MIN);

    if (toRemove.length > 0) {
        await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: toRemove,
        });
    }
    if (rules.length > 0) {
        await chrome.declarativeNetRequest.updateDynamicRules({ addRules: rules });
    }
};

export const persistFirewallRules = async (): Promise<void> => {
    await chrome.storage.local.set({
    dynamicFilteringString: popupState.permanentFirewall.toString(),
    });
};

export const revertFirewallRules = async (): Promise<void> => {
  popupState.sessionFirewall.assign(popupState.permanentFirewall);
  await syncFirewallDnrRules();
};

export const getFirewallRulesForPopup = (
    srcHostname: string,
    hostnameDict: Record<string, any>,
): Record<string, string> => {
    const firewallRules: Record<string, string> = {};
    const firewallRuleTypes = [
    "*",
    "image",
    "3p",
    "inline-script",
    "1p-script",
    "3p-script",
    "3p-frame",
    ];

    for (const type of firewallRuleTypes) {
        const globalRule = popupState.sessionFirewall.lookupRuleData(
            "*",
            "*",
            type,
        );
        if (globalRule !== undefined) {
            firewallRules[`/ * ${type}`] = globalRule;
        }
        const localRule = popupState.sessionFirewall.lookupRuleData(
            srcHostname,
            "*",
            type,
        );
        if (localRule !== undefined) {
            firewallRules[`. * ${type}`] = localRule;
        }
    }

    for (const desHostname of Object.keys(hostnameDict)) {
        const globalRule = popupState.sessionFirewall.lookupRuleData(
            "*",
            desHostname,
            "*",
        );
        if (globalRule !== undefined) {
            firewallRules[`/ ${desHostname} *`] = globalRule;
        }
        const localRule = popupState.sessionFirewall.lookupRuleData(
            srcHostname,
            desHostname,
            "*",
        );
        if (localRule !== undefined) {
            firewallRules[`. ${desHostname} *`] = localRule;
        }
    }

    return firewallRules;
};

export const compileHostnameSwitchDnrRules = (
    hostnameSwitches: Record<string, Record<string, boolean>>,
): chrome.declarativeNetRequest.Rule[] => {
    const rules: chrome.declarativeNetRequest.Rule[] = [];
    let ruleId = HOSTNAME_SWITCH_RULE_ID_MIN;

    const noScripting = new Set<string>();
    const noCosmetic = new Set<string>();
    const noPopup = new Set<string>();
    const noLargeMedia = new Set<string>();
    const noRemoteFonts = new Set<string>();

    for (const [hostname, switches] of Object.entries(hostnameSwitches)) {
        if (switches["no-scripting"]) noScripting.add(hostname);
        if (switches["no-cosmetic-filtering"]) noCosmetic.add(hostname);
        if (switches["no-popups"]) noPopup.add(hostname);
        if (switches["no-large-media"]) noLargeMedia.add(hostname);
        if (switches["no-remote-fonts"]) noRemoteFonts.add(hostname);
    }

    for (const hostname of noScripting) {
        if (ruleId > HOSTNAME_SWITCH_RULE_ID_MAX) break;
        rules.push({
            id: ruleId++,
            priority: 1,
            action: { type: "block" },
            condition: { urlFilter: ".*", initiatorDomains: [hostname], resourceTypes: ["script"] },
        });
    }
    for (const hostname of noPopup) {
        if (ruleId > HOSTNAME_SWITCH_RULE_ID_MAX) break;
        rules.push({
            id: ruleId++,
            priority: 1,
            action: { type: "block" },
            condition: {
                urlFilter: ".*",
                initiatorDomains: [hostname],
                resourceTypes: ["main_frame", "sub_frame"],
            },
        });
    }
    for (const hostname of noLargeMedia) {
        if (ruleId > HOSTNAME_SWITCH_RULE_ID_MAX) break;
        rules.push({
            id: ruleId++,
            priority: 1,
            action: { type: "block" },
            condition: {
                urlFilter: ".*",
                initiatorDomains: [hostname],
                resourceTypes: ["media"],
            },
        });
    }
    for (const hostname of noRemoteFonts) {
        if (ruleId > HOSTNAME_SWITCH_RULE_ID_MAX) break;
        rules.push({
            id: ruleId++,
            priority: 1,
            action: { type: "block" },
            condition: {
                urlFilter: ".*",
                initiatorDomains: [hostname],
                resourceTypes: ["font"],
            },
        });
    }
    // no-cosmetic-filtering is enforced at content-script level via
    // retrieveContentScriptParameters — DNR has no expression for suppressing
    // cosmetic filtering on a hostname. The switch data is read from
    // sessionHostnameSwitches in sw-messaging-handlers.ts.

    return rules;
};

export const syncHostnameSwitchDnrRules = async (): Promise<void> => {
    if (chrome.declarativeNetRequest === undefined) {
        return;
    }

    const addRules = compileHostnameSwitchDnrRules(
    popupState.sessionHostnameSwitches,
    );

    const MAX_DNR_RULES = 30000;
    if (addRules.length > MAX_DNR_RULES) {
        addRules.length = MAX_DNR_RULES;
    }

    const existingRules = await chrome.declarativeNetRequest.getDynamicRules();
    const removeRuleIds = existingRules
    .map((rule) => rule.id)
    .filter(
        (id) =>
            id >= HOSTNAME_SWITCH_RULE_ID_MIN && id <= HOSTNAME_SWITCH_RULE_ID_MAX,
    );

    await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds,
    addRules,
    });
};

export const compileWhitelistRulesToDnr = (
    whitelist: string[],
): chrome.declarativeNetRequest.Rule[] => {
    const rules: chrome.declarativeNetRequest.Rule[] = [];
    let ruleId = WHITELIST_RULE_ID_MIN;

    for (const entry of whitelist) {
        if (ruleId > WHITELIST_RULE_ID_MAX) break;
        const trimmed = entry.trim();
        if (trimmed === "" || trimmed.startsWith("#")) continue;

        try {
      rules.push({
        id: ruleId++,
        priority: 1,
        action: { type: "allow" },
        condition: {
          urlFilter: `||${trimmed.replace(/\./g, "\\.").replace(/\*/g, ".*")}`,
          isUrlFilterCaseSensitive: false,
        },
      });
        } catch (e) {
            console.warn('[uBR] compileWhitelistRulesToDnr: invalid whitelist entry', entry, e);
        }
    }

    return rules;
};

export const syncWhitelistDnrRules = async (): Promise<void> => {
    if (chrome.declarativeNetRequest === undefined) {
        return;
    }

    const stored = await chrome.storage.local.get("whitelist");
    const whitelist =
    typeof stored?.whitelist === "string"
        ? stored.whitelist.split("\n").filter((l) => l.trim())
        : [];

    const addRules = compileWhitelistRulesToDnr(whitelist);

    const existingRules = await chrome.declarativeNetRequest.getDynamicRules();
    const removeRuleIds = existingRules
    .map((rule) => rule.id)
    .filter((id) => id >= WHITELIST_RULE_ID_MIN && id <= WHITELIST_RULE_ID_MAX);

    await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds,
    addRules,
    });
};

export const setWhitelist = async (hostname: string, scope: string, state: boolean): Promise<void> => {
    const index = popupState.whitelist.indexOf(hostname);
    if (state && index === -1) {
    popupState.whitelist.push(hostname);
    } else if (!state && index !== -1) {
    popupState.whitelist.splice(index, 1);
    } else {
        return;
    }

    await chrome.storage.local.set({ whitelist: popupState.whitelist.join("\n") });
    await syncWhitelistDnrRules();

    const broadcastFilteringBehaviorChanged = async () => {
        const messaging = (globalThis as any).vAPI?.messaging;
        if (!messaging) return;

        for (const [name, details] of messaging.ports) {
            try {
        details.port.postMessage({
          channel: "filtersBehaviorChanged",
          payload: null,
        });
            } catch (e) {
                console.warn('[uBR] broadcastFilteringBehaviorChanged: failed to send to port', name, e);
            }
        }
    };

    await broadcastFilteringBehaviorChanged();
};

export const applyPersistedHostnameSwitchesForTab = async (tabId: number, url: string): Promise<void> => {
    if (!url) return;

    let hostname = "";
    try {
        hostname = new URL(url).hostname;
    } catch (e) {
        console.warn('[uBR] applyPersistedHostnameSwitchesForTab: invalid URL', url, e);
        return;
    }

    const stored = await chrome.storage.local.get("perSiteFiltering");
    const perSiteFiltering = (stored?.perSiteFiltering as Record<string, boolean>) || {};

    for (const [domain, enabled] of Object.entries(perSiteFiltering)) {
        if (hostname === domain || hostname.endsWith(`.${  domain}`)) {
            try {
                const p = chrome.tabs.sendMessage(tabId, {
          what: "powerSwitch",
          hostname: domain,
          state: enabled,
                }) as Promise<unknown> | undefined;
        p?.catch((e) => {
            console.warn('[uBR] applyPersistedHostnameSwitchesForTab: sendMessage failed for tab', tabId, e);
        });
            } catch (e) {
                console.warn('[uBR] applyPersistedHostnameSwitchesForTab: failed for domain', domain, e);
            }
        }
    }
};
