/*******************************************************************************

    uBlock Origin - MV3 Startup Orchestrator
    https://github.com/gorhill/uBlock

    Handles the initialization pipeline: registering chrome event modules,
    initializing YouTube protection, setting up the smart cosmetic engine,
    installing the µb compatibility polyfill, and running the post-init
    state sync chain.

    Extracted from sw-entry.ts to isolate the startup sequence.

*******************************************************************************/

import { ChromeEventRegistry } from "./chrome-event-registry.js";
import { ensureLegacyBackend as ensureLegacyBackendImpl } from "./sw-initialization.js";
import { setEngineReferences as setSharedEngineReferences } from "./sw-engine-references.js";
import { initYouTubeProtection, cleanupStaleYouTubeMastheadFilters } from "./youtube-site-protector.js";
import { YouTubeEngine } from "./youtube-engine.js";
import { readYouTubeSettingsFromStorage } from "../youtube/youtube-config.js";
import { createPageLifecycleModule } from "./modules/page-lifecycle-module.js";
import { createUIEventsModule } from "./modules/ui-events-module.js";
import { createLoggerBufferModule } from "./modules/logger-buffer-module.js";
import { createYouTubeEventsModule } from "./modules/youtube-events-module.js";
import {
    trackPendingRequest,
    finalizeTrackedRequest,
} from "./sw-request-handlers.js";
import { clearTabRequestState } from "./sw-request-tracking.js";
import { pageStores } from "./sw-pagestore.js";
import { popupState, ensurePopupState } from "./sw-storage.js";
import {
    syncFirewallDnrRules,
    syncPowerSwitchDnrRules,
    syncHostnameSwitchDnrRules,
    syncWhitelistDnrRules,
} from "./sw-firewall.js";
import {
    syncFilterListDnrRules,
} from "./sw-policies.js";
import { syncStealthSurrogateRules } from "./stealth-surrogates.js";
import { installUBlockPolyfill } from "./sw-ub-polyfill.js";
import { initContextMenu } from "./sw-context-menu.js";

export type StartupDeps = {
    Zapper: any;
    Picker: any;
    Messaging: any;
    normalizeExtensionPageURL: (url: string) => string;
    appendUserFiltersFromPicker: (filters: string) => Promise<any>;
    toggleHostnameSwitch: (request: any) => any;
    persistURLFilteringRules: () => Promise<void>;
};

const ensureLegacyBackend = async () => {
    await ensureLegacyBackendImpl();
    setSharedEngineReferences();
};

async function initSmartCosmeticEngine(): Promise<void> {
    try {
        const { smartEngine, seedDemoRules } = await import('../../core/smart-cosmetic/engine');
        const { smartRuleStore } = await import('../../core/smart-cosmetic/smart-rule-store');
        await smartEngine.init();
        const allRules = smartRuleStore.getAllRules();
        if (allRules.length === 0) {
            await seedDemoRules();
        }
    } catch (e) {
        console.warn('[MV3] smart cosmetic engine init failed:', e);
    }
}

export function startup(deps: StartupDeps): void {
    const {
        Zapper,
        Picker,
        Messaging,
        normalizeExtensionPageURL,
        appendUserFiltersFromPicker,
        toggleHostnameSwitch,
        persistURLFilteringRules,
    } = deps;

    // ── Chrome Event Registry ──
    const chromeEventRegistry = new ChromeEventRegistry();
    chromeEventRegistry.registerModule(createPageLifecycleModule({
        trackPendingRequest,
        finalizeTrackedRequest,
        clearTabRequestState,
        pageStores,
    }));
    chromeEventRegistry.registerModule(createUIEventsModule({ Zapper, Picker }));
    chromeEventRegistry.registerModule(createLoggerBufferModule());

    // ── Legacy backend + YouTube init ──
    void ensureLegacyBackend().catch((e) => {
        console.warn('[uBR] startup: ensureLegacyBackend failed', e);
    });

    initYouTubeProtection();

    const youtubeEngine = new YouTubeEngine();
    youtubeEngine.init({
        manifestVersion: "1.0.0",
        criticalEndpointRegistryVersion: "1.0.0",
        rulePrioritySchemaVersion: "1.0.0",
        youtubeRuleIdRangeVersion: "1.0.0",
        surrogateSchemaVersion: "1.0.0",
        sanitizerSchemaVersion: "1.0.0",
        bootstrapVersion: "1.0.0",
        wrapperRiskSchemaVersion: "1.0.0",
        cosmeticSelectorRegistryVersion: "1.0.0",
    });

    chromeEventRegistry.registerModule(createYouTubeEventsModule({
        getYouTubeEngine: () => youtubeEngine,
    }));
    chromeEventRegistry.installAll();

    // ── Smart cosmetic engine ──
    void initSmartCosmeticEngine().catch((e) => {
        console.warn('[uBR] startup: initSmartCosmeticEngine failed', e);
    });

    // ── Post-init state sync chain ──
    ensurePopupState()
        .then(async () => {
            await cleanupStaleYouTubeMastheadFilters();
            void syncFirewallDnrRules();
            void syncFilterListDnrRules();
            void syncPowerSwitchDnrRules();
            void syncHostnameSwitchDnrRules();
            void syncWhitelistDnrRules();
            void syncStealthSurrogateRules();

            const settings = await readYouTubeSettingsFromStorage();
            if (settings.youtubeDetectionNeutralMode || settings.youtubeSmartBlockingEnabled) {
                youtubeEngine.applyRulePlan([]).catch((e) => {
                    console.warn('[uBR] startup: youtubeEngine.applyRulePlan failed', e);
                });
            }
        })
        .catch((e) => {
            console.warn('[uBR] ensurePopupState startup chain failed', e);
        });

    // ── Global compatibility exports ──
    (self as any).µBlockMV3 = {
        userSettings: popupState.userSettings,
        permanentFirewall: popupState.permanentFirewall,
        sessionFirewall: popupState.sessionFirewall,
    };

    (self as any).Messaging = Messaging;
    (self as any).Zapper = Zapper;
    (self as any).Picker = Picker;

    // ── µb compatibility polyfill ──
    installUBlockPolyfill({
        normalizeExtensionPageURL,
        persistURLFilteringRules,
        appendUserFiltersFromPicker,
        toggleHostnameSwitch,
    });

    // ── Context menu ──
    initContextMenu(popupState.userSettings);
}
