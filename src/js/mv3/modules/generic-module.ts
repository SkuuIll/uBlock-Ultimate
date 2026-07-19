/*******************************************************************************

    uBlock Origin - MV3 Generic Topic Handlers Module
    https://github.com/gorhill/uBlock

    Simple topic-based handlers previously registered via
    registerMessagingHandlers(). These handle one-shot messaging
    topics that don't need the channel+what sub-dispatch.

*******************************************************************************/

import type { HandlerModule, Handler } from "../handler-registry.js";
import type { SWContext } from "../sw-context.js";

const handlers: Handler<SWContext>[] = [

    {
        channel: "ping",
        what: "*",
        handler: async () => ({ pong: true, timestamp: Date.now() }),
    },

    {
        channel: "getTabId",
        what: "*",
        handler: async () => {
            const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
            return { tabId: tabs[0]?.id ?? null };
        },
    },

    {
        channel: "userSettings",
        what: "*",
        handler: async () => {
            const items = await chrome.storage.local.get("userSettings");
            return items.userSettings || {};
        },
    },

    {
        channel: "setUserSettings",
        what: "*",
        handler: async (payload) => {
            const items = await chrome.storage.local.get("userSettings");
            const current = (items.userSettings || {}) as Record<string, unknown>;
            const updates = (payload || {}) as Record<string, unknown>;
            const settings = { ...current, ...updates };
            await chrome.storage.local.set({ userSettings: settings });
            return { success: true };
        },
    },

    {
        channel: "dashboardGetRules",
        what: "*",
        handler: async (_request, ctx) => {
            const { modifyDashboardRuleset, resetDashboardRules } = await import("../sw-initialization.js");
            return resetDashboardRules(ctx.popupState, ctx.ensurePopupState, ctx.syncFirewallDnrRules);
        },
    },

    {
        channel: "dashboardModifyRuleset",
        what: "*",
        handler: async (payload, ctx) => {
            const { modifyDashboardRuleset, resetDashboardRules } = await import("../sw-initialization.js");
            return modifyDashboardRuleset(
                payload || {},
                ctx.popupState,
                ctx.ensurePopupState,
                ctx.persistPermanentFirewall,
                ctx.syncFirewallDnrRules,
            );
        },
    },

    {
        channel: "dashboardResetRules",
        what: "*",
        handler: async (_request, ctx) => {
            const { modifyDashboardRuleset, resetDashboardRules } = await import("../sw-initialization.js");
            return resetDashboardRules(ctx.popupState, ctx.ensurePopupState, ctx.syncFirewallDnrRules);
        },
    },

    {
        channel: "getWhitelist",
        what: "*",
        handler: async (_request, ctx) => ctx.getWhitelist(),
    },

    {
        channel: "setWhitelist",
        what: "*",
        handler: async (payload, ctx) => ctx.setWhitelist(payload),
    },

    {
        channel: "getAssetContent",
        what: "*",
        handler: async (request) => {
            const url = request.url as string;
            try {
                if (!url) return { content: "", trustedSource: false };
                const response = await fetch(url);
                const content = await response.text();
                return { content, trustedSource: false, sourceURL: url };
            } catch (e) {
                console.warn("[generic-module] getAssetContent: fetch failed", url, e);
                return { content: "", trustedSource: false };
            }
        },
    },

    {
        channel: "getAutoCompleteDetails",
        what: "*",
        handler: async (_request, ctx) => {
            const stored = await chrome.storage.local.get("selectedFilterLists");
            const selectedLists = stored?.selectedFilterLists || [];
            const lists = await ctx.getFilterListState();
            return { selectedFilterLists: selectedLists, lists };
        },
    },

    {
        channel: "getTrustedScriptletTokens",
        what: "*",
        handler: async () => {
            const redirectEngine = (globalThis as any).vAPI?.redirectEngine || (globalThis as any).redirectEngine;
            return redirectEngine?.getTrustedScriptletTokens?.() || [];
        },
    },

    {
        channel: "getMatchedRuleInfo",
        what: "*",
        handler: async (payload) => {
            const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
            const tabId = Number.isInteger(tabs[0]?.id)
                ? tabs[0].id as number
                : (payload?.tabId ?? 0);
            return {};
        },
    },

    {
        channel: "disableMatchedRule",
        what: "*",
        handler: async () => ({ ok: false }),
    },

    {
        channel: "getSanitizedExport",
        what: "*",
        handler: async () => ({}),
    },

    {
        channel: "getCosmeticSelectorsForDomain",
        what: "*",
        handler: async (payload) => {
            const domain = payload?.hostname ?? "";
            if (!domain) return { ok: false, selectors: [] };
            return { ok: true, selectors: [] };
        },
    },

    {
        channel: "cosmeticTelemetry",
        what: "*",
        handler: async () => ({ ok: true }),
    },

    {
        channel: "toggleAdvancedCSS",
        what: "*",
        handler: async () => ({ ok: false, hostname: "", enabled: false }),
    },

    {
        channel: "recordPopupAction",
        what: "*",
        handler: async () => ({ ok: false, reason: "not configured" }),
    },

    {
        channel: "isPopupBlocked",
        what: "*",
        handler: async () => ({ blocked: false }),
    },
];

export const genericModule: HandlerModule<SWContext> = {
    domain: "generic",
    handlers,
};
