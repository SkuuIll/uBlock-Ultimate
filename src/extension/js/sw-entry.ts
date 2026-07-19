/* CANONICAL SERVICE WORKER — Manifest-selected active runtime.
 *
 * This file is the canonical service worker loaded by
 * platform/chromium/manifest.json (background.service_worker).
 *
 * Source of truth: this file (manually maintained).
 * Migration candidate: src/js/mv3/sw-entry.ts (TypeScript prototype).
 * DO NOT replace sw.js with generated bundles; the manifest points here.
 *
 * Generated validation output: platform/chromium/js/sw-entry-bundle.js
 * (from src/js/mv3/sw-entry.ts via build.mjs — NOT loaded by manifest).
 */

import {
    STEALTH_MODE_SETTING,
    createStealthSurrogateRules,
    isStealthSurrogateRuleId,
} from "./stealth-surrogates.js";

import { registerHybridUpdates } from "./hybrid-filter-updater.ts";
import { migrateStorageToV2 } from "./storage-schema-v2.ts";

import { YouTubeEngine, isYouTubeHost, classifyPageType } from "./youtube-engine.js";
const ytEngine = new YouTubeEngine();

import { smartEngine, smartRuleStore, exportAllRules, parseSmartRules } from "./smart-engine.js";

import { resolvePagePolicy, loadPolicyProfiles, extractHostname, domainFromHostname, explainPolicy, classifySelectorRisk } from "./policy-resolver.js";

import { PolicySnapshot } from "./policy-snapshot.js";

import { OperationToken } from "./operation-token.js";
import { DnrDecisionStore } from "./dnr-decision-store.js";
import { QuotaManager } from "./quota-manager.js";
import { CssInjectionRegistry } from "./css-injection-registry.js";
import { MessageContracts } from "./message-contracts.js";
import { AllowRuleAuthority } from "./allow-rule-authority.js";
import { MainWorldBridgePolicy } from "./main-world-bridge-policy.js";
import { HydrationGate } from "./startup-hydration-gate.js";
import { snapshotDnrRules, restoreDnrSnapshot, updateDnrTransaction } from "./dnr-transaction.js";
import { idAuthority } from "./id-authority.js";
import { timeAuthority } from "./time-authority.js";
import { classifyFirstKnownProfile } from "./page-signal-classifier.js";
import {
    DynamicFirewallRules,
    compileFirewallRulesToDnr,
    firewallRuleIdsInRange,
    getFirewallRulesForPopup,
    isDnrInitiatorDomain,
} from "./dynamic-filtering-runtime.js";
import {
    POPUP_LEDGER_SESSION_KEY,
    PopupRequestLedgerStore,
} from "./popup-request-ledger.js";
import {
    STORAGE_KEY_POPUP_SETTINGS as POPUP_SETTINGS_STORAGE_KEY,
    isPopupSettingsStorageChange,
    mergePopupSettings,
    popupSettingsStorageKeys,
    popupSettingsToStorage,
} from "./popup-settings-runtime.js";
import { LoggerRuntime } from "./logger-runtime.js";

const staleTabErrorPattern = /(?:No tab with id|Invalid tab|Tab.*not found|The tab was closed)/i;

function errorMessage(error) {
    return error?.message || String(error || "");
}

function isStaleTabError(error) {
    return staleTabErrorPattern.test(errorMessage(error));
}

function consumeRuntimeLastError() {
    try {
        return chrome.runtime.lastError || null;
    } catch (_) {
        return null;
    }
}

function logNonStaleTabError(context, error) {
    if (isStaleTabError(error)) return;
    console.warn(`[uBlock Ultimate] ${context}:`, error);
}

// Suppress "No tab with id" errors — harmless race when tab closes mid-async
self.onunhandledrejection = (event) => {
    if (isStaleTabError(event.reason)) {
        event.preventDefault();
    }
};

function broadcastMessage(channelName, message) {
    try {
        const ch = new BroadcastChannel(channelName);
        ch.postMessage(message);
        ch.close();
    } catch (_) {}
}

self.onerror = (_message, _source, _lineno, _colno, error) => {
    if (isStaleTabError(error)) return true;
    return false;
};

function callAction(method, details, context) {
    return new Promise(resolve => {
        let settled = false;
        const done = err => {
            if (settled) return;
            settled = true;
            if (err) logNonStaleTabError(context, err);
            resolve();
        };
        try {
            const maybePromise = chrome.action[method](details, () => {
                done(consumeRuntimeLastError());
            });
            if (maybePromise && typeof maybePromise.then === "function") {
                maybePromise.then(() => done(), done);
            }
        } catch (err) {
            done(err);
        }
    });
}

const actionEnable = (tabId, context = "action.enable") =>
    callAction("enable", tabId, context);

const actionDisable = (tabId, context = "action.disable") =>
    callAction("disable", tabId, context);

const actionSetBadgeText = (details, context = "action.setBadgeText") =>
    callAction("setBadgeText", details, context);

const actionSetIcon = (details, context = "action.setIcon") =>
    callAction("setIcon", details, context);

const actionSetTitle = (details, context = "action.setTitle") =>
    callAction("setTitle", details, context);

/* uBlock Ultimate MV3 SW — logger + content script bridge + popup panel */

// On-demand blocking state: persisted hostname index loaded lazily via webRequest
let cachedHostnameBlockSet = null;             // Set<string> loaded from storage
let installedSessionHostnames = new Set();     // hostnames already active as session rules
const sessionRuleFifo = [];                    // rule IDs in installation order (for eviction)
const SESSION_RULE_LIMIT = 5000;
const DYNAMIC_RULE_LIMIT = 5000;
let sessionRuleIdCounter = 88000000;           // starts below stealth range

const STORAGE_KEY_HOSTNAME_BLOCK = "hostnameBlockSet";
const STORAGE_KEY_HOSTNAME_BLOCK_TS = "hostnameBlockSetTimestamp";

async function loadCachedHostnameIndex() {
  try {
    const stored = await chrome.storage.local.get(STORAGE_KEY_HOSTNAME_BLOCK);
    const arr = stored[STORAGE_KEY_HOSTNAME_BLOCK];
    if (Array.isArray(arr) && arr.length > 0) {
      cachedHostnameBlockSet = new Set(arr);
      return true;
    }
  } catch (_) { /* ignore */ }
  return false;
}

const STORAGE_KEY_DNR_SCHEMA_VERSION = "ubrDnrSchemaVersion";
const CURRENT_DNR_SCHEMA_VERSION = 2;

async function clearDnrStateForSchemaUpgrade() {
    const stored = await chrome.storage.local.get(STORAGE_KEY_DNR_SCHEMA_VERSION);
    if (stored[STORAGE_KEY_DNR_SCHEMA_VERSION] === CURRENT_DNR_SCHEMA_VERSION) {
        return;
    }
    console.log("[uBlock Ultimate] DNR schema upgrade detected — clearing old DNR state");
    await chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: (await chrome.declarativeNetRequest.getDynamicRules()).map(r => r.id),
        addRules: [],
    });
    await chrome.declarativeNetRequest.updateSessionRules({
        removeRuleIds: (await chrome.declarativeNetRequest.getSessionRules()).map(r => r.id),
        addRules: [],
    });
    await chrome.storage.local.remove([
        STORAGE_KEY_HOSTNAME_BLOCK,
        STORAGE_KEY_HOSTNAME_BLOCK_TS,
        STORAGE_KEY_COMPILED_COUNTS,
        "cosmeticFiltersData",
    ]);
    cachedHostnameBlockSet = null;
    installedSessionHostnames.clear();
    sessionRuleFifo.length = 0;
    await chrome.storage.local.set({
        [STORAGE_KEY_DNR_SCHEMA_VERSION]: CURRENT_DNR_SCHEMA_VERSION,
    });
}

async function restoreSessionState() {
  try {
    const rules = await chrome.declarativeNetRequest.getSessionRules();
    for (const rule of rules) {
      if (rule.id >= 88000000 && rule.id < 90000000) {
        const m = rule.condition?.urlFilter?.match(/^\|\|([^/^]+)\^/);
        if (m) { installedSessionHostnames.add(m[1]); sessionRuleFifo.push(rule.id); }
      }
    }
    if (installedSessionHostnames.size > 0) {
      console.log(`[uBlock Ultimate] Restored ${installedSessionHostnames.size} session rules from previous session`);
    }
  } catch (_) { /* ignore */ }
}

async function ensureFilterRules() {
  if (cachedHostnameBlockSet) {
    const dyn = await chrome.declarativeNetRequest.getDynamicRules();
    if (dyn.length > 0) {
      await restoreSessionState();
      console.log(`[uBlock Ultimate] Using cached index with ${cachedHostnameBlockSet.size} hostnames + ${dyn.length} dynamic rules`);
      dnrSyncCompleted = true;
      runtimeHealth.dnrStaticRulesReady = true;
      runtimeHealth.filterListsReady = true;
      return dyn.length;
    }
  }
  if (syncInProgress) return 0;
  return await syncFilterListDnrRules();
}

const LOGGER_BUFFER_MAX = 5000;
const LOGGER_OBSOLETE_AFTER = 30000;

// Runtime health — tracks subsystem readiness for diagnostics
const runtimeHealth = {
  dnrStaticRulesReady: false,
  dnrDynamicRulesReady: false,
  filterListsReady: false,
  cosmeticsReady: false,
  scriptletsReady: false,
  lastError: '',
  degradedMode: false,
  degradedModeReason: '',
  degradedModeTimestamp: 0,
  managedPolicyApplied: false,
  idleState: 'active',
  filterListVersions: {},
  filterListsOutdated: [],
  adaptiveMode: false,
};

// Temporary logger exception filters — cleared on releaseView / loggerDisabled
const inMemoryFilters = new Set();

// Storage quota manager (Item 193)
const storageQuota = {
    maxFilterListCacheSize: 5 * 1024 * 1024, // 5MB
    maxDiagnosticsEntries: 100,
    maxCompatHistoryEntries: 200,
    maxRecorderEntries: 50,
    maxRuntimeHealthEntries: 20,
    
    estimateSize(obj) {
        try {
            const str = JSON.stringify(obj);
            return new Blob([str]).size;
        } catch (e) {
            return 0;
        }
    },
    
    async enforceQuota() {
        const keys = ['compatibilityHistory', 'localRecorderOutput', 'diagnosticReports', 'filterListCache'];
        for (const key of keys) {
            const stored = await chrome.storage.local.get(key);
            if (!stored[key]) continue;
            const data = stored[key];
            const size = this.estimateSize(data);
            const limit = key === 'filterListCache' ? this.maxFilterListCacheSize :
                          key === 'compatibilityHistory' ? 1024 * 1024 :
                          key === 'localRecorderOutput' ? 512 * 1024 : 256 * 1024;
            if (size > limit) {
                console.warn(`[uBlock Ultimate] Storage quota exceeded for "${key}": ${size} > ${limit}, truncating`);
                if (Array.isArray(data)) {
                    const trimmed = data.slice(-Math.floor(data.length / 2));
                    await chrome.storage.local.set({ [key]: trimmed });
                }
            }
        }
    }
};

// Feature expiry tracking (Item 340)
const featureExpiryGates = {
    experimentalInterceptors: { enabled: false, expiresAt: 0 },
    antiAdblockCountermeasures: { enabled: false, expiresAt: 0 },
    smartCosmetics: { enabled: false, expiresAt: 0 },
    genericVideoMutation: { enabled: false, expiresAt: 0 },
    firstPartyDomDetection: { enabled: false, expiresAt: 0 },
    
    setExpiry(feature, days = 90) {
        if (this[feature]) {
            this[feature].enabled = true;
            this[feature].expiresAt = Date.now() + days * 24 * 60 * 60 * 1000;
        }
    },
    
    isExpired(feature) {
        const gate = this[feature];
        if (!gate || !gate.enabled) return true;
        if (gate.expiresAt > 0 && Date.now() > gate.expiresAt) {
            gate.enabled = false;
            console.warn(`[uBlock Ultimate] Feature "${feature}" has expired`);
            return true;
        }
        return false;
    }
};

// Inline scriptlet cache for minified scriptlet delivery (Item 146)
const scriptletCache = new Map(); // scriptletName → { script, version }

// URL filtering rules — session (temporary) + permanent (persisted)
const sessionURLFilteringRules = new Map(); // `${context} ${url} ${type}` → action
let permanentURLFilteringRules = {}; // loaded from chrome.storage.local
const STORAGE_KEY_URL_FILTERING = "ubrURLFilteringRules";
const STORAGE_KEY_SESSION_URL_FILTERING = "ubrSessionURLFilteringRules";

// Filter reverse index — lazily loaded from DNR source-map artifacts + assets.json
const filterReverseIndex = new Map(); // rawFilter → [{ assetKey, title, supportURL, sourceList, sourceLine }]
const dnrRuleReverseIndex = new Map(); // `${rulesetId}:${ruleId}` → { rawFilter, assetKey, title, supportURL, sourceList, rulesetId }
const urlFilteringDnrRuleMetadata = new Map(); // ruleId → logger source metadata
const matchedRuleLogByTab = new Map();
let filterReverseIndexReady; // promise, set once during first lazy load

async function loadSourceMapPaths() {
    const loadJson = async path => {
        try {
            return await fetch(chrome.runtime.getURL(path)).then(r => {
                if (!r.ok) throw new Error(`HTTP ${r.status}`);
                return r.json();
            });
        } catch (_) {
            return null;
        }
    };

    const sourceMapIndex = await loadJson("dnr/source-map-index.json");
    if (Array.isArray(sourceMapIndex)) {
        return sourceMapIndex.filter(path => typeof path === "string");
    }
    if (Array.isArray(sourceMapIndex?.files)) {
        return sourceMapIndex.files.filter(path => typeof path === "string");
    }

    const legacyIndex = await loadJson("dnr/.source-map.index.json");
    if (Array.isArray(legacyIndex?.files)) {
        return legacyIndex.files
            .filter(path => typeof path === "string")
            .map(path => path.startsWith("dnr/") ? path : `dnr/${path}`);
    }

    return ["dnr/core-mini.source-map.json"];
}

function appendMatchedRuleLog(tabId, entry) {
    if (typeof tabId !== "number" || tabId < 0) return;
    let list = matchedRuleLogByTab.get(tabId);

    if (!list) {
        list = [];
        matchedRuleLogByTab.set(tabId, list);
    }

    list.push(entry);

    if (list.length > 1000) {
        list.splice(0, list.length - 1000);
    }
}

async function injectCosmeticLoggerIntoTab(tabId) {
    try {
        await chrome.scripting.executeScript({
            target: { tabId, allFrames: true },
            files: ["/js/scriptlets/cosmetic-logger.js"],
        });
    } catch (error) {
        if (!isStaleTabError(error)) {
            console.warn("[uBlock Ultimate] cosmetic logger injection failed:", tabId, error);
        }
    }
}

async function enableCosmeticLoggerForOpenTabs() {
    const tabs = await chrome.tabs.query({ url: ["http://*/*", "https://*/*"] });
    await Promise.allSettled(
        tabs.filter(tab => Number.isInteger(tab.id)).map(tab => injectCosmeticLoggerIntoTab(tab.id))
    );
}

async function disableCosmeticLoggerForOpenTabs() {
    const tabs = await chrome.tabs.query({});
    await Promise.allSettled(
        tabs.filter(tab => Number.isInteger(tab.id)).map(tab =>
            chrome.tabs.sendMessage(tab.id, { what: "loggerDisabled" }).catch(() => {})
        )
    );
}

async function ensureFilterReverseIndex() {
    if (filterReverseIndexReady) return filterReverseIndexReady;
    filterReverseIndexReady = (async () => {
    // Build sourceList → asset metadata lookup from assets.json
        let assets;
        try {
            assets = await fetch(chrome.runtime.getURL("assets/assets.json")).then(r => r.json());
        } catch (err) {
            console.warn("[uBlock Ultimate] Failed to fetch assets.json:", err);
        }
        const listByAssetKey = new Map();
        const listByContentURL = new Map();
        if (assets) {
            for (const [assetKey, meta] of Object.entries(assets)) {
                listByAssetKey.set(assetKey, {
                    assetKey,
                    title: meta.title || assetKey,
                    supportURL: meta.supportURL || "",
                });
                const urls = Array.isArray(meta.contentURL) ? meta.contentURL : [meta.contentURL];
                for (const url of urls.filter(Boolean)) {
          listByContentURL.set(url, { assetKey, title: meta.title || assetKey, supportURL: meta.supportURL || "" });
                }
            }
        }
        // Load source-map artifacts and populate both indexes
        const sourceMapPaths = await loadSourceMapPaths();
        for (const path of sourceMapPaths) {
            let sm;
            try {
                sm = await fetch(chrome.runtime.getURL(path)).then(r => r.json());
            } catch (err) {
                console.warn("[uBlock Ultimate] Failed to fetch source-map:", path, err);
            }
            if (!sm?.entries) continue;
            for (const entry of sm.entries) {
                const rawFilter = entry.originalFilter;
                if (!rawFilter) continue;
                const baseRulesetId = String(entry.rulesetId || "").replace(/-\d{2}$/, "");
                const meta = listByAssetKey.get(entry.assetKey || baseRulesetId) || listByContentURL.get(entry.sourceList) || {};
                const item = {
          assetKey: meta.assetKey || entry.rulesetId || entry.sourceList,
          title: meta.title || entry.rulesetId || entry.sourceList,
          supportURL: meta.supportURL || "",
          sourceList: entry.sourceList,
          sourceLine: entry.sourceLine,
          rulesetId: entry.rulesetId,
          ruleId: entry.ruleId,
                };
                // Populate raw-filter index
                const existing = filterReverseIndex.get(rawFilter);
                if (existing) existing.push(item);
                else filterReverseIndex.set(rawFilter, [item]);
                // Populate rule-id index
                if (entry.ruleId != null) {
          const key = `${entry.rulesetId}:${entry.ruleId}`;
          dnrRuleReverseIndex.set(key, {
            rawFilter,
            assetKey: item.assetKey,
            title: item.title,
            supportURL: item.supportURL,
            sourceList: entry.sourceList,
            sourceLine: entry.sourceLine,
            rulesetId: entry.rulesetId,
            ruleId: entry.ruleId,
            regex:
                typeof entry.loggerRegex === "string"
                    ? entry.loggerRegex
                    : undefined,
          });
                }
            }
        }
    })();
    return filterReverseIndexReady;
}

function lookupFilterLists(rawFilter) {
    const entries = filterReverseIndex.get(rawFilter);
    if (!entries || entries.length === 0) return {};
    return { [rawFilter]: entries };
}

function lookupFilterByRuleId(rulesetId, ruleId) {
    const dynamicURLSource = urlFilteringDnrRuleMetadata.get(Number(ruleId));
    if (dynamicURLSource) {
        return dynamicURLSource;
    }
    return dnrRuleReverseIndex.get(`${rulesetId}:${ruleId}`) || null;
}


// Request stats tracking (popup counters)
const reqStats = {
  byTab: new Map(), // tabId → { allowed: { any, script, frame } }
  globalAllowed: { any: 0 },
};
const hostnameStats = new Map(); // hostname → { domain, allowed: { any, script, frame }, blocked: { any, script, frame } }
const popupRequestLedgers = new PopupRequestLedgerStore();
let popupLedgerHydrated = false;
let popupLedgerHydrationPromise = null;
let popupLedgerPersistTimer = 0;

async function ensurePopupLedgerHydrated() {
    if (popupLedgerHydrated) return;
    if (popupLedgerHydrationPromise === null) {
        popupLedgerHydrationPromise = (async () => {
            try {
                if (chrome.storage?.session) {
                    const stored = await chrome.storage.session.get(POPUP_LEDGER_SESSION_KEY);
                    popupRequestLedgers.hydrate(stored[POPUP_LEDGER_SESSION_KEY] || {});
                }
            } catch (err) {
                console.warn("[uBlock Ultimate] popup ledger hydrate failed:", err);
            }
            popupLedgerHydrated = true;
        })();
    }
    await popupLedgerHydrationPromise;
}

function schedulePopupLedgerPersist() {
    if (!chrome.storage?.session) return;
    if (popupLedgerPersistTimer) clearTimeout(popupLedgerPersistTimer);
    popupLedgerPersistTimer = setTimeout(() => {
        popupLedgerPersistTimer = 0;
        chrome.storage.session.set({
            [POPUP_LEDGER_SESSION_KEY]: popupRequestLedgers.serialize(),
        }).catch(err => { console.warn("[uBlock Ultimate] popup ledger persist failed:", err); });
    }, 250);
}

async function ensureLifetimeRequestCountsLoaded() {
    if (lifetimeCountsLoaded) return;

    if (lifetimeCountsLoadPromise === null) {
        lifetimeCountsLoadPromise = (async () => {
            try {
                const stored = await chrome.storage.local.get([
                    STORAGE_KEY_GLOBAL_ALLOWED_REQUEST_COUNT,
                    STORAGE_KEY_GLOBAL_BLOCKED_REQUEST_COUNT,
                ]);

                lifetimeRequestCounts.allowed = Math.max(
                    0,
                    Number(stored[STORAGE_KEY_GLOBAL_ALLOWED_REQUEST_COUNT]) || 0,
                );

                lifetimeRequestCounts.blocked = Math.max(
                    0,
                    Number(stored[STORAGE_KEY_GLOBAL_BLOCKED_REQUEST_COUNT]) || 0,
                );

                lifetimeCountsLoaded = true;
            } catch (error) {
                console.warn(
                    "[uBlock Ultimate] Failed to load lifetime request counts:",
                    error,
                );
                lifetimeCountsLoadPromise = null;
            }
        })();
    }

    await lifetimeCountsLoadPromise;
}

function scheduleLifetimeRequestCountsPersist() {
    if (lifetimeCountsPersistTimer !== 0) {
        clearTimeout(lifetimeCountsPersistTimer);
    }

    lifetimeCountsPersistTimer = setTimeout(() => {
        lifetimeCountsPersistTimer = 0;

        chrome.storage.local.set({
            [STORAGE_KEY_GLOBAL_ALLOWED_REQUEST_COUNT]:
                lifetimeRequestCounts.allowed,

            [STORAGE_KEY_GLOBAL_BLOCKED_REQUEST_COUNT]:
                lifetimeRequestCounts.blocked,
        }).catch(error => {
            console.warn(
                "[uBlock Ultimate] Failed to persist lifetime request counts:",
                error,
            );
        });
    }, 250);
}

function recordPopupRequest(details) {
    if (isExtensionURL(details?.url)) return;
    void ensurePopupLedgerHydrated().then(() => {
        popupRequestLedgers.recordBeforeRequest(details);
        if (details.tabId >= 0) {
            if (dnrSyncCompleted === false) tabUnprocessedRequest.add(details.tabId);
            const hn = hostnameFromURL(details.url);
            if (hn) {
                if (!tabHostnames.has(details.tabId)) tabHostnames.set(details.tabId, new Set());
                tabHostnames.get(details.tabId).add(hn);
            }
            markTabChanged(details.tabId);
        }
        schedulePopupLedgerPersist();
    });
}

function finalizePopupRequest(details, blocked = false) {
    if (isExtensionURL(details?.url)) return;
    void Promise.all([
        ensurePopupLedgerHydrated(),
        ensureLifetimeRequestCountsLoaded(),
    ]).then(() => {
        const result = blocked
            ? popupRequestLedgers.finalizeError(details)
            : popupRequestLedgers.finalizeCompleted(details);

        // Increment only once. Duplicate and failed requests must not affect
        // lifetime counters.
        if (result === "allowed") {
            lifetimeRequestCounts.allowed += 1;
            scheduleLifetimeRequestCountsPersist();
        } else if (result === "blocked") {
            lifetimeRequestCounts.blocked += 1;
            scheduleLifetimeRequestCountsPersist();
        }

        if (
            details.tabId >= 0 &&
            result !== null &&
            result !== "failed" &&
            result !== "duplicate"
        ) {
            markTabChanged(details.tabId);
        }

        schedulePopupLedgerPersist();
    });
}

function categorizeRequestType(type) {
    if (type === "script") return "script";
    if (type === "sub_frame" || type === "main_frame") return "frame";
    return "other";
}

let cachedGlobalMatchCount = 0;
let cachedTabMatchCounts = new Map(); // tabId → count
let lastMatchRefresh = 0;
const MATCH_REFRESH_INTERVAL = 5000;

async function refreshMatchCounts() {
    const now = Date.now();
    if (now - lastMatchRefresh < MATCH_REFRESH_INTERVAL) return;
    lastMatchRefresh = now;
    try {
        const result = await chrome.declarativeNetRequest.getMatchedRules();
        const infos = result?.rulesMatchedInfo || result?.rules || [];
        cachedGlobalMatchCount = infos.length;
        const tabCounts = new Map();
        for (const info of infos) {
            const tid = info.tabId;
      tabCounts.set(tid, (tabCounts.get(tid) || 0) + 1);
        }
        cachedTabMatchCounts = tabCounts;
    } catch (err) {
        console.warn("[uBlock Ultimate] refreshMatchCounts failed:", err);
    }
}

async function getDNRMatchedCount(tabId) {
    await refreshMatchCounts();
    if (typeof tabId === "number" && tabId > 0) {
        return cachedTabMatchCounts.get(tabId) || 0;
    }
    return cachedGlobalMatchCount;
}

// Shared domain/URL utils — delegates to policy-resolver.js implementations
// (Item 281-283: centralize URL/hostname normalization)
function hostnameFromURL(url) {
    return extractHostname(url);
}

function isExtensionURL(url) {
    return String(url || "").startsWith(chrome.runtime.getURL(""));
}

const loggerRuntime = new LoggerRuntime({
    hostnameFromURL,
    domainFromHostname,
    lookupRule: (rulesetId, ruleId) => lookupFilterByRuleId(rulesetId, ruleId),
    storage: chrome.storage.session,
    loggerObsoleteAfterMs: LOGGER_OBSOLETE_AFTER,
});
void loggerRuntime.hydrate();

const YOUTUBE_UI_PROTECTED_IDS = [
  "container",
  "center",
  "start",
  "end",
  "guide-button",
  "logo",
  "search-button-narrow",
  "voice-search-button",
];

function youtubeScopeApplies(scope) {
    if (scope === "") return true;
    const includes = [];
    const excludes = [];
    for (const rawToken of scope.split(",")) {
        const token = rawToken.trim().toLowerCase();
        if (token === "") continue;
        if (token.startsWith("~")) excludes.push(token.slice(1));
        else includes.push(token);
    }
    const isYoutubeScope = token =>
        token === "*" ||
    token === "youtube.com" ||
    token === "www.youtube.com" ||
    token === "m.youtube.com" ||
    token === "youtu.be" ||
    token === "*.youtube.com" ||
    token.endsWith(".youtube.com");
    if (excludes.some(isYoutubeScope)) return false;
    return includes.length === 0 || includes.some(isYoutubeScope);
}

function selectorTargetsYouTubeMasthead(selector) {
    const normalized = String(selector || "").toLowerCase();
    const compact = normalized.replace(/\s+/g, "");
    if (
    normalized.includes("ytd-masthead") ||
    normalized.includes("ytd-topbar") ||
    normalized.includes("yt-searchbox")
    ) {
        return true;
    }
    if (
        compact === ".style-scope" ||
    compact === "*.style-scope" ||
    compact === "div.style-scope" ||
    /\[class[*~|^$]?=(["'])?style-scope\1?\]/.test(compact)
    ) {
        return true;
    }
    const idGroup = YOUTUBE_UI_PROTECTED_IDS.join("|");
    return new RegExp(`(^|[^\\w-])#(?:${idGroup})(?:$|[^\\w-])`).test(normalized) ||
    new RegExp(`\\[id\\s*=\\s*["']?(?:${idGroup})["']?\\]`).test(normalized);
}

function cosmeticCacheEntrySelector(entry) {
    if (typeof entry === "string") return entry;
    if (Array.isArray(entry)) return typeof entry[0] === "string" ? entry[0] : "";
    if (entry && typeof entry === "object" && typeof entry.selector === "string") return entry.selector;
    return "";
}

function cosmeticCacheEntryScopes(entry, key) {
    const details = Array.isArray(entry) ? entry[1] : entry && typeof entry === "object" ? entry : {};
    const value = details?.[key];
    if (Array.isArray(value)) return value.filter(scope => typeof scope === "string");
    if (key === "matches" && Array.isArray(details?.domains)) {
        return details.domains.filter(scope => typeof scope === "string");
    }
    return [];
}

function cosmeticCacheEntryAppliesToYoutube(entry) {
    const excludes = cosmeticCacheEntryScopes(entry, "excludeMatches");
    if (excludes.some(scope => youtubeScopeApplies(scope))) return false;
    const includes = cosmeticCacheEntryScopes(entry, "matches");
    return includes.length === 0 || includes.some(scope => youtubeScopeApplies(scope));
}

function scrubStaleYouTubeCosmeticCache(raw) {
    if (raw === undefined || raw === null || raw === "") {
        return { changed: false, removed: [], content: undefined };
    }
    const data = parseStoredCosmeticFilterData(raw);
    const removed = [];
    const keepGeneric = data.genericCosmeticFilters.filter(entry => {
        const selector = cosmeticCacheEntrySelector(entry);
        if (selector === "" || selectorTargetsYouTubeMasthead(selector) === false) return true;
    removed.push(selector);
    return false;
    });
    const keepSpecific = data.specificCosmeticFilters.filter(entry => {
        const selector = cosmeticCacheEntrySelector(entry);
        if (
            selector === "" ||
      selectorTargetsYouTubeMasthead(selector) === false ||
      cosmeticCacheEntryAppliesToYoutube(entry) === false
        ) {
            return true;
        }
    removed.push(selector);
    return false;
    });
    if (removed.length === 0) return { changed: false, removed, content: undefined };
    return {
    changed: true,
    removed,
    content: JSON.stringify({
      ...data,
      genericCosmeticFilters: keepGeneric,
      specificCosmeticFilters: keepSpecific,
    }),
    };
}

async function buildUserCosmeticFilters(hostname) {
    const result = { specificCSS: "", genericCSS: "", proceduralFilters: [], exceptionFilters: [], proceduralPrehideCSS: "" };
    if (!hostname) return result;
    try {
        const stored = await chrome.storage.local.get(["userFilters", "user-filters", "selectedFilterLists"]);
        // Check if user-filters list is selected; return empty if deselected
        if (
            Array.isArray(stored.selectedFilterLists) === false ||
            stored.selectedFilterLists.includes("user-filters") === false
        ) {
            return result;
        }
        const raw = typeof stored.userFilters === "string" && stored.userFilters !== ""
            ? stored.userFilters
            : typeof stored["user-filters"] === "string"
                ? stored["user-filters"]
                : "";
        if (!raw) return result;
        const specificLines = [];
        const genericLines = [];
        const procPrehides = [];
        const exceptions = [];
        for (const line of raw.split(/\r?\n/)) {
            const trimmed = line.trim();
            if (trimmed === "" || trimmed.startsWith("!")) continue;
            // Exception cosmetic filter: domain#@#selector
            if (trimmed.includes("#@#")) {
                const sep = trimmed.indexOf("#@#");
                const domain = trimmed.slice(0, sep).trim();
                const selector = trimmed.slice(sep + 3).trim();
                if (selector && hostnameMatches(hostname, domain)) {
                    exceptions.push(selector);
                }
                continue;
            }
            // Standard cosmetic filter: domain##selector
            if (trimmed.includes("##")) {
                const sep = trimmed.indexOf("##");
                const domain = trimmed.slice(0, sep).trim();
                const selector = trimmed.slice(sep + 2).trim();
                if (selector && hostnameMatches(hostname, domain)) {
                    const scopeTokens = domain.split(",").map(t => t.trim()).filter(Boolean);
                    const hasPositiveScope = scopeTokens.some(t => t !== "*" && t.startsWith("~") === false);
                    const isGeneric = hasPositiveScope === false;
                    if (isProceduralCosmeticSelector(selector)) {
                        result.proceduralFilters.push({ selector });
                        const prehide = prehideSelectorFromProceduralSelector(selector);
                        if (prehide) {
                            procPrehides.push(prehide);
                        }
                    } else if (isGeneric) {
                        genericLines.push(selector);
                    } else {
                        specificLines.push(selector);
                    }
                }
            }
        }
        if (specificLines.length > 0) {
            result.specificCSS = specificLines.map(s => `${s} { display: none !important; }`).join("\n");
        }
        if (genericLines.length > 0) {
            result.genericCSS = genericLines.map(s => `${s} { display: none !important; }`).join("\n");
        }
        if (procPrehides.length > 0) {
            result.proceduralPrehideCSS = procPrehides.map(s => `${s} { display: none !important; }`).join("\n");
        }
        if (exceptions.length > 0) {
            result.exceptionFilters = exceptions.map(s => `${s} { display: unset !important; }`);
        }
        return result;
    } catch (e) {
        console.warn("[uBlock Ultimate] buildUserCosmeticFilters failed:", e);
        return result;
    }
}

function hostnameMatches(hostname, domain) {
    if (domain === "" || domain === "*") return true;
    // Parse comma-separated include/exclude scopes
    const parts = domain.split(",");
    if (parts.length === 1) {
        const raw = parts[0].trim();
        if (raw === "") return true;
        // Single domain with optional ~ prefix
        const d = raw.startsWith("~") ? raw.slice(1) : raw;
        const matched = d === hostname || hostname.endsWith(`.${d}`);
        return raw.startsWith("~") ? !matched : matched;
    }
    let hasInclude = false;
    let matched = false;
    for (const token of parts) {
        const raw = token.trim();
        if (raw === "") continue;
        if (raw.startsWith("~")) {
            const d = raw.slice(1);
            if (d === hostname || hostname.endsWith(`.${d}`)) {
                return false; // Exclusion wins
            }
        } else {
            hasInclude = true;
            if (raw === hostname || hostname.endsWith(`.${raw}`)) {
                matched = true;
            }
        }
    }
    // If there were explicit includes, require a match; otherwise allow all
    return hasInclude ? matched : true;
}

function cosmeticDomainsMatch(domains, hostname) {
    const included = [];
    const excluded = [];
    for (const raw of domains) {
        const token = String(raw).trim();
        if (token === "") continue;
        if (token.startsWith("~")) {
            excluded.push(token.slice(1));
        } else {
            included.push(token);
        }
    }
    if (excluded.some(d => d === hostname || hostname.endsWith(`.${d}`))) {
        return false;
    }
    return included.length === 0 ||
        included.some(d => d === hostname || hostname.endsWith(`.${d}`));
}

const proceduralPrehideOperatorNames = [
    "has-text",
    "matches-path",
    "matches-css-after",
    "matches-css-before",
    "matches-css",
    "matches-attr",
    "matches-prop",
    "matches-media",
    "min-text-length",
    "watch-attr",
    "remove-class",
    "remove-attr",
    "upward",
    "xpath",
    "spath",
    "shadow",
    "others",
    "if-not",
    "has",
    "if",
    "not",
    "remove",
];

function topLevelProceduralOperatorIndex(selector) {
    let quote = "";
    let escaped = false;
    let squareDepth = 0;
    let parenDepth = 0;
    for (let i = 0; i < selector.length; i += 1) {
        const ch = selector[i];
        if (escaped) {
            escaped = false;
            continue;
        }
        if (ch === "\\") {
            escaped = true;
            continue;
        }
        if (quote !== "") {
            if (ch === quote) quote = "";
            continue;
        }
        if (ch === '"' || ch === "'") {
            quote = ch;
            continue;
        }
        if (ch === "[") {
            squareDepth += 1;
            continue;
        }
        if (ch === "]" && squareDepth !== 0) {
            squareDepth -= 1;
            continue;
        }
        if (squareDepth !== 0) continue;
        if (ch === "(") {
            parenDepth += 1;
            continue;
        }
        if (ch === ")" && parenDepth !== 0) {
            parenDepth -= 1;
            continue;
        }
        if (ch !== ":" || parenDepth !== 0) continue;
        for (const operator of proceduralPrehideOperatorNames) {
            if (selector.startsWith(`${operator}(`, i + 1)) {
                return i;
            }
        }
    }
    return -1;
}

function isProceduralCosmeticSelector(selector) {
    const normalized = String(selector || "").trim();
    return normalized.startsWith("{") || topLevelProceduralOperatorIndex(normalized) !== -1;
}

function hasSpecificPrehideAnchor(selector) {
    return selector !== "" &&
        selector !== "*" &&
        (selector.includes("#") || selector.includes(".") || selector.includes("[")) &&
        /[>+~]$/.test(selector) === false;
}

function topLevelProceduralOperatorArgument(selector, wantedOperator) {
    let quote = "";
    let escaped = false;
    let squareDepth = 0;
    let parenDepth = 0;
    for (let i = 0; i < selector.length; i += 1) {
        const ch = selector[i];
        if (escaped) {
            escaped = false;
            continue;
        }
        if (ch === "\\") {
            escaped = true;
            continue;
        }
        if (quote !== "") {
            if (ch === quote) quote = "";
            continue;
        }
        if (ch === '"' || ch === "'") {
            quote = ch;
            continue;
        }
        if (ch === "[") {
            squareDepth += 1;
            continue;
        }
        if (ch === "]" && squareDepth !== 0) {
            squareDepth -= 1;
            continue;
        }
        if (squareDepth !== 0) continue;
        if (ch === "(") {
            parenDepth += 1;
            continue;
        }
        if (ch === ")" && parenDepth !== 0) {
            parenDepth -= 1;
            continue;
        }
        if (ch !== ":" || parenDepth !== 0) continue;
        if (selector.startsWith(`${wantedOperator}(`, i + 1) === false) {
            continue;
        }
        const argStart = i + wantedOperator.length + 2;
        const argEnd = selector.indexOf(")", argStart);
        return argEnd === -1 ? "" : selector.slice(argStart, argEnd).trim();
    }
    return "";
}

function ancestorPrehideSelectorFromUpward(selector, anchorSelector) {
    const upwardArg = topLevelProceduralOperatorArgument(selector, "upward");
    if (/^\d+$/.test(upwardArg) === false) return "";
    const distance = parseInt(upwardArg, 10);
    if (distance < 1 || distance > 8) return "";
    const chain = [
        ...Array.from({ length: distance - 1 }, () => "*"),
        anchorSelector,
    ].join(" > ");
    return `:is(article,aside,div,li,main,nav,section):has(> ${chain})`;
}

function prehideSelectorFromProceduralSelector(raw) {
    const selector = String(raw || "").trim();
    if (selector === "" || selector.startsWith("{")) return "";
    const operatorIndex = topLevelProceduralOperatorIndex(selector);
    if (operatorIndex === -1) return "";
    const prehide = selector.slice(0, operatorIndex).trim();
    if (hasSpecificPrehideAnchor(prehide) === false) return "";
    const ancestorPrehide = ancestorPrehideSelectorFromUpward(selector, prehide);
    return ancestorPrehide === "" ? prehide : `${ancestorPrehide},\n${prehide}`;
}

async function cleanupStaleYouTubeMastheadFilters() {
    const stored = await chrome.storage.local.get(["cosmeticFiltersData"]);
    const cleaned = scrubStaleYouTubeCosmeticCache(stored.cosmeticFiltersData);
    if (cleaned.changed === false) return [];
    if (cleaned.content !== undefined) {
        await chrome.storage.local.set({ cosmeticFiltersData: cleaned.content });
    }
    try { await reloadAllFilterLists(); } catch (err) { console.warn("[uBlock Ultimate] reloadAllFilterLists after scrub:", err); }
    if (cleaned.removed.length !== 0) {
        console.warn("[uBlock Ultimate] Removed stale YouTube masthead cosmetic entries:", cleaned.removed);
    }
    return cleaned.removed;
}

async function getActivePageTab() {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    return tabs.find(t => typeof t.id === "number" && !isExtensionURL(t.url)) || null;
}

async function getLoggerTabs() {
    const tabs = await chrome.tabs.query({});
    return tabs.filter(t => typeof t.id === "number" && !isExtensionURL(t.url)).map(t => [t.id, t.title || t.url || `Tab ${t.id}`]);
}

async function pushTabReloadMarker(tabId) {
    let tabURL = "";
    let tabHostname = "";
    let tabDomain = "";
    try {
        const tab = await chrome.tabs.get(tabId);
        tabURL = tab?.url || "";
        tabHostname = hostnameFromURL(tabURL);
        tabDomain = domainFromHostname(tabHostname);
    } catch (e) {
        console.warn("[uBlock Ultimate] pushTabReloadMarker: tabs.get failed for tab", tabId, e);
    }
    loggerRuntime.writeMessage({
    tstamp: Date.now() / 1000,
    realm: "message",
    tabId,
    type: "tabReload",
    text: `Reload requested for ${tabURL || `tab ${tabId}`}`,
    keywords: ["reload", "logger"],
    });
}

// Lazy activation: on each observed request, install session rule for hostname in index
async function tryActivateHostname(_hostname) {
  // Deferred activation removed in favor of specificity-preserving rules.
  // Future deferred-rules implementation will preserve full original DNR rules.
}

console.log("[uBlock Ultimate] chrome.webRequest available:", typeof chrome?.webRequest, typeof chrome?.webRequest?.onBeforeRequest);
try {
  chrome.webRequest.onBeforeRequest.addListener(
      d => {
        recordPopupRequest(d);
        loggerRuntime.recordBeforeRequest(d);
        if (d.type === "main_frame") {
            popupBlockedCountByTab.set(d.tabId, 0);
            scheduleCspReportPolicySync();
        }
        try { const u = new URL(d.url); void tryActivateHostname(u.hostname); }
        catch (_) { /* invalid URL */ }
      },
      { urls: ["<all_urls>"] }
  );
  chrome.webRequest.onCompleted.addListener(
      d => {
        finalizePopupRequest(d, false);
        loggerRuntime.recordCompleted(d);
      },
      { urls: ["<all_urls>"] }
  );
  chrome.webRequest.onErrorOccurred.addListener(
      d => {
        finalizePopupRequest(d, true);
        loggerRuntime.recordError(d);
      },
      { urls: ["<all_urls>"] }
  );
} catch (e) {
  console.warn("[uBlock Ultimate] webRequest registration failed:", e);
}

// ---------------------------------------------------------------------------
// Legacy global CSS used broad substring selectors and could hide application
// UI. Keep its exact text only so it can be removed from already-open tabs.
// ---------------------------------------------------------------------------
const LEGACY_BUILTIN_COSMETIC_HIDE = `
.adsbygoogle,.adsbox,.ad-container,.ad-slot,.ad-banner,.ad-placeholder,
ins.adsbygoogle,.google-adsense,.advertisement,.advertising,
.ad-wrap,.ad-wrapper,.ad-unit,.ad-area,.ad-module,.ad-section,
[class*="adunit"],[class*="ad-unit"],[class*="ad_banner"],[class*="ad-banner"],
[class*="ad-container"],[class*="ad-slot"],[class*="ad_placeholder"],
[class*="ad-holder"],[id*="google_ads"],[id*="ad-slot"],[id*="ad-container"],
[class*="adv-banner"],[class*="advertisement"],[class*="sponsored"],
[class*="advert"],[id*="advert"],[class*="adsbygoogle"],
[data-ad-slot],[data-ad-client],[data-ad-format],
amp-ad,.amp-ad,.ads-ad,.ad-text,.ad-display,.ad-thumb,
.googletag,.dfp-ad,.dfp-tag-wrapper,.ad-iframe,.ad-frame,
.mantis-ad,.taboola-ad,[class*="taboola"],[id*="taboola"],
.outbrain-ad,[class*="outbrain"],[id*="outbrain"],
[data-ad-layout],[data-ad-status]
{display:none!important}
`.replace(/\s+/g, " ").trim();

const LEGACY_BUILTIN_COSMETIC_NUKE = `
iframe[src*="doubleclick"],iframe[src*="googleadservices"],
iframe[src*="googlesyndication"],img[src*="doubleclick"],
img[src*="googleadservices"],img[src*="ads"],
img[src*="adservice"]
{display:none!important;width:0!important;height:0!important}
`.replace(/\s+/g, " ").trim();

const LEGACY_BUILTIN_COSMETIC_CSS = `${LEGACY_BUILTIN_COSMETIC_HIDE} ${LEGACY_BUILTIN_COSMETIC_NUKE}`.trim();
const BUILTIN_COSMETIC_CSS = "";

// ---------------------------------------------------------------------------
// Popup state model
// ---------------------------------------------------------------------------

// In-memory session stores (lost on SW restart)
const sessionNetFiltering = new Map(); // hostname → boolean
const sessionPageNetFiltering = new Map(); // tabId → { hostname, pageURL, state }
const sessionHostnameSwitches = new Map(); // hostname → { noPopups, noLargeMedia, noCosmeticFiltering, noRemoteFonts, noScripting, noCSPReports }
const sessionFirewall = new DynamicFirewallRules();
const permanentFirewall = new DynamicFirewallRules();
const tabContentRevision = new Map(); // tabId → number
const tabUnprocessedRequest = new Set(); // tabId set
let dnrSyncCompleted = false; // set true once initial DNR rules are installed
const tabHostnames = new Map(); // tabId → Set<hostname>

// Storage key constants
const STORAGE_KEY_PERM_NET_FILTERING = "ubrPermanentNetFiltering";
const STORAGE_KEY_PERM_HOSTNAME_SWITCHES = "ubrPermanentHostnameSwitches";
const STORAGE_KEY_PERM_FIREWALL_RULES = "ubrPermanentFirewallRules";
const STORAGE_KEY_POPUP_SETTINGS = POPUP_SETTINGS_STORAGE_KEY;
const STORAGE_KEY_DYNAMIC_FILTERING_STRING = "dynamicFilteringString";
const STORAGE_KEY_SESSION_FIREWALL_STRING = "ubrSessionFirewallRulesString";
const STORAGE_KEY_TAB_STATS = "ubrTabStats";
const STORAGE_KEY_HOSTNAME_STATS = "ubrHostnameStats";
const STORAGE_KEY_FILTER_CACHE = "ubrFilterListCache";
const STORAGE_KEY_COMPILED_COUNTS = "ubrCompiledFilterCounts";
const STORAGE_KEY_GLOBAL_ALLOWED_REQUEST_COUNT =
    "globalAllowedRequestCount";
const STORAGE_KEY_GLOBAL_BLOCKED_REQUEST_COUNT =
    "globalBlockedRequestCount";
const STORAGE_KEY_SESSION_PAGE_NET_FILTERING = "ubrSessionPageNetFiltering";
const STORAGE_KEY_SESSION_HOSTNAME_SWITCHES = "ubrSessionHostnameSwitches";

const lifetimeRequestCounts = {
    allowed: 0,
    blocked: 0,
};

let lifetimeCountsLoaded = false;
let lifetimeCountsLoadPromise = null;
let lifetimeCountsPersistTimer = 0;

// Cache of permanent state loaded from storage
let permanentNetFiltering = {};
let permanentHostnameSwitches = {};
let permanentFirewallRules = {};
let popupSettings = {};
let permanentStateLoaded = false;
let permanentStateLoadPromise = null;

// Managed enterprise policy cache (chrome.storage.managed)
let managedPolicy = {};

// Idle state tracking
let idleDetectionActive = false;

// Whitelist (trusted site) directive cache
let whitelistTestFns = [];
let managedWhitelistFns = [];
let whitelistReadyPromise = null;

function ensureWhitelistReady() {
    if (whitelistReadyPromise === null) {
        whitelistReadyPromise = reloadWhitelist()
            .catch(error => {
                whitelistReadyPromise = null;
                throw error;
            });
    }
    return whitelistReadyPromise;
}

async function reloadWhitelistAuthoritatively() {
    whitelistReadyPromise = reloadWhitelist()
        .catch(error => {
            whitelistReadyPromise = null;
            throw error;
        });
    return whitelistReadyPromise;
}

function compileWhitelistDirective(directive) {
    const d = directive.trim();
    if (!d || /^\s*#/.test(d)) return null;
    if (d.startsWith('/') && d.endsWith('/') && d.length > 2) {
        try { const re = new RegExp(d.slice(1, -1)); return u => re.test(u); } catch (e) { console.warn("[uBlock Ultimate] compileWhitelistDirective: invalid regex", d, e); return null; }
    }
    if (d.endsWith('-scheme')) {
        const s = d.slice(0, -7);
        return u => u.startsWith(`${s  }:`);
    }
    const pos = d.indexOf('/');
    if (pos === -1) {
        return u => {
            const hn = hostnameFromURL(u);
            return hn === d || hn.endsWith(`.${  d}`);
        };
    }
    const hostname = d.slice(0, pos);
    const path = d.slice(pos);
    return u => {
        const hn = hostnameFromURL(u);
        if (hn !== hostname && !hn.endsWith(`.${  hostname}`)) return false;
        const hostnameStart = u.indexOf(hn);
        if (hostnameStart === -1) return false;
        const urlPath = u.slice(hostnameStart + hn.length);
        return urlPath.startsWith(path);
    };
}

function isURLTrusted(url) {
    if (!url) return false;
    for (const fn of whitelistTestFns) {
        if (fn(url)) return true;
    }
    return false;
}

const WHITELIST_DNR_RULE_BASE = 300000;
const TRUSTED_SITE_ALLOW_PRIORITY = 2_700_000;
const URL_FILTERING_SESSION_RULE_MIN = 9_400_000;
const URL_FILTERING_SESSION_RULE_MAX = 9_449_999;
const URL_FILTERING_DYNAMIC_RULE_MIN = 9_450_000;
const URL_FILTERING_DYNAMIC_RULE_MAX = 9_499_999;
const URL_FILTERING_SESSION_PRIORITY = 2_350_000;
const URL_FILTERING_DYNAMIC_PRIORITY = 2_300_000;
const CSP_POLICY_RULE_MIN = 8_950_000;
const CSP_POLICY_RULE_MAX = 8_950_999;
const CSP_POLICY_BLOCK_RULE_ID = CSP_POLICY_RULE_MIN;
const NET_FILTERING_SESSION_RULE_MIN = 9_100_000;
const NET_FILTERING_SESSION_RULE_MAX = 9_149_999;
const NET_FILTERING_DYNAMIC_RULE_MIN = 9_150_000;
const NET_FILTERING_DYNAMIC_RULE_MAX = 9_199_999;
const POWER_SWITCH_ALLOW_PRIORITY = 2_600_000;
const HOSTNAME_SWITCH_RULE_MIN = 9_200_000;
const HOSTNAME_SWITCH_RULE_MAX = 9_249_999;
const HOSTNAME_SWITCH_PRIORITY = 2_500_000;

async function installWhitelistAllowRules(directives) {
    const allowRules = [];
    let id = WHITELIST_DNR_RULE_BASE;
    for (const line of directives) {
        const d = line.trim();
        if (!d || /^\s*#/.test(d)) continue;
        if (d.startsWith('/') && d.endsWith('/') && d.length > 2) {
            try { new RegExp(d.slice(1, -1)); } catch (e) { console.warn("[uBlock Ultimate] installWhitelistAllowRules: invalid regex", d, e); continue; }
            allowRules.push({
                id: id++,
                priority: TRUSTED_SITE_ALLOW_PRIORITY,
                action: { type: "allow" },
                condition: {
                    regexFilter: d.slice(1, -1),
                    resourceTypes: ["main_frame"],
                },
            });
        } else if (d.endsWith('-scheme')) {
            continue;
        } else if (d.includes('/')) {
            // Path-scoped trust entries require tab-scoped session
            // allows derived from matched top-level URLs. Do not place
            // hostname/path strings into DNR domain fields.
            continue;
        } else {
            allowRules.push({
                id: id++,
                priority: TRUSTED_SITE_ALLOW_PRIORITY,
                action: { type: "allow" },
                condition: { initiatorDomains: [d] },
            });
            allowRules.push({
                id: id++,
                priority: TRUSTED_SITE_ALLOW_PRIORITY,
                action: { type: "allow" },
                condition: {
                    requestDomains: [d],
                    resourceTypes: ["main_frame"],
                },
            });
        }
    }
    const existing = await chrome.declarativeNetRequest.getSessionRules();
    const removeIds = existing.filter(r => r.id >= WHITELIST_DNR_RULE_BASE && r.id < WHITELIST_DNR_RULE_BASE + 10000).map(r => r.id);
    if (removeIds.length > 0) {
        await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: removeIds, addRules: [] });
    }
    if (allowRules.length > 0) {
        await chrome.declarativeNetRequest.updateSessionRules({ addRules: allowRules, removeRuleIds: [] });
    }
}

async function reloadWhitelist() {
    const data = await chrome.storage.local.get(["whitelist"]);
    const raw = Array.isArray(data.whitelist) ? data.whitelist : [];
    whitelistTestFns = [...raw.map(compileWhitelistDirective).filter(Boolean), ...managedWhitelistFns];
    await installWhitelistAllowRules(raw);
    scheduleCspReportPolicySync();
}

async function removeLegacyBuiltInCosmetics() {
    const tabs = await chrome.tabs.query({ url: ["http://*/*", "https://*/*"] });
    await Promise.all(tabs.map(tab => {
        if (tab.id === undefined) return Promise.resolve();
        return chrome.scripting.removeCSS({
            target: { tabId: tab.id },
            css: LEGACY_BUILTIN_COSMETIC_CSS,
        }).catch(err => { console.warn("[uBlock Ultimate] Failed to remove legacy cosmetics:", err); });
    }));
}

async function reconcileTrustedTabCosmetics() {
    const tabs = await chrome.tabs.query({ url: ["http://*/*", "https://*/*"] });
    for (const tab of tabs) {
        if (tab.id === undefined || !tab.url) continue;
        if (isURLTrusted(tab.url)) {
            void chrome.scripting.removeCSS({
                target: { tabId: tab.id },
                css: LEGACY_BUILTIN_COSMETIC_CSS,
            }).catch(err => { console.warn("[uBlock Ultimate] Failed to remove trusted tab cosmetics:", err); });
            markTabChanged(tab.id);
        }
    }
}

// Initialize from storage
async function hydratePopupSettingsFromStorage(preloaded = null) {
    try {
        const storage = preloaded || await chrome.storage.local.get(popupSettingsStorageKeys());
        const merged = mergePopupSettings(userSettingsDefault, storage);
        popupSettings = merged.settings;
        if (merged.migrated) {
            await chrome.storage.local.set(popupSettingsToStorage(popupSettings));
        }
    } catch (err) {
        console.warn("[uBlock Ultimate] hydratePopupSettingsFromStorage failed:", err);
        popupSettings = { ...userSettingsDefault, ...popupSettings };
    }
}

async function loadPermanentState() {
    try {
        const result = await chrome.storage.local.get([
      STORAGE_KEY_PERM_NET_FILTERING,
      STORAGE_KEY_PERM_HOSTNAME_SWITCHES,
      STORAGE_KEY_PERM_FIREWALL_RULES,
      STORAGE_KEY_POPUP_SETTINGS,
      STORAGE_KEY_DYNAMIC_FILTERING_STRING,
      STORAGE_KEY_URL_FILTERING,
      ...popupSettingsStorageKeys(),
        ]);
        permanentNetFiltering = result[STORAGE_KEY_PERM_NET_FILTERING] || {};
        permanentHostnameSwitches = result[STORAGE_KEY_PERM_HOSTNAME_SWITCHES] || {};
        permanentFirewall.reset();
        if (typeof result[STORAGE_KEY_DYNAMIC_FILTERING_STRING] === "string") {
            permanentFirewall.fromString(result[STORAGE_KEY_DYNAMIC_FILTERING_STRING]);
        }
        permanentFirewall.fromObject(result[STORAGE_KEY_PERM_FIREWALL_RULES] || {}, true);
        permanentFirewallRules = permanentFirewall.toObject({ numeric: true });
        try {
            const sessionResult = chrome.storage?.session
                ? await chrome.storage.session.get([
                    STORAGE_KEY_SESSION_FIREWALL_STRING,
                    STORAGE_KEY_SESSION_URL_FILTERING,
                    STORAGE_KEY_SESSION_HOSTNAME_SWITCHES,
                ])
                : {};
            const sessionString = sessionResult[STORAGE_KEY_SESSION_FIREWALL_STRING];
            if (typeof sessionString === "string" && sessionString.trim() !== "") {
                sessionFirewall.fromString(sessionString);
            } else {
                sessionFirewall.assign(permanentFirewall);
            }
            sessionURLFilteringRules.clear();
            const sessionURLRules =
                sessionResult[STORAGE_KEY_SESSION_URL_FILTERING];
            if (
                sessionURLRules &&
                typeof sessionURLRules === "object" &&
                Array.isArray(sessionURLRules) === false
            ) {
                for (const [key, value] of Object.entries(sessionURLRules)) {
                    sessionURLFilteringRules.set(key, String(value));
                }
            }
            restoreSessionHostnameSwitches(
                sessionResult[STORAGE_KEY_SESSION_HOSTNAME_SWITCHES]
            );
        } catch (err) {
            console.warn("[uBlock Ultimate] load session state failed:", err);
            sessionFirewall.assign(permanentFirewall);
            sessionURLFilteringRules.clear();
            sessionHostnameSwitches.clear();
        }
        await hydratePopupSettingsFromStorage(result);
        let hostnameSwitchMigrationNeeded = false;

        if (
            typeof permanentHostnameSwitches !== "object" ||
            permanentHostnameSwitches === null
        ) {
            permanentHostnameSwitches = {};
            hostnameSwitchMigrationNeeded = true;
        }

        if (
            typeof permanentHostnameSwitches["*"] !== "object" ||
            permanentHostnameSwitches["*"] === null
        ) {
            permanentHostnameSwitches["*"] = {};
            hostnameSwitchMigrationNeeded = true;
        }

        const GLOBAL_SWITCH_NAMES = ["noCosmeticFiltering", "noLargeMedia", "noRemoteFonts", "noScripting", "noCSPReports"];

        for (const name of GLOBAL_SWITCH_NAMES) {
            if (permanentHostnameSwitches["*"][name] === undefined) {
                permanentHostnameSwitches["*"][name] = popupSettings[name] === true;
                hostnameSwitchMigrationNeeded = true;
            }
        }

        if (hostnameSwitchMigrationNeeded) {
            await chrome.storage.local.set({
                [STORAGE_KEY_PERM_HOSTNAME_SWITCHES]:
                    permanentHostnameSwitches,
            });
        }
        permanentURLFilteringRules = result[STORAGE_KEY_URL_FILTERING] || {};
        permanentStateLoaded = true;
    } catch (err) {
        console.warn("[uBlock Ultimate] loadPermanentState failed:", err);
        throw err;
    }
}

async function ensurePermanentStateLoaded() {
    if (permanentStateLoaded) return;
    if (permanentStateLoadPromise === null) {
        permanentStateLoadPromise = loadPermanentState()
            .catch(error => {
                permanentStateLoaded = false;
                throw error;
            })
            .finally(() => {
                if (!permanentStateLoaded) {
                    permanentStateLoadPromise = null;
                }
            });
    }
    await permanentStateLoadPromise;
}

async function persistPermanentFirewallState() {
    permanentFirewallRules = permanentFirewall.toObject({ numeric: true });
    await chrome.storage.local.set({
        [STORAGE_KEY_PERM_FIREWALL_RULES]: permanentFirewallRules,
        [STORAGE_KEY_DYNAMIC_FILTERING_STRING]: permanentFirewall.toString(),
    });
}

async function persistSessionFirewallState() {
    if (!chrome.storage?.session) return;
    await chrome.storage.session.set({
        [STORAGE_KEY_SESSION_FIREWALL_STRING]: sessionFirewall.toString(),
    });
}

function tabScopedFirewallSources(firewall) {
    const out = new Set();
    for (const line of firewall.toArray({ numeric: true })) {
        const [src] = line.split(/\s+/);
        if (src && src !== "*" && isDnrInitiatorDomain(src) === false) {
            out.add(src);
        }
    }
    return out;
}

async function compileTabScopedFirewallRules(firewall, baseId) {
    const sources = tabScopedFirewallSources(firewall);
    if (sources.size === 0) return [];
    const tabs = await chrome.tabs.query({ url: ["http://*/*", "https://*/*"] }).catch(err => {
        console.warn("[uBlock Ultimate] compileTabScopedFirewallRules tabs.query failed:", err);
        return [];
    });
    const addRules = [];
    let nextId = baseId;
    for (const tab of tabs) {
        if (typeof tab.id !== "number" || !tab.url) continue;
        const sourceHostname = hostnameFromURL(tab.url);
        if (sources.has(sourceHostname) === false) continue;
        const rules = compileFirewallRulesToDnr(firewall, {
            baseId: nextId,
            sourceHostname,
            tabId: tab.id,
        });
        addRules.push(...rules);
        nextId += rules.length;
    }
    return addRules;
}

async function syncFirewallDnrRules() {
    await ensurePermanentStateLoaded();
    if (!chrome.declarativeNetRequest) return;
    const sessionDiffers = sessionFirewall.toString() !== permanentFirewall.toString();
    const permanentRules = sessionDiffers ? [] : compileFirewallRulesToDnr(permanentFirewall);
    const existingDynamic = await chrome.declarativeNetRequest.getDynamicRules();
    await chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: firewallRuleIdsInRange(existingDynamic),
        addRules: permanentRules,
    });

    if (typeof chrome.declarativeNetRequest.getSessionRules !== "function") return;
    const existingSession = await chrome.declarativeNetRequest.getSessionRules();
    const sessionRules = sessionDiffers ? compileFirewallRulesToDnr(sessionFirewall) : [];
    const tabScopedRules = await compileTabScopedFirewallRules(
        sessionFirewall,
        9_000_000 + sessionRules.length,
    );
    await chrome.declarativeNetRequest.updateSessionRules({
        removeRuleIds: firewallRuleIdsInRange(existingSession),
        addRules: [...sessionRules, ...tabScopedRules],
    });
}

const ALL_RESOURCE_TYPES = ["main_frame", "sub_frame", "stylesheet", "script", "image", "font", "media", "object", "xmlhttprequest", "ping", "websocket", "other"];
const SUBRESOURCE_TYPES = ALL_RESOURCE_TYPES.filter(t => t !== "main_frame");

function makeNetFilterAllowRules(hostname) {
    return [
        {
            action: { type: "allow" },
            condition: {
                initiatorDomains: [hostname],
                resourceTypes: SUBRESOURCE_TYPES,
            },
        },
        {
            action: { type: "allow" },
            condition: {
                requestDomains: [hostname],
                resourceTypes: ["main_frame"],
            },
        },
    ];
}

async function syncNetFilteringDnrRules() {
    if (!chrome.declarativeNetRequest) return;
    if (typeof chrome.declarativeNetRequest.getSessionRules !== "function") return;
    await ensurePermanentStateLoaded();
    const allowRules = [];
    let nextId = NET_FILTERING_SESSION_RULE_MIN;

    // Collect per-hostname sets of tab IDs that have page-scoped ON overrides
    const hostnameExcludedTabs = new Map();
    for (const [tabId, entry] of sessionPageNetFiltering) {
        if (entry.state !== true) continue;
        let set = hostnameExcludedTabs.get(entry.hostname);
        if (!set) {
            set = new Set();
            hostnameExcludedTabs.set(entry.hostname, set);
        }
        set.add(tabId);
    }

    // Permanent site-level OFF (persisted, rebuilt on startup)
    for (const [hostname, state] of Object.entries(permanentNetFiltering)) {
        if (state !== false || !hostname) continue;
        const excludedTabIds = hostnameExcludedTabs.get(hostname);
        for (const base of makeNetFilterAllowRules(hostname)) {
            const rule = { ...base, id: nextId++, priority: POWER_SWITCH_ALLOW_PRIORITY };
            if (excludedTabIds && excludedTabIds.size > 0) {
                rule.condition.excludedTabIds = [...excludedTabIds];
            }
            allowRules.push(rule);
        }
    }

    // Session site-level OFF (not covered by permanent)
    for (const [hostname, state] of sessionNetFiltering) {
        if (state !== false) continue;
        if (permanentNetFiltering[hostname] === false) continue;
        for (const base of makeNetFilterAllowRules(hostname)) {
            allowRules.push({ ...base, id: nextId++, priority: POWER_SWITCH_ALLOW_PRIORITY });
        }
    }

    // Page-scoped OFF
    for (const [tabId, entry] of sessionPageNetFiltering) {
        if (entry.state !== false) continue;
        for (const base of makeNetFilterAllowRules(entry.hostname)) {
            allowRules.push({
                ...base,
                id: nextId++,
                priority: POWER_SWITCH_ALLOW_PRIORITY,
                condition: { ...base.condition, tabIds: [tabId] },
            });
        }
    }

    // Clean up stale dynamic rules from prior versions
    const existingDynamic = await chrome.declarativeNetRequest.getDynamicRules();
    const staleDynamic = existingDynamic
        .filter(r => r.id >= NET_FILTERING_DYNAMIC_RULE_MIN && r.id <= NET_FILTERING_DYNAMIC_RULE_MAX)
        .map(r => r.id);
    if (staleDynamic.length > 0) {
        await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: staleDynamic });
    }

    const existingSession = await chrome.declarativeNetRequest.getSessionRules();
    const removeSession = existingSession
        .filter(r => r.id >= NET_FILTERING_SESSION_RULE_MIN && r.id <= NET_FILTERING_SESSION_RULE_MAX)
        .map(r => r.id);

    if (removeSession.length > 0 || allowRules.length > 0) {
        await chrome.declarativeNetRequest.updateSessionRules({
            removeRuleIds: removeSession,
            addRules: allowRules,
        });
    }
}

function isURLFilteringSessionRule(rule) {
    return rule.id >= URL_FILTERING_SESSION_RULE_MIN &&
           rule.id <= URL_FILTERING_SESSION_RULE_MAX;
}

function isURLFilteringDynamicRule(rule) {
    return rule.id >= URL_FILTERING_DYNAMIC_RULE_MIN &&
           rule.id <= URL_FILTERING_DYNAMIC_RULE_MAX;
}

function urlFilteringRulesObjectFromSession() {
    return Object.fromEntries(sessionURLFilteringRules);
}

async function persistSessionURLFilteringRules() {
    if (!chrome.storage?.session) return;
    await chrome.storage.session.set({
        [STORAGE_KEY_SESSION_URL_FILTERING]:
            urlFilteringRulesObjectFromSession(),
    });
}

function serializePageNetFiltering() {
    const obj = {};
    for (const [tabId, entry] of sessionPageNetFiltering) {
        obj[String(tabId)] = entry;
    }
    return obj;
}

let pageNetFilteringPersistTail = Promise.resolve();
let hostnameSwitchPersistTail = Promise.resolve();

function persistSessionPageNetFiltering() {
    if (!chrome.storage?.session) return Promise.resolve();
    const snapshot = serializePageNetFiltering();
    pageNetFilteringPersistTail = pageNetFilteringPersistTail
        .catch(error => {
            console.warn("[uBlock Ultimate] previous page net-filtering persistence failed:", error);
        })
        .then(() => chrome.storage.session.set({
            [STORAGE_KEY_SESSION_PAGE_NET_FILTERING]: snapshot,
        }));
    return pageNetFilteringPersistTail;
}

async function restoreSessionPageNetFiltering() {
    if (!chrome.storage?.session) return;
    try {
        const result = await chrome.storage.session.get(STORAGE_KEY_SESSION_PAGE_NET_FILTERING);
        const raw = result[STORAGE_KEY_SESSION_PAGE_NET_FILTERING];
        let changed = false;
        if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
            await chrome.storage.session.set({
                [STORAGE_KEY_SESSION_PAGE_NET_FILTERING]: {},
            });
            return;
        }
        if (raw && typeof raw === "object") {
            sessionPageNetFiltering.clear();
            for (const [key, entry] of Object.entries(raw)) {
                const tabId = Number(key);
                if (!Number.isInteger(tabId) || tabId < 0 || typeof entry !== "object" || entry === null || !entry.hostname || typeof entry.state !== "boolean") { changed = true; continue; }
                if (typeof entry.pageURL !== "string" || entry.pageURL === "") { changed = true; continue; }
                try {
                    const parsed = new URL(entry.pageURL);
                    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") { changed = true; continue; }
                    if (parsed.hostname !== entry.hostname) { changed = true; continue; }
                } catch {
                    changed = true;
                    continue;
                }
                // Validate entry against live tab URL
                const tab = await chrome.tabs.get(tabId).catch(() => null);
                if (!tab?.url || normalizeURL(tab.url) !== normalizeURL(entry.pageURL)) {
                    changed = true;
                    continue;
                }
                sessionPageNetFiltering.set(tabId, {
                    hostname: entry.hostname,
                    pageURL: normalizeURL(entry.pageURL),
                    state: entry.state,
                });
            }
            if (changed) {
                await persistSessionPageNetFiltering();
            }
        }
    } catch (err) {
        console.warn("[uBlock Ultimate] restoreSessionPageNetFiltering failed:", err);
    }
}

function serializeSessionHostnameSwitches() {
    const output = {};
    for (const [hostname, switches] of sessionHostnameSwitches) {
        output[hostname] = { ...switches };
    }
    return output;
}

function restoreSessionHostnameSwitches(value) {
    sessionHostnameSwitches.clear();
    if (value === null || typeof value !== "object" || Array.isArray(value)) return;
    for (const [hostname, switches] of Object.entries(value)) {
        if (hostname === "" || switches === null || typeof switches !== "object" || Array.isArray(switches)) continue;
        sessionHostnameSwitches.set(hostname, { ...switches });
    }
}

async function persistSessionHostnameSwitches() {
    if (!chrome.storage?.session) return;
    hostnameSwitchPersistTail = hostnameSwitchPersistTail
        .catch(error => {
            console.warn("[uBlock Ultimate] previous hostname-switch persistence failed:", error);
        })
        .then(() => chrome.storage.session.set({
            [STORAGE_KEY_SESSION_HOSTNAME_SWITCHES]: serializeSessionHostnameSwitches(),
        }));
    return hostnameSwitchPersistTail;
}

function resourceTypeForURLFilteringType(type) {
    switch (type) {
    case "doc":
    case "document":
    case "main_frame":
        return "main_frame";
    case "css":
    case "stylesheet":
        return "stylesheet";
    case "frame":
    case "subdocument":
    case "sub_frame":
        return "sub_frame";
    case "xhr":
    case "xmlhttprequest":
        return "xmlhttprequest";
    case "beacon":
    case "ping":
        return "ping";
    case "image":
    case "script":
    case "font":
    case "media":
    case "object":
    case "websocket":
    case "csp_report":
    case "other":
        return type;
    default:
        return "";
    }
}

function isHostnameOnlyDnrDomain(value) {
    const hostname = String(value || "").trim().toLowerCase();
    return /^[a-z0-9.-]+$/i.test(hostname) &&
        hostname.includes(".") &&
        hostname.startsWith(".") === false &&
        hostname.endsWith(".") === false;
}

function urlFilterForURLFilteringTarget(target) {
    const value = String(target || "").trim();
    if (value === "") return null;
    if (value.startsWith("/") && value.endsWith("/") && value.length > 2) {
        return { regexFilter: value.slice(1, -1) };
    }
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) {
        return { urlFilter: `|${value}` };
    }
    if (/^[a-z0-9._-]+$/i.test(value)) {
        return { urlFilter: `||${value}^` };
    }
    return { urlFilter: value };
}

function parseURLFilteringRuleKey(key) {
    const text = String(key || "").trim();
    const first = text.indexOf(" ");
    const last = text.lastIndexOf(" ");
    if (first <= 0 || last <= first) return null;
    return {
        context: text.slice(0, first),
        url: text.slice(first + 1, last),
        type: text.slice(last + 1),
    };
}

function compileURLFilteringRulesToDnr(ruleEntries, {
    baseId,
    basePriority,
    maxId,
} = {}) {
    const addRules = [];
    let nextId = baseId;

    for (const [key, rawAction] of ruleEntries) {
        if (nextId > maxId) break;
        const parsed = parseURLFilteringRuleKey(key);
        if (parsed === null) continue;

        const action = Number(rawAction) || 0;
        if (action !== 1 && action !== 2) {
            // uBO noop is not a broad allow. It only cancels broader URL
            // filtering decisions, so do not compile it as a DNR allow.
            continue;
        }

        const urlCondition = urlFilterForURLFilteringTarget(parsed.url);
        if (urlCondition === null) continue;

        const condition = { ...urlCondition };
        const resourceType = resourceTypeForURLFilteringType(parsed.type);
        if (resourceType !== "" && parsed.type !== "*") {
            condition.resourceTypes = [resourceType];
        }

        if (
            parsed.context !== "*" &&
            parsed.context !== "" &&
            isHostnameOnlyDnrDomain(parsed.context) &&
            isDnrInitiatorDomain(parsed.context)
        ) {
            condition.initiatorDomains = [parsed.context];
        }

        const actionName = ACTION_NUM_TO_WORD[action] || String(action);
        const priority = basePriority +
            (parsed.context !== "*" ? 100 : 0) +
            (parsed.type !== "*" ? 25 : 0);

        const rule = {
            id: nextId++,
            priority,
            action: {
                type: action === 2 ? "allow" : "block",
            },
            condition,
        };

        addRules.push(rule);
        urlFilteringDnrRuleMetadata.set(rule.id, {
            rawFilter: `${parsed.context} ${parsed.url} ${parsed.type} ${actionName}`,
            assetKey: "dynamic-url-filtering",
            title: "Dynamic URL filtering",
            supportURL: "",
            sourceList: "dynamic-url-filtering",
            sourceLine: undefined,
            rulesetId: "_dynamic",
            ruleId: rule.id,
            source: "dynamicUrl",
            rule: [
                parsed.context,
                parsed.url,
                parsed.type,
                actionName,
            ],
        });
    }

    return addRules;
}

async function syncURLFilteringDnrRules() {
    if (!chrome.declarativeNetRequest) return;
    await ensurePermanentStateLoaded();

    urlFilteringDnrRuleMetadata.clear();

    const permanentEntries = Object.entries(permanentURLFilteringRules);
    const dynamicRules = compileURLFilteringRulesToDnr(permanentEntries, {
        baseId: URL_FILTERING_DYNAMIC_RULE_MIN,
        basePriority: URL_FILTERING_DYNAMIC_PRIORITY,
        maxId: URL_FILTERING_DYNAMIC_RULE_MAX,
    });
    const existingDynamic =
        await chrome.declarativeNetRequest.getDynamicRules();
    await chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: existingDynamic
            .filter(isURLFilteringDynamicRule)
            .map(rule => rule.id),
        addRules: dynamicRules,
    });

    if (typeof chrome.declarativeNetRequest.getSessionRules !== "function") {
        return;
    }

    const sessionRules = compileURLFilteringRulesToDnr(
        [...sessionURLFilteringRules],
        {
            baseId: URL_FILTERING_SESSION_RULE_MIN,
            basePriority: URL_FILTERING_SESSION_PRIORITY,
            maxId: URL_FILTERING_SESSION_RULE_MAX,
        },
    );
    const existingSession =
        await chrome.declarativeNetRequest.getSessionRules();
    await chrome.declarativeNetRequest.updateSessionRules({
        removeRuleIds: existingSession
            .filter(isURLFilteringSessionRule)
            .map(rule => rule.id),
        addRules: sessionRules,
    });
}

function isCspPolicyRule(rule) {
    return rule.id >= CSP_POLICY_RULE_MIN &&
           rule.id <= CSP_POLICY_RULE_MAX;
}

async function computeCspReportExcludedTabs() {
    const tabs = await chrome.tabs.query({});
    const excludedTabIds = [];

    for (const tab of tabs) {
        if (typeof tab.id !== "number") continue;

        const url = typeof tab.url === "string"
            ? tab.url
            : "";

        const hostname = hostnameFromURL(url);

        if (hostname === "") {
            continue;
        }

        const filteringEnabled =
            getEffectiveNetFiltering(hostname, undefined, tab.id) === true &&
            isURLTrusted(url) === false;

        const cspBlockingEnabled =
            getEffectiveHostnameSwitch(
                hostname,
                "noCSPReports"
            ) === true;

        if (!filteringEnabled || !cspBlockingEnabled) {
            excludedTabIds.push(tab.id);
        }
    }

    return excludedTabIds;
}

async function syncCspReportPolicyRules() {
    if (
        !chrome.declarativeNetRequest ||
        typeof chrome.declarativeNetRequest
            .getSessionRules !== "function"
    ) {
        return;
    }

    await ensurePermanentStateLoaded();

    const existing =
        await chrome.declarativeNetRequest.getSessionRules();

    const removeRuleIds = existing
        .filter(isCspPolicyRule)
        .map(rule => rule.id);

    const globallyEnabled =
        getEffectiveHostnameSwitch("*", "noCSPReports");

    if (!globallyEnabled) {
        await chrome.declarativeNetRequest.updateSessionRules({
            removeRuleIds,
            addRules: [],
        });
        return;
    }

    const excludedTabIds =
        await computeCspReportExcludedTabs();

    const condition = {
        resourceTypes: ["csp_report"],
    };

    if (excludedTabIds.length !== 0) {
        condition.excludedTabIds = excludedTabIds;
    }

    await chrome.declarativeNetRequest.updateSessionRules({
        removeRuleIds,
        addRules: [
            {
                id: CSP_POLICY_BLOCK_RULE_ID,
                priority: 400100,
                action: {
                    type: "block",
                },
                condition,
            },
        ],
    });
}

let cspPolicySyncTimer = 0;

function scheduleCspReportPolicySync() {
    if (cspPolicySyncTimer !== 0) {
        clearTimeout(cspPolicySyncTimer);
    }

    cspPolicySyncTimer = setTimeout(() => {
        cspPolicySyncTimer = 0;

        syncCspReportPolicyRules().catch(error => {
            console.warn(
                "[uBlock Ultimate] CSP report policy synchronization failed:",
                error
            );
        });
    }, 50);
}
function isHostnameSwitchRule(rule) {
    return rule.id >= HOSTNAME_SWITCH_RULE_MIN && rule.id <= HOSTNAME_SWITCH_RULE_MAX;
}

const MAX_SESSION_RULES =
    Number.isInteger(chrome.declarativeNetRequest?.MAX_NUMBER_OF_SESSION_RULES)
        ? chrome.declarativeNetRequest.MAX_NUMBER_OF_SESSION_RULES
        : 5000;

/**
 * Allocate a unique DNR rule ID within the hostname-switch range,
 * avoiding any ID in @p usedIds.
 */
function allocateHostnameSwitchRuleId(usedIds) {
    for (let id = HOSTNAME_SWITCH_RULE_MIN; id <= HOSTNAME_SWITCH_RULE_MAX; id++) {
        if (usedIds.has(id)) continue;
        usedIds.add(id);
        return id;
    }
    throw new Error("No hostname-switch DNR rule IDs available");
}

/**
 * Build per-tab hostname-switch DNR rules for every open HTTP(S) tab.
 * Also emits domain-scoped requestDomains rules for noScripting CSP so
 * that the CSP header can match before a tab-scoped rule is installed.
 */
async function compileHostnameSwitchDnrRules() {
    const rules = [];
    const usedIds = new Set();

    const tabs = await chrome.tabs.query({ url: ["http://*/*", "https://*/*"] });

    for (const tab of tabs) {
        if (typeof tab.id !== "number" || typeof tab.url !== "string") continue;
        const hostname = hostnameFromURL(tab.url);
        if (!hostname || isURLTrusted(tab.url)) continue;
        if (getEffectiveNetFiltering(hostname, tab.url, tab.id) === false) continue;

        const switches = getEffectiveHostnameSwitches(hostname);

        if (switches.noLargeMedia === true) {
            try { rules.push({ id: allocateHostnameSwitchRuleId(usedIds), priority: HOSTNAME_SWITCH_PRIORITY, action: { type: "block" }, condition: { tabIds: [tab.id], resourceTypes: ["media"] } }); } catch (_) { break; }
        }

        if (switches.noRemoteFonts === true) {
            try { rules.push({ id: allocateHostnameSwitchRuleId(usedIds), priority: HOSTNAME_SWITCH_PRIORITY, action: { type: "block" }, condition: { tabIds: [tab.id], resourceTypes: ["font"] } }); } catch (_) { break; }
        }

        if (switches.noScripting === true) {
            try { rules.push({ id: allocateHostnameSwitchRuleId(usedIds), priority: HOSTNAME_SWITCH_PRIORITY, action: { type: "block" }, condition: { tabIds: [tab.id], resourceTypes: ["script"] } }); } catch (_) { break; }
            try { rules.push({ id: allocateHostnameSwitchRuleId(usedIds), priority: HOSTNAME_SWITCH_PRIORITY, action: { type: "modifyHeaders", responseHeaders: [{ header: "content-security-policy", operation: "append", value: "script-src 'none'; object-src 'none'" }] }, condition: { tabIds: [tab.id], resourceTypes: ["main_frame", "sub_frame"] } }); } catch (_) { break; }
        }
    }

    // Also emit domain-scoped requestDomains CSP rules for noScripting so that
    // the header is present before the first navigation to a hostname.
    // Read only own (non-inherited) noScripting properties to avoid treating
    // unrelated switch entries as explicit scripting rules.
    const noScriptState = new Map();
    const seen = new Set();
    for (const [hostname] of sessionHostnameSwitches) {
        if (seen.has(hostname)) continue;
        seen.add(hostname);
        const v = readExplicitNoScripting(hostname);
        if (v !== undefined) noScriptState.set(hostname, v);
    }
    for (const hostname of Object.keys(permanentHostnameSwitches)) {
        if (seen.has(hostname)) continue;
        seen.add(hostname);
        const v = readExplicitNoScripting(hostname);
        if (v !== undefined) noScriptState.set(hostname, v);
    }
    // Separate true hostnames (to emit rules for) from their false descendants (to exclude)
    const trueHostnames = [];
    const falseDescendants = new Map();
    for (const [hostname, v] of noScriptState) {
        if (v === true) trueHostnames.push(hostname);
    }
    for (const hostname of trueHostnames) {
        const excluded = [];
        for (const [candidate, cv] of noScriptState) {
            if (cv !== false) continue;
            if (candidate === hostname) continue;
            if (candidate.endsWith("." + hostname)) {
                excluded.push(candidate);
            }
        }
        if (excluded.length > 0) falseDescendants.set(hostname, excluded);
    }
    // Wildcard: if "*" has explicit noScripting=true, emit a global rule
    if (readExplicitNoScripting("*") === true) {
        const wildcardExcluded = [];
        for (const [hostname, v] of noScriptState) {
            if (v !== false) continue;
            if (hostname === "*") continue;
            wildcardExcluded.push(hostname);
        }
        try {
            const cond = { resourceTypes: ["main_frame"] };
            if (wildcardExcluded.length > 0) cond.excludedRequestDomains = wildcardExcluded;
            rules.push({
                id: allocateHostnameSwitchRuleId(usedIds),
                priority: HOSTNAME_SWITCH_PRIORITY,
                action: { type: "modifyHeaders", responseHeaders: [{ header: "content-security-policy", operation: "append", value: "script-src 'none'; object-src 'none'" }] },
                condition: cond,
            });
        } catch (_) {}
    }
    for (const hostname of trueHostnames) {
        if (hostname === "*") continue;
        try {
            const cond = { requestDomains: [hostname], resourceTypes: ["main_frame"] };
            const excluded = falseDescendants.get(hostname);
            if (excluded?.length > 0) cond.excludedRequestDomains = excluded;
            rules.push({
                id: allocateHostnameSwitchRuleId(usedIds),
                priority: HOSTNAME_SWITCH_PRIORITY,
                action: { type: "modifyHeaders", responseHeaders: [{ header: "content-security-policy", operation: "append", value: "script-src 'none'; object-src 'none'" }] },
                condition: cond,
            });
        } catch (_) { break; }
    }

    return rules;
}

/**
 * Shared queue for every hostname-switch DNR mutation.
 */
function enqueueHostnameSwitchDnrMutation(task) {
    hostnameSwitchSyncTail = hostnameSwitchSyncTail
        .catch(err => console.warn("[uBlock Ultimate] previous hostname-switch operation failed:", err))
        .then(task);
    return hostnameSwitchSyncTail;
}

/**
 * Unqueued implementation: compile and replace all hostname-switch DNR rules.
 * Callers already inside the DNR queue (applyRuleChanges, resetRules) must
 * call this directly to avoid deadlock.  External callers use the queued
 * wrapper syncHostnameSwitchDnrRules().
 */
async function syncHostnameSwitchDnrRulesUnqueued() {
    if (!chrome.declarativeNetRequest || typeof chrome.declarativeNetRequest.getSessionRules !== "function") return;
    await ensurePermanentStateLoaded();
    const existing = await chrome.declarativeNetRequest.getSessionRules();
    const nonHostnameCount = existing.filter(r => !isHostnameSwitchRule(r)).length;
    const available = Math.max(0, MAX_SESSION_RULES - nonHostnameCount);
    const removeRuleIds = existing.filter(isHostnameSwitchRule).map(r => r.id);
    const addRules = await compileHostnameSwitchDnrRules();
    if (addRules.length > available) {
        throw new Error("Hostname-switch DNR capacity exceeded: " + addRules.length + " required, " + available + " available");
    }
    await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds, addRules });
}

function syncHostnameSwitchDnrRules() {
    if (!chrome.declarativeNetRequest || typeof chrome.declarativeNetRequest.getSessionRules !== "function") return Promise.resolve();
    return enqueueHostnameSwitchDnrMutation(() => syncHostnameSwitchDnrRulesUnqueued());
}

/**
 * Replace the hostname-switch rules for a specific tab.
 *
 * Always removes old rules for the tab first (even when the destination
 * is trusted or powered-off), then installs new rules only when the
 * destination hostname has active switches.  Runs inside the shared
 * serialization queue.
 */
function replaceHostnameSwitchRulesForTab(tabId, url) {
    return enqueueHostnameSwitchDnrMutation(async () => {
        if (!chrome.declarativeNetRequest || typeof chrome.declarativeNetRequest.getSessionRules !== "function") return;
        await ensurePermanentStateLoaded();

        const existing = await chrome.declarativeNetRequest.getSessionRules();
        const tabRules = existing.filter(r => isHostnameSwitchRule(r) && r.condition?.tabIds?.includes(tabId));
        const removeRuleIds = tabRules.map(r => r.id);

        const hostname = hostnameFromURL(url || "");
        const shouldEnforce = hostname !== "" && !isURLTrusted(url || "") && getEffectiveNetFiltering(hostname, url, tabId) !== false;

        if (!shouldEnforce) {
            if (removeRuleIds.length > 0) {
                await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds, addRules: [] });
            }
            return;
        }

        const removeSet = new Set(removeRuleIds);
        const usedIds = new Set(existing.filter(r => !removeSet.has(r.id)).map(r => r.id));
        const makeId = () => allocateHostnameSwitchRuleId(usedIds);

        const switches = getEffectiveHostnameSwitches(hostname);
        const addRules = [];

        if (switches.noLargeMedia === true) { try { addRules.push({ id: makeId(), priority: HOSTNAME_SWITCH_PRIORITY, action: { type: "block" }, condition: { tabIds: [tabId], resourceTypes: ["media"] } }); } catch (_) {} }
        if (switches.noRemoteFonts === true) { try { addRules.push({ id: makeId(), priority: HOSTNAME_SWITCH_PRIORITY, action: { type: "block" }, condition: { tabIds: [tabId], resourceTypes: ["font"] } }); } catch (_) {} }
        if (switches.noScripting === true) {
            try { addRules.push({ id: makeId(), priority: HOSTNAME_SWITCH_PRIORITY, action: { type: "block" }, condition: { tabIds: [tabId], resourceTypes: ["script"] } }); } catch (_) {}
            try { addRules.push({ id: makeId(), priority: HOSTNAME_SWITCH_PRIORITY, action: { type: "modifyHeaders", responseHeaders: [{ header: "content-security-policy", operation: "append", value: "script-src 'none'; object-src 'none'" }] }, condition: { tabIds: [tabId], resourceTypes: ["main_frame", "sub_frame"] } }); } catch (_) {}
        }

        if (removeRuleIds.length > 0 || addRules.length > 0) {
            await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds, addRules });
        }
    });
}

let hostnameSwitchSyncTimer = 0;
let hostnameSwitchSyncTail = Promise.resolve();

function scheduleHostnameSwitchDnrSync() {
    if (hostnameSwitchSyncTimer !== 0) clearTimeout(hostnameSwitchSyncTimer);
    hostnameSwitchSyncTimer = setTimeout(() => {
        hostnameSwitchSyncTimer = 0;
        syncHostnameSwitchDnrRules().catch(error => {
            console.warn("[uBlock Ultimate] hostname switch DNR sync failed:", error);
        });
    }, 50);
}

/**
 * Serialize hostname-switch toggles per hostname so concurrent clicks on
 * different switches for the same hostname do not race.
 */
const hostnameMutationTails = new Map();

function enqueueHostnameMutation(hostname, task) {
    const previous = hostnameMutationTails.get(hostname) || Promise.resolve();
    const next = previous
        .catch(() => {})
        .then(task)
        .finally(() => {
            if (hostnameMutationTails.get(hostname) === next) {
                hostnameMutationTails.delete(hostname);
            }
        });
    hostnameMutationTails.set(hostname, next);
    return next;
}

// ---------------------------------------------------------------------------
// Global state-mutation queue
// Every filtering-state write (toggle, save, revert, reset, applyRuleChanges,
// changeUserSetting global switch, storage listener) goes through this single
// queue to prevent races between concurrent operations.
// ---------------------------------------------------------------------------
let stateMutationTail = Promise.resolve();
let insideStateQueue = false;
let permanentReloadPending = false;

function enqueueStateMutation(task) {
    stateMutationTail = stateMutationTail
        .catch(() => {})
        .then(async () => {
            insideStateQueue = true;
            try {
                return await task();
            } finally {
                insideStateQueue = false;
                // Process any deferred external changes that arrived while queue was active
                if (permanentReloadPending) {
                    permanentReloadPending = false;
                    permanentStateLoaded = false;
                    permanentStateLoadPromise = null;
                    try {
                        await ensurePermanentStateLoaded();
                        await syncFirewallDnrRules();
                        await syncNetFilteringDnrRules();
                        await syncHostnameSwitchDnrRules();
                        await syncURLFilteringDnrRules();
                        await syncCspReportPolicyRules();
                    } catch (e) {
                        console.warn("[uBlock Ultimate] deferred permanent state reload failed:", e);
                    }
                }
            }
        });
    return stateMutationTail;
}

// Deep-snapshot all filtering state for rollback
function snapshotFilteringState() {
    return {
        permanentHostnameSwitches: structuredClone(permanentHostnameSwitches),
        permanentNetFiltering: { ...permanentNetFiltering },
        permanentFirewallStr: permanentFirewall.toString(),
        permanentFirewallRules: permanentFirewallRules,
        permanentURLFilteringRules: { ...permanentURLFilteringRules },
        sessionHostnameSwitches: new Map(
            [...sessionHostnameSwitches].map(([k, v]) => [k, { ...v }])
        ),
        sessionNetFiltering: new Map(sessionNetFiltering),
        sessionPageNetFiltering: new Map(
            [...sessionPageNetFiltering].map(([k, v]) => [k, { ...v }])
        ),
        sessionFirewallStr: sessionFirewall.toString(),
        sessionURLFilteringRules: new Map(sessionURLFilteringRules),
    };
}

// Restore from snapshot: memory, storage, and DNR enforcement
async function restoreFilteringState(snapshot) {
    permanentHostnameSwitches = structuredClone(snapshot.permanentHostnameSwitches);
    permanentNetFiltering = { ...snapshot.permanentNetFiltering };
    permanentFirewall.fromString(snapshot.permanentFirewallStr);
    permanentFirewallRules = snapshot.permanentFirewallRules;
    permanentURLFilteringRules = { ...snapshot.permanentURLFilteringRules };

    sessionHostnameSwitches.clear();
    for (const [k, v] of snapshot.sessionHostnameSwitches) sessionHostnameSwitches.set(k, { ...v });
    sessionNetFiltering.clear();
    for (const [k, v] of snapshot.sessionNetFiltering) sessionNetFiltering.set(k, v);
    sessionPageNetFiltering.clear();
    for (const [k, v] of snapshot.sessionPageNetFiltering) sessionPageNetFiltering.set(k, { ...v });
    sessionFirewall.fromString(snapshot.sessionFirewallStr);
    sessionURLFilteringRules.clear();
    for (const [k, v] of snapshot.sessionURLFilteringRules) sessionURLFilteringRules.set(k, v);

    await Promise.all([
        chrome.storage.local.set({
            [STORAGE_KEY_PERM_HOSTNAME_SWITCHES]: permanentHostnameSwitches,
            [STORAGE_KEY_PERM_NET_FILTERING]: permanentNetFiltering,
            [STORAGE_KEY_PERM_FIREWALL_RULES]: permanentFirewallRules,
            [STORAGE_KEY_DYNAMIC_FILTERING_STRING]: permanentFirewall.toString(),
            [STORAGE_KEY_URL_FILTERING]: permanentURLFilteringRules,
        }),
        persistSessionHostnameSwitches(),
        persistSessionFirewallState(),
        persistSessionPageNetFiltering(),
        persistSessionURLFilteringRules(),
    ]);

    await Promise.all([
        syncFirewallDnrRules(),
        syncNetFilteringDnrRules(),
        syncHostnameSwitchDnrRules(),
        syncURLFilteringDnrRules(),
        syncCspReportPolicyRules(),
    ]);

    PolicySnapshot.invalidateAll({ reason: "filtering-state-restore" });
}

// Post-commit: invalidate policies and notify all tabs
async function postCommitFilteringChange(reason) {
    PolicySnapshot.invalidateAll({ reason: reason || "filtering-change" });
    // Notify all frames in each HTTP(S) tab of the policy change
    try {
        const tabs = await chrome.tabs.query({ url: ["http://*/*", "https://*/*"] });
        await Promise.allSettled(
            tabs.map(async tab => {
                const frames = await chrome.webNavigation.getAllFrames({ tabId: tab.id }).catch(() => null);
                if (!frames || frames.length === 0) {
                    return chrome.tabs.sendMessage(tab.id, {
                        topic: "uBlockPolicyRefresh",
                        payload: { reason: reason || "filtering-change" },
                    }).catch(() => {});
                }
                return Promise.allSettled(
                    frames.map(frame =>
                        chrome.tabs.sendMessage(tab.id, {
                            topic: "uBlockPolicyRefresh",
                            payload: { reason: reason || "filtering-change" },
                        }, { frameId: frame.frameId }).catch(() => {})
                    )
                );
            })
        );
    } catch (_) {}
    for (const tabId of tabContentRevision.keys()) {
        markTabChanged(tabId);
    }
}

ensureWhitelistReady();
try {
    chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName !== "local") return;
        if (isPopupSettingsStorageChange(changes)) {
            void hydratePopupSettingsFromStorage().then(() => {
                for (const tabId of tabContentRevision.keys()) markTabChanged(tabId);
                scheduleCspReportPolicySync();
            });
        }
        if (
            changes[STORAGE_KEY_GLOBAL_ALLOWED_REQUEST_COUNT] ||
            changes[STORAGE_KEY_GLOBAL_BLOCKED_REQUEST_COUNT]
        ) {
            const allowedChange = changes[STORAGE_KEY_GLOBAL_ALLOWED_REQUEST_COUNT];
            const blockedChange = changes[STORAGE_KEY_GLOBAL_BLOCKED_REQUEST_COUNT];

            if (allowedChange) {
                lifetimeRequestCounts.allowed = Math.max(
                    0,
                    Number(allowedChange.newValue) || 0,
                );
            }

            if (blockedChange) {
                lifetimeRequestCounts.blocked = Math.max(
                    0,
                    Number(blockedChange.newValue) || 0,
                );
            }

            lifetimeCountsLoaded = true;
            lifetimeCountsLoadPromise = null;

            for (const tabId of tabContentRevision.keys()) {
                markTabChanged(tabId);
            }
        }
        if (
            changes[STORAGE_KEY_PERM_FIREWALL_RULES] ||
            changes[STORAGE_KEY_DYNAMIC_FILTERING_STRING] ||
            changes[STORAGE_KEY_PERM_HOSTNAME_SWITCHES] ||
            changes[STORAGE_KEY_URL_FILTERING] ||
            changes[STORAGE_KEY_PERM_NET_FILTERING]
        ) {
            if (insideStateQueue) {
                permanentReloadPending = true;
                return;
            }
            permanentStateLoaded = false;
            permanentStateLoadPromise = null;

            enqueueStateMutation(async () => {
                await ensurePermanentStateLoaded();
                await syncFirewallDnrRules();
                await syncNetFilteringDnrRules();
                await syncHostnameSwitchDnrRules();
                await syncURLFilteringDnrRules();
                await syncCspReportPolicyRules();
            }).catch(err => {
                console.warn("[uBlock Ultimate] storage change firewall reload failed:", err);
            });
        }
    });
} catch (err) {
    console.warn("[uBlock Ultimate] storage.onChanged listener failed:", err);
}

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

let revisionCounter = 1;
function normalizeURL(url) {
    try {
        const parsed = new URL(url);
        parsed.hash = "";
        return parsed.href;
    } catch {
        return "";
    }
}

function markTabChanged(tabId) {
    if (typeof tabId === "number" && tabId > 0) {
    tabContentRevision.set(tabId, revisionCounter++);
    }
}

function getTabRevision(tabId) {
    return tabContentRevision.get(tabId) || 0;
}

async function validatePopupTarget(tabId, expectedHostname, expectedURL) {
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!tab?.url) {
        throw new Error("Target tab no longer exists");
    }
    const currentHostname = hostnameFromURL(tab.url);
    if (currentHostname !== expectedHostname) {
        throw new Error("The tab navigated while the popup was open");
    }
    if (expectedURL && normalizeURL(tab.url) !== normalizeURL(expectedURL)) {
        throw new Error("The page changed while the operation was queued");
    }
    return tab;
}

function getEffectiveNetFiltering(hostname, pageURL, tabId) {
    if (!hostname) return false;
    if (tabId && sessionPageNetFiltering.has(tabId)) {
        const entry = sessionPageNetFiltering.get(tabId);
        if (
            entry.hostname === hostname &&
            typeof entry.pageURL === "string" &&
            entry.pageURL !== "" &&
            typeof pageURL === "string" &&
            normalizeURL(entry.pageURL) === normalizeURL(pageURL)
        ) {
            return entry.state;
        }
    }
    if (sessionNetFiltering.has(hostname)) return sessionNetFiltering.get(hostname);
    if (permanentNetFiltering[hostname] !== undefined) return permanentNetFiltering[hostname];
    return true;
}

function readHostnameSwitchAt(hostname, name) {
    const session = sessionHostnameSwitches.get(hostname);
    if (session && session[name] !== undefined) {
        return session[name] === true;
    }

    const permanent = permanentHostnameSwitches[hostname];
    if (permanent && permanent[name] !== undefined) {
        return permanent[name] === true;
    }

    return undefined;
}

function readPermanentHostnameSwitchAt(hostname, name) {
    const permanent = permanentHostnameSwitches[hostname];
    if (permanent && permanent[name] !== undefined) {
        return permanent[name] === true;
    }
    return undefined;
}

function readExplicitNoScripting(hostname) {
    const session = sessionHostnameSwitches.get(hostname);
    if (session && Object.hasOwn(session, "noScripting")) {
        return session.noScripting === true;
    }
    const permanent = permanentHostnameSwitches[hostname];
    if (permanent && Object.hasOwn(permanent, "noScripting")) {
        return permanent.noScripting === true;
    }
    return undefined;
}

function parentHostname(hostname) {
    const dot = hostname.indexOf(".");
    return dot === -1 ? "" : hostname.slice(dot + 1);
}

function getEffectiveHostnameSwitch(hostname, name) {
    let current = hostname;

    while (current !== "") {
        const value = readHostnameSwitchAt(current, name);
        if (value !== undefined) {
            return value;
        }
        current = parentHostname(current);
    }

    const globalValue = readHostnameSwitchAt("*", name);
    if (globalValue !== undefined) {
        return globalValue;
    }

    if (name === "noCSPReports") {
        return popupSettings.noCSPReports === true;
    }

    return false;
}

function getEffectivePermanentHostnameSwitch(hostname, name) {
    let current = hostname;
    while (current !== "") {
        const value = readPermanentHostnameSwitchAt(current, name);
        if (value !== undefined) {
            return value;
        }
        current = parentHostname(current);
    }
    const globalValue = readPermanentHostnameSwitchAt("*", name);
    if (globalValue !== undefined) {
        return globalValue;
    }
    return false;
}

function getEffectiveHostnameSwitches(hostname) {
    if (!hostname) return {};
    return {
        noPopups: getEffectiveHostnameSwitch(hostname, "noPopups"),
        noLargeMedia: getEffectiveHostnameSwitch(hostname, "noLargeMedia"),
        noCosmeticFiltering: getEffectiveHostnameSwitch(hostname, "noCosmeticFiltering"),
        noRemoteFonts: getEffectiveHostnameSwitch(hostname, "noRemoteFonts"),
        noScripting: getEffectiveHostnameSwitch(hostname, "noScripting"),
        noCSPReports: getEffectiveHostnameSwitch(hostname, "noCSPReports"),
    };
}

function getEffectiveFirewallRule(key) {
    const parts = String(key || "").split(/\s+/);
    if (parts.length < 3) return undefined;
    return sessionFirewall.lookupRuleData(parts[0], parts[1], parts[2]);
}

function lookupRuleData(srcHostname, desHostname, type) {
    return sessionFirewall.lookupRuleData(srcHostname, desHostname, type);
}

function getEffectiveFirewallRules(pageHostname, hostnameDict) {
    return getFirewallRulesForPopup(sessionFirewall, pageHostname, hostnameDict);
}

function computeMatrixIsDirty(hostname, hostnameDict = {}) {
    if (!hostname) return false;
    // Compare effective (session+inherited) vs permanent effective for each switch
    for (const name of ["noPopups", "noLargeMedia", "noCosmeticFiltering", "noRemoteFonts", "noScripting", "noCSPReports"]) {
        const sessionEffective = getEffectiveHostnameSwitch(hostname, name);
        const permanentEffective = getEffectivePermanentHostnameSwitch(hostname, name);
        if (sessionEffective !== permanentEffective) return true;
    }
    // Check net filtering
    if (sessionNetFiltering.has(hostname) && sessionNetFiltering.get(hostname) !== (permanentNetFiltering[hostname] !== false)) return true;
    return sessionFirewall.hasSameRules(permanentFirewall, hostname, hostnameDict) === false;
}

function isSupportedURL(url) {
    if (!url) return false;
    if (url.startsWith("http://") || url.startsWith("https://")) return true;
    if (url.startsWith("worker://") || url.startsWith("worklet://")) return true;
    return false;
}

/**
 * Resolve the policy context (trust, power, switches) for a page, using
 * the top-level tab URL for authorization decisions.
 *
 * @param {number} tabId
 * @param {string} [frameURL] - optional frame-level URL (for cosmetic selection)
 * @returns {Promise<{topURL, pageHostname, frameHostname, trusted, netFilteringEnabled, hostnameSwitches}>}
 */
async function resolvePolicyContext(tabId, frameURL) {
    await Promise.all([
        ensurePermanentStateLoaded(),
        ensureWhitelistReady(),
    ]);
    let topURL = frameURL || "";
    if (Number.isInteger(tabId) && tabId > 0) {
        try {
            const tab = await chrome.tabs.get(tabId);
            if (tab?.url) topURL = tab.url;
        } catch (_) {}
    }
    const pageHostname = hostnameFromURL(topURL) || "";
    const frameHostname = hostnameFromURL(frameURL || "") || pageHostname;
    const trusted = isURLTrusted(topURL);
    return {
        topURL,
        pageHostname,
        frameHostname,
        trusted,
        netFilteringEnabled: trusted ? false : getEffectiveNetFiltering(pageHostname, topURL, tabId),
        hostnameSwitches: getEffectiveHostnameSwitches(pageHostname),
    };
}

/**
 * Resolve policy context from an already-fetched tab URL, without
 * performing another chrome.tabs.get() call.
 */
function resolvePolicyContextFromURL(tabId, tabURL) {
    const pageHostname = hostnameFromURL(tabURL) || "";
    const trusted = isURLTrusted(tabURL);
    return {
        topURL: tabURL,
        pageHostname,
        frameHostname: pageHostname,
        trusted,
        netFilteringEnabled: trusted ? false : getEffectiveNetFiltering(pageHostname, tabURL, tabId),
        hostnameSwitches: getEffectiveHostnameSwitches(pageHostname),
    };
}

// Emerging transport / protocol helpers
function isWebTransportURL(url) {
    return url && url.startsWith("https://") && (
        url.includes(".webtransport") || url.includes("webtransport")
    );
}

function isSXGURL(url) {
    return url && url.endsWith(".sxg");
}

// Browser-internal and extension pages cannot be filtered. Disable the action
// for them so its popup cannot present controls which have no valid target.
// Chrome renders a disabled action in gray.
async function syncActionAvailability(tabId, url) {
    if (typeof tabId !== "number" || tabId < 0) return;
    try {
        if (isSupportedURL(url) || isExtensionURL(url)) {
            await actionEnable(tabId, "syncActionAvailability.enable");
        } else {
            await actionDisable(tabId, "syncActionAvailability.disable");
            await actionSetBadgeText({ tabId, text: "" }, "syncActionAvailability.setBadgeText");
        }
    } catch (err) {
        logNonStaleTabError("syncActionAvailability", err);
    }
}

async function syncActionAvailabilityForOpenTabs() {
    try {
        const tabs = await chrome.tabs.query({});
        await Promise.all(tabs.map(async tab => {
            await syncActionAvailability(tab.id, tab.url);
            if (typeof tab.id === "number") {
                await clearBlockedCountIcon(tab.id);
            }
        }));
    } catch (err) {
        console.warn("[uBlock Ultimate] syncActionAvailabilityForOpenTabs:", err);
    }
}

// ----- Custom new tab interception -----
async function interceptNewTab(tabId, url) {
    if (!_showCustomNewTab) return;
    if (url !== "chrome://newtab/") return;
    try {
        const tab = await chrome.tabs.get(tabId);
        if (tab.url !== "chrome://newtab/" && tab.pendingUrl !== "chrome://newtab/") return;
        chrome.tabs.update(tabId, { url: chrome.runtime.getURL("pages/newtab.html") }).catch(() => {});
    } catch (_) {}
}

async function loadCustomNewTabState() {
    try {
        const us = await readUserSettings();
        _showCustomNewTab = us.showCustomNewTab === true;
        await chrome.storage.local.set({ showCustomNewTab: _showCustomNewTab }).catch(() => {});
    } catch (_) {}
}

async function syncNewTabToUserSettings(value) {
    try {
        const stored = await chrome.storage.local.get("userSettings");
        const current = stored.userSettings || {};
        current.showCustomNewTab = value;
        await chrome.storage.local.set({ userSettings: current });
    } catch (_) {}
}

// ----- Logger runtime release -----
async function disableLoggerRuntime(reason) {
    loggerRuntime.forceRelease();
    inMemoryFilters.clear();

    try {
        broadcastMessage("uBR", { what: "loggerDisabled", reason });
    } catch (_) {
    }

    await disableCosmeticLoggerForOpenTabs();
}

// ----- Managed enterprise policy -----
async function readManagedPolicy() {
    try {
        if (typeof chrome.storage.managed === "undefined") {
            runtimeHealth.managedPolicyApplied = false;
            return;
        }
        const policy = await chrome.storage.managed.get(null);
        if (policy && Object.keys(policy).length > 0) {
            managedPolicy = policy;
            runtimeHealth.managedPolicyApplied = true;
            if (policy.disableFiltering === true) {
                runtimeHealth.degradedMode = true;
                runtimeHealth.lastError = 'Filtering disabled by enterprise policy';
            }
            if (policy.disableLogger === true) {
                await disableLoggerRuntime("managed-policy");
            }
            if (Array.isArray(policy.whitelist)) {
                const compiled = policy.whitelist.map(compileWhitelistDirective).filter(Boolean);
                managedWhitelistFns = compiled;
                whitelistTestFns.push(...compiled);
            }
        }
    } catch (e) {
        console.warn("[uBlock Ultimate] readManagedPolicy failed:", e);
    }
}

// ----- Idle detection -----
function startIdleDetection() {
    if (typeof chrome.idle === "undefined" || idleDetectionActive) return;
    idleDetectionActive = true;
    try {
        chrome.idle.onStateChanged.addListener(newState => {
            runtimeHealth.idleState = newState;
            if (newState === "idle" || newState === "locked") {
                void disableLoggerRuntime("browser-idle");
            }
        });
        chrome.idle.queryState(60, state => {
            runtimeHealth.idleState = state;
        });
    } catch (e) {
        console.warn("[uBlock Ultimate] startIdleDetection failed:", e);
        idleDetectionActive = false;
    }
}

// Map switch ID (from HTML) to popup data field name
const SWITCH_ID_TO_FIELD = {
    "no-popups": "noPopups",
    "no-large-media": "noLargeMedia",
    "no-cosmetic-filtering": "noCosmeticFiltering",
    "no-remote-fonts": "noRemoteFonts",
    "no-scripting": "noScripting",
    "no-csp-reports": "noCSPReports",
};
const FIELD_TO_SWITCH_ID = {};
for (const [k, v] of Object.entries(SWITCH_ID_TO_FIELD)) {
    FIELD_TO_SWITCH_ID[v] = k;
}

const ACTION_NUM_TO_WORD = { 1: "block", 2: "allow", 3: "noop" };
const ACTION_WORD_TO_NUM = { block: 1, allow: 2, noop: 3 };

// Serialize all dynamic rules into arrays for the My rules tab
function serializeAllRules() {
    const permanentRules = [];
    const sessionRules = [];

    permanentRules.push(...permanentFirewall.toArray());
    sessionRules.push(...sessionFirewall.toArray());

    // Hostname switches
    for (const [hostname, switches] of Object.entries(permanentHostnameSwitches)) {
        if (typeof hostname !== "string" || hostname === "") continue;
        for (const [field, val] of Object.entries(switches)) {
            const name = FIELD_TO_SWITCH_ID[field];
            if (name) permanentRules.push(`${name}: ${hostname} ${val ? "true" : "false"}`);
        }
    }
    for (const [hostname, switches] of sessionHostnameSwitches) {
        if (typeof hostname !== "string" || hostname === "") continue;
        for (const [field, val] of Object.entries(switches)) {
            const name = FIELD_TO_SWITCH_ID[field];
            if (name) sessionRules.push(`${name}: ${hostname} ${val ? "true" : "false"}`);
        }
    }

    // URL filtering rules
    for (const [key, val] of Object.entries(permanentURLFilteringRules)) {
        const parts = key.split(" ");
        if (parts.length >= 3) {
            permanentRules.push(`${parts[0]} ${parts[1]} ${parts[2]} ${ACTION_NUM_TO_WORD[val] || val}`);
        }
    }
    for (const [key, val] of sessionURLFilteringRules) {
        const parts = key.split(" ");
        if (parts.length >= 3) {
            sessionRules.push(`${parts[0]} ${parts[1]} ${parts[2]} ${ACTION_NUM_TO_WORD[val] || val}`);
        }
    }

    return { permanentRules, sessionRules };
}

// Parse a single rule line from the My rules editor into a structured rule object
function parseRuleLine(line) {
    line = line.trim();
    if (!line) return null;

    const swMatch = /^([a-z][a-z-]+):\s+(\S+)\s+(true|false)$/.exec(line);
    if (swMatch) {
        const field = SWITCH_ID_TO_FIELD[swMatch[1]];
        if (field) {
            return { type: "switch", name: swMatch[1], field, hostname: swMatch[2], value: swMatch[3] === "true" };
        }
    }

    const tokens = line.split(/\s+/);
    if (tokens.length < 4) return null;

    const actionWord = tokens[tokens.length - 1];
    const actionNum = ACTION_WORD_TO_NUM[actionWord];
    if (actionNum === undefined) return null;

    // tokens: [src, second, type, action] — type may be multi-word only for switches (already matched above)
    const src = tokens[0];
    const second = tokens[1];
    const ruleType = tokens.slice(2, -1).join(" ");

    if (second.includes("/")) {
        return { type: "url", context: src, url: second, ruleType, action: actionNum };
    }
    return { type: "firewall", src, des: second, ruleType, action: actionNum };
}

async function applyImmediateCosmeticSwitch(tabId, noCosmeticFiltering) {
    if (typeof tabId !== "number" || tabId <= 0) return { reloadRequired: false };
    const disabled = noCosmeticFiltering === true;
    // When enabling cosmetic filtering, the domFilterer may not exist if
    // the page started without it. Return reloadRequired: true in that case.
    if (disabled === false) {
        try {
            const results = await chrome.scripting.executeScript({
                target: { tabId, allFrames: false },
                world: "ISOLATED",
                func: () => {
                    const filterer = globalThis.vAPI?.domFilterer;
                    return { exists: !!filterer };
                },
                args: [],
            });
            const hasFilterer = results?.[0]?.result?.exists === true;
            if (!hasFilterer) {
                return { reloadRequired: true };
            }
        } catch (error) {
            if (!isStaleTabError(error)) console.warn("[uBlock Ultimate] immediate cosmetic switch probe failed:", error);
            return { reloadRequired: true };
        }
    }
    try {
        await chrome.scripting.executeScript({
            target: { tabId, allFrames: true },
            world: "ISOLATED",
            func: d => {
                const filterer = globalThis.vAPI?.domFilterer;
                if (filterer && typeof filterer.toggle === "function") filterer.toggle(!d);
            },
            args: [disabled],
        });
        return { reloadRequired: false };
    } catch (error) {
        if (!isStaleTabError(error)) console.warn("[uBlock Ultimate] immediate cosmetic switch failed:", error);
        return { reloadRequired: true };
    }
}

// Apply a modifyRuleset operation to the in-memory stores
async function applyRuleChanges(permanent, toAdd, toRemove) {
    await ensurePermanentStateLoaded();

    // Parse rules first without mutating state.
    const parsedAdd = [];
    const parsedRemove = [];
    const processParse = (line, isAdd) => {
        const rule = parseRuleLine(line);
        if (!rule) return;
        (isAdd ? parsedAdd : parsedRemove).push(rule);
    };
    if (toRemove) { for (const line of toRemove.split("\n")) processParse(line, false); }
    if (toAdd) { for (const line of toAdd.split("\n")) processParse(line, true); }

    return enqueueStateMutation(async () => {
        const snapshot = snapshotFilteringState();
        const applyRule = (rule, add) => {
            switch (rule.type) {
            case "switch": {
                if (add) {
                    if (permanent) {
                        if (!permanentHostnameSwitches[rule.hostname]) permanentHostnameSwitches[rule.hostname] = {};
                        permanentHostnameSwitches[rule.hostname][rule.field] = rule.value;
                    } else {
                        let entry = sessionHostnameSwitches.get(rule.hostname);
                        if (!entry) { entry = {}; sessionHostnameSwitches.set(rule.hostname, entry); }
                        entry[rule.field] = rule.value;
                    }
                } else {
                    if (permanent) {
                        if (permanentHostnameSwitches[rule.hostname]) {
                            delete permanentHostnameSwitches[rule.hostname][rule.field];
                            if (Object.keys(permanentHostnameSwitches[rule.hostname]).length === 0) {
                                delete permanentHostnameSwitches[rule.hostname];
                            }
                        }
                    } else {
                        const entry = sessionHostnameSwitches.get(rule.hostname);
                        if (entry) {
                            delete entry[rule.field];
                            if (Object.keys(entry).length === 0) sessionHostnameSwitches.delete(rule.hostname);
                        }
                    }
                }
                break;
            }
            case "firewall": {
                const action = add ? rule.action : 0;
                if (permanent) {
                    permanentFirewall.setCell(rule.src, rule.des, rule.ruleType, action);
                    sessionFirewall.setCell(rule.src, rule.des, rule.ruleType, action);
                } else {
                    sessionFirewall.setCell(rule.src, rule.des, rule.ruleType, action);
                }
                break;
            }
            case "url": {
                const key = `${rule.context} ${rule.url} ${rule.ruleType}`;
                if (add) {
                    if (permanent) permanentURLFilteringRules[key] = String(rule.action);
                    else sessionURLFilteringRules.set(key, String(rule.action));
                } else {
                    if (permanent) delete permanentURLFilteringRules[key];
                    else sessionURLFilteringRules.delete(key);
                }
                break;
            }
            }
        };

        try {
            for (const rule of parsedRemove) applyRule(rule, false);
            for (const rule of parsedAdd) applyRule(rule, true);

            if (permanent) {
                permanentFirewallRules = permanentFirewall.toObject({ numeric: true });
                await chrome.storage.local.set({
                    [STORAGE_KEY_PERM_FIREWALL_RULES]: permanentFirewallRules,
                    [STORAGE_KEY_PERM_HOSTNAME_SWITCHES]: permanentHostnameSwitches,
                    [STORAGE_KEY_URL_FILTERING]: permanentURLFilteringRules,
                    [STORAGE_KEY_DYNAMIC_FILTERING_STRING]: permanentFirewall.toString(),
                });
            }
            await persistSessionHostnameSwitches();
            await persistSessionFirewallState();
            await persistSessionURLFilteringRules();

            await syncFirewallDnrRules();
            await syncNetFilteringDnrRules();
            await syncHostnameSwitchDnrRules();
            await syncURLFilteringDnrRules();
            await syncCspReportPolicyRules();
        } catch (error) {
            await restoreFilteringState(snapshot);
            console.warn("[uBlock Ultimate] applyRuleChanges failed, rolled back:", error);
            throw error;
        }

        await postCommitFilteringChange("rules-editor-apply");
        const serialized = serializeAllRules();
        return { permanentRules: serialized.permanentRules, sessionRules: serialized.sessionRules };
    });
}

async function resolveTabId(tabId) {
    let id = Number(tabId) > 0 ? Number(tabId) : 0;
    if (id <= 0) {
        id = popupPortTabId;
    }
    if (id <= 0) {
        try {
            const win = await chrome.windows.getLastFocused();
            const tabs = await chrome.tabs.query({ windowId: win.id, active: true });
            for (const t of tabs) {
                if (typeof t.id === "number") { id = t.id; break; }
            }
            if (id <= 0) {
                const tabs2 = await chrome.tabs.query({});
                for (const t of tabs2) {
                    if (typeof t.id === "number" && t.url) { id = t.id; break; }
                }
            }
        } catch (e) {
            console.warn("[uBlock Ultimate] resolveTabId: failed to resolve tab ID", e);
        }
    }
    return id;
}

// Keep a small, per-navigation badge count for actual DNR block actions. This
// is deliberately event-driven: querying getMatchedRules on every request is
// quota-limited and would make badge updates less reliable than the count.
const blockedDnrCountByTab = new Map();
// Cosmetic filters run in every frame. Keep each frame's monotonic count
// separate so a no-match iframe cannot overwrite the top document's count.
const blockedCosmeticCountByTab = new Map();
const popupBlockedCountByTab = new Map();
const pendingBadgeUpdates = new Set();
const matchedRuleActionCache = new Map();
const pendingRuleActionLookups = new Map();
const actionIconBaseImageData = new Map();

// New tab page toggle state
let _showCustomNewTab = false;

const actionIconPaths = Object.freeze({
    16: chrome.runtime.getURL("img/ublock16.png"),
    32: chrome.runtime.getURL("img/ublock32.png"),
});
const actionDefaultTitle = "uBlock Ultimate";
const actionIconPixelData = Object.freeze({
    16: new Uint8ClampedArray([0,0,0,0,0,0,0,0,0,0,0,0,52,53,54,0,0,0,0,0,139,143,143,23,175,180,180,95,175,174,175,202,175,175,175,202,175,180,180,94,138,142,142,22,0,0,0,0,48,49,50,0,0,0,0,0,0,0,0,0,0,0,0,0,255,255,255,0,103,103,104,11,161,165,165,39,174,180,180,81,176,179,179,141,166,161,161,205,145,118,119,246,126,59,62,255,126,59,62,255,145,118,119,246,166,161,161,204,176,179,179,140,174,180,180,80,159,164,164,39,101,100,101,11,228,228,228,0,0,0,0,1,177,177,178,136,161,149,149,234,142,110,112,250,131,75,77,255,126,39,43,255,135,23,27,255,145,23,27,255,145,22,27,255,135,22,26,255,127,40,43,255,131,75,77,255,143,111,112,250,161,149,150,233,176,176,177,134,0,0,0,0,64,67,69,6,173,171,172,180,122,50,53,255,138,20,25,255,144,23,27,255,147,25,29,255,147,25,30,255,144,22,26,255,144,22,26,255,145,22,26,255,147,22,26,255,144,21,26,255,138,20,24,255,121,51,54,255,173,172,172,176,38,40,42,5,98,101,102,9,169,166,166,187,128,44,48,255,146,25,29,255,144,28,32,255,145,25,29,255,145,33,37,255,163,89,91,255,172,102,104,255,172,102,105,255,162,80,83,255,146,33,37,255,147,24,29,255,127,45,48,255,168,166,166,183,83,87,87,7,88,91,93,7,169,167,167,183,126,44,47,255,158,72,75,255,192,156,157,255,146,41,45,255,150,51,54,255,228,220,221,255,219,204,204,255,211,188,189,255,234,228,228,255,178,123,125,255,144,23,27,255,127,47,50,255,169,167,167,181,73,77,77,7,0,0,0,3,172,171,172,169,126,50,53,255,169,96,98,255,229,221,221,255,149,49,53,255,150,51,54,255,227,218,218,255,163,95,97,255,145,50,53,255,216,197,197,255,195,157,159,255,143,23,27,255,129,55,58,255,172,172,172,168,0,0,0,2,255,255,255,0,174,177,177,141,128,67,69,255,166,92,94,255,232,225,226,255,151,60,63,255,149,53,56,255,227,217,217,255,172,128,129,255,221,206,207,255,225,215,216,255,152,68,71,255,143,20,25,255,131,72,74,255,174,177,177,139,255,255,255,0,225,225,225,0,175,180,180,95,139,100,101,253,146,55,58,255,225,213,213,255,219,201,202,255,210,187,187,255,228,220,220,255,157,85,87,255,185,134,136,255,234,227,228,255,187,140,142,255,137,25,29,255,139,102,104,253,174,179,179,94,222,222,222,0,150,150,150,0,161,165,165,40,157,144,145,228,127,29,33,255,154,62,66,255,174,112,114,255,176,116,118,255,158,77,80,255,144,28,32,255,142,23,28,255,184,132,134,255,233,228,228,255,137,72,74,255,157,142,142,227,159,163,164,40,148,147,148,0,69,69,70,0,3,4,6,3,176,177,177,157,129,73,75,255,142,21,25,255,145,23,27,255,144,22,26,255,144,22,27,255,145,25,29,255,145,24,29,255,146,38,42,255,154,72,75,255,130,91,92,255,175,175,176,155,0,0,0,3,67,66,67,0,0,0,0,0,183,183,184,0,165,168,168,52,161,150,150,227,125,37,40,255,147,25,29,255,146,26,30,255,145,25,30,255,145,25,29,255,145,25,29,255,146,23,28,255,123,34,37,255,161,149,150,226,163,166,167,51,181,181,181,0,0,0,0,0,0,0,0,0,62,62,63,0,0,0,0,0,176,179,179,105,149,127,128,245,126,31,34,255,146,24,29,255,146,26,30,255,146,26,30,255,146,24,29,255,127,31,34,255,150,129,130,244,175,178,179,104,255,255,255,0,59,58,59,0,0,0,0,0,0,0,0,0,0,0,0,0,110,110,110,0,83,82,83,6,177,179,179,121,150,130,131,244,124,39,42,255,143,22,26,255,143,22,26,255,125,40,43,255,152,132,133,243,177,180,180,120,79,79,80,5,109,109,110,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,114,114,115,0,85,84,85,5,175,178,178,98,163,153,153,223,128,73,75,255,128,74,76,255,163,154,155,223,175,178,178,96,83,82,83,5,113,113,114,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,72,72,73,0,0,0,0,0,163,166,166,57,177,178,178,190,177,178,179,188,162,165,166,56,0,0,0,0,69,69,69,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]),
    32: new Uint8ClampedArray([0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,68,68,70,0,17,17,18,14,104,104,105,88,172,171,172,203,171,171,172,202,104,104,105,86,15,15,16,13,63,62,64,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,2,48,47,49,30,122,122,123,98,181,181,181,186,218,218,218,244,197,199,198,255,199,200,200,255,218,219,219,243,180,180,180,184,120,120,121,97,47,47,48,28,0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,2,2,3,0,0,0,0,4,45,45,46,29,109,109,110,81,158,158,159,152,200,201,201,218,219,220,220,251,185,186,186,255,111,99,99,255,79,29,31,255,79,31,32,255,112,101,101,255,186,188,187,255,219,220,220,251,200,200,200,217,156,156,156,150,106,106,106,79,42,42,43,28,0,0,0,4,1,1,2,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,1,1,0,0,0,0,0,3,3,4,10,53,53,54,32,99,99,100,68,137,137,137,116,172,172,172,171,202,202,202,220,218,219,219,249,202,204,204,255,149,147,147,255,93,72,73,255,83,24,26,255,116,17,21,255,143,23,28,255,143,22,27,255,114,16,20,255,83,24,27,255,95,73,74,255,151,149,149,255,203,204,204,255,217,218,218,248,201,201,201,219,171,171,171,169,135,135,136,114,98,97,98,66,49,48,50,31,2,1,2,10,0,0,0,0,3,2,3,0,0,0,0,0,0,0,0,0,104,104,105,0,85,85,86,56,172,172,172,191,207,207,207,224,215,216,216,246,210,212,212,254,185,187,187,255,142,137,137,255,99,78,79,255,82,33,35,255,98,16,19,255,128,19,23,255,146,25,30,255,147,26,30,255,146,25,30,255,145,24,29,255,147,25,29,255,146,24,28,255,129,19,23,255,99,16,19,255,82,34,36,255,99,80,80,255,144,139,139,255,187,188,188,255,211,213,213,254,215,216,216,245,205,205,205,224,169,169,169,190,81,81,82,53,96,96,97,0,0,0,0,0,0,0,0,0,181,181,181,0,129,129,129,102,225,226,226,255,142,137,138,255,100,79,80,255,84,45,46,255,87,23,25,255,106,16,20,255,129,19,23,255,144,23,28,255,148,26,30,255,147,26,30,255,147,26,30,255,146,25,29,255,145,24,29,255,146,25,29,255,146,25,29,255,146,25,30,255,147,26,30,255,149,26,30,255,144,23,28,255,129,19,23,255,105,16,19,255,86,23,26,255,85,46,48,255,101,80,81,255,145,141,141,255,225,225,225,254,122,122,123,95,162,162,162,0,0,0,0,0,0,0,0,0,250,250,249,0,145,144,145,121,209,211,211,255,76,36,38,255,128,17,21,255,141,22,27,255,148,25,29,255,148,26,31,255,147,26,30,255,146,25,29,255,146,26,30,255,147,26,30,255,147,25,30,255,145,25,29,255,144,25,29,255,146,26,30,255,146,26,30,255,145,26,30,255,146,27,30,255,147,27,31,255,147,26,30,255,147,25,30,255,147,25,29,255,147,25,29,255,141,22,26,255,126,15,20,255,77,41,42,255,211,213,213,255,137,137,137,113,215,216,215,0,0,0,0,0,46,43,59,0,255,255,255,0,153,153,153,133,203,205,205,255,85,33,35,255,147,24,29,255,146,26,30,255,146,25,30,255,147,26,31,255,146,26,31,255,146,26,30,255,146,25,30,255,146,26,30,255,147,25,30,255,146,24,29,255,146,26,30,255,147,27,31,255,147,26,30,255,146,25,30,255,147,26,30,255,148,26,31,255,148,26,30,255,146,25,30,255,146,25,30,255,146,25,30,255,146,25,30,255,145,22,27,255,82,35,37,255,205,207,207,255,147,147,147,125,255,255,255,0,224,190,255,0,59,56,71,0,255,255,255,0,158,157,158,141,198,200,200,255,84,29,31,255,147,24,29,255,146,25,30,255,146,25,30,255,147,27,31,255,147,27,31,255,146,26,30,255,145,25,29,255,146,25,29,255,145,25,29,255,140,23,27,255,139,23,27,255,140,24,28,255,141,24,28,255,141,24,28,255,141,23,27,255,142,22,26,255,144,22,26,255,147,25,30,255,147,26,30,255,147,26,30,255,146,26,30,255,145,24,28,255,82,31,32,255,201,203,203,255,152,152,152,134,255,255,255,0,44,41,49,0,47,46,50,0,255,255,255,0,157,157,157,145,196,198,198,255,83,28,30,255,147,25,29,255,146,24,29,255,144,23,27,255,142,22,26,255,143,22,26,255,145,24,29,255,145,25,29,255,146,24,29,255,136,39,42,255,171,138,139,255,186,157,158,255,186,156,157,255,187,157,158,255,187,156,157,255,186,156,157,255,179,143,144,255,153,93,95,255,138,33,37,255,145,25,29,255,146,26,30,255,146,26,30,255,146,24,29,255,82,29,31,255,199,201,201,255,153,152,152,137,255,255,255,0,6,6,5,0,60,55,72,0,255,255,255,0,157,157,158,140,198,199,199,255,83,29,31,255,146,25,29,255,143,24,28,255,143,75,78,255,167,122,124,255,156,105,107,255,138,33,37,255,147,25,29,255,146,24,28,255,139,50,53,255,228,224,225,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,246,247,247,255,179,149,150,255,137,30,34,255,145,25,30,255,146,27,31,255,145,24,28,255,82,31,33,255,200,202,202,255,151,151,151,136,255,255,255,0,36,33,40,0,52,48,62,0,255,255,255,0,152,152,152,130,202,204,204,255,84,33,35,255,146,25,29,255,140,23,27,255,180,149,150,255,255,255,255,255,225,222,222,255,139,48,51,255,146,24,29,255,147,25,29,255,140,51,53,255,227,223,223,255,255,255,255,255,205,191,192,255,173,135,137,255,176,137,138,255,183,153,154,255,230,224,225,255,255,255,255,255,239,239,239,255,144,73,75,255,144,23,27,255,146,26,31,255,145,24,28,255,83,35,36,255,204,206,206,255,147,147,147,126,255,255,255,0,108,94,133,0,0,0,0,0,227,227,227,0,142,142,142,116,208,210,210,255,84,41,42,255,145,25,29,255,141,24,27,255,180,149,150,255,255,255,255,255,226,221,221,255,139,49,52,255,146,25,29,255,147,25,29,255,140,51,53,255,227,223,223,255,255,255,255,255,169,128,129,255,137,18,22,255,142,22,26,255,137,19,23,255,161,112,114,255,251,253,253,255,249,251,250,255,153,95,97,255,142,22,27,255,146,26,31,255,144,24,28,255,84,43,45,255,209,211,212,255,137,137,137,112,212,212,212,0,0,0,0,0,0,0,0,0,164,164,164,0,127,126,127,94,213,215,215,254,87,54,55,255,140,22,26,255,141,24,28,255,181,149,150,255,255,255,255,255,226,221,221,255,138,49,52,255,145,25,29,255,146,25,29,255,140,51,53,255,227,223,224,255,255,255,255,255,171,129,130,255,136,24,27,255,138,32,36,255,137,39,43,255,181,149,150,255,255,255,255,255,235,233,234,255,141,66,69,255,143,23,28,255,147,27,31,255,140,23,27,255,89,57,59,255,214,216,216,253,122,121,122,92,155,155,155,0,0,0,0,0,0,0,0,0,110,110,111,0,101,100,101,68,215,216,216,246,98,77,78,255,130,19,23,255,141,24,28,255,180,149,150,255,255,255,255,255,226,221,221,255,138,48,51,255,146,25,29,255,147,25,29,255,140,51,53,255,227,223,224,255,255,255,255,255,169,126,127,255,141,79,81,255,207,194,194,255,218,209,209,255,248,248,248,255,238,236,236,255,167,125,127,255,137,27,31,255,145,25,30,255,146,26,31,255,131,20,24,255,102,82,82,255,215,216,216,245,96,96,96,65,104,103,104,0,0,0,0,0,0,0,0,0,58,58,59,0,59,59,60,39,207,208,208,230,124,115,115,255,117,17,21,255,142,23,27,255,177,142,143,255,255,255,255,255,237,236,236,255,143,70,72,255,140,19,24,255,144,20,25,255,138,47,50,255,227,223,223,255,255,255,255,255,168,126,127,255,154,101,102,255,251,253,253,255,255,255,255,255,253,254,254,255,175,152,152,255,130,29,33,255,144,23,28,255,145,26,30,255,147,26,31,255,115,17,20,255,127,118,118,255,207,207,207,228,56,56,56,37,55,55,55,0,0,0,0,0,0,0,0,0,20,20,22,0,0,0,0,14,189,189,190,198,162,160,161,255,98,18,21,255,145,21,26,255,158,104,106,255,249,251,251,255,254,254,254,255,212,199,199,255,168,123,125,255,165,113,115,255,170,134,135,255,239,237,237,255,254,255,255,255,165,119,121,255,135,64,66,255,195,175,176,255,239,238,238,255,255,255,255,255,243,241,241,255,180,149,150,255,136,35,39,255,145,25,30,255,149,26,31,255,96,18,21,255,165,164,164,255,186,186,187,196,0,0,0,13,18,17,19,0,0,0,0,0,0,0,0,0,8,7,12,0,255,255,255,0,156,156,156,147,200,202,202,255,83,33,35,255,144,23,27,255,138,40,44,255,197,179,180,255,251,253,253,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,227,224,224,255,144,69,72,255,143,22,27,255,137,28,32,255,152,88,90,255,223,216,216,255,255,255,255,255,250,252,252,255,173,137,138,255,138,25,29,255,145,24,28,255,83,34,35,255,202,203,203,255,153,152,153,145,255,255,255,0,11,9,13,0,0,0,0,0,0,0,0,0,34,28,35,0,142,141,142,0,110,109,110,82,217,218,218,249,98,78,79,255,128,20,24,255,146,24,29,255,138,42,45,255,163,117,119,255,193,171,172,255,202,186,186,255,203,187,188,255,200,181,182,255,180,149,150,255,144,72,75,255,141,25,29,255,146,26,31,255,147,26,31,255,142,21,25,255,150,84,86,255,237,236,236,255,255,255,255,255,232,230,230,255,143,64,67,255,126,16,20,255,100,80,81,255,216,217,217,248,106,106,106,80,135,135,135,0,55,47,65,0,0,0,0,0,0,0,0,0,0,0,0,0,48,47,48,0,33,33,34,26,195,195,196,212,155,153,153,255,95,17,20,255,147,25,30,255,145,24,28,255,140,22,26,255,137,26,30,255,137,30,34,255,137,30,34,255,137,28,32,255,138,23,27,255,143,23,27,255,144,26,30,255,145,26,30,255,145,26,30,255,146,25,30,255,138,26,30,255,189,165,166,255,253,255,255,255,252,255,255,255,171,130,131,255,88,14,17,255,158,156,156,255,194,194,194,210,29,29,30,24,46,45,46,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,2,1,2,0,255,255,255,0,145,145,145,134,212,213,214,255,83,51,52,255,135,21,25,255,147,26,31,255,147,26,30,255,147,26,31,255,147,27,31,255,147,26,31,255,145,25,29,255,145,25,30,255,144,25,29,255,145,25,29,255,145,26,30,255,146,26,30,255,145,26,30,255,145,23,28,255,140,58,62,255,160,109,111,255,162,111,113,255,130,71,73,255,79,52,53,255,213,214,214,255,142,142,142,130,255,255,255,0,1,1,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,84,83,84,0,69,69,70,44,203,203,204,225,149,146,146,255,92,17,19,255,148,26,30,255,149,28,32,255,147,27,31,255,146,27,31,255,146,26,30,255,146,26,30,255,145,25,30,255,145,25,29,255,145,25,29,255,146,26,30,255,145,26,30,255,144,25,29,255,145,25,30,255,144,24,28,255,142,21,25,255,144,21,25,255,90,15,17,255,152,149,150,255,202,202,202,223,66,65,67,41,80,80,81,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,7,7,7,0,0,0,0,0,141,141,142,128,217,218,218,254,92,72,72,255,122,18,22,255,148,27,31,255,146,26,31,255,147,27,31,255,146,27,31,255,146,26,30,255,145,25,30,255,145,25,29,255,146,25,29,255,145,25,29,255,144,24,29,255,145,25,29,255,146,26,30,255,146,26,31,255,148,26,31,255,120,18,22,255,94,75,76,255,218,219,219,254,137,137,138,127,0,0,0,0,5,5,6,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,64,64,65,0,41,41,42,26,184,184,185,198,192,193,193,255,77,35,37,255,136,22,26,255,147,26,31,255,147,27,31,255,146,26,30,255,146,26,30,255,145,26,30,255,145,25,30,255,145,25,29,255,145,25,29,255,145,25,29,255,146,26,30,255,146,26,30,255,147,25,30,255,135,21,25,255,77,37,38,255,194,196,196,255,182,182,182,196,38,37,38,24,62,62,63,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,168,167,168,0,97,96,97,67,208,208,208,231,161,160,160,255,81,24,26,255,141,24,28,255,146,26,30,255,146,26,30,255,146,26,30,255,146,26,30,255,145,25,30,255,145,25,29,255,145,25,29,255,145,26,30,255,146,26,30,255,147,25,30,255,140,22,26,255,79,25,27,255,165,164,165,255,207,207,207,230,92,92,93,65,155,155,156,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,9,8,9,0,0,0,0,0,121,121,121,103,217,217,217,243,146,143,143,255,81,22,24,255,140,24,28,255,147,26,31,255,145,26,30,255,146,26,30,255,146,26,30,255,146,26,30,255,147,27,31,255,147,26,31,255,148,27,31,255,140,23,27,255,81,23,26,255,151,148,149,255,217,217,217,242,120,120,120,99,0,0,0,0,9,8,9,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,26,25,26,0,0,0,0,4,133,133,133,118,219,219,219,245,150,147,148,255,79,27,29,255,133,21,25,255,147,25,30,255,146,25,29,255,147,26,31,255,147,26,30,255,147,26,31,255,148,26,30,255,132,21,24,255,79,29,30,255,155,153,153,255,218,219,219,244,130,130,131,116,0,0,0,4,21,21,21,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,29,29,29,0,0,0,0,5,129,129,130,115,215,215,215,241,172,172,172,255,78,43,45,255,115,17,20,255,147,25,29,255,148,26,30,255,147,25,30,255,147,25,29,255,115,17,21,255,79,46,47,255,176,176,176,255,214,215,215,239,128,128,129,111,0,0,0,5,30,28,32,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,19,19,20,0,0,0,0,3,114,114,114,92,203,203,203,225,203,204,204,255,98,83,83,255,91,18,21,255,138,23,27,255,137,22,26,255,88,18,21,255,102,87,87,255,205,207,207,255,201,201,201,223,111,111,111,89,0,0,0,3,19,19,19,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,3,3,3,0,0,0,0,0,85,84,85,56,177,177,177,189,221,222,222,252,150,148,148,255,78,42,44,255,79,45,46,255,154,152,152,255,222,223,223,252,175,175,175,187,81,81,82,53,0,0,0,0,1,1,2,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,87,87,88,0,40,39,40,20,138,137,138,125,207,207,208,229,209,211,211,255,210,212,212,255,207,207,207,227,135,135,135,122,38,37,38,19,83,82,84,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,7,6,8,0,0,0,0,2,82,82,82,62,162,162,162,189,161,161,161,188,82,81,83,59,0,0,0,1,5,5,6,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]),
});
// Preload icon data on SW startup so badge rendering succeeds reliably.
for (const size of Object.keys(actionIconPaths).map(Number)) {
    getActionIconBaseImageData(size);
}

function getBlockedCosmeticCount(tabId) {
    const countsByFrame = blockedCosmeticCountByTab.get(tabId);
    if (countsByFrame === undefined) return 0;
    let count = 0;
    for (const frameCount of countsByFrame.values()) {
        count += frameCount;
    }
    return count;
}

function reportBlockedCosmeticCount(tabId, frameId, count, clear = false) {
    const normalizedFrameId = Number.isInteger(frameId) && frameId >= 0 ? frameId : 0;
    let countsByFrame = blockedCosmeticCountByTab.get(tabId);
    if (clear) {
        if (countsByFrame === undefined) return;
        countsByFrame.delete(normalizedFrameId);
        if (countsByFrame.size === 0) {
            blockedCosmeticCountByTab.delete(tabId);
        }
        return;
    }
    const currentCount = countsByFrame?.get(normalizedFrameId) || 0;
    if (count <= currentCount) return;
    if (countsByFrame === undefined) {
        countsByFrame = new Map();
        blockedCosmeticCountByTab.set(tabId, countsByFrame);
    }
    countsByFrame.set(normalizedFrameId, count);
}

function incrementBlockedCosmeticCount(tabId, frameId, increment) {
    if (increment <= 0) return;
    const normalizedFrameId = Number.isInteger(frameId) && frameId >= 0 ? frameId : 0;
    let countsByFrame = blockedCosmeticCountByTab.get(tabId);
    if (countsByFrame === undefined) {
        countsByFrame = new Map();
        blockedCosmeticCountByTab.set(tabId, countsByFrame);
    }
    countsByFrame.set(
        normalizedFrameId,
        (countsByFrame.get(normalizedFrameId) || 0) + increment,
    );
}

async function getMatchedRuleActionType(matchedRule) {
    const ruleId = matchedRule?.ruleId;
    const rulesetId = matchedRule?.rulesetId || "_dynamic";
    if (typeof ruleId !== "number") return undefined;
    const cacheKey = `${rulesetId}:${ruleId}`;
    if (matchedRuleActionCache.has(cacheKey)) {
        return matchedRuleActionCache.get(cacheKey);
    }
    const pending = pendingRuleActionLookups.get(cacheKey);
    if (pending) return pending;

    const lookup = (async () => {
        let actionType;
        try {
            if (rulesetId === "_session") {
                const rules = await chrome.declarativeNetRequest.getSessionRules();
                actionType = rules.find(rule => rule.id === ruleId)?.action?.type;
            } else if (rulesetId === "_dynamic") {
                const rules = await chrome.declarativeNetRequest.getDynamicRules();
                actionType = rules.find(rule => rule.id === ruleId)?.action?.type;
            } else {
                const resources = chrome.runtime.getManifest()
                    .declarative_net_request?.rule_resources || [];
                const resource = resources.find(entry => entry.id === rulesetId);
                if (resource) {
                    const rules = await fetch(chrome.runtime.getURL(resource.path)).then(r => r.json());
                    actionType = rules.find(rule => rule.id === ruleId)?.action?.type;
                }
            }
        } catch (err) {
            console.warn("[uBlock Ultimate] getMatchedRuleActionType failed:", err);
        }
        matchedRuleActionCache.set(cacheKey, actionType);
        pendingRuleActionLookups.delete(cacheKey);
        return actionType;
    })();
    pendingRuleActionLookups.set(cacheKey, lookup);
    return lookup;
}

function formatCompactBlockedCount(count) {
    return count > 99 ? "99+" : String(count);
}

function getActionIconBaseImageData(size) {
    const cached = actionIconBaseImageData.get(size);
    if (cached !== undefined) return cached;
    const canvas = new OffscreenCanvas(size, size);
    const context = canvas.getContext("2d");
    const imageData = new ImageData(actionIconPixelData[size], size, size);
    context.putImageData(imageData, 0, 0);
    const result = context.getImageData(0, 0, size, size);
    actionIconBaseImageData.set(size, result);
    return result;
}

const countDigitData = Object.freeze({
    16: Object.freeze({
        "0": Object.freeze({w: 8, h: 8, data: new Uint8ClampedArray([0,0,0,2,0,0,0,148,0,0,0,248,0,0,0,254,0,0,0,253,0,0,0,227,0,0,0,65,0,0,0,0,0,0,0,84,2,2,2,255,147,147,147,255,239,239,239,255,218,218,218,255,66,66,66,254,0,0,0,234,0,0,0,3,0,0,0,178,83,83,83,255,254,254,254,255,43,43,43,255,146,146,146,255,227,227,227,255,3,3,3,255,0,0,0,35,0,0,0,221,140,140,140,255,234,234,234,255,0,0,0,255,86,86,86,255,255,255,255,255,32,32,32,255,0,0,0,61,0,0,0,220,141,141,141,255,235,235,235,255,0,0,0,255,88,88,88,255,255,255,255,255,31,31,31,255,0,0,0,62,0,0,0,179,83,83,83,255,255,255,255,255,43,43,43,255,149,149,149,255,227,227,227,255,3,3,3,255,0,0,0,34,0,0,0,84,2,2,2,255,148,148,148,255,239,239,239,255,218,218,218,255,66,66,66,254,0,0,0,234,0,0,0,3,0,0,0,2,0,0,0,149,0,0,0,248,0,0,0,254,0,0,0,253,0,0,0,227,0,0,0,65,0,0,0,0])}),
        "1": Object.freeze({w: 8, h: 8, data: new Uint8ClampedArray([0,0,0,24,0,0,0,255,0,0,0,255,0,0,0,255,0,0,0,255,0,0,0,176,0,0,0,0,0,0,0,0,0,0,0,24,24,24,24,255,255,255,255,255,255,255,255,255,176,176,176,255,0,0,0,231,0,0,0,0,0,0,0,0,0,0,0,24,0,0,0,255,0,0,0,255,188,188,188,255,176,176,176,255,0,0,0,248,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,250,188,188,188,255,176,176,176,255,0,0,0,248,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,250,188,188,188,255,176,176,176,255,0,0,0,248,0,0,0,0,0,0,0,0,0,0,0,16,0,0,0,255,0,0,0,255,188,188,188,255,176,176,176,255,0,0,0,255,0,0,0,255,0,0,0,4,0,0,0,16,16,16,16,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,4,4,4,255,0,0,0,4,0,0,0,16,0,0,0,255,0,0,0,255,0,0,0,255,0,0,0,255,0,0,0,255,0,0,0,255,0,0,0,4])}),
        "2": Object.freeze({w: 7, h: 8, data: new Uint8ClampedArray([0,0,0,88,0,0,0,255,0,0,0,255,0,0,0,255,0,0,0,255,0,0,0,229,0,0,0,70,0,0,0,88,88,88,88,255,255,255,255,255,253,253,253,255,219,219,219,255,71,71,71,254,0,0,0,211,0,0,0,88,0,0,0,255,0,0,0,255,17,17,17,255,206,206,206,255,195,195,195,255,0,0,0,235,0,0,0,0,0,0,0,28,0,0,0,235,41,41,41,255,238,238,238,255,141,141,141,255,0,0,0,229,0,0,0,18,0,0,0,221,29,29,29,254,226,226,226,255,175,175,175,255,9,9,9,253,0,0,0,144,0,0,0,104,18,18,18,255,213,213,213,255,189,189,189,255,6,6,6,255,0,0,0,255,0,0,0,225,0,0,0,104,92,92,92,255,255,255,255,255,255,255,255,255,255,255,255,255,224,224,224,255,0,0,0,224,0,0,0,92,0,0,0,255,0,0,0,255,0,0,0,255,0,0,0,255,0,0,0,255,0,0,0,224])}),
        "3": Object.freeze({w: 7, h: 8, data: new Uint8ClampedArray([0,0,0,56,0,0,0,255,0,0,0,255,0,0,0,255,0,0,0,255,0,0,0,238,0,0,0,99,0,0,0,56,56,56,56,255,255,255,255,255,253,253,253,255,228,228,228,255,100,100,100,254,0,0,0,211,0,0,0,56,0,0,0,255,0,0,0,255,21,21,21,255,217,217,217,255,183,183,183,255,0,0,0,223,0,0,0,0,0,0,0,120,120,120,120,255,255,255,255,255,249,249,249,255,72,72,72,255,0,0,0,247,0,0,0,0,0,0,0,120,0,0,0,255,15,15,15,255,196,196,196,255,213,213,213,255,0,0,0,250,0,0,0,120,0,0,0,255,0,0,0,255,14,14,14,255,195,195,195,255,214,214,214,255,0,0,0,250,0,0,0,120,120,120,120,255,255,255,255,255,249,249,249,255,209,209,209,255,65,65,65,254,0,0,0,224,0,0,0,120,0,0,0,255,0,0,0,255,0,0,0,255,0,0,0,254,0,0,0,220,0,0,0,63])}),
        "4": Object.freeze({w: 8, h: 8, data: new Uint8ClampedArray([0,0,0,0,0,0,0,0,0,0,0,159,0,0,0,255,0,0,0,255,0,0,0,255,0,0,0,96,0,0,0,0,0,0,0,0,0,0,0,67,0,0,0,245,159,159,159,255,255,255,255,255,96,96,96,255,0,0,0,156,0,0,0,0,0,0,0,9,0,0,0,229,68,68,68,254,220,220,220,255,255,255,255,255,96,96,96,255,0,0,0,193,0,0,0,0,0,0,0,132,14,14,14,250,219,219,219,255,72,72,72,255,255,255,255,255,96,96,96,255,0,0,0,193,0,0,0,0,0,0,0,212,128,128,128,255,155,155,155,255,12,12,12,255,255,255,255,255,96,96,96,255,0,0,0,255,0,0,0,52,0,0,0,210,164,164,164,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,52,52,52,255,0,0,0,52,0,0,0,164,0,0,0,255,0,0,0,255,12,12,12,255,255,255,255,255,96,96,96,255,0,0,0,255,0,0,0,52,0,0,0,0,0,0,0,0,0,0,0,12,0,0,0,255,0,0,0,255,0,0,0,255,0,0,0,96,0,0,0,0])}),
        "5": Object.freeze({w: 7, h: 8, data: new Uint8ClampedArray([0,0,0,40,0,0,0,255,0,0,0,255,0,0,0,255,0,0,0,255,0,0,0,255,0,0,0,152,0,0,0,74,40,40,40,255,255,255,255,255,255,255,255,255,255,255,255,255,152,152,152,255,0,0,0,152,0,0,0,102,40,40,40,255,255,255,255,255,12,12,12,255,0,0,0,255,0,0,0,255,0,0,0,185,0,0,0,74,40,40,40,255,255,255,255,255,247,247,247,255,224,224,224,255,83,83,83,255,0,0,0,241,0,0,0,40,0,0,0,255,0,0,0,255,9,9,9,255,179,179,179,255,235,235,235,255,0,0,0,254,0,0,0,96,0,0,0,255,0,0,0,255,9,9,9,255,180,180,180,255,232,232,232,255,0,0,0,254,0,0,0,96,96,96,96,255,255,255,255,255,253,253,253,255,216,216,216,255,74,74,74,254,0,0,0,239,0,0,0,96,0,0,0,255,0,0,0,255,0,0,0,255,0,0,0,255,0,0,0,227,0,0,0,73])}),
        "6": Object.freeze({w: 8, h: 8, data: new Uint8ClampedArray([0,0,0,0,0,0,0,92,0,0,0,233,0,0,0,255,0,0,0,255,0,0,0,255,0,0,0,192,0,0,0,0,0,0,0,41,0,0,0,253,92,92,92,255,221,221,221,255,254,254,254,255,192,192,192,255,0,0,0,192,0,0,0,0,0,0,0,132,41,41,41,255,252,252,252,255,91,91,91,255,3,3,3,255,0,0,0,255,0,0,0,221,0,0,0,0,0,0,0,187,108,108,108,255,254,254,254,255,218,218,218,255,240,240,240,255,118,118,118,255,0,0,0,254,0,0,0,17,0,0,0,193,114,114,114,255,255,255,255,255,77,77,77,255,130,130,130,255,254,254,254,255,17,17,17,255,0,0,0,26,0,0,0,147,59,59,59,255,255,255,255,255,77,77,77,255,131,131,131,255,250,250,250,255,10,10,10,255,0,0,0,26,0,0,0,59,0,0,0,255,129,129,129,255,236,236,236,255,230,230,230,255,97,97,97,255,0,0,0,252,0,0,0,10,0,0,0,0,0,0,0,129,0,0,0,246,0,0,0,254,0,0,0,254,0,0,0,240,0,0,0,97,0,0,0,0])}),
        "7": Object.freeze({w: 7, h: 8, data: new Uint8ClampedArray([0,0,0,120,0,0,0,255,0,0,0,255,0,0,0,255,0,0,0,255,0,0,0,255,0,0,0,239,0,0,0,120,120,120,120,255,255,255,255,255,255,255,255,255,255,255,255,255,239,239,239,255,0,0,0,250,0,0,0,120,0,0,0,255,0,0,0,255,2,2,2,255,221,221,221,255,168,168,168,255,0,0,0,251,0,0,0,0,0,0,0,0,0,0,0,208,78,78,78,255,255,255,255,255,54,54,54,255,0,0,0,186,0,0,0,0,0,0,0,43,0,0,0,255,188,188,188,255,196,196,196,255,0,0,0,255,0,0,0,54,0,0,0,0,0,0,0,170,43,43,43,255,255,255,255,255,82,82,82,255,0,0,0,215,0,0,0,0,0,0,0,0,0,0,0,170,153,153,153,255,222,222,222,255,2,2,2,255,0,0,0,83,0,0,0,0,0,0,0,0,0,0,0,153,0,0,0,242,0,0,0,242,0,0,0,222,0,0,0,2,0,0,0,0])}),
        "8": Object.freeze({w: 8, h: 8, data: new Uint8ClampedArray([0,0,0,24,0,0,0,202,0,0,0,253,0,0,0,255,0,0,0,255,0,0,0,245,0,0,0,125,0,0,0,0,0,0,0,95,24,24,24,255,196,196,196,255,247,247,247,255,236,236,236,255,126,126,126,255,0,0,0,240,0,0,0,0,0,0,0,97,78,78,78,255,255,255,255,255,63,63,63,255,168,168,168,255,225,225,225,255,0,0,0,245,0,0,0,0,0,0,0,149,5,5,5,255,201,201,201,255,255,255,255,255,254,254,254,255,95,95,95,255,0,0,0,254,0,0,0,4,0,0,0,170,100,100,100,255,252,252,252,255,31,31,31,255,139,139,139,255,238,238,238,255,4,4,4,255,0,0,0,9,0,0,0,174,112,112,112,255,251,251,251,255,38,38,38,255,143,143,143,255,250,250,250,255,5,5,5,255,0,0,0,9,0,0,0,122,18,18,18,254,185,185,185,255,245,245,245,255,231,231,231,255,106,106,106,255,0,0,0,252,0,0,0,5,0,0,0,17,0,0,0,190,0,0,0,252,0,0,0,255,0,0,0,254,0,0,0,241,0,0,0,106,0,0,0,0])}),
        "9": Object.freeze({w: 8, h: 8, data: new Uint8ClampedArray([0,0,0,12,0,0,0,180,0,0,0,252,0,0,0,254,0,0,0,253,0,0,0,217,0,0,0,48,0,0,0,0,0,0,0,123,14,14,14,253,176,176,176,255,244,244,244,255,208,208,208,255,50,50,50,253,0,0,0,212,0,0,0,0,0,0,0,189,117,117,117,255,246,246,246,255,31,31,31,255,185,185,185,255,202,202,202,255,0,0,0,254,0,0,0,5,0,0,0,193,128,128,128,255,246,246,246,255,31,31,31,255,185,185,185,255,252,252,252,255,5,5,5,255,0,0,0,7,0,0,0,140,25,25,25,254,198,198,198,255,246,246,246,255,223,223,223,255,248,248,248,255,2,2,2,255,0,0,0,7,0,0,0,71,0,0,0,255,0,0,0,255,17,17,17,255,187,187,187,255,180,180,180,255,0,0,0,253,0,0,0,2,0,0,0,52,52,52,52,255,255,255,255,255,245,245,245,255,183,183,183,255,33,33,33,251,0,0,0,188,0,0,0,0,0,0,0,52,0,0,0,255,0,0,0,255,0,0,0,255,0,0,0,252,0,0,0,191,0,0,0,28,0,0,0,0])}),
        "+": Object.freeze({w: 8, h: 7, data: new Uint8ClampedArray([0,0,0,0,0,0,0,0,0,0,0,28,0,0,0,213,0,0,0,213,0,0,0,208,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,53,35,35,35,249,215,215,215,254,0,0,0,246,0,0,0,0,0,0,0,0,0,0,0,40,0,0,0,255,0,0,0,255,28,28,28,255,208,208,208,255,0,0,0,255,0,0,0,255,0,0,0,220,0,0,0,40,40,40,40,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,220,220,220,255,0,0,0,220,0,0,0,40,0,0,0,255,0,0,0,255,28,28,28,255,208,208,208,255,0,0,0,255,0,0,0,255,0,0,0,220,0,0,0,0,0,0,0,0,0,0,0,53,35,35,35,249,215,215,215,254,0,0,0,246,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,28,0,0,0,213,0,0,0,213,0,0,0,208,0,0,0,0,0,0,0,0])}),
    }),
    32: Object.freeze({
        "0": Object.freeze({w: 12, h: 12, data: new Uint8ClampedArray([0,0,0,0,0,0,0,0,0,0,0,80,0,0,0,219,0,0,0,254,0,0,0,255,0,0,0,255,0,0,0,252,0,0,0,192,0,0,0,44,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,88,0,0,0,254,80,80,80,255,202,202,202,255,247,247,247,255,241,241,241,255,179,179,179,255,44,44,44,255,0,0,0,245,0,0,0,36,0,0,0,0,0,0,0,3,0,0,0,237,88,88,88,255,254,254,254,255,225,225,225,255,32,32,32,255,71,71,71,255,252,252,252,255,241,241,241,255,36,36,36,255,0,0,0,179,0,0,0,0,0,0,0,49,3,3,3,255,227,227,227,255,255,255,255,255,126,126,126,255,0,0,0,249,0,0,0,255,195,195,195,255,255,255,255,255,166,166,166,255,0,0,0,250,0,0,0,0,0,0,0,111,47,47,47,255,255,255,255,255,255,255,255,255,90,90,90,255,0,0,0,197,0,0,0,245,159,159,159,255,255,255,255,255,237,237,237,255,0,0,0,255,0,0,0,11,0,0,0,153,76,76,76,255,255,255,255,255,255,255,255,255,77,77,77,255,0,0,0,175,0,0,0,238,146,146,146,255,255,255,255,255,255,255,255,255,11,11,11,255,0,0,0,22,0,0,0,153,77,77,77,255,255,255,255,255,255,255,255,255,78,78,78,255,0,0,0,175,0,0,0,238,147,147,147,255,255,255,255,255,255,255,255,255,11,11,11,255,0,0,0,22,0,0,0,111,47,47,47,255,255,255,255,255,255,255,255,255,91,91,91,255,0,0,0,198,0,0,0,246,160,160,160,255,255,255,255,255,237,237,237,255,0,0,0,255,0,0,0,11,0,0,0,49,3,3,3,255,228,228,228,255,255,255,255,255,127,127,127,255,0,0,0,249,0,0,0,255,196,196,196,255,255,255,255,255,166,166,166,255,0,0,0,250,0,0,0,0,0,0,0,3,0,0,0,238,91,91,91,255,255,255,255,255,226,226,226,255,33,33,33,255,72,72,72,255,252,252,252,255,242,242,242,255,38,38,38,255,0,0,0,179,0,0,0,0,0,0,0,0,0,0,0,91,0,0,0,255,83,83,83,255,203,203,203,255,248,248,248,255,242,242,242,255,181,181,181,255,47,47,47,255,0,0,0,246,0,0,0,38,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,83,0,0,0,220,0,0,0,254,0,0,0,255,0,0,0,255,0,0,0,252,0,0,0,195,0,0,0,47,0,0,0,0,0,0,0,0])}),
        "1": Object.freeze({w: 10, h: 12, data: new Uint8ClampedArray([0,0,0,9,0,0,0,105,0,0,0,227,0,0,0,255,0,0,0,255,0,0,0,255,0,0,0,255,0,0,0,116,0,0,0,0,0,0,0,0,0,0,0,104,45,45,45,220,105,105,105,251,207,207,207,255,255,255,255,255,255,255,255,255,116,116,116,255,0,0,0,179,0,0,0,0,0,0,0,0,0,0,0,104,134,134,134,233,162,162,162,253,58,58,58,255,255,255,255,255,255,255,255,255,116,116,116,255,0,0,0,214,0,0,0,0,0,0,0,0,0,0,0,98,0,0,0,195,0,0,0,211,8,8,8,255,255,255,255,255,255,255,255,255,116,116,116,255,0,0,0,214,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,23,8,8,8,255,255,255,255,255,255,255,255,255,116,116,116,255,0,0,0,214,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,23,8,8,8,255,255,255,255,255,255,255,255,255,116,116,116,255,0,0,0,214,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,23,8,8,8,255,255,255,255,255,255,255,255,255,116,116,116,255,0,0,0,214,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,23,8,8,8,255,255,255,255,255,255,255,255,255,116,116,116,255,0,0,0,214,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,23,8,8,8,255,255,255,255,255,255,255,255,255,116,116,116,255,0,0,0,214,0,0,0,0,0,0,0,0,0,0,0,92,0,0,0,255,0,0,0,255,8,8,8,255,255,255,255,255,255,255,255,255,116,116,116,255,0,0,0,255,0,0,0,255,0,0,0,200,0,0,0,92,92,92,92,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,200,200,200,255,0,0,0,200,0,0,0,92,0,0,0,255,0,0,0,255,0,0,0,255,0,0,0,255,0,0,0,255,0,0,0,255,0,0,0,255,0,0,0,255,0,0,0,200])}),
        "2": Object.freeze({w: 10, h: 12, data: new Uint8ClampedArray([0,0,0,39,0,0,0,162,0,0,0,243,0,0,0,255,0,0,0,255,0,0,0,255,0,0,0,246,0,0,0,178,0,0,0,37,0,0,0,0,0,0,0,186,58,58,58,239,147,147,147,254,222,222,222,255,249,249,249,255,226,226,226,255,165,165,165,255,37,37,37,255,0,0,0,240,0,0,0,20,0,0,0,186,193,193,193,249,94,94,94,253,26,26,26,255,24,24,24,255,187,187,187,255,255,255,255,255,236,236,236,255,20,20,20,255,0,0,0,108,0,0,0,174,0,0,0,203,0,0,0,209,0,0,0,123,0,0,0,228,64,64,64,255,255,255,255,255,255,255,255,255,96,96,96,255,0,0,0,167,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,9,0,0,0,233,88,88,88,255,255,255,255,255,255,255,255,255,101,101,101,255,0,0,0,169,0,0,0,0,0,0,0,0,0,0,0,3,0,0,0,182,9,9,9,255,207,207,207,255,255,255,255,255,246,246,246,255,27,27,27,255,0,0,0,117,0,0,0,0,0,0,0,0,0,0,0,158,3,3,3,255,178,178,178,255,255,255,255,255,253,253,253,255,89,89,89,255,0,0,0,250,0,0,0,27,0,0,0,0,0,0,0,135,0,0,0,255,157,157,157,255,255,255,255,255,253,253,253,255,90,90,90,255,0,0,0,254,0,0,0,89,0,0,0,0,0,0,0,111,0,0,0,255,135,135,135,255,255,255,255,255,255,255,255,255,103,103,103,255,0,0,0,254,0,0,0,90,0,0,0,0,0,0,0,0,0,0,0,240,111,111,111,255,255,255,255,255,255,255,255,255,125,125,125,255,0,0,0,255,0,0,0,255,0,0,0,255,0,0,0,255,0,0,0,136,0,0,0,240,228,228,228,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,136,136,136,255,0,0,0,136,0,0,0,228,0,0,0,255,0,0,0,255,0,0,0,255,0,0,0,255,0,0,0,255,0,0,0,255,0,0,0,255,0,0,0,255,0,0,0,136])}),
        "3": Object.freeze({w: 11, h: 12, data: new Uint8ClampedArray([0,0,0,0,0,0,0,24,0,0,0,150,0,0,0,239,0,0,0,255,0,0,0,255,0,0,0,255,0,0,0,252,0,0,0,211,0,0,0,73,0,0,0,0,0,0,0,0,0,0,0,142,57,57,57,225,144,144,144,253,216,216,216,255,249,249,249,255,239,239,239,255,193,193,193,255,73,73,73,255,0,0,0,253,0,0,0,42,0,0,0,0,0,0,0,142,163,163,163,239,97,97,97,252,22,22,22,255,22,22,22,255,172,172,172,255,255,255,255,255,251,251,251,255,42,42,42,255,0,0,0,114,0,0,0,0,0,0,0,130,0,0,0,176,0,0,0,182,0,0,0,132,0,0,0,240,76,76,76,255,255,255,255,255,255,255,255,255,86,86,86,255,0,0,0,125,0,0,0,0,0,0,0,0,0,0,0,80,0,0,0,255,0,0,0,255,24,24,24,255,172,172,172,255,255,255,255,255,225,225,225,255,19,19,19,255,0,0,0,99,0,0,0,0,0,0,0,0,0,0,0,80,80,80,80,255,255,255,255,255,255,255,255,255,255,255,255,255,233,233,233,255,63,63,63,255,0,0,0,255,0,0,0,66,0,0,0,0,0,0,0,0,0,0,0,80,0,0,0,255,1,1,1,255,30,30,30,255,170,170,170,255,255,255,255,255,249,249,249,255,51,51,51,255,0,0,0,165,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,31,0,0,0,192,23,23,23,255,255,255,255,255,255,255,255,255,143,143,143,255,0,0,0,214,0,0,0,15,0,0,0,186,0,0,0,204,0,0,0,204,0,0,0,96,0,0,0,193,21,21,21,255,255,255,255,255,255,255,255,255,140,140,140,255,0,0,0,213,0,0,0,15,65,65,65,208,193,193,193,252,67,67,67,254,16,16,16,255,26,26,26,255,167,167,167,255,255,255,255,255,246,246,246,255,45,45,45,255,0,0,0,160,0,0,0,15,0,0,0,205,80,80,80,248,183,183,183,255,233,233,233,255,251,251,251,255,228,228,228,255,167,167,167,255,46,46,46,255,0,0,0,249,0,0,0,45,0,0,0,0,0,0,0,70,0,0,0,202,0,0,0,251,0,0,0,255,0,0,0,255,0,0,0,255,0,0,0,247,0,0,0,183,0,0,0,46,0,0,0,0])}),
        "4": Object.freeze({w: 12, h: 12, data: new Uint8ClampedArray([0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,173,0,0,0,255,0,0,0,255,0,0,0,255,0,0,0,255,0,0,0,164,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,125,1,1,1,255,173,173,173,255,255,255,255,255,255,255,255,255,164,164,164,255,0,0,0,223,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,74,0,0,0,254,124,124,124,255,255,255,255,255,255,255,255,255,255,255,255,255,164,164,164,255,0,0,0,244,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,37,0,0,0,246,74,74,74,255,253,253,253,255,201,201,201,255,221,221,221,255,255,255,255,255,164,164,164,255,0,0,0,244,0,0,0,0,0,0,0,0,0,0,0,13,0,0,0,221,37,37,37,255,240,240,240,255,241,241,241,255,34,34,34,255,216,216,216,255,255,255,255,255,164,164,164,255,0,0,0,244,0,0,0,0,0,0,0,0,0,0,0,102,13,13,13,255,213,213,213,255,255,255,255,255,90,90,90,255,0,0,0,255,216,216,216,255,255,255,255,255,164,164,164,255,0,0,0,244,0,0,0,0,0,0,0,0,0,0,0,160,94,94,94,255,255,255,255,255,160,160,160,255,0,0,0,255,0,0,0,255,216,216,216,255,255,255,255,255,164,164,164,255,0,0,0,255,0,0,0,255,0,0,0,24,0,0,0,155,96,96,96,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,24,24,24,255,0,0,0,24,0,0,0,96,0,0,0,255,0,0,0,255,0,0,0,255,0,0,0,255,0,0,0,255,216,216,216,255,255,255,255,255,164,164,164,255,0,0,0,255,0,0,0,255,0,0,0,24,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,254,216,216,216,255,255,255,255,255,164,164,164,255,0,0,0,244,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,249,216,216,216,255,255,255,255,255,164,164,164,255,0,0,0,223,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,216,0,0,0,255,0,0,0,255,0,0,0,255,0,0,0,164,0,0,0,0,0,0,0,0])}),
        "5": Object.freeze({w: 10, h: 12, data: new Uint8ClampedArray([0,0,0,132,0,0,0,255,0,0,0,255,0,0,0,255,0,0,0,255,0,0,0,255,0,0,0,255,0,0,0,255,0,0,0,255,0,0,0,8,0,0,0,196,132,132,132,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,8,8,8,255,0,0,0,8,0,0,0,227,132,132,132,255,255,255,255,255,148,148,148,255,0,0,0,255,0,0,0,255,0,0,0,255,0,0,0,255,0,0,0,255,0,0,0,8,0,0,0,227,132,132,132,255,255,255,255,255,148,148,148,255,0,0,0,255,0,0,0,255,0,0,0,249,0,0,0,196,0,0,0,51,0,0,0,0,0,0,0,221,132,132,132,255,255,255,255,255,248,248,248,255,250,250,250,255,231,231,231,255,181,181,181,255,51,51,51,255,0,0,0,251,0,0,0,52,0,0,0,185,110,110,110,255,107,107,107,255,31,31,31,255,22,22,22,255,167,167,167,255,255,255,255,255,249,249,249,255,52,52,52,255,0,0,0,180,0,0,0,110,0,0,0,171,0,0,0,181,0,0,0,136,0,0,0,188,15,15,15,255,252,252,252,255,255,255,255,255,161,161,161,255,0,0,0,236,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,29,0,0,0,255,232,232,232,255,255,255,255,255,190,190,190,255,0,0,0,246,0,0,0,183,0,0,0,208,0,0,0,212,0,0,0,117,0,0,0,186,15,15,15,255,252,252,252,255,255,255,255,255,157,157,157,255,0,0,0,234,0,0,0,197,197,197,197,251,89,89,89,254,25,25,25,255,22,22,22,255,167,167,167,255,255,255,255,255,244,244,244,255,43,43,43,255,0,0,0,174,0,0,0,197,63,63,63,244,161,161,161,254,219,219,219,255,247,247,247,255,223,223,223,255,164,164,164,255,39,39,39,255,0,0,0,247,0,0,0,43,0,0,0,48,0,0,0,177,0,0,0,244,0,0,0,255,0,0,0,255,0,0,0,255,0,0,0,245,0,0,0,178,0,0,0,39,0,0,0,0])}),
        "6": Object.freeze({w: 11, h: 12, data: new Uint8ClampedArray([0,0,0,0,0,0,0,0,0,0,0,18,0,0,0,150,0,0,0,242,0,0,0,255,0,0,0,255,0,0,0,254,0,0,0,234,0,0,0,122,0,0,0,7,0,0,0,0,0,0,0,17,0,0,0,223,18,18,18,255,142,142,142,255,223,223,223,255,248,248,248,255,215,215,215,255,125,125,125,251,58,58,58,206,0,0,0,76,0,0,0,0,0,0,0,156,17,17,17,255,218,218,218,255,252,252,252,255,104,104,104,255,17,17,17,255,31,31,31,255,129,129,129,251,121,121,121,219,0,0,0,76,0,0,0,1,0,0,0,248,149,149,149,255,255,255,255,255,156,156,156,255,0,0,0,255,0,0,0,255,0,0,0,255,0,0,0,247,0,0,0,198,0,0,0,71,0,0,0,22,1,1,1,255,236,236,236,255,255,255,255,255,212,212,212,255,228,228,228,255,247,247,247,255,213,213,213,255,102,102,102,255,0,0,0,255,0,0,0,104,0,0,0,46,21,21,21,255,255,255,255,255,255,255,255,255,252,252,252,255,60,60,60,255,40,40,40,255,238,238,238,255,255,255,255,255,104,104,104,255,0,0,0,230,0,0,0,49,26,26,26,255,255,255,255,255,255,255,255,255,201,201,201,255,0,0,0,255,0,0,0,253,165,165,165,255,255,255,255,255,213,213,213,255,0,0,0,254,0,0,0,30,5,5,5,255,249,249,249,255,255,255,255,255,181,181,181,255,0,0,0,252,0,0,0,241,145,145,145,255,255,255,255,255,244,244,244,255,0,0,0,255,0,0,0,5,0,0,0,254,186,186,186,255,255,255,255,255,201,201,201,255,0,0,0,255,0,0,0,253,165,165,165,255,255,255,255,255,206,206,206,255,0,0,0,254,0,0,0,0,0,0,0,201,55,55,55,255,249,249,249,255,252,252,252,255,60,60,60,255,39,39,39,255,237,237,237,255,254,254,254,255,79,79,79,255,0,0,0,221,0,0,0,0,0,0,0,55,0,0,0,251,58,58,58,255,189,189,189,255,244,244,244,255,237,237,237,255,191,191,191,255,63,63,63,255,0,0,0,254,0,0,0,79,0,0,0,0,0,0,0,0,0,0,0,58,0,0,0,204,0,0,0,253,0,0,0,255,0,0,0,255,0,0,0,252,0,0,0,207,0,0,0,63,0,0,0,0])}),
        "7": Object.freeze({w: 11, h: 12, data: new Uint8ClampedArray([0,0,0,16,0,0,0,255,0,0,0,255,0,0,0,255,0,0,0,255,0,0,0,255,0,0,0,255,0,0,0,255,0,0,0,255,0,0,0,255,0,0,0,160,0,0,0,16,16,16,16,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,160,160,160,255,0,0,0,213,0,0,0,16,0,0,0,255,0,0,0,255,0,0,0,255,0,0,0,255,0,0,0,255,90,90,90,255,255,255,255,255,255,255,255,255,141,141,141,255,0,0,0,219,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,49,0,0,0,255,198,198,198,255,255,255,255,255,253,253,253,255,37,37,37,255,0,0,0,158,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,176,49,49,49,255,255,255,255,255,255,255,255,255,172,172,172,255,0,0,0,255,0,0,0,37,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,17,0,0,0,253,157,157,157,255,255,255,255,255,255,255,255,255,53,53,53,255,0,0,0,189,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,125,17,17,17,255,246,246,246,255,255,255,255,255,190,190,190,255,0,0,0,255,0,0,0,53,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,2,0,0,0,237,116,116,116,255,255,255,255,255,255,255,255,255,71,71,71,255,0,0,0,208,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,76,2,2,2,255,221,221,221,255,255,255,255,255,208,208,208,255,0,0,0,255,0,0,0,71,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,203,75,75,75,255,255,255,255,255,255,255,255,255,89,89,89,255,0,0,0,225,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,203,182,182,182,255,255,255,255,255,223,223,223,255,3,3,3,255,0,0,0,91,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,182,0,0,0,255,0,0,0,255,0,0,0,255,0,0,0,223,0,0,0,3,0,0,0,0,0,0,0,0,0,0,0,0])}),
        "8": Object.freeze({w: 11, h: 12, data: new Uint8ClampedArray([0,0,0,0,0,0,0,15,0,0,0,151,0,0,0,241,0,0,0,255,0,0,0,255,0,0,0,255,0,0,0,254,0,0,0,228,0,0,0,110,0,0,0,0,0,0,0,0,0,0,0,176,15,15,15,255,145,145,145,255,221,221,221,255,246,246,246,255,241,241,241,255,207,207,207,255,110,110,110,255,0,0,0,255,0,0,0,102,0,0,0,0,0,0,0,245,171,171,171,255,255,255,255,255,214,214,214,255,23,23,23,255,58,58,58,255,251,251,251,255,255,255,255,255,102,102,102,255,0,0,0,195,0,0,0,0,0,0,0,250,223,223,223,255,255,255,255,255,152,152,152,255,0,0,0,254,0,0,0,255,225,225,225,255,255,255,255,255,155,155,155,255,0,0,0,212,0,0,0,0,0,0,0,240,138,138,138,255,255,255,255,255,214,214,214,255,23,23,23,255,58,58,58,255,252,252,252,255,251,251,251,255,71,71,71,255,0,0,0,183,0,0,0,0,0,0,0,211,2,2,2,255,162,162,162,255,255,255,255,255,255,255,255,255,255,255,255,255,251,251,251,255,101,101,101,255,0,0,0,255,0,0,0,137,0,0,0,17,0,0,0,255,159,159,159,255,255,255,255,255,201,201,201,255,23,23,23,255,50,50,50,255,242,242,242,255,254,254,254,255,92,92,92,255,0,0,0,222,0,0,0,37,17,17,17,255,255,255,255,255,255,255,255,255,103,103,103,255,0,0,0,241,0,0,0,254,171,171,171,255,255,255,255,255,204,204,204,255,0,0,0,249,0,0,0,37,21,21,21,255,255,255,255,255,255,255,255,255,103,103,103,255,0,0,0,241,0,0,0,254,172,172,172,255,255,255,255,255,208,208,208,255,0,0,0,250,0,0,0,21,0,0,0,255,189,189,189,255,255,255,255,255,201,201,201,255,23,23,23,255,49,49,49,255,242,242,242,255,255,255,255,255,120,120,120,255,0,0,0,230,0,0,0,0,0,0,0,193,15,15,15,255,133,133,133,255,216,216,216,255,245,245,245,255,239,239,239,255,203,203,203,255,101,101,101,255,1,1,1,255,0,0,0,121,0,0,0,0,0,0,0,15,0,0,0,140,0,0,0,237,0,0,0,254,0,0,0,255,0,0,0,255,0,0,0,253,0,0,0,224,0,0,0,102,0,0,0,1])}),
        "9": Object.freeze({w: 11, h: 12, data: new Uint8ClampedArray([0,0,0,0,0,0,0,3,0,0,0,111,0,0,0,229,0,0,0,254,0,0,0,255,0,0,0,255,0,0,0,247,0,0,0,165,0,0,0,22,0,0,0,0,0,0,0,0,0,0,0,158,3,3,3,255,109,109,109,255,210,210,210,255,246,246,246,255,232,232,232,255,156,156,156,255,22,22,22,255,0,0,0,220,0,0,0,10,0,0,0,28,0,0,0,255,157,157,157,255,255,255,255,255,192,192,192,255,18,18,18,255,127,127,127,255,255,255,255,255,215,215,215,255,10,10,10,255,0,0,0,118,0,0,0,85,28,28,28,255,254,254,254,255,255,255,255,255,93,93,93,255,0,0,0,243,18,18,18,255,255,255,255,255,255,255,255,255,112,112,112,255,0,0,0,216,0,0,0,107,64,64,64,255,255,255,255,255,255,255,255,255,73,73,73,255,0,0,0,191,0,0,0,255,252,252,252,255,255,255,255,255,182,182,182,255,0,0,0,248,0,0,0,89,34,34,34,255,255,255,255,255,255,255,255,255,93,93,93,255,0,0,0,242,17,17,17,255,255,255,255,255,255,255,255,255,209,209,209,255,0,0,0,252,0,0,0,34,0,0,0,255,183,183,183,255,255,255,255,255,191,191,191,255,17,17,17,255,125,125,125,255,255,255,255,255,255,255,255,255,204,204,204,255,0,0,0,252,0,0,0,0,0,0,0,187,15,15,15,255,148,148,148,255,227,227,227,255,248,248,248,255,216,216,216,255,230,230,230,255,255,255,255,255,164,164,164,255,0,0,0,242,0,0,0,0,0,0,0,131,0,0,0,221,0,0,0,251,0,0,0,255,0,0,0,255,4,4,4,255,226,226,226,255,255,255,255,255,76,76,76,255,0,0,0,191,0,0,0,0,0,0,0,136,153,153,153,239,92,92,92,253,16,16,16,255,30,30,30,255,160,160,160,255,255,255,255,255,163,163,163,255,0,0,0,255,0,0,0,76,0,0,0,0,0,0,0,136,56,56,56,228,161,161,161,254,230,230,230,255,247,247,247,255,207,207,207,255,108,108,108,255,2,2,2,255,0,0,0,164,0,0,0,0,0,0,0,0,0,0,0,26,0,0,0,168,0,0,0,246,0,0,0,255,0,0,0,255,0,0,0,254,0,0,0,228,0,0,0,109,0,0,0,2,0,0,0,0])}),
        "+": Object.freeze({w: 12, h: 10, data: new Uint8ClampedArray([0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,244,0,0,0,251,0,0,0,251,0,0,0,172,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,255,244,244,244,255,172,172,172,255,0,0,0,228,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,255,244,244,244,255,172,172,172,255,0,0,0,246,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,132,0,0,0,255,0,0,0,255,0,0,0,255,0,0,0,255,244,244,244,255,172,172,172,255,0,0,0,255,0,0,0,255,0,0,0,255,0,0,0,255,0,0,0,64,0,0,0,196,132,132,132,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,64,64,64,255,0,0,0,112,0,0,0,196,132,132,132,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,64,64,64,255,0,0,0,112,0,0,0,132,0,0,0,255,0,0,0,255,0,0,0,255,0,0,0,255,244,244,244,255,172,172,172,255,0,0,0,255,0,0,0,255,0,0,0,255,0,0,0,255,0,0,0,64,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,255,244,244,244,255,172,172,172,255,0,0,0,246,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,255,244,244,244,255,172,172,172,255,0,0,0,228,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,244,0,0,0,251,0,0,0,251,0,0,0,172,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0])}),
    }),
});

async function renderCompactBlockedCountIcon(count) {
    const text = formatCompactBlockedCount(count);
    const imageData = {};
    for (const size of Object.keys(actionIconPaths).map(Number)) {
        const digits = countDigitData[size];
        const base = getActionIconBaseImageData(size);
        const canvas = new OffscreenCanvas(size, size);
        const context = canvas.getContext("2d");
        context.putImageData(base, 0, 0);

        // Calculate total width of the count string
        let totalWidth = 0;
        const chars = [];
        for (const ch of text) {
            const d = digits[ch];
            if (d) {
                chars.push(d);
                totalWidth += d.w;
            }
        }

        // Position right-aligned at bottom of icon
        let x = Math.round(size - 0.5 - totalWidth);
        const digitHeight = size === 16 ? 8 : 12;
        const y = size - 1 - digitHeight;

        for (const d of chars) {
            context.putImageData(new ImageData(d.data, d.w, d.h), x, y);
            x += d.w;
        }

        imageData[size] = context.getImageData(0, 0, size, size);
    }
    return imageData;
}

async function clearBlockedCountIcon(tabId) {
    try {
        await Promise.all([
            actionSetBadgeText({ tabId, text: "" }, "clearBlockedCountIcon.setBadgeText"),
            actionSetIcon({ tabId, path: actionIconPaths }, "clearBlockedCountIcon.setIcon"),
            actionSetTitle({ tabId, title: actionDefaultTitle }, "clearBlockedCountIcon.setTitle"),
        ]);
    } catch (err) {
        logNonStaleTabError("clearBlockedCountIcon failed", err);
    }
}

async function updateBlockedCountBadge(tabId) {
    try {
        const count = (blockedDnrCountByTab.get(tabId) || 0) +
            getBlockedCosmeticCount(tabId);
        const settings = await readUserSettings();
        if (settings.showIconBadge === false || count === 0) {
            await clearBlockedCountIcon(tabId);
            return;
        }
        const iconRender = renderCompactBlockedCountIcon(count).then(imageData =>
            actionSetIcon({ tabId, imageData }, "updateBlockedCountBadge.setIcon")
        );
        const results = await Promise.allSettled([
            iconRender,
            actionSetBadgeText({ tabId, text: "" }, "updateBlockedCountBadge.setBadgeText"),
            actionSetTitle({
                tabId,
                title: `${actionDefaultTitle} — ${ formatCompactBlockedCount(count) } blocked`,
            }, "updateBlockedCountBadge.setTitle"),
        ]);
        for (const r of results) {
            if (r.status === "rejected") {
                logNonStaleTabError("Badge update sub-task failed", r.reason);
            }
        }
    } catch (err) {
        logNonStaleTabError("updateBlockedCountBadge failed", err);
    }
}

function scheduleBlockedCountBadgeUpdate(tabId) {
    if (pendingBadgeUpdates.has(tabId)) return;
    pendingBadgeUpdates.add(tabId);
    setTimeout(() => {
        pendingBadgeUpdates.delete(tabId);
        void updateBlockedCountBadge(tabId).catch(err => { console.warn("[uBlock Ultimate] scheduleBlockedCountBadgeUpdate:", err); });
    }, 100);
}

function resetBlockedCountBadge(tabId) {
    blockedDnrCountByTab.delete(tabId);
    blockedCosmeticCountByTab.delete(tabId);
    pendingBadgeUpdates.delete(tabId);
    void clearBlockedCountIcon(tabId).catch(err => { console.warn("[uBlock Ultimate] resetBlockedCountBadge:", err); });
}

// The popup uses getMatchedRules() as its DNR source of truth.  Keep the
// action icon's event-driven total in sync whenever that same count is read:
// on some Chromium builds onRuleMatchedDebug does not deliver every match,
// which otherwise leaves the popup with a count while the icon stays empty.
async function syncBlockedDnrCountWithPopup(tabId, count) {
    if (typeof tabId !== "number" || tabId <= 0) return;
    if (count > 0) {
        blockedDnrCountByTab.set(tabId, count);
    } else {
        blockedDnrCountByTab.delete(tabId);
    }
    await updateBlockedCountBadge(tabId);
}

// Bump tab revision on DNR rule matches so popup polling detects blocked-count
// changes, and update the action badge for block rules on that same tab.
try {
  chrome.declarativeNetRequest.onRuleMatchedDebug.addListener((info) => {
      const tabId = info?.request?.tabId ?? info?.tabId;
      if (!tabId || tabId <= 0) return;
      markTabChanged(tabId);

      // Use the action type from the async getMatchedRuleActionType lookup to
      // ensure we always have a valid action, even in Chrome builds where the
      // event's action.type may be absent. Schedule the lookup inline so that
      // recordRuleMatch is called before webRequest events settle.
      const actionType = getMatchedRuleActionType(info.rule);

      void actionType.then(action => {
          loggerRuntime.recordRuleMatch({
              ...info,
              rule: {
                  ...info.rule,
                  action: {
                      type: action,
                  },
              },
          });
      }).catch(() => {
          loggerRuntime.recordRuleMatch(info);
      });

      void (async () => {
          await ensureFilterReverseIndex();

          const rulesetId = info.rule?.rulesetId || "_dynamic";

          const source = lookupFilterByRuleId(rulesetId, info.rule?.ruleId);

          appendMatchedRuleLog(tabId, {
              time: Date.now(),
              url: info.request?.url || "",
              type: info.request?.type || "",
              initiator: info.request?.initiator || "",
              requestId: info.request?.requestId,
              rulesetId,
              ruleId: info.rule?.ruleId,
              source,
          });

          const action = await actionType;

          if (action !== "block") return;
          blockedDnrCountByTab.set(tabId, (blockedDnrCountByTab.get(tabId) || 0) + 1);
          scheduleBlockedCountBadgeUpdate(tabId);
      })().catch(error => {
          console.warn("[uBlock Ultimate] matched rule attribution failed:", error);
      });
  });
} catch (err) {
    console.warn("[uBlock Ultimate] Failed to register onRuleMatchedDebug listener:", err);
}

function performanceInitiatorToRequestType(initiatorType) {
    switch (initiatorType) {
    case "script":
        return "script";
    case "iframe":
    case "frame":
        return "sub_frame";
    case "img":
    case "image":
        return "image";
    case "css":
    case "link":
        return "stylesheet";
    case "fetch":
    case "xmlhttprequest":
        return "xmlhttprequest";
    default:
        return "other";
    }
}

async function backfillPopupLedgerFromPageResources(tabId, pageURL) {
    if (!tabId || tabId < 0 || !isSupportedURL(pageURL)) return;
    let initialHostnames;
    try {
        initialHostnames = new Set(Object.keys(popupRequestLedgers.snapshotForTab(tabId, pageURL).hostnameDict || {}));
    } catch (_) {
        initialHostnames = new Set();
    }
    try {
        const results = await chrome.scripting.executeScript({
            target: { tabId, allFrames: true },
            func: () => {
                const entries = [];
                try {
                    for (const entry of performance.getEntriesByType("resource")) {
                        if (typeof entry.name !== "string" || entry.name === "") continue;
                        entries.push({
                            url: entry.name,
                            initiatorType: entry.initiatorType || "",
                        });
                    }
                } catch (_) {
                    // Ignore restricted performance entries.
                }
                return entries;
            },
        });
        let changed = false;
        let index = 0;
        for (const result of results || []) {
            const resources = Array.isArray(result?.result) ? result.result : [];
            for (const resource of resources) {
                const url = String(resource?.url || "");
                const hostname = hostnameFromURL(url);
                if (!hostname || initialHostnames.has(hostname) || isExtensionURL(url)) continue;
                const type = performanceInitiatorToRequestType(resource?.initiatorType);
                const requestId = `perf:${tabId}:${index++}:${url}`;
                popupRequestLedgers.recordBeforeRequest({
                    tabId,
                    requestId,
                    url,
                    type,
                    frameId: Number(result.frameId) || 0,
                    parentFrameId: -1,
                    documentUrl: pageURL,
                });
                popupRequestLedgers.finalizeCompleted({
                    tabId,
                    requestId,
                    url,
                    type,
                    frameId: Number(result.frameId) || 0,
                    parentFrameId: -1,
                });
                changed = true;
            }
        }
        if (changed) {
            markTabChanged(tabId);
            schedulePopupLedgerPersist();
        }
    } catch (err) {
        if (!isStaleTabError(err)) {
            console.warn("[uBlock Ultimate] backfillPopupLedgerFromPageResources failed:", err);
        }
    }
}

async function buildPopupData(tabId) {
    await Promise.all([
        ensurePermanentStateLoaded(),
        ensureWhitelistReady(),
    ]);
    await ensurePopupLedgerHydrated();
    await ensureLifetimeRequestCountsLoaded();
    const id = await resolveTabId(tabId);
    let tabTitle = "";
    let pageURL = "";
    let rawURL = "";
    if (id > 0) {
        try {
            const t = await chrome.tabs.get(id);
            tabTitle = t?.title || "";
            pageURL = t?.url || "";
            rawURL = pageURL;
        } catch (e) {
            console.warn("[uBlock Ultimate] buildPopupData: tabs.get failed for tab", id, e);
        }
    }

    const pageHostname = hostnameFromURL(pageURL);
    const pageDomain = domainFromHostname(pageHostname);
    const isSupported = isSupportedURL(pageURL);
    const manifest = chrome.runtime.getManifest();

    const storage = await chrome.storage.local.get(["selectedFilterLists"]);

    await backfillPopupLedgerFromPageResources(id, pageURL);
    const ledgerSnapshot = popupRequestLedgers.snapshotForTab(id, pageURL);
    const pageBlocked = ledgerSnapshot.pageCounts.blocked;
    const pageAllowed = ledgerSnapshot.pageCounts.allowed;
    const hostnameDict = ledgerSnapshot.hostnameDict;
    const tabBlocked = pageBlocked.any;
    const globalBlocked = lifetimeRequestCounts.blocked;
    try { await syncBlockedDnrCountWithPopup(id, tabBlocked); } catch (err) { console.warn("[uBlock Ultimate] buildPopupData badge sync:", err); }

    // Single immutable tab snapshot — no second tabs.get() call
    const pageCtx = resolvePolicyContextFromURL(id, pageURL);
    const policy = resolvePagePolicy({
        url: pageCtx.topURL,
        hostname: pageCtx.pageHostname,
        trusted: pageCtx.trusted,
        netFilteringEnabled: pageCtx.netFilteringEnabled,
        hostnameSwitches: pageCtx.hostnameSwitches,
    });
    const netFilteringSwitch = pageCtx.netFilteringEnabled;
    const effectiveSwitches = pageCtx.hostnameSwitches;
    const noPopups = effectiveSwitches.noPopups === true;
    const noLargeMedia = effectiveSwitches.noLargeMedia === true;
    const noCosmeticFiltering = effectiveSwitches.noCosmeticFiltering === true;
    const noRemoteFonts = effectiveSwitches.noRemoteFonts === true;
    const noScripting = effectiveSwitches.noScripting === true;
    const advancedUserEnabled = popupSettings.advancedUserEnabled === true;
    const colorBlindFriendly = popupSettings.colorBlindFriendly === true;
    const tooltipsDisabled = popupSettings.tooltipsDisabled === true;
    const popupPanelHeightMode = popupSettings.popupPanelHeightMode || 0;
    const godMode = popupSettings.godMode === true;
    const matrixIsDirty = computeMatrixIsDirty(pageHostname, hostnameDict);
    const firewallPaneMinimized = popupSettings.firewallPaneMinimized === true;

    return {
    tabId: id,
    tabTitle,
    appName: manifest.name || "uBlock Ultimate",
    appVersion: manifest.version || "0.0.0.0",
    rawURL,
    pageURL,
    pageHostname,
    pageDomain,
    contentLastModified: Math.max(getTabRevision(id), ledgerSnapshot.contentRevision || 0),

    netFilteringSwitch,
    advancedUserEnabled,
    matrixIsDirty,
    canElementPicker: isSupported && /^https?:\/\/(chrome\.google\.com|chromewebstore\.google\.com)\//.test(pageURL) === false,
    userFiltersAreEnabled: Array.isArray(storage.selectedFilterLists) ? storage.selectedFilterLists.includes("user-filters") : true,
    colorBlindFriendly,
    firewallPaneMinimized,
    tooltipsDisabled,
    popupPanelHeightMode,
    popupPanelOrientation: popupSettings.popupPanelOrientation || "auto",
	    popupPanelSections: typeof popupSettings.popupPanelSections === "number" ? popupSettings.popupPanelSections : 0b1111,
    popupPanelDisabledSections: typeof popupSettings.popupPanelDisabledSections === "number" ? popupSettings.popupPanelDisabledSections : 0,
    popupPanelLockedSections: typeof popupSettings.popupPanelLockedSections === "number" ? popupSettings.popupPanelLockedSections : 0,
    fontSize: popupSettings.fontSize || "unset",
    uiPopupConfig: popupSettings.uiPopupConfig,
    godMode,

    noPopups,
    noLargeMedia,
    noCosmeticFiltering,
    noRemoteFonts,
    noScripting,

    popupBlockedCount: popupBlockedCountByTab.get(id) || 0,
    // DNR getMatchedRules() does not distinguish request types — large media and
    // remote font blocked counts cannot be attributed per-type under MV3.
    largeMediaCount: 0,
    remoteFontCount: 0,
    reloadRequired: false,

	    globalBlockedRequestCount: globalBlocked,
	    globalAllowedRequestCount: lifetimeRequestCounts.allowed,
    pageCounts: { blocked: pageBlocked, allowed: pageAllowed },
    hostnameDict,
    cnameMap: [],
    firewallRules: getEffectiveFirewallRules(pageHostname, hostnameDict),
    hasUnprocessedRequest: tabUnprocessedRequest.has(id),
    };
}

// ---------------------------------------------------------------------------
// Badge counting scripts
// ---------------------------------------------------------------------------

async function getHiddenElementCount(tabId) {
    const reportedCount = typeof tabId === "number" && tabId > 0
        ? getBlockedCosmeticCount(tabId)
        : 0;
    try {
        const results = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: () => {
          const vapi = globalThis.vAPI;
          const filterer = vapi instanceof Object ? vapi.domFilterer : undefined;
          if (
              filterer instanceof Object === false ||
              typeof filterer.getAllSelectors !== "function"
          ) {
              return 0;
          }
          const details = filterer.getAllSelectors(0b11);
          const selectors = Array.isArray(details?.declarative)
              ? details.declarative
              : [];
          if (selectors.length === 0) return 0;
          const matched = new Set();
          for (const selector of selectors) {
              if (typeof selector !== "string" || selector === "") continue;
              try {
                  for (const element of document.querySelectorAll(selector)) {
                      matched.add(element);
                  }
              } catch {
                  // Ignore selectors unsupported by querySelectorAll().
              }
          }
          return matched.size;
      },
        });
        const liveCount = (results || []).reduce((sum, r) => sum + (Number(r.result) || 0), 0);
        return Math.max(liveCount, reportedCount);
    } catch (e) {
        console.warn("[uBlock Ultimate] getHiddenElementCount: executeScript failed", tabId, e);
        return reportedCount || -1;
    }
}

async function getScriptCount(tabId) {
    try {
        const results = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: () => document.scripts.length,
        });
        return (results || []).reduce((sum, r) => sum + (Number(r.result) || 0), 0);
    } catch (e) {
        console.warn("[uBlock Ultimate] getScriptCount: executeScript failed", tabId, e);
        return 0;
    }
}

// ---------------------------------------------------------------------------
// VAPI (localStorage + userCSS)
// ---------------------------------------------------------------------------
async function handleVAPI(msg, senderTabId) {
    if (msg?.what === "localStorage") {
        const key = msg?.args?.[0];
        const value = msg?.args?.[1];
        try {
            switch (msg.fn) {
            case "getItemAsync": {
                const r = await chrome.storage.local.get(key);
                return r[key] ?? null;
            }
            case "setItem": {
                await chrome.storage.local.set({ [key]: value });
                return null;
            }
            case "removeItem": {
                await chrome.storage.local.remove(key);
                return null;
            }
            case "clear": {
                await chrome.storage.local.clear();
                return null;
            }
            default: return { error: `Unknown localStorage fn: ${  msg.fn}` };
            }
        } catch (e) {
            return { error: String(e?.message || e) };
        }
    }

    if (msg?.what === "userCSS") {
        const tabId = msg._tabId || senderTabId;
        const frameId = msg._frameId;
        const documentId = msg._documentId;
        const addCSS = Array.isArray(msg.add) ? msg.add : [];
        const removeCSS = Array.isArray(msg.remove) ? msg.remove : [];
        if (!Number.isInteger(tabId) || tabId <= 0) {
            return { ok: false, error: "Missing valid CSS target tab" };
        }
        const target = { tabId };
        if (typeof documentId === "string" && documentId !== "") {
            target.documentIds = [documentId];
        } else if (Number.isInteger(frameId)) {
            target.frameIds = [frameId];
        }
        const added = [];
        const removed = [];
        try {
            for (const css of addCSS) {
                if (typeof css === "string" && css.length > 0) {
                    await chrome.scripting.insertCSS({ target, css });
                    added.push(css);
                }
            }
            for (const css of removeCSS) {
                if (typeof css === "string" && css.length > 0) {
                    await chrome.scripting.removeCSS({ target, css });
                    removed.push(css);
                }
            }
            return { ok: true, added, removed };
        } catch (e) {
            console.warn("[uBlock Ultimate] userCSS operation failed:", e);
            return { ok: false, error: String(e?.message || e), added, removed };
        }
    }

    return { error: `Unknown vapi message: ${  msg?.what}` };
}

// ---------------------------------------------------------------------------
// Capability layer action permissions
// ---------------------------------------------------------------------------

const ALLOWED_LAYER_ACTIONS = {
    cosmetic: ["hide", "remove-style", "inject-css", "hide-element", "unhide-element", "picker-launch", "picker-create-filter", "dom-remove"],
    video: ["observe", "hide", "remove", "neutralize-click", "skip-click", "mark"],
    smart: ["smart-style", "smart-observe", "smart-hide", "smart-unhide", "smart-limited-dom-mutation", "smart-selector-update", "smart-rollback"],
    interceptors: ["fetch-wrap", "xhr-wrap", "mutate-fetch-response", "mutate-xhr-response", "observe-dom", "response-mutation"],
};

// ---------------------------------------------------------------------------
// Content script handler
// ---------------------------------------------------------------------------
async function handleContentscript(msg, senderTabId, senderFrameId) {
    const tabId = Number.isInteger(senderTabId) ? senderTabId : (msg.tabId || msg._tabId || 0);
    const frameId = Number.isInteger(senderFrameId) ? senderFrameId : (msg.frameId || msg._frameId || 0);
    // Trust ONLY the browser-derived document id that the dispatcher stamps
    // from sender.documentId.  The page can set a `documentId` field on its own
    // outgoing messages, so that value is never authoritative.
    const senderDocumentId = msg._documentId || null;

    switch (msg.what) {

    case "retrieveContentScriptParameters": {
        const hostname = msg.hostname || hostnameFromURL(msg.url || "");
        const isYouTubePage = hostname !== "" && youtubeScopeApplies(hostname);
        if (isYouTubePage) {
            await cleanupStaleYouTubeMastheadFilters();
        }
        // Build cosmetic filters from user custom filters
        const userResult = await buildUserCosmeticFilters(hostname);
        // Also load compiled filter list cosmetic filters
        let compiledSpecificCSS = "";
        let compiledGenericCSS = "";
        let compiledProceduralCSS = "";
        let compiledProcedural = [];
        try {
            const stored = await chrome.storage.local.get(["cosmeticFiltersData"]);
            if (stored.cosmeticFiltersData) {
                const data = typeof stored.cosmeticFiltersData === "string"
                    ? JSON.parse(stored.cosmeticFiltersData)
                    : stored.cosmeticFiltersData;
                if (Array.isArray(data.specificCosmeticFilters)) {
                    const hostnameParts = hostname.split(".");
                    for (const entry of data.specificCosmeticFilters) {
                        if (!entry || !entry.domains || !entry.selector) continue;
                        const matches = cosmeticDomainsMatch(entry.domains, hostname);
                        if (matches) {
                            if (isProceduralCosmeticSelector(entry.selector)) {
                                compiledProcedural.push({ selector: entry.selector });
                                const prehide = prehideSelectorFromProceduralSelector(entry.selector);
                                if (prehide) {
                                    compiledProceduralCSS += `${prehide} { display: none !important; }\n`;
                                }
                            } else {
                                compiledSpecificCSS += `${entry.selector} { display: none !important; }\n`;
                            }
                        }
                    }
                }
                if (Array.isArray(data.genericCosmeticFilters)) {
                    for (const sel of data.genericCosmeticFilters) {
                        if (!sel) continue;
                        if (isProceduralCosmeticSelector(sel)) {
                            compiledProcedural.push({ selector: sel });
                            const prehide = prehideSelectorFromProceduralSelector(sel);
                            if (prehide) {
                                compiledProceduralCSS += `${prehide} { display: none !important; }\n`;
                            }
                        } else {
                            compiledGenericCSS += `${sel} { display: none !important; }\n`;
                        }
                    }
                }
            }
        } catch (e) {
            console.warn("[uBlock Ultimate] Error loading compiled cosmetic filters:", e);
        }
        const pageCtx = await resolvePolicyContext(tabId, msg.url);
        // Policy uses the top-level page hostname for authorization, trust,
        // net-filtering and hostname-switch selection. The frame hostname is
        // used only for cosmetic filter matching (passed via `hostname` below).
        const policy = resolvePagePolicy({
            url: pageCtx.topURL,
            hostname: pageCtx.pageHostname,
            trusted: pageCtx.trusted,
            netFilteringEnabled: pageCtx.netFilteringEnabled,
            hostnameSwitches: pageCtx.hostnameSwitches,
        });
        const userProcedural = userResult.proceduralFilters || [];
        const proceduralAllowed = policy.cosmeticField.procedural !== false;
        const specificAllowed = policy.cosmeticField.specific !== false;
        const genericAllowed = policy.cosmeticField.generic !== false;
        const cosmeticOn = policy.cosmeticFilteringEnabled !== false;
        // Gate all user CSS independently:
        // - specific/generic compiled CSS gated by respective policy field
        // - user CSS also gated by respective policy field
        // - when overall cosmetic filtering is off, no user hiding CSS is returned
        const allCSS = [
            cosmeticOn && specificAllowed ? userResult.specificCSS : "",
            cosmeticOn && genericAllowed ? userResult.genericCSS : "",
            specificAllowed ? compiledSpecificCSS : "",
            genericAllowed ? compiledGenericCSS : "",
            proceduralAllowed ? userResult.proceduralPrehideCSS : "",
            proceduralAllowed ? compiledProceduralCSS : "",
        ].filter(Boolean).join("\n");
        const allProcedural = proceduralAllowed
            ? [...userProcedural, ...compiledProcedural]
            : [];
        const allExceptions = [...(userResult.exceptionFilters || [])];
        if (
            proceduralAllowed &&
            allProcedural.length !== 0 &&
            tabId != null &&
            frameId != null
        ) {
            try {
                await chrome.scripting.executeScript({
                    target: { tabId, frameIds: [frameId] },
                    files: ["/js/contentscript-extra.js"],
                    world: "ISOLATED",
                });
            } catch (e) {
                console.warn("[uBlock Ultimate] retrieveContentScriptParameters: inject contentscript-extra failed", e);
            }
        }
        return {
        url: msg.url || "",
        hostname,
        origin: msg.origin || "",
        noCosmeticFiltering: !policy.cosmeticFilteringEnabled,
        noGenericCosmeticFiltering: !policy.cosmeticField.generic,
        noSpecificCosmeticFiltering: !policy.cosmeticField.specific,
        noProceduralCosmeticFiltering: !proceduralAllowed,
        noSmartCosmeticFiltering: !policy.cosmeticField.smart,
        specificCosmeticFilters: {
          ready: true,
          injectedCSS: allCSS,
          proceduralFilters: allProcedural,
          exceptionFilters: allExceptions,
          exceptedFilters: [],
          convertedProceduralFilters: [],
        },
        genericCosmeticFiltersHidden: false,
        scriptletInjectable: policy && policy.scriptlets !== "off", // gated by policy
        scriptletWillInject: policy && policy.scriptlets !== "off", // gated by policy
        trustedScriptletTokens: [],
        tabId,
        userStyles: "",
        userScripts: "",
        popupPanelType: "legacy",
        experimentalHeuristicInterceptorsEnabled: popupSettings.experimentalHeuristicInterceptorsEnabled === true,
        firstPartyDomDetection: policy?.contentScript?.firstPartyDomDetection === true,
        };
    }

    case "getCosmeticSelectorsForDomain": {
        return { ok: true, selectors: [] };
    }

    case "retrieveGenericCosmeticSelectors": {
        const requestedHashes = Array.isArray(msg.hashes)
            ? msg.hashes.filter(Number.isInteger)
            : [];
        if (requestedHashes.length === 0) {
            return { result: undefined };
        }
        try {
            const stored = await chrome.storage.local.get("cosmeticFiltersData");
            let data = stored.cosmeticFiltersData;
            if (typeof data === "string") {
                data = JSON.parse(data);
            }
            const index = data && typeof data.genericCosmeticByHash === "object"
                ? data.genericCosmeticByHash
                : {};
            const selectors = new Set();
            for (const h of requestedHashes) {
                const bucket = index[String(h)];
                if (!Array.isArray(bucket)) continue;
                for (const selector of bucket) {
                    if (typeof selector === "string" && selector !== "") {
                        selectors.add(selector);
                    }
                }
            }
            if (selectors.size === 0) {
                return { result: undefined };
            }
            return {
                result: {
                    injectedCSS: Array.from(selectors)
                        .map(s => `${s} { display: none !important; }`)
                        .join("\n"),
                    excepted: [],
                },
            };
        } catch (_) {
            return { result: undefined };
        }
    }

    case "onDomReady":
    case "enableCSS":
    case "disableCSS": {
        return { ok: true };
    }

    case "getCollapsibleBlockedRequests": {
        return { requests: [] };
    }

    case "cosmeticBlockCount": {
        const count = Math.max(0, Number(msg.count) || 0);
        if ( typeof tabId === "number" && tabId > 0 ) {
            // A content-script report is a snapshot of elements which are
            // presently in the DOM. It can legitimately be lower than the
            // number already counted for this page (for example, an element
            // picker just hid an element before its storage update triggers a
            // re-scan). Do not let that delayed re-scan make the badge go
            // backwards during a navigation.
            reportBlockedCosmeticCount(tabId, frameId, count, msg.clear === true);
            scheduleBlockedCountBadgeUpdate(tabId);
        }
        return { ok: true };
    }

    case "getPagePolicy": {
        // Diagnostic-only: returns the resolved policy
        const tabId = Number(msg.tabId) || 0;
        const frameURL = msg.url || "";
        const pageCtx = await resolvePolicyContext(tabId, frameURL);
        const policy = resolvePagePolicy({
            url: pageCtx.topURL,
            hostname: pageCtx.pageHostname,
            trusted: pageCtx.trusted,
            netFilteringEnabled: pageCtx.netFilteringEnabled,
            hostnameSwitches: pageCtx.hostnameSwitches,
            hasKnownFilterSupport: msg.hasKnownFilterSupport || false,
            pageSignals: msg.pageSignals || {},
        });

        return { policy };
    }

    case "getPageActivation": {
        // ── 1. Resolve policy once ────────────────────────────────────────
        const frameURL = msg.url || "";
        const pageCtx = await resolvePolicyContext(senderTabId, frameURL);
        const hostname = pageCtx.pageHostname;
        const trusted = pageCtx.trusted;
        const policy = resolvePagePolicy({
            url: pageCtx.topURL,
            hostname,
            trusted,
            netFilteringEnabled: pageCtx.netFilteringEnabled,
            hostnameSwitches: pageCtx.hostnameSwitches,
            hasKnownFilterSupport: msg.hasKnownFilterSupport === true,
            pageSignals: msg.pageSignals || {},
        });

        // ── 2. Apply feature expiry gates ─────────────────────────────────
        if (policy && policy.video && featureExpiryGates.isExpired("genericVideoMutation")) {
            policy.video.allowMutation = false;
            policy.video.allowSkipClick = false;
        }
        if (policy && policy.smartCosmetic && featureExpiryGates.isExpired("smartCosmetics")) {
            policy.smartCosmetic = false;
            policy.contentScript.loadSmartRuntime = false;
        }
        if (policy && policy.contentScript && featureExpiryGates.isExpired("firstPartyDomDetection")) {
            policy.contentScript.firstPartyDomDetection = false;
        }
        if (policy && policy.antiAdblockCountermeasures && featureExpiryGates.isExpired("antiAdblockCountermeasures")) {
            policy.antiAdblockCountermeasures = false;
        }

        // ── 3. Create ONE policy snapshot ─────────────────────────────────
        // Use the trusted sender document id (derived from the SW message
        // envelope's _documentId), NOT the page-supplied msg.documentId,
        // which a hostile page could forge.
        const snapshot = PolicySnapshot.create(
            senderTabId,
            frameId,
            senderDocumentId,
            msg.url || "",
            policy,
        );

        // ── 4. Compute active layers ──────────────────────────────────────
        const activeLayers = [];
        if (policy && policy.contentScript && policy.contentScript.loadCosmeticRuntime) {
            activeLayers.push("cosmetic");
        }
        if (policy && policy.contentScript && policy.contentScript.loadVideoRuntime) {
            activeLayers.push("video");
        }
        if (policy && policy.contentScript && policy.contentScript.loadSmartRuntime) {
            activeLayers.push("smart");
        }
        const heuristicInterceptorsEnabled =
            policy?.contentScript?.loadInterceptors === true &&
            popupSettings.experimentalHeuristicInterceptorsEnabled === true;

        if (heuristicInterceptorsEnabled) {
            activeLayers.push("interceptors");
        }

        // ── 5. Issue tokens ───────────────────────────────────────────────
        const tokens = {};
        for (const layer of activeLayers) {
            const t = snapshot._issueToken(layer);
            tokens[layer] = {
                tokenId: t.tokenId,
                layer: t.layer,
                revision: t.revision,
                documentId: t.documentId,
                expiresAt: t.expiresAt,
            };
        }

        // ── 6. Inject into correct worlds ──────────────────────────────────
        const errors = [];
        const isolatedFiles = [];
        const mainFiles = [];

        // Deactivate MAIN-world interceptor when the setting is off
        // Must run outside the activeLayers guard so deactivation works
        // even when all layers are inactive.  Deactivation is driven by a
        // SW-originated message (which the page cannot forge) rather than by
        // calling a method on the page-published controller — the page shares
        // that global and must not be able to shut the interceptor down.
        if (senderTabId != null && frameId != null && heuristicInterceptorsEnabled === false) {
            try {
                await chrome.tabs.sendMessage(senderTabId, {
                    channel: "__ubrInterceptorCtl",
                    msg: { kind: "deactivate" },
                }, { frameId });
            } catch (error) {
                const message = String(error?.message || error);
                errors.push(`interceptor-deactivation: ${message}`);
                console.warn("[uBlock Ultimate] Failed to deactivate universal interceptor:", error);
            }
        }

        if (senderTabId != null && frameId != null && activeLayers.length > 0) {
            // ISOLATED-world files (need vAPI)
            if (policy?.contentScript?.loadSmartRuntime === true) {
                isolatedFiles.push("/js/smart-content.js");
            }
            if (policy?.contentScript?.loadVideoRuntime === true) {
                isolatedFiles.push("/js/video-adblock-generic.js");
            }
            // MAIN-world files
            if (heuristicInterceptorsEnabled) {
                mainFiles.push("/js/universal-ad-interceptor-main.js");
            }

            try {
                await chrome.tabs.get(senderTabId);

                // Seed tokens, revision, AND policy into MAIN world
                await chrome.scripting.executeScript({
                    target: { tabId: senderTabId, frameIds: [frameId] },
                    func: (tks, revision, plcy) => {
                        self.__uborTokens = tks;
                        self.__uborPolicyRevision = revision;
                        self.__uborPagePolicy = plcy;
                    },
                    args: [tokens, snapshot.revision, policy],
                    world: "MAIN",
                });

                // Seed tokens into ISOLATED world so ISOLATED-world
                // capability check() works for video/smart layers.
                await chrome.scripting.executeScript({
                    target: { tabId: senderTabId, frameIds: [frameId] },
                    func: (tks, revision, plcy) => {
                        self.__uborTokens = tks;
                        self.__uborPolicyRevision = revision;
                        // Seed the authoritative (expiry-gated) policy so the
                        // ISOLATED-world video runtime applies the same gates
                        // as the MAIN-world path instead of falling back to a
                        // basic getPagePolicy response.
                        self.__uborPagePolicy = plcy;
                    },
                    args: [tokens, snapshot.revision, policy],
                    world: "ISOLATED",
                });

                // Inject per-action interceptor authorisation flags into
                // MAIN world (non-configurable, non-writable) so the
                // interceptor can check them without a forgeable bridge.
                if ( heuristicInterceptorsEnabled ) {
                    const interceptorActions = {
                        "fetch-wrap": true,
                        "xhr-wrap": true,
                        "mutate-fetch-response": true,
                        "mutate-xhr-response": true,
                    };
                    await chrome.scripting.executeScript({
                        target: { tabId: senderTabId, frameIds: [frameId] },
                        func: (actions) => {
                            try {
                                Object.defineProperty(self, "__ubrInterceptorAuthorized", {
                                    value: true,
                                    configurable: false,
                                    writable: false,
                                });
                                Object.defineProperty(self, "__ubrInterceptorActions", {
                                    value: Object.freeze(actions),
                                    configurable: false,
                                    writable: false,
                                });
                            } catch (_) {}
                        },
                        args: [interceptorActions],
                        world: "MAIN",
                    });
                }

                // Inject capability enforcer into ISOLATED world first,
                // before any ISOLATED-world runtime that depends on it.
                await chrome.scripting.executeScript({
                    target: { tabId: senderTabId, frameIds: [frameId] },
                    func: () => { self.__ubrEnforcerIsolated = true; },
                    world: "ISOLATED",
                });
                await chrome.scripting.executeScript({
                    target: { tabId: senderTabId, frameIds: [frameId] },
                    files: ["/js/capability-enforcer.js"],
                    world: "ISOLATED",
                });

                // Inject ISOLATED-world files (smart-content, video-adblock)
                for (const file of [...new Set(isolatedFiles)]) {
                    await chrome.scripting.executeScript({
                        target: { tabId: senderTabId, frameIds: [frameId] },
                        files: [file],
                        world: "ISOLATED",
                    });
                }

                // Inject capability enforcer into MAIN world, then MAIN-world runtimes
                await chrome.scripting.executeScript({
                    target: { tabId: senderTabId, frameIds: [frameId] },
                    files: ["/js/capability-enforcer.js"],
                    world: "MAIN",
                });
                for (const file of [...new Set(mainFiles)]) {
                    await chrome.scripting.executeScript({
                        target: { tabId: senderTabId, frameIds: [frameId] },
                        files: [file],
                        world: "MAIN",
                    });
                }
            } catch (e) {
                errors.push(e.message || String(e));
            }
        }

        return {
            ok: errors.length === 0,
            activeLayers,
            policyRevision: snapshot.revision,
            tokens,
            policy,
            isolatedFiles,
            mainFiles,
            injectedFiles: isolatedFiles.length + mainFiles.length,
            approvedFileCount: isolatedFiles.length + mainFiles.length,
            errors: errors.length > 0 ? errors : undefined,
        };
    }

    case "reconcileHeuristicInterceptor": {
        const frameId2 = Number.isInteger(senderFrameId) ? senderFrameId : 0;
        const pageCtx2 = await resolvePolicyContext(senderTabId, msg.url || "");
    const policy2 = resolvePagePolicy({
        url: pageCtx2.topURL,
        hostname: pageCtx2.pageHostname,
        trusted: pageCtx2.trusted,
        netFilteringEnabled: pageCtx2.netFilteringEnabled,
        hostnameSwitches: pageCtx2.hostnameSwitches,
        hasKnownFilterSupport: msg.hasKnownFilterSupport === true,
        pageSignals: msg.pageSignals || {},
    });
        const enabled =
            policy2?.contentScript?.loadInterceptors === true &&
            popupSettings.experimentalHeuristicInterceptorsEnabled === true;
        const target = { tabId: senderTabId, frameIds: [frameId2] };
        if ( enabled ) {
            try {
                // Inject capability enforcer first so __ubrCapability and
                // __ubrInterceptorAuthorized exist before the interceptor runs.
                const snap2 = PolicySnapshot.get(senderTabId, frameId2);
                const interceptorActions = {
                    "fetch-wrap": true,
                    "xhr-wrap": true,
                    "mutate-fetch-response": true,
                    "mutate-xhr-response": true,
                };
                await chrome.scripting.executeScript({
                    target,
                    files: ["/js/capability-enforcer.js"],
                    world: "MAIN",
                });
                // Destroy any existing controller so re-enable creates a fresh
                // one with its closure-private revocation flag reset.  This is
                // the only way to undo a prior SW-ordered revocation, because
                // the flag lives in closure-private state the page cannot touch.
                // The destroy command is sent as a SW-originated message (not a
                // page-callable method) so an ad-serving page cannot trigger it.
                try {
                    await chrome.tabs.sendMessage(senderTabId, {
                        channel: "__ubrInterceptorCtl",
                        msg: { kind: "destroy" },
                    }, { frameId: frameId2 });
                } catch (_) {}
                await chrome.scripting.executeScript({
                    target,
                    func: (actions) => {
                        try {
                            Object.defineProperty(self, "__ubrInterceptorAuthorized", {
                                value: true,
                                configurable: false,
                                writable: false,
                            });
                            Object.defineProperty(self, "__ubrInterceptorActions", {
                                value: Object.freeze(actions),
                                configurable: false,
                                writable: false,
                            });
                        } catch (_) {}
                    },
                    args: [interceptorActions],
                    world: "MAIN",
                });
                await chrome.scripting.executeScript({
                    target,
                    world: "MAIN",
                    files: ["/js/universal-ad-interceptor-main.js"],
                });
            } catch (e) {
                console.warn("[uBlock Ultimate] Failed to inject heuristic interceptor:", e);
                return { ok: false, error: String(e?.message || e) };
            }
        } else {
            try {
                await chrome.tabs.sendMessage(senderTabId, {
                    channel: "__ubrInterceptorCtl",
                    msg: { kind: "deactivate" },
                }, { frameId: frameId2 });
            } catch (e) {
                console.warn("[uBlock Ultimate] Failed to deactivate heuristic interceptor:", e);
                return { ok: false, error: String(e?.message || e) };
            }
        }
        return { ok: true, enabled };
    }

    case "getPageDiagnostics": {
        // Test-mode-only diagnostics endpoint for e2e verification.
        // Returns resolved policy, active layers, tokens, and snapshot info
        // for the given tab. Gated by self.__ubrTestMode; silently returns
        // minimal data when not in test mode.
        const isTestMode = self.__ubrTestMode === true;
        if (!isTestMode || senderTabId == null) {
            return {
                available: false,
                hint: "set self.__ubrTestMode=true and provide tabId",
                profileId: null,
                activeLayers: [],
                tokens: {},
            };
        }
        const diagnosticsSnapshot = senderTabId != null
            ? PolicySnapshot.getActiveSnapshotForTab
                ? PolicySnapshot.getActiveSnapshotForTab(senderTabId)
                : null
            : null;
        if (!diagnosticsSnapshot) {
            const policyOnly = resolvePagePolicy({
                url: msg.url || "",
                hostname: msg.hostname || hostnameFromURL(msg.url || ""),
                trusted: false,
                netFilteringEnabled: true,
                hasKnownFilterSupport: false,
                pageSignals: {},
            });
            const cs = policyOnly && policyOnly.contentScript || {};
            const active = [];
            if (cs.loadCosmeticRuntime) active.push("cosmetic");
            if (cs.loadVideoRuntime) active.push("video");
            if (cs.loadSmartRuntime) active.push("smart");
            if (cs.loadInterceptors) active.push("interceptors");
            return {
                available: true,
                fromSnapshot: false,
                profileId: policyOnly ? policyOnly.profileId || "unknown" : "unknown",
                activeLayers: active,
                policySummary: {
                    network: policyOnly ? policyOnly.network || "off" : "off",
                    cosmetic: policyOnly ? policyOnly.cosmetic || "off" : "off",
                    contentScript: {
                        loadCosmeticRuntime: cs.loadCosmeticRuntime === true,
                        loadSmartRuntime: cs.loadSmartRuntime === true,
                        loadVideoRuntime: cs.loadVideoRuntime === true,
                        loadInterceptors: cs.loadInterceptors === true,
                    },
                },
                tokens: {},
                revision: "",
            };
        }
        const dp = diagnosticsSnapshot.policy || {};
        const dcs = dp.contentScript || {};
        const dActive = [];
        if (dcs.loadCosmeticRuntime) dActive.push("cosmetic");
        if (dcs.loadVideoRuntime) dActive.push("video");
        if (dcs.loadSmartRuntime) dActive.push("smart");
        if (dcs.loadInterceptors) dActive.push("interceptors");
        return {
            available: true,
            fromSnapshot: true,
            profileId: dp.profileId || "unknown",
            activeLayers: dActive,
            deniedLayers: ["cosmetic", "video", "smart", "interceptors"].filter(l => !dActive.includes(l)),
            policySummary: {
                network: dp.network || "off",
                cosmetic: dp.cosmetic || "off",
                genericCosmetic: dp.genericCosmetic === true,
                genericVideo: dp.genericVideo || "off",
                contentScript: {
                    loadCosmeticRuntime: dcs.loadCosmeticRuntime === true,
                    loadSmartRuntime: dcs.loadSmartRuntime === true,
                    loadVideoRuntime: dcs.loadVideoRuntime === true,
                    loadInterceptors: dcs.loadInterceptors === true,
                },
            },
            tokens: diagnosticsSnapshot.tokens
                ? Object.keys(diagnosticsSnapshot.tokens).map(k => ({ layer: k }))
                : [],
            revision: diagnosticsSnapshot.revision || "",
        };
    }

    case "validateToken": {
        // ── 1. Fail closed: missing sender identity ─────────────────────
        if (senderTabId == null) return { valid: false, reason: "missing-sender-tab" };
        if (senderFrameId == null) return { valid: false, reason: "missing-sender-frame" };

        const token = PolicySnapshot.getTokenById(msg.tokenId);
        if (!token) return { valid: false, reason: "token-not-found" };

        // ── 2. Fail closed: missing token identity ──────────────────────
        if (token.tabId == null) return { valid: false, reason: "token-missing-tab" };
        if (token.frameId == null) return { valid: false, reason: "token-missing-frame" };

        // ── 3. Sender identity match (unconditional) ────────────────────
        if (senderTabId !== token.tabId) return { valid: false, reason: "wrong-tab" };
        if (senderFrameId !== token.frameId) return { valid: false, reason: "wrong-frame" };

        // ── 4. Document ID match ─────────────────────────────────────────
        if (senderDocumentId && token.documentId && senderDocumentId !== token.documentId) {
            return { valid: false, reason: "wrong-document" };
        }

        // ── 5. Layer check ───────────────────────────────────────────────
        if (token.layer !== msg.layer) {
            return { valid: false, reason: "wrong-layer" };
        }

        // ── 6. Fail closed: require action for every validation ─────────
        if (!msg.action) return { valid: false, reason: "missing-action" };

        // ── 7. Fail closed: layer must have action allowlist ─────────────
        const layerActions = ALLOWED_LAYER_ACTIONS[token.layer];
        if (!layerActions) return { valid: false, reason: "unknown-layer" };

        // ── 8. Action must be allowed ────────────────────────────────────
        if (!layerActions.includes(msg.action)) {
            return { valid: false, reason: "action-not-allowed" };
        }

        // ── 9. Snapshot and revision check ───────────────────────────────
        const snap = PolicySnapshot.get(token.tabId, token.frameId);
        if (!snap) return { valid: false, reason: "no-snapshot" };
        if (token.revision !== snap.revision) return { valid: false, reason: "stale-revision" };

        // ── 10. Expiry check ─────────────────────────────────────────────
        if (token.expiresAt && Date.now() > token.expiresAt) {
            return { valid: false, reason: "token-expired" };
        }

        return { valid: true, layer: token.layer };
    }

    case "validateCapability": {
        // ISOLATED-world capability enforcer delegates validation here.
        // Performs the same checks as the validateToken case so that
        // layer, revision, expiry, document identity and sender identity
        // are all enforced.
        if (senderTabId == null) return { ok: false, reason: "missing-sender-tab" };
        if (senderFrameId == null) return { ok: false, reason: "missing-sender-frame" };
        if (!msg.layer) return { ok: false, reason: "missing-layer" };
        if (!msg.action) return { ok: false, reason: "missing-action" };

        // ── Snapshot lookup ────────────────────────────────────────────
        const snap = PolicySnapshot.get(senderTabId, senderFrameId);
        if (!snap) return { ok: false, reason: "no-snapshot" };

        // ── Token lookup by layer (snap.tokens is a Set<Token>) ─────────
        const token = [...snap.tokens].find(function(candidate) {
            return candidate.layer === msg.layer;
        });
        if (!token) return { ok: false, reason: "no-token" };

        // ── Document identity match ────────────────────────────────────
        // Compare against the trusted sender document id (from the SW
        // message envelope), never the page-supplied msg.documentId.
        // When the token was issued for a specific document, the request
        // must originate from that same document or it is rejected.
        if (token.documentId && senderDocumentId !== token.documentId) {
            return { ok: false, reason: "wrong-document" };
        }

        // ── Layer check ────────────────────────────────────────────────
        if (token.layer !== msg.layer) {
            return { ok: false, reason: "wrong-layer" };
        }

        // ── Action allowlist check ─────────────────────────────────────
        const layerActions = ALLOWED_LAYER_ACTIONS[token.layer];
        if (!layerActions) return { ok: false, reason: "unknown-layer" };
        if (!layerActions.includes(msg.action)) {
            return { ok: false, reason: "action-not-allowed" };
        }

        // ── Revision check ─────────────────────────────────────────────
        if (token.revision !== snap.revision) {
            return { ok: false, reason: "stale-revision" };
        }

        // ── Expiry check + auto-renew ─────────────────────────────────
        if (token.expiresAt && Date.now() > token.expiresAt) {
            // Renew expired tokens automatically so continuous capability
            // checks (video, cosmetic, smart) survive the token TTL
            // without requiring a full policy re-seed.
            // Remove the expired token first to prevent unbounded growth
            // of the token set.
            snap.tokens.delete(token);
            const newToken = snap._issueToken(msg.layer);
            return {
                ok: true,
                authorized: true,
                revision: snap.revision,
                renewedToken: {
                    tokenId: newToken.tokenId,
                    layer: newToken.layer,
                    revision: newToken.revision,
                    expiresAt: newToken.expiresAt,
                },
            };
        }

        return { ok: true, authorized: true, revision: snap.revision };
    }

    default: {
        return { error: `Unhandled contentscript request: ${  msg.what}` };
    }
    }
}

async function handleScriptlets(msg, senderTabId, senderFrameId) {
    switch (msg.what) {
    case "logCosmeticFilteringData": {
        if (loggerRuntime.enabled === false) {
            return { ok: true, accepted: 0 };
        }

        const tabId = Number.isInteger(senderTabId) ? senderTabId : Number(msg.tabId) || -1;
        const frameId = Number.isInteger(senderFrameId) ? senderFrameId : Number(msg.frameId) || 0;
        const frameURL = typeof msg.frameURL === "string" ? msg.frameURL : "";
        const docHostname = hostnameFromURL(frameURL);
        const docDomain = domainFromHostname(docHostname);
        const records = Array.isArray(msg.entries) ? msg.entries : [];

        let accepted = 0;
        for (const record of records) {
            const result = Number(record?.result) === 2 ? 2 : 1;
            let raw = String(record?.raw || "");
            if (/^#@?#/.test(raw) === false) {
                raw = result === 2 ? `#@#${raw}` : `##${raw}`;
            }
            if (raw === "##" || raw === "#@#") continue;

            const type = record?.type === "scriptlet" || /^#@?#\+js\(/.test(raw) ? "scriptlet" : "dom";

            loggerRuntime.writeExtended({
                tstamp: Date.now() / 1000,
                realm: "extended",
                tabId,
                frameId,
                documentId: typeof msg.documentId === "string" ? msg.documentId : undefined,
                method: "",
                type,
                url: frameURL,
                tabHostname: typeof msg.tabHostname === "string" ? msg.tabHostname : docHostname,
                tabDomain: typeof msg.tabDomain === "string" ? msg.tabDomain : docDomain,
                docHostname,
                docDomain,
                hostname: docHostname,
                domain: docDomain,
                filter: {
                    source: "static",
                    raw,
                    result,
                },
            });
            accepted += 1;
        }

        return { ok: true, accepted };
    }

    case "securityPolicyViolation":
        return true;

    default:
        return { error: `Unhandled scriptlets request: ${msg.what}` };
    }
}

// ---------------------------------------------------------------------------
// Popup panel handlers
// ---------------------------------------------------------------------------
let popupPortTabId = 0;

async function handlePopupPanel(msg) {
    const rawTabId = Number(msg?.tabId) || Number(msg?._tabId) || 0;

    switch (msg.what) {

    case "getPopupData": {
        return buildPopupData(rawTabId);
    }

    case "toggleNetFiltering": {
        await ensurePermanentStateLoaded();
        const requestedHostname = hostnameFromURL(msg.url || "");
        if (!requestedHostname) return { ok: false, error: "No hostname" };
        if (isURLTrusted(msg.url || "")) return buildPopupData(rawTabId);
        const state = msg.state === true || msg.state === false ? msg.state : true;
        const isPageScope = msg.scope === "page";
        const rawTabIdCtx = rawTabId;

        return enqueueStateMutation(async () => {
            const tabId = await resolveTabId(rawTabIdCtx);

            // Validate the tab and resolve current URL inside the queue
            let currentURL = null;
            if (tabId > 0) {
                const tab = await chrome.tabs.get(tabId).catch(() => null);
                if (tab?.url && /^https?:\/\//.test(tab.url)) {
                    currentURL = new URL(tab.url);
                    currentURL.hash = "";
                    const current = hostnameFromURL(currentURL.href);
                    if (current && current !== requestedHostname) {
                        return buildPopupData(rawTabIdCtx);
                    }
                    if (isURLTrusted(currentURL.href)) {
                        return buildPopupData(rawTabIdCtx);
                    }
                } else {
                    return buildPopupData(rawTabIdCtx);
                }
            }

            const actualHostname = currentURL ? hostnameFromURL(currentURL.href) : requestedHostname;
            if (!actualHostname) return buildPopupData(rawTabIdCtx);

            const snapshot = snapshotFilteringState();

            try {
                if (isPageScope) {
                    if (tabId > 0) {
                        sessionPageNetFiltering.set(tabId, {
                            hostname: actualHostname,
                            pageURL: currentURL ? currentURL.href : (msg.url || ""),
                            state,
                        });
                        await persistSessionPageNetFiltering();
                    }
                } else {
                    if (tabId > 0 && sessionPageNetFiltering.delete(tabId)) {
                        await persistSessionPageNetFiltering();
                    }
                    sessionNetFiltering.set(actualHostname, state);
                }
                if (!isPageScope) {
                    permanentNetFiltering[actualHostname] = state;
                    await chrome.storage.local.set({
                        [STORAGE_KEY_PERM_NET_FILTERING]: permanentNetFiltering,
                    });
                }
                if (tabId > 0) markTabChanged(tabId);
                PolicySnapshot.invalidateAll({ reason: "net-filtering-toggle" });
                await syncFirewallDnrRules();
                await syncNetFilteringDnrRules();
                await syncHostnameSwitchDnrRules();
                await syncCspReportPolicyRules();
                await postCommitFilteringChange("net-filtering-toggle");
                return buildPopupData(rawTabIdCtx);
            } catch (error) {
                await restoreFilteringState(snapshot);
                console.warn("[uBlock Ultimate] net filtering toggle failed, rolled back:", error);
                return { ok: false, error: "Net filtering toggle failed" };
            }
        });
    }

    case "toggleHostnameSwitch": {
        await ensurePermanentStateLoaded();
        const hostname = String(msg.hostname || "").trim();
        if (!hostname) return { ok: false, error: "No hostname" };
        const field = SWITCH_ID_TO_FIELD[msg.name];
        if (!field) return { ok: false, error: `Unknown switch: ${msg.name}` };
        const enabled = msg.state === true;
        const rawTabIdCtx = rawTabId;
        const persist = msg.persist === true;

        return enqueueStateMutation(async () => {
            const tabId = await resolveTabId(rawTabIdCtx);

            // Validate current tab URL inside the queue — require valid tab
            let validatedURL = "";
            if (tabId > 0) {
                const tab = await chrome.tabs.get(tabId).catch(() => null);
                if (!tab?.url) {
                    return { ok: false, error: "Target tab no longer exists" };
                }
                if (!/^https?:\/\//.test(tab.url)) {
                    return { ok: false, error: "Tab does not have an HTTP(S) URL" };
                }
                const currentHostname = hostnameFromURL(tab.url);
                if (currentHostname && currentHostname !== hostname) {
                    return { ok: false, error: "The tab navigated while the popup was open" };
                }
                if (isURLTrusted(tab.url)) {
                    return buildPopupData(rawTabIdCtx);
                }
                validatedURL = tab.url;
            }

            const snapshot = snapshotFilteringState();

            try {
                let sessionEntry = sessionHostnameSwitches.get(hostname);
                if (!sessionEntry) { sessionEntry = {}; sessionHostnameSwitches.set(hostname, sessionEntry); }
                sessionEntry[field] = enabled;

                await syncHostnameSwitchDnrRules();
                if (persist) {
                    if (!permanentHostnameSwitches[hostname]) permanentHostnameSwitches[hostname] = {};
                    permanentHostnameSwitches[hostname][field] = enabled;
                    await chrome.storage.local.set({ [STORAGE_KEY_PERM_HOSTNAME_SWITCHES]: permanentHostnameSwitches });
                }
                await persistSessionHostnameSwitches();
                if (field === "noCSPReports") await syncCspReportPolicyRules();

                await postCommitFilteringChange("hostname-switch-toggle");

                if (tabId > 0) markTabChanged(tabId);
                const result = await buildPopupData(rawTabIdCtx);
                if (field === "noCosmeticFiltering") {
                    let tabStillValid = true;
                    if (tabId > 0) {
                        const tab = await chrome.tabs.get(tabId).catch(() => null);
                        if (!tab?.url) {
                            tabStillValid = false;
                        } else if (tab.url !== validatedURL) {
                            // Full URL recheck: tab navigated or trust changed
                            tabStillValid = false;
                        } else if (isURLTrusted(tab.url)) {
                            tabStillValid = false;
                        }
                    }
                    if (tabStillValid) {
                        const csResult = await applyImmediateCosmeticSwitch(tabId, enabled);
                        result.reloadRequired = csResult.reloadRequired;
                    } else {
                        result.reloadRequired = true;
                    }
                }
                return result;
            } catch (error) {
                await restoreFilteringState(snapshot);
                console.warn("[uBlock Ultimate] hostname switch toggle failed, rolled back:", error);
                return { ok: false, error: "Hostname switch toggle failed" };
            }
        });
    }

    case "toggleFirewallRule": {
        await ensurePermanentStateLoaded();
        const pageHostname = msg.pageHostname || "";
        const srcHostname = msg.srcHostname || "*";
        const desHostname = msg.desHostname || "*";
        const requestType = msg.requestType || "*";
        const action = Number(msg.action) || 0;
        const effectiveSrc = srcHostname === "*" ? "*" : pageHostname;
        const persistToggle = msg.persist === true || msg.persist === 1;
        const rawTabIdCtx = rawTabId;

        return enqueueStateMutation(async () => {
            const tabId = await resolveTabId(rawTabIdCtx);
            if (tabId > 0 && pageHostname) {
                const validatedTab = await validatePopupTarget(tabId, pageHostname, msg.pageURL).catch(() => {
                    throw new Error("Target tab changed while the popup was open");
                });
                if (isURLTrusted(validatedTab.url)) {
                    return { ok: false, error: "The current page is trusted" };
                }
            }
            const snapshot = snapshotFilteringState();
            try {
                if (action === 0) {
                    sessionFirewall.setCell(effectiveSrc, desHostname, requestType, 0);
                    if (persistToggle) {
                        permanentFirewall.setCell(effectiveSrc, desHostname, requestType, 0);
                    }
                } else {
                    sessionFirewall.setCell(effectiveSrc, desHostname, requestType, action);
                    if (persistToggle) {
                        permanentFirewall.setCell(effectiveSrc, desHostname, requestType, action);
                    }
                }
                if (persistToggle) {
                    permanentFirewallRules = permanentFirewall.toObject({ numeric: true });
                    await chrome.storage.local.set({
                        [STORAGE_KEY_PERM_FIREWALL_RULES]: permanentFirewallRules,
                        [STORAGE_KEY_DYNAMIC_FILTERING_STRING]: permanentFirewall.toString(),
                    });
                }
                await persistSessionFirewallState();
                await syncFirewallDnrRules();
                await syncCspReportPolicyRules();
                await postCommitFilteringChange("firewall-rule-toggle");
                return buildPopupData(rawTabIdCtx);
            } catch (error) {
                await restoreFilteringState(snapshot);
                console.warn("[uBlock Ultimate] firewall rule toggle failed, rolled back:", error);
                return { ok: false, error: "Firewall rule toggle failed" };
            }
        });
    }

    case "saveFirewallRules": {
        await ensurePermanentStateLoaded();
        const hostname = msg.srcHostname || "";
        const desHostnames = msg.desHostnames || {};
        const rawTabIdCtx = rawTabId;

        const doSave = (h) => enqueueStateMutation(async () => {
            const tabId = await resolveTabId(rawTabIdCtx);
            if (h && tabId > 0) {
                const validatedTab = await validatePopupTarget(tabId, h, msg.pageURL).catch(() => {
                    throw new Error("Target tab changed while the popup was open");
                });
                if (isURLTrusted(validatedTab.url)) {
                    return { ok: false, error: "The current page is trusted" };
                }
            }
            const snapshot = snapshotFilteringState();
            try {
                if (h) {
                    if (sessionHostnameSwitches.has(h)) {
                        if (!permanentHostnameSwitches[h]) permanentHostnameSwitches[h] = {};
                        Object.assign(permanentHostnameSwitches[h], sessionHostnameSwitches.get(h));
                    }
                    if (sessionNetFiltering.has(h)) {
                        permanentNetFiltering[h] = sessionNetFiltering.get(h);
                    }
                    permanentFirewall.copyRules(sessionFirewall, h, desHostnames);
                } else {
                    // Global Save All: copy all session state to permanent
                    for (const [shost, sw] of sessionHostnameSwitches) {
                        if (!permanentHostnameSwitches[shost]) permanentHostnameSwitches[shost] = {};
                        Object.assign(permanentHostnameSwitches[shost], sw);
                    }
                    for (const [nhost, nstate] of sessionNetFiltering) {
                        permanentNetFiltering[nhost] = nstate;
                    }
                    permanentFirewall.assign(sessionFirewall);
                }
                permanentFirewallRules = permanentFirewall.toObject({ numeric: true });
                await chrome.storage.local.set({
                    [STORAGE_KEY_PERM_NET_FILTERING]: permanentNetFiltering,
                    [STORAGE_KEY_PERM_HOSTNAME_SWITCHES]: permanentHostnameSwitches,
                    [STORAGE_KEY_PERM_FIREWALL_RULES]: permanentFirewallRules,
                    [STORAGE_KEY_DYNAMIC_FILTERING_STRING]: permanentFirewall.toString(),
                });
                await persistSessionFirewallState();
                await syncFirewallDnrRules();
                await syncNetFilteringDnrRules();
                await syncHostnameSwitchDnrRules();
                await syncCspReportPolicyRules();
                await postCommitFilteringChange("save-firewall-rules");
                return buildPopupData(rawTabIdCtx);
            } catch (error) {
                await restoreFilteringState(snapshot);
                console.warn("[uBlock Ultimate] save firewall rules failed, rolled back:", error);
                return { ok: false, error: "Save firewall rules failed" };
            }
        });

        return hostname ? doSave(hostname) : doSave("");
    }

    case "revertFirewallRules": {
        await ensurePermanentStateLoaded();
        const hostname = msg.srcHostname || "";
        const desHostnames = msg.desHostnames || {};
        const rawTabIdCtx = rawTabId;

        const doRevert = (h) => enqueueStateMutation(async () => {
            const tabId = await resolveTabId(rawTabIdCtx);
            if (h && tabId > 0) {
                const validatedTab = await validatePopupTarget(tabId, h, msg.pageURL).catch(() => {
                    throw new Error("Target tab changed while the popup was open");
                });
                if (isURLTrusted(validatedTab.url)) {
                    return { ok: false, error: "The current page is trusted" };
                }
            }
            const snapshot = snapshotFilteringState();
            try {
                if (h) {
                    sessionHostnameSwitches.delete(h);
                    sessionNetFiltering.delete(h);
                    for (const [tid, entry] of sessionPageNetFiltering) {
                        if (entry.hostname === h) {
                            sessionPageNetFiltering.delete(tid);
                        }
                    }
                    sessionFirewall.copyRules(permanentFirewall, h, desHostnames);
                } else {
                    // Global Revert All: clear all session state
                    sessionHostnameSwitches.clear();
                    sessionNetFiltering.clear();
                    sessionPageNetFiltering.clear();
                    sessionFirewall.assign(permanentFirewall);
                }
                await Promise.all([
                    persistSessionHostnameSwitches(),
                    persistSessionFirewallState(),
                    persistSessionPageNetFiltering(),
                ]);
                await syncFirewallDnrRules();
                await syncNetFilteringDnrRules();
                await syncHostnameSwitchDnrRules();
                await syncCspReportPolicyRules();
                await postCommitFilteringChange("revert-firewall-rules");
                return buildPopupData(rawTabIdCtx);
            } catch (error) {
                await restoreFilteringState(snapshot);
                console.warn("[uBlock Ultimate] revert firewall rules failed, rolled back:", error);
                return { ok: false, error: "Revert firewall rules failed" };
            }
        });

        return hostname ? doRevert(hostname) : doRevert("");
    }

    case "getMatchedRuleLog": {
        const tabId = Number(msg.tabId) || rawTabId || 0;

        return {
            entries:
                matchedRuleLogByTab.get(tabId) || [],
        };
    }

    case "getHiddenElementCount":
    case "getScriptCount": {
        const tabId = await resolveTabId(rawTabId);
        if (msg.what === "getHiddenElementCount") return getHiddenElementCount(tabId);
        return getScriptCount(tabId);
    }

    case "hasPopupContentChanged": {
        await ensurePopupLedgerHydrated();
        const tabId = await resolveTabId(rawTabId);
        const lastModified = Number(msg.contentLastModified) || 0;
        const ledgerRevision = popupRequestLedgers.snapshotForTab(tabId).contentRevision || 0;
        const current = Math.max(getTabRevision(tabId), ledgerRevision);
        return current > lastModified;
    }

    case "getPopupStats": {
        await ensurePopupLedgerHydrated();
        const tabId = await resolveTabId(rawTabId);
        const snapshot = popupRequestLedgers.snapshotForTab(tabId);
        const tabBlocked = snapshot.pageCounts.blocked.any;
        await syncBlockedDnrCountWithPopup(tabId, tabBlocked);
        return {
        blocked: snapshot.pageCounts.blocked,
        allowed: snapshot.pageCounts.allowed,
        };
    }

    case "gotoURL": {
        const url = msg?.details?.url;
        if (url) {
            const fullUrl = url.startsWith("http") || url.startsWith("chrome-extension://")
                ? url
                : chrome.runtime.getURL(url);
            try {
                await chrome.tabs.create({ url: fullUrl, active: true });
            } catch (e) {
                console.warn("[uBlock Ultimate] gotoURL: tabs.create failed", fullUrl, e);
            }
        }
        return { ok: true };
    }

    case "userSettings": {
        if (!msg.name || msg.value === undefined) {
            return { ok: false, error: "Missing setting name or value" };
        }
        return changeUserSetting(msg);
    }

    case "dismissUnprocessedRequest": {
        const tabId = await resolveTabId(rawTabId);
        if (tabId > 0) {
        tabUnprocessedRequest.delete(tabId);
        markTabChanged(tabId);
        }
        return { ok: true };
    }

    case "reloadTab": {
        const tabId = await resolveTabId(rawTabId);
        if (tabId > 0) {
            await pushTabReloadMarker(tabId);
            // If a URL is provided and differs from current, navigate to it
            // (handles interstitial/blocked-page recovery)
            if (msg.url) {
                try {
                    const t = await chrome.tabs.get(tabId);
                    if (t?.url !== msg.url) {
                        await chrome.tabs.update(tabId, { url: msg.url });
                    } else {
                        await chrome.tabs.reload(tabId, { bypassCache: !!msg.bypassCache });
                    }
                } catch (e) {
                    console.warn("[uBlock Ultimate] reloadTab: tabs.get failed", tabId, e);
                    try { await chrome.tabs.reload(tabId, { bypassCache: !!msg.bypassCache }); } catch (_) {}
                }
            } else {
                try {
                    await chrome.tabs.reload(tabId, { bypassCache: !!msg.bypassCache });
                } catch (e) {
                    console.warn("[uBlock Ultimate] reloadTab: tabs.reload failed", tabId, e);
                }
            }
            if (msg.select) {
                try {
                    await chrome.tabs.update(tabId, { active: true });
                } catch (e) {
                    console.warn("[uBlock Ultimate] reloadTab: tabs.update failed", tabId, e);
                }
            }
            markTabChanged(tabId);
        }
        return { ok: true };
    }

    case "launchElementPicker": {
        // Frontend uses direct MV3 imports for zapper/picker.
        // This handler exists for compatibility with fallback paths.
        return { unsupported: true, message: "Use frontend MV3 helper directly" };
    }

    case "launchReporter": {
        chrome.tabs.create({ url: chrome.runtime.getURL("logger-ui.html"), active: true }).catch(e => { console.warn("[uBlock Ultimate] tabs.create launchReporter:", e); });
        return { ok: true };
    }

    default: {
        return buildPopupData(rawTabId);
    }
    }
}

// ---------------------------------------------------------------------------
// Logger UI handler
// ---------------------------------------------------------------------------
async function handleLoggerUI(msg) {
    switch (msg.what) {

    case "readAll": {
        const ownerId = Number(msg.ownerId);
        await loggerRuntime.hydrate();
        const wasEnabled = loggerRuntime.enabled;
        const entries = loggerRuntime.read(ownerId);
        if (entries && typeof entries === "object" && entries.unavailable === true) {
            return { unavailable: true };
        }
        if (wasEnabled === false && loggerRuntime.enabled) {
            try {
                broadcastMessage("uBR", { what: "loggerEnabled" });
            } catch (e) {
                console.warn("[uBlock Ultimate] BroadcastChannel loggerEnabled:", e);
            }
            await enableCosmeticLoggerForOpenTabs();
        }
        const tabIds = await getLoggerTabs();
        const activeTab = await getActivePageTab();
        const activeTabId = activeTab?.id || (tabIds.length > 0 ? tabIds[0][0] : 0);
        return {
        activeTabId,
        tabIds,
        tabIdsToken: String(Date.now()),
        colorBlind: popupSettings.colorBlindFriendly === true,
        tooltips: popupSettings.tooltipsDisabled !== true,
        entries,
        };
    }

    case "releaseView": {
      loggerRuntime.release(Number(msg.ownerId));
      inMemoryFilters.clear();
      if (loggerRuntime.enabled === false) {
          try {
              broadcastMessage("uBR", { what: "loggerDisabled" });
          } catch (e) {
              console.warn("[uBlock Ultimate] BroadcastChannel loggerDisabled:", e);
          }
          await disableCosmeticLoggerForOpenTabs();
      }
      return { ok: true };
    }

    case "hasInMemoryFilter": {
        return typeof msg.filter === "string" ? inMemoryFilters.has(msg.filter) : false;
    }

    case "toggleInMemoryFilter": {
        const filter = String(msg.filter || "");
        if (!filter) return false;
        if (inMemoryFilters.has(filter)) {
        inMemoryFilters.delete(filter);
        return false;
        }
      inMemoryFilters.add(filter);
      return true;
    }

    case "getURLFilteringData": {
        const context = msg.context || "";
        const type = msg.type || "*";
        const urls = Array.isArray(msg.urls) ? msg.urls : [];
        const colors = {};
        let dirty = false;
        for (const url of urls) {
            const sessionKey = `${context} ${url} ${type}`;
            const permKey = `${context} ${url} ${type}`;
            const sessionVal = sessionURLFilteringRules.get(sessionKey);
            const permVal = permanentURLFilteringRules[permKey];
            let r = 0;
            if (permVal !== undefined) r = Number(permVal);
            const own = sessionVal !== undefined && sessionVal !== permVal;
            if (own) dirty = true;
            if (sessionVal !== undefined) {
                r = Number(sessionVal);
            }
            colors[url] = { r, own };
        }
        return { dirty, colors };
    }

    case "setURLFilteringRule": {
        const context = msg.context || "";
        const url = msg.url || "";
        const type = msg.type || "*";
        const action = Number(msg.action) || 0;
        const key = `${context} ${url} ${type}`;
        if (action === 0) {
        sessionURLFilteringRules.delete(key);
        } else {
        sessionURLFilteringRules.set(key, String(action));
        }
        if (msg.persist) {
            if (action === 0) {
                delete permanentURLFilteringRules[key];
            } else {
                permanentURLFilteringRules[key] = String(action);
            }
            await chrome.storage.local.set({ [STORAGE_KEY_URL_FILTERING]: permanentURLFilteringRules });
        }
        await persistSessionURLFilteringRules();
        await syncURLFilteringDnrRules();
        return { ok: true };
    }

    case "saveURLFilteringRules": {
        const context = msg.context || "";
        const type = msg.type || "*";
        const urls = Array.isArray(msg.urls) ? msg.urls : [];
        for (const url of urls) {
            const key = `${context} ${url} ${type}`;
            if (sessionURLFilteringRules.has(key)) {
                permanentURLFilteringRules[key] = sessionURLFilteringRules.get(key);
            }
        }
        await chrome.storage.local.set({ [STORAGE_KEY_URL_FILTERING]: permanentURLFilteringRules });
        await syncURLFilteringDnrRules();
        return { ok: true };
    }

    case "getDomainNames": {
        const targets = Array.isArray(msg.targets) ? msg.targets : [];
        return targets.map(t => {
            if (typeof t !== "string") return "";
            try {
                return t.indexOf("/") !== -1
                    ? domainFromHostname(new URL(t).hostname) || ""
                    : domainFromHostname(t) || t;
            } catch (_) {
                return "";
            }
        });
    }

    case "listsFromNetFilter": {
        await ensureFilterReverseIndex();
        return lookupFilterLists(String(msg.rawFilter || ""));
    }

    case "listsFromCosmeticFilter": {
        await ensureFilterReverseIndex();
        return lookupFilterLists(String(msg.rawFilter || msg.filter || ""));
    }

    case "createUserFilter":
        return createUserFilter(msg);

    case "registerScriptletCache": {
        const { name, script, version } = msg;
        if (name && script) {
            scriptletCache.set(name, { script, version: version || '1' });
            return { ok: true };
        }
        return { ok: false, error: 'missing-name-or-script' };
    }

    case "explainPolicy": {
        const policyUrl = msg.url || "";
        const policyHostname = extractHostname(policyUrl);
        const policy = resolvePagePolicy({ url: policyUrl, hostname: policyHostname });
        return { ok: true, explanation: explainPolicy(policyUrl, policyHostname, policy) };
    }

    case "classifySelectorRisk": {
        if (typeof msg.selector !== "string") return { ok: false, error: "Missing selector" };
        return { ok: true, classification: classifySelectorRisk(msg.selector) };
    }

    case "getMutationLedger": {
        const tabId = Number(msg.tabId);
        if (tabId > 0) {
            try {
                const response = await chrome.tabs.sendMessage(tabId, { what: "getMutationLedger" });
                return { ok: true, ledger: response.ledger || [] };
            } catch (e) {
                return { ok: false, error: String(e) };
            }
        }
        return { ok: true, ledger: [] };
    }

    case "getCssInjectionInventory": {
        const cssTabId = Number(msg.tabId);
        if (cssTabId > 0) {
            try {
                const response = await chrome.tabs.sendMessage(cssTabId, { what: "getCssInjectionInventory" });
                return { ok: true, inventory: response.inventory || [] };
            } catch (e) {
                return { ok: false, error: String(e) };
            }
        }
        return { ok: true, inventory: [] };
    }

    case "rollbackMutationsForTab": {
        // Signal content scripts to rollback via broadcast
        const tabId = Number(msg.tabId);
        try {
            broadcastMessage("uBR", { what: "rollbackMutations", tabId });
            // Also try direct tab message for content scripts that may not have BroadcastChannel
            if (tabId > 0) {
                chrome.tabs.sendMessage(tabId, { what: "rollbackMutations" }).catch(() => {});
            }
            return { ok: true };
        } catch (e) {
            return { ok: false, error: String(e) };
        }
    }

    case "getStorageQuota":
        return { ok: true, quota: { maxFilterListCacheSize: storageQuota.maxFilterListCacheSize } };

    case "enforceStorageQuota":
        await storageQuota.enforceQuota();
        return { ok: true };

    case "getFeatureExpiryGates":
        return { ok: true, gates: { ...featureExpiryGates } };

    case "setFeatureExpiry":
        if (msg.feature && typeof msg.days === "number") {
            featureExpiryGates.setExpiry(msg.feature, msg.days);
            return { ok: true };
        }
        return { ok: false, error: "Invalid feature or days" };

    case "isFeatureExpired":
        if (msg.feature) {
            const expired = featureExpiryGates.isExpired(msg.feature);
            return { ok: true, expired };
        }
        return { ok: false, error: "Invalid feature" };

    case "launchElementPicker": {
        // Matches popup panel handler — frontend uses direct MV3 imports
        return { unsupported: true, message: "Use frontend MV3 helper directly" };
    }

    case "reloadTab": {
        const tabId = Number(msg.tabId);
        if (tabId > 0) {
            await pushTabReloadMarker(tabId);
            try {
                await chrome.tabs.reload(tabId, { bypassCache: !!msg.bypassCache });
            } catch (e) {
                console.warn("[uBlock Ultimate] loggerUI reloadTab: tabs.reload failed", tabId, e);
            }
            markTabChanged(tabId);
        }
        return { ok: true };
    }

    default: return { error: `Unhandled loggerUI: ${  msg.what}` };
    }
}

async function handleDom(msg) {
    switch (msg.what) {
    case "uiStyles": {
        const data = await chrome.storage.local.get([
            "userSettings",
            "uiStyles",
            "uiAccentStylesheet",
        ]);

        const userSettings =
            data.userSettings &&
            typeof data.userSettings === "object"
                ? data.userSettings
                : {};

        const accentColor =
            typeof userSettings.uiAccentCustom0 === "string"
                ? userSettings.uiAccentCustom0
                : "";

        return {
            uiTheme:
                typeof userSettings.uiTheme === "string"
                    ? userSettings.uiTheme
                    : "auto",

            uiAccentCustom:
                userSettings.uiAccentCustom === true &&
                /^#[0-9a-f]{6}$/i.test(accentColor),

            uiAccentCustom0:
                accentColor,

            uiAccentStylesheet:
                typeof data.uiAccentStylesheet === "string"
                    ? data.uiAccentStylesheet
                    : "",

            uiStyles:
                typeof data.uiStyles === "string"
                    ? data.uiStyles
                    : "unset",
        };
    }
    case "uiAccentStylesheet":
        if (typeof msg.stylesheet === "string") {
            await chrome.storage.local.set({ uiAccentStylesheet: msg.stylesheet });
        }
        return {};
    default:
        return {};
    }
}

// ---------------------------------------------------------------------------
// Main message dispatcher
// ---------------------------------------------------------------------------
async function dispatchMessage(channel, msg, senderTabId, senderFrameId) {
    if (channel === "ping") return { pong: true };
    if (channel === "loggerUI") return handleLoggerUI(msg);
    if (channel === "popupPanel") return handlePopupPanel(msg);
    if (channel === "vapi") return handleVAPI(msg, senderTabId);
    if (channel === "contentscript") return handleContentscript(msg, senderTabId, senderFrameId);
    if (channel === "scriptlets") return handleScriptlets(msg, senderTabId, senderFrameId);
    if (channel === "codeViewer") return handleCodeViewer(msg);
    if (channel === "domInspectorContent") return handleDOMInspectorContent(msg, senderTabId, senderFrameId);
    if (channel === "dashboard") return handleDashboard(msg, senderTabId);
    if (channel === "dashboardGetRules") return handleDashboard({ ...msg, what: "getRules" }, senderTabId);
    if (channel === "dashboardModifyRuleset") return handleDashboard({ ...msg, what: "modifyRuleset" }, senderTabId);
    if (channel === "dashboardResetRules") return handleDashboard({ ...msg, what: "resetRules" }, senderTabId);
    if (channel === "elementPicker") return handleElementPicker(msg);
    if (channel === "getWhitelist") return handleWhitelist.get(msg);
    if (channel === "setWhitelist") return handleWhitelist.set(msg);
    if (channel === "cloudWidget") return handleCloudWidget(msg);
    if (channel === "broadcast") return { ok: true };
    if (channel === "dom") return handleDom(msg);
    if (channel === "default") return handleDefaultChannel(msg);
    return { error: `No handler for channel ${  channel}` };
}

async function handleDefaultChannel(msg) {
    switch (msg.what) {
    case "getAssetContent": {
        const url = msg.url || "";
        try {
            const response = await fetchWithTimeout(url, 15000);
            if (response.ok) {
                const content = await response.text();
                return { content, ok: true };
            }
        } catch (e) {
            console.warn("[uBlock Ultimate] fetchAsset: fetch failed", url, e);
        }
        return { error: `Failed to fetch ${url}` };
    }
    case "gotoURL": {
        const url = msg?.details?.url;
        if (url) {
            const fullUrl = url.startsWith("http") || url.startsWith("chrome-extension://")
                ? url
                : chrome.runtime.getURL(url);
            chrome.tabs.create({ url: fullUrl, active: true }).catch(e => { console.warn("[uBlock Ultimate] tabs.create gotoURL:", e); });
        }
        return { ok: true };
    }
    case "setNewtabToggle": {
        _showCustomNewTab = msg.enabled;
        await chrome.storage.local.set({ showCustomNewTab: msg.enabled }).catch(() => {});
        await syncNewTabToUserSettings(msg.enabled);
        if (msg._tabId && msg.navigate) {
            const ourUrl = chrome.runtime.getURL("pages/newtab.html");
        if (msg.enabled) {
            chrome.tabs.update(msg._tabId, { url: ourUrl }).catch(() => {});
        } else {
            chrome.tabs.update(msg._tabId, { url: "chrome://newtab/" }).catch(() => {});
        }
        }
        return { ok: true };
    }
    case "getNewtabToggle": {
        return { enabled: _showCustomNewTab };
    }
    default:
        return { error: `Unhandled default message: ${  msg.what}` };
    }
}

const pickerArgs = { target: "", mouse: false, zap: false, eprom: null };

async function handleElementPicker(msg) {
    switch (msg.what) {
    case "elementPickerArguments":
        return {
        target: pickerArgs.target,
        mouse: pickerArgs.mouse,
        zap: pickerArgs.zap,
        pickerURL: chrome.runtime.getURL(`/web_accessible_resources/epicker-ui.html?zap=${  Math.random().toString(36).slice(2, 10)}`),
        eprom: pickerArgs.eprom || null,
        };
    case "elementPickerEprom":
        if (msg.eprom) {
            pickerArgs.eprom = msg.eprom;
            await chrome.storage.local.set({ elementPickerEprom: msg.eprom }).catch(e => { console.warn("[uBlock Ultimate] storage.set elementPickerEprom:", e); });
        }
        return { success: true };
    case "createUserFilter":
    case "elementPickerCreateFilter":
        return createUserFilter(msg);
    default:
        return {};
    }
}

// Whitelist/trusted-site directive constants (single source of truth)
const WHITELIST_RE_BAD_HOSTNAME = "^[0-9.]+$|^(\\.|.*[^0-9a-zA-Z._-]).*$";
const WHITELIST_RE_HOSTNAME_EXTRACTOR = "^([^\\/]+)\\/(.*)$";
const WHITELIST_DEFAULT_DIRECTIVES = [
    "about-scheme",
    "chrome-extension-scheme",
    "moz-extension-scheme",
    "opera-scheme",
    "vivaldi-scheme",
    "wyciwyg-scheme",
];

const handleWhitelist = {
  async get() {
      const data = await chrome.storage.local.get(["whitelist"]);
      const whitelist = Array.isArray(data.whitelist) ? data.whitelist : [];
      return {
      reBadHostname: WHITELIST_RE_BAD_HOSTNAME,
      reHostnameExtractor: WHITELIST_RE_HOSTNAME_EXTRACTOR,
      whitelistDefault: WHITELIST_DEFAULT_DIRECTIVES,
      whitelist,
      };
  },
  async set(msg) {
      const whitelist = typeof msg.whitelist === "string"
          ? msg.whitelist.split("\n").filter((l) => l.trim())
          : Array.isArray(msg.whitelist)
              ? msg.whitelist
              : [];
      await chrome.storage.local.set({ whitelist });
      await reloadWhitelistAuthoritatively();
      void reconcileTrustedTabCosmetics();
      PolicySnapshot.invalidateAll({ reason: "whitelist-change" });
      return { ok: true };
  },
};

let contextMenuInstalled = false;

async function installContextMenu() {
    if (contextMenuInstalled) return;
    contextMenuInstalled = true;
    await chrome.contextMenus.removeAll().catch(e => { console.warn("[uBlock Ultimate] contextMenus.removeAll install:", e); });
    try {
        chrome.contextMenus.create({
            id: "uBlockUltimateBlockElement",
            title: "Block element…",
            contexts: ["all"],
            documentUrlPatterns: ["http://*/*", "https://*/*"],
        });
    } catch (err) { console.warn("[uBlock Ultimate] Failed to create context menu items:", err); }
    try {
        chrome.contextMenus.create({
            id: "uBlockUltimateOpenLogger",
            title: "Open logger",
            contexts: ["action"],
        });
    } catch (err) { console.warn("[uBlock Ultimate] Failed to create logger context menu:", err); }
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
    switch (info.menuItemId) {
    case "uBlockUltimateBlockElement":
        if (tab?.id) {
            chrome.tabs.sendMessage(tab.id, { topic: "pickerActivate", payload: { source: "context-menu" } }).catch(e => { console.warn("[uBlock Ultimate] tabs.sendMessage elementPicker:", e); });
        }
        break;
    case "uBlockUltimateOpenLogger":
        chrome.tabs.create({ url: chrome.runtime.getURL("logger-ui.html"), active: true }).catch(e => { console.warn("[uBlock Ultimate] tabs.create contextMenu logger:", e); });
        break;
    }
});

async function resolveUserFilterTabId(msg) {
    const explicitTabId = Number(msg.tabId) || 0;
    if (explicitTabId > 0) return explicitTabId;
    const senderTabId = Number(msg._tabId) || 0;
    if (typeof msg.docURL !== "string") return senderTabId;

    let targetURL;
    try {
        targetURL = new URL(msg.docURL);
    } catch (e) {
        console.warn("[uBlock Ultimate] resolveUserFilterTabId: invalid docURL", msg.docURL, e);
        return senderTabId;
    }
    if (targetURL.protocol !== "http:" && targetURL.protocol !== "https:") {
        return senderTabId;
    }
    try {
        const tabs = await chrome.tabs.query({});
        const targetHref = targetURL.href.split("#", 1)[0];
        const matchingTabs = tabs.filter(tab => {
            if (typeof tab.id !== "number" || typeof tab.url !== "string") return false;
            try {
                return new URL(tab.url).hostname === targetURL.hostname;
            } catch (e) {
                console.warn("[uBlock Ultimate] resolveUserFilterTabId: invalid tab URL", tab.url, e);
                return false;
            }
        });
        if (matchingTabs.some(tab => tab.id === senderTabId)) {
            return senderTabId;
        }
        const exactMatch = matchingTabs.find(tab => tab.url?.split("#", 1)[0] === targetHref);
        return exactMatch?.id || matchingTabs.find(tab => tab.active)?.id || senderTabId;
    } catch (e) {
        console.warn("[uBlock Ultimate] resolveUserFilterTabId: tabs.query failed", e);
        return senderTabId;
    }
}

async function createUserFilter(msg) {
    try {
        const tabId = await resolveUserFilterTabId(msg);
        const frameId = Number(msg._frameId);
        const existing = await chrome.storage.local.get(["userFilters", "user-filters", "selectedFilterLists"]);
        const current =
      typeof existing.userFilters === "string"
          ? existing.userFilters
          : typeof existing["user-filters"] === "string"
              ? existing["user-filters"]
              : "";
        const rawFilter = msg.filter || msg.filters || "";
        const lines = current.split("\n").map(f => f.trim()).filter(Boolean);
        let addedCount = 0;
        let highRiskFilters = [];
        for (const filter of rawFilter.split("\n").map(f => f.trim()).filter(Boolean)) {
            if (lines.includes(filter) === false) {
                // Validate against risk model (Item 126)
                const isHighRisk = filter.includes('##') || filter.includes('#@#') ||
                    filter.includes('$replace') || filter.includes('$header') ||
                    filter.includes('$redirect') || filter.includes('$redirect-rule') ||
                    filter.includes('$csp') || filter.includes('$webrtc') ||
                    filter.includes('+js(') || filter.includes('$xmlhttprequest') ||
                    /main-world/i.test(filter) || /responseheader/i.test(filter);
                if (isHighRisk) {
                    highRiskFilters.push(filter);
                }
                lines.push(filter);
                addedCount += 1;
            }
        }
        const selected = new Set(Array.isArray(existing.selectedFilterLists) ? existing.selectedFilterLists : []);
    selected.add("user-filters");
    const updated = lines.join("\n");
    
    // Warn about high-risk filters but still allow them
    if (highRiskFilters.length > 0) {
        console.warn(`[uBlock Ultimate] User filter added ${highRiskFilters.length} high-risk filter(s): ${highRiskFilters.slice(0, 3).join(', ')}${highRiskFilters.length > 3 ? '...' : ''}`);
    }
    
    await chrome.storage.local.set({
      userFilters: updated,
      "user-filters": updated,
      selectedFilterLists: Array.from(selected)
    });
    if ( tabId > 0 && addedCount > 0 ) {
        incrementBlockedCosmeticCount(tabId, frameId, addedCount);
        scheduleBlockedCountBadgeUpdate(tabId);
    }
    reloadAllFilterLists().catch(err => console.warn("[uBlock Ultimate] reloadAllFilterLists after user filters update:", err));
    try { broadcastMessage("uBR", { what: "userFiltersUpdated" }); } catch (e) { console.warn("[uBlock Ultimate] BroadcastChannel userFiltersUpdated:", e); }
    return { ok: true, added: addedCount, rejected: 0, highRisk: highRiskFilters.length };
    } catch (e) {
        return { ok: false, error: String(e) };
    }
}

const optionalProtectionRulesets = Object.freeze([
    {
        id: "privacy-url-cleanup",
        ruleCount: 1,
        risk: "low",
        title: {
            en: "Remove tracking parameters",
            es: "Eliminar parámetros de seguimiento",
        },
        description: {
            en: "Removes common campaign identifiers from top-level links without touching page APIs.",
            es: "Elimina identificadores comunes de campañas en enlaces principales sin modificar las API de las páginas.",
        },
    },
    {
        id: "static-video-ads",
        ruleCount: 46,
        risk: "medium",
        title: {
            en: "Video ad protection",
            es: "Protección contra anuncios de video",
        },
        description: {
            en: "Blocks known video advertising endpoints. Disable it if a player fails to start.",
            es: "Bloquea endpoints conocidos de publicidad en video. Desactívalo si un reproductor no inicia.",
        },
    },
    {
        id: "privacy-social-trackers",
        ruleCount: 7,
        risk: "medium",
        title: {
            en: "Social tracking pixels",
            es: "Píxeles de seguimiento social",
        },
        description: {
            en: "Blocks third-party measurement scripts from major social and advertising platforms.",
            es: "Bloquea scripts de medición de terceros de grandes plataformas sociales y publicitarias.",
        },
    },
    {
        id: "static-badware",
        ruleCount: 174,
        risk: "low",
        title: {
            en: "Extended malware protection",
            es: "Protección ampliada contra malware",
        },
        description: {
            en: "Adds the packaged badware block and exception rules.",
            es: "Añade reglas empaquetadas de bloqueo y excepciones contra software malicioso.",
        },
    },
    {
        id: "static-privacy",
        ruleCount: 183,
        risk: "medium",
        title: {
            en: "Strict privacy layer",
            es: "Capa de privacidad estricta",
        },
        description: {
            en: "Adds stricter tracker blocking and privacy redirects. Some sign-in or payment flows may need an exception.",
            es: "Añade bloqueos y redirecciones de privacidad más estrictos. Algunos accesos o pagos pueden requerir una excepción.",
        },
    },
    {
        id: "static-core",
        ruleCount: 315,
        risk: "medium",
        title: {
            en: "Extended core filters",
            es: "Filtros principales ampliados",
        },
        description: {
            en: "Enables an extra packaged set of block, allow and redirect rules.",
            es: "Activa un conjunto empaquetado adicional de reglas de bloqueo, permiso y redirección.",
        },
    },
    {
        id: "static-unbreak",
        ruleCount: 237,
        risk: "low",
        title: {
            en: "Compatibility repairs",
            es: "Reparaciones de compatibilidad",
        },
        description: {
            en: "Adds allow and redirect rules intended to repair sites affected by strict filtering.",
            es: "Añade reglas de permiso y redirección para reparar sitios afectados por filtros estrictos.",
        },
    },
]);

const optionalProtectionRulesetIds = new Set(
    optionalProtectionRulesets.map(entry => entry.id)
);

async function getProtectionRulesetState() {
    const enabled = new Set(
        await chrome.declarativeNetRequest.getEnabledRulesets()
    );
    let availableStaticRuleCount = null;
    if (
        typeof chrome.declarativeNetRequest.getAvailableStaticRuleCount ===
        "function"
    ) {
        availableStaticRuleCount =
            await chrome.declarativeNetRequest.getAvailableStaticRuleCount();
    }
    return {
        availableStaticRuleCount,
        rulesets: optionalProtectionRulesets.map(entry => ({
            ...entry,
            enabled: enabled.has(entry.id),
        })),
    };
}

async function setProtectionRuleset(msg) {
    const id = typeof msg.id === "string" ? msg.id : "";
    if (optionalProtectionRulesetIds.has(id) === false) {
        throw new Error(`Unknown optional ruleset: ${id || "(empty)"}`);
    }
    if (typeof msg.enabled !== "boolean") {
        throw new Error("The enabled state must be boolean");
    }
    const enabled = new Set(
        await chrome.declarativeNetRequest.getEnabledRulesets()
    );
    if (enabled.has(id) !== msg.enabled) {
        await chrome.declarativeNetRequest.updateEnabledRulesets({
            enableRulesetIds: msg.enabled ? [id] : [],
            disableRulesetIds: msg.enabled ? [] : [id],
        });
    }
    return getProtectionRulesetState();
}

async function handleDashboard(msg, senderTabId) {
    switch (msg.what) {
    case "getProtectionRulesets":
        return getProtectionRulesetState();
    case "setProtectionRuleset":
        return setProtectionRuleset(msg);
    case "getLists":
        return getFilterListState();
    case "dashboardConfig":
        return { canUpdate: true, noDashboard: false };
    case "getRuntimeHealth":
        return { ...runtimeHealth };
    case "userSettings":
        if (msg.name) return changeUserSetting(msg);
        return readUserSettings();
    case "getLocalData":
        return readLocalData();
    case "reloadAllFilters":
        return reloadAllFilterLists();
    case "updateNow":
        return updateFilterListsNow(msg);
    case "listsUpdateNow":
        if (Array.isArray(msg.assetKeys)) {
            for (const key of msg.assetKeys) {
                await purgeFilterListCache(key);
            }
        }
        return updateFilterListsNow(msg);
    case "applyFilterListSelection":
        return applyFilterListSelection(msg);
    case "readUserFilters":
        return readUserFilters();
    case "writeUserFilters":
        return writeUserFilters(msg);
    case "getAutoCompleteDetails": {
        const stored = await chrome.storage.local.get(["redirectResourceDetails", "trustedScriptletTokens"]);
        const result = {
            hintUpdateToken: msg.hintUpdateToken || 0,
            redirectResources: stored.redirectResourceDetails || [],
            preparseDirectiveEnv: ["chromium", "firefox", "edge", "safari", "mobile", "devbuild"],
            preparseDirectiveHints: ["chromium", "firefox", "edge", "safari", "mobile", "devbuild", "true", "false"],
            originHints: [],
        };
        try {
            const tabs = await chrome.tabs.query({ url: ["http://*/*", "https://*/*"] });
            const hosts = new Set();
            for (const tab of tabs) {
                try { hosts.add(new URL(tab.url).hostname); } catch (e) { console.warn("[uBlock Ultimate] getHostnameHints: invalid tab URL", tab.url, e); }
            }
            result.originHints = Array.from(hosts).sort();
        } catch (e) {
            console.warn("[uBlock Ultimate] getHostnameHints: tabs.query failed", e);
        }
        return result;
    }
    case "getTrustedScriptletTokens": {
        const stored = await chrome.storage.local.get("trustedScriptletTokens");
        return new Set(stored.trustedScriptletTokens || []);
    }
    case "getRules": {
        await ensurePermanentStateLoaded();
        const serialized = serializeAllRules();
        let pslSelfie = null;
        try {
            const cached = await chrome.storage.local.get('pslSelfie');
            if (cached.pslSelfie) pslSelfie = cached.pslSelfie;
        } catch (e) {
            console.warn("[uBlock Ultimate] getRules: failed to read pslSelfie", e);
        }
        return { permanentRules: serialized.permanentRules, sessionRules: serialized.sessionRules, pslSelfie };
    }
    case "modifyRuleset": {
        return await applyRuleChanges(msg.permanent === true, msg.toAdd || "", msg.toRemove || "");
    }
    case "resetRules": {
        await ensurePermanentStateLoaded();

        return enqueueStateMutation(async () => {
            const snapshot = snapshotFilteringState();
            try {
                sessionFirewall.assign(permanentFirewall);
                sessionHostnameSwitches.clear();
                sessionNetFiltering.clear();
                sessionPageNetFiltering.clear();
                sessionURLFilteringRules.clear();
                await Promise.all([
                    persistSessionHostnameSwitches(),
                    persistSessionFirewallState(),
                    persistSessionPageNetFiltering(),
                    persistSessionURLFilteringRules(),
                ]);
                await syncFirewallDnrRules();
                await syncNetFilteringDnrRules();
                await syncHostnameSwitchDnrRules();
                await syncURLFilteringDnrRules();
                await syncCspReportPolicyRules();
                await postCommitFilteringChange("rules-reset");
                const serialized = serializeAllRules();
                return { permanentRules: serialized.permanentRules, sessionRules: serialized.sessionRules };
            } catch (error) {
                await restoreFilteringState(snapshot);
                console.warn("[uBlock Ultimate] resetRules failed, rolled back:", error);
                throw error;
            }
        });
    }
    case "getAppData":
        return { name: "uBlock Ultimate", version: chrome.runtime.getManifest().version || "1.0.0" };
    case "readHiddenSettings": {
        const stored = await chrome.storage.local.get("hiddenSettings").catch(e => { console.warn("[uBlock Ultimate] readHiddenSettings: storage.get failed", e); return {}; });
        return { default: {}, admin: {}, current: stored.hiddenSettings || {} };
    }
    case "writeHiddenSettings": {
        await chrome.storage.local.set({ hiddenSettings: msg.settings || {} });
        return { ok: true };
    }
    case "resetUserData": {
        await chrome.storage.local.clear();
        await chrome.storage.session?.clear().catch(e => { console.warn("[uBlock Ultimate] storage.session.clear:", e); });
        permanentURLFilteringRules = {};
        sessionURLFilteringRules.clear();
        urlFilteringDnrRuleMetadata.clear();
        lifetimeRequestCounts.allowed = 0;
        lifetimeRequestCounts.blocked = 0;
        lifetimeCountsLoaded = true;
        lifetimeCountsLoadPromise = null;
        if (lifetimeCountsPersistTimer !== 0) {
            clearTimeout(lifetimeCountsPersistTimer);
            lifetimeCountsPersistTimer = 0;
        }
        await chrome.storage.local.set({
            [STORAGE_KEY_GLOBAL_ALLOWED_REQUEST_COUNT]: 0,
            [STORAGE_KEY_GLOBAL_BLOCKED_REQUEST_COUNT]: 0,
        });
        await syncURLFilteringDnrRules();
        scheduleCspReportPolicySync();
        return { ok: true };
    }
    case "getMatchedRuleInfo":
        return { ok: true, matches: [] };
    case "restoreUserData": {
        if (msg.userData) {
            await chrome.storage.local.set(msg.userData);
        }
        if (msg.localData) {
            await chrome.storage.local.set({ localData: msg.localData });
        }
        try {
            await reloadAllFilterLists();
        } catch (e) {
            console.warn("[uBlock Ultimate] restoreUserData: reloadAllFilterLists failed", e);
        }
        return { ok: true };
    }
    case "backupUserData": {
        const allKeys = await chrome.storage.local.get(null);
        const userDataKeys = ["userSettings", "selectedFilterLists", "userFilters", "user-filters", "whitelist",
            "ubrPermanentNetFiltering", "ubrPermanentHostnameSwitches", "ubrPermanentFirewallRules",
            "ubrURLFilteringRules", "aboutPageSettings", "hiddenSettings", "dynamicFilteringString",
            "hostnameSwitchesString", "ubrFilterListCache", "filterListWriteTimes",
        ];
        const userData = {};
        for (const key of userDataKeys) {
            if (key in allKeys) userData[key] = allKeys[key];
        }
        const localData = { lastBackupFile: msg?.filename || "", lastBackupTime: Date.now() };
        return { userData, localData };
    }
    case "getWhitelist":
        return handleWhitelist.get();
    case "setWhitelist":
        return handleWhitelist.set(msg);
    case "readyToFilter":
        return true;
    case "getSmartRules":
        await smartRuleStore.load();
        return { rules: smartRuleStore.getAllRules(), collections: smartRuleStore.getAllCollections() };
    case "addSmartRule": {
        const rule = msg.rule;
        rule.id = rule.id || `ubr:smart:${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        rule.metadata = rule.metadata || { createdAt: new Date().toISOString() };
        await smartRuleStore.load();
        return smartRuleStore.addRule(rule);
    }
    case "updateSmartRule":
        await smartRuleStore.load();
        return smartRuleStore.updateRule(msg.rule.id, msg.rule);
    case "removeSmartRule":
        await smartRuleStore.load();
        return { ok: await smartRuleStore.removeRule(msg.id) };
    case "setSmartRuleState":
        await smartRuleStore.load();
        return { ok: await smartRuleStore.setRuleState(msg.id, msg.state) };
    case "subscribeSmartCollection": {
        await smartEngine.init();
        const collectionId = `col-${Date.now()}`;
        const ok = await smartEngine.subscribeToCollection(msg.url, collectionId);
        return { ok, collectionId };
    }
    case "testSmartRules": {
        await smartEngine.init();
        const tabId = msg.tabId || senderTabId || 0;
        const selectors = smartEngine.applyRulesToTab(tabId, msg.url).selectors;
        return { selectors };
    }
    case "getCosmeticPlanForDocument": {
        const tabId = msg.tabId || senderTabId || 0;
        const result = smartEngine.getCosmeticPlanForTab(tabId, msg.url);
        return result;
    }
    case "getSmartTabId":
        return { tabId: senderTabId || 0 };
    case "previewSmartCosmeticRule": {
        await smartRuleStore.load();
        try { broadcastMessage("ubr-smart-cosmetic", { what: "previewRule" }); } catch (e) { console.warn("[uBlock Ultimate] BroadcastChannel smart-cosmetic previewRule:", e); }
        return { ok: true, rule: msg.rule || null };
    }
    case "confirmSmartCosmeticRulePreview": {
        await smartRuleStore.load();
        const rule = smartRuleStore.getRule(msg.id);
        if (rule) {
            const updated = { ...rule, preview: { status: 'confirmed', confirmationHash: msg.hash || rule.preview?.confirmationHash, confirmedAt: new Date().toISOString(), lastPreviewedAt: new Date().toISOString() } };
            await smartRuleStore.updateRule(msg.id, updated);
            return { ok: true };
        }
        return { ok: false, error: 'Rule not found' };
    }
    case "saveSmartCosmeticRule": {
        await smartRuleStore.load();
        const result = await smartRuleStore.addRule(msg.rule);
        try { broadcastMessage("ubr-smart-cosmetic", { what: "rules-changed" }); } catch (e) { console.warn("[uBlock Ultimate] BroadcastChannel smart-cosmetic rules-changed:", e); }
        return { ok: result.ok, errors: result.validation?.diagnostics };
    }
    case "updateSmartCosmeticRule": {
        await smartRuleStore.load();
        const result = await smartRuleStore.updateRule(msg.id, msg.updates);
        try { broadcastMessage("ubr-smart-cosmetic", { what: "rules-changed" }); } catch (e) { console.warn("[uBlock Ultimate] BroadcastChannel smart-cosmetic rules-changed:", e); }
        return { ok: result.ok, errors: result.validation?.diagnostics };
    }
    case "deleteSmartCosmeticRule": {
        await smartRuleStore.load();
        const success = await smartRuleStore.removeRule(msg.id);
        try { broadcastMessage("ubr-smart-cosmetic", { what: "rules-changed" }); } catch (e) { console.warn("[uBlock Ultimate] BroadcastChannel smart-cosmetic rules-changed:", e); }
        return { ok: success };
    }
    case "enableDisableSmartCosmeticRule": {
        await smartRuleStore.load();
        const success = await smartRuleStore.setRuleState(msg.id, msg.state);
        try { broadcastMessage("ubr-smart-cosmetic", { what: "rules-changed" }); } catch (e) { console.warn("[uBlock Ultimate] BroadcastChannel smart-cosmetic rules-changed:", e); }
        return { ok: success };
    }
    case "importSmartRules": {
        const parsed = parseSmartRules(msg.yaml);
        if (parsed.errors.length > 0 && parsed.rules.length === 0) {
            return { ok: false, errors: parsed.errors };
        }
        let added = 0;
        for (const rule of parsed.rules) {
            const result = await smartRuleStore.addRule(rule);
            if (result.ok) added++;
        }
        return { ok: true, count: added, errors: parsed.errors };
    }
    case "exportSmartRules": {
        const result = await exportAllRules();
        return result;
    }
    case "exportSmartRulesToClassic": {
        const result = await exportAllRules();
        return { classicLines: result.classicLines, lossMetadata: result.lossMetadata };
    }
    default:
        return {};
    }
}

async function handleCloudWidget(msg) {
    switch (msg.what) {
    case "cloudGetOptions": {
        const stored = await chrome.storage.local.get(["cloudOptions", "userSettings"]);
        const options = stored.cloudOptions || {};
        const userSettings = stored.userSettings || {};
        if (!options.deviceName) {
            options.deviceName = `${navigator.platform || "unknown"}-${Date.now().toString(36).slice(-6)}`;
            await chrome.storage.local.set({ cloudOptions: options });
        }
        return {
            enabled: userSettings.cloudStorageEnabled === true,
            deviceName: options.deviceName || "",
            defaultDeviceName: "Default device",
            cloudStorageSupported: typeof chrome.storage.sync !== "undefined",
        };
    }
    case "cloudSetOptions": {
        const stored = await chrome.storage.local.get("cloudOptions");
        const options = stored.cloudOptions || {};
        if (msg.options?.deviceName) options.deviceName = msg.options.deviceName;
        await chrome.storage.local.set({ cloudOptions: options });
        return {
            deviceName: options.deviceName || "",
            defaultDeviceName: "Default device",
        };
    }
    case "cloudPush": {
        const datakey = msg.datakey || "cloudData";
        try {
            const payload = { data: msg.data, source: msg.source || "", tstamp: Date.now() };
            const json = JSON.stringify(payload);
            await chrome.storage.local.set({ [datakey]: json });
            return false;
        } catch (e) {
            return String(e);
        }
    }
    case "cloudPull": {
        const datakey = msg.datakey || "cloudData";
        try {
            const stored = await chrome.storage.local.get(datakey);
            const raw = stored[datakey];
            if (!raw) return false;
            return JSON.parse(raw);
        } catch (e) {
            console.warn("[uBlock Ultimate] sw: cloudPull failed", datakey, e);
            return false;
        }
    }
    case "cloudUsed": {
        const datakey = msg.datakey || "cloudData";
        const max = typeof chrome.storage.sync !== "undefined" ? 102400 : 10485760;
        const total = await chrome.storage.local.getBytesInUse(null).catch(e => { console.warn("[uBlock Ultimate] sw: cloudUsed getBytesInUse failed", e); return 0; });
        const stored = await chrome.storage.local.get(datakey).catch(e => { console.warn("[uBlock Ultimate] sw: cloudUsed storage.get failed", datakey, e); return {}; });
        const used = stored[datakey] ? stored[datakey].length : 0;
        return { max, total, used };
    }
    default:
        return false;
    }
}

const userSettingsDefault = {
  advancedUserEnabled: false,
  autoUpdate: true,
  cloudStorageEnabled: false,
    collapseBlocked: true,
    showCustomNewTab: false,
    colorBlindFriendly: false,
  contextMenuEnabled: true,
  cnameUncloakEnabled: false,
  hyperlinkAuditingDisabled: true,
  ignoreGenericCosmeticFilters: false,
  importedLists: [],
  largeMediaSize: 10485760,
  noCosmeticFiltering: false,
  noLargeMedia: false,
  noRemoteFonts: false,
  noScripting: false,
  noCSPReports: true,
  experimentalHeuristicInterceptorsEnabled: false,
  prefetchingDisabled: false,
  webrtcIPAddressHidden: false,
  firewallPaneMinimized: true,
  popupPanelSections: 15,
  showIconBadge: true,
  stealthModeEnabled: true,
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
  suspendUntilListsAreLoaded: false,
  tooltipsDisabled: false,
  uiAccentCustom: false,
  uiAccentCustom0: "#3498d6",
  uiTheme: "auto",
};

async function readUserSettings() {
    const stored = await chrome.storage.local.get(popupSettingsStorageKeys());
    const merged = mergePopupSettings(userSettingsDefault, stored);
    if (merged.migrated) {
        await chrome.storage.local.set(popupSettingsToStorage(merged.settings));
    }
    popupSettings = merged.settings;
    return merged.settings;
}

const FIREWALL_SECTION_BIT = 0b10000;

async function changeUserSetting(msg) {
    const name = typeof msg?.name === "string" ? msg.name : "";
    if (name === "") {
        return { ok: false, error: "Missing setting name" };
    }

    await ensurePermanentStateLoaded();

    const GLOBAL_SWITCH_NAMES = ["noCosmeticFiltering", "noLargeMedia", "noRemoteFonts", "noScripting", "noCSPReports"];
    if (GLOBAL_SWITCH_NAMES.includes(name) === false) {
        // Non-filtering settings — write directly, no queue needed
        const nextSettings = {
            ...userSettingsDefault,
            ...popupSettings,
            [name]: msg.value,
        };
        if (name === "advancedUserEnabled" && msg.value === true) {
            const currentSections = Number.isInteger(nextSettings.popupPanelSections)
                ? nextSettings.popupPanelSections
                : 0b1111;
            nextSettings.popupPanelSections = currentSections | FIREWALL_SECTION_BIT;
        }
        await chrome.storage.local.set(popupSettingsToStorage(nextSettings));
        popupSettings = nextSettings;
        try {
            await syncHostnameSwitchDnrRules();
            if (name === "noCSPReports") await syncCspReportPolicyRules();
        } catch (_) {}
        for (const tabId of tabContentRevision.keys()) {
            markTabChanged(tabId);
        }
        if (msg.name === "experimentalHeuristicInterceptorsEnabled") {
            await postCommitFilteringChange("heuristic-interceptors-setting");
        }
        if (msg.name === STEALTH_MODE_SETTING || msg.name === "youtubeDetectionNeutralMode") {
            await syncStealthSurrogateRules();
        }
        if (msg.name === "contextMenuEnabled") {
            if (msg.value) { await installContextMenu(); }
            else { chrome.contextMenus.removeAll().catch(e => { console.warn("[uBlock Ultimate] contextMenus.removeAll settings:", e); }); }
        }
        if (msg.name === "showCustomNewTab") {
            _showCustomNewTab = msg.value;
            await chrome.storage.local.set({ showCustomNewTab: msg.value }).catch(() => {});
        }
        if (msg.name === "showIconBadge") {
            if (!msg.value) {
                const tabs = await chrome.tabs.query({}).catch(e => { console.warn("[uBlock Ultimate] sw: showIconBadge tabs.query failed", e); return []; });
                await Promise.all(tabs.map(tab => clearBlockedCountIcon(tab.id)));
            } else {
                const tabs = await chrome.tabs.query({}).catch(e => { console.warn("[uBlock Ultimate] sw: showIconBadge tabs.query failed", e); return []; });
                for (const tab of tabs) {
                    if (typeof tab.id === "number") { scheduleBlockedCountBadgeUpdate(tab.id); }
                }
            }
        }
        if (msg.name === "prefetchingDisabled" && typeof chrome.privacy !== "undefined") {
            chrome.privacy.network.networkPredictionEnabled.set({ value: !msg.value }).catch(e => { console.warn("[uBlock Ultimate] privacy.networkPredictionEnabled:", e); });
        }
        if (msg.name === "hyperlinkAuditingDisabled" && typeof chrome.privacy !== "undefined") {
            chrome.privacy.websites.hyperlinkAuditingEnabled.set({ value: !msg.value }).catch(e => { console.warn("[uBlock Ultimate] privacy.hyperlinkAuditingEnabled:", e); });
        }
        if (msg.name === "webrtcIPAddressHidden" && typeof chrome.privacy !== "undefined") {
            chrome.privacy.services.ipHandlingPolicy.set({ value: msg.value ? "disable_non_proxied_udp" : "default" }).catch(e => { console.warn("[uBlock Ultimate] privacy.ipHandlingPolicy:", e); });
        }
        return { ok: true, userSettings: { ...nextSettings } };
    }

    // Global switch — entire transaction inside the state queue
    const switchName = name;
    const switchValue = msg.value === true;
    return enqueueStateMutation(async () => {
        const filteringSnapshot = snapshotFilteringState();
        const oldSettings = structuredClone(popupSettings);
        const nextSettings = {
            ...userSettingsDefault,
            ...popupSettings,
            [switchName]: switchValue,
        };
        try {
            popupSettings = nextSettings;
            permanentHostnameSwitches["*"] = {
                ...(permanentHostnameSwitches["*"] || {}),
                [switchName]: switchValue,
            };
            await chrome.storage.local.set({
                ...popupSettingsToStorage(nextSettings),
                [STORAGE_KEY_PERM_HOSTNAME_SWITCHES]: permanentHostnameSwitches,
            });
            await syncHostnameSwitchDnrRules();
            if (switchName === "noCSPReports") await syncCspReportPolicyRules();
            await postCommitFilteringChange(`global-switch:${switchName}`);
            for (const tabId of tabContentRevision.keys()) {
                markTabChanged(tabId);
            }
            return { ok: true, userSettings: { ...popupSettings } };
        } catch (error) {
            popupSettings = oldSettings;
            await chrome.storage.local.set(popupSettingsToStorage(oldSettings)).catch(() => {});
            await restoreFilteringState(filteringSnapshot);
            console.warn("[uBlock Ultimate] global switch update failed, rolled back:", error);
            return { ok: false, error: "Global switch update failed" };
        }
    });
}

async function syncStealthSurrogateRules() {
    const settings = await readUserSettings();
    const existing = await chrome.declarativeNetRequest.getSessionRules();
    const removeRuleIds = existing
        .map(rule => rule.id)
        .filter(isStealthSurrogateRuleId);
    const addRules = settings[STEALTH_MODE_SETTING] === false
        ? []
        : createStealthSurrogateRules({
            youtubeDetectionNeutral: settings.youtubeDetectionNeutralMode !== false,
        });

    await chrome.declarativeNetRequest.updateSessionRules({
        removeRuleIds,
        addRules,
    });
}

async function readLocalData() {
    const storageUsed = await chrome.storage.local.getBytesInUse(null).catch(e => { console.warn("[uBlock Ultimate] sw: readLocalData getBytesInUse failed", e); return 0; });
    const localData = (await chrome.storage.local.get("localData")).localData || {};
    const userSettings = await readUserSettings();
    return {
    storageUsed,
    lastBackupFile: localData.lastBackupFile || "",
    lastBackupTime: localData.lastBackupTime || 0,
    lastRestoreFile: localData.lastRestoreFile || "",
    lastRestoreTime: localData.lastRestoreTime || 0,
    cloudStorageSupported: typeof chrome.storage.sync !== "undefined",
    privacySettingsSupported: typeof chrome.privacy !== "undefined",
    canLeakLocalIPAddresses: typeof chrome.privacy !== "undefined",
    };
}

async function readUserFilters() {
    const data = await chrome.storage.local.get(["userFilters", "user-filters", "selectedFilterLists", "userSettings"]);
    const selectedLists = Array.isArray(data.selectedFilterLists) ? data.selectedFilterLists : [];
    const userSettings = data.userSettings || {};
    const content =
    typeof data.userFilters === "string"
        ? data.userFilters
        : typeof data["user-filters"] === "string"
            ? data["user-filters"]
            : "";
    let enabled = selectedLists.includes("user-filters");
    if (enabled === false && content.trim() === "") {
        enabled = true;
        await chrome.storage.local.set({
      selectedFilterLists: ["user-filters", ...selectedLists],
        });
    }
    return {
    content,
    enabled,
    trusted: userSettings.userFiltersTrusted === true,
    };
}

async function writeUserFilters(msg) {
    try {
        const data = await chrome.storage.local.get(["selectedFilterLists", "userSettings"]);
        const selected = new Set(Array.isArray(data.selectedFilterLists) ? data.selectedFilterLists : []);
        if (msg.enabled !== false) {
      selected.add("user-filters");
        } else {
      selected.delete("user-filters");
        }
        const nextUserSettings = {
      ...(data.userSettings || {}),
      userFiltersTrusted: msg.trusted === true,
        };
        const rawContent = msg.content || "";
        await chrome.storage.local.set({
      userFilters: rawContent,
      "user-filters": rawContent,
      selectedFilterLists: Array.from(selected),
      userSettings: nextUserSettings,
        });
        try { broadcastMessage("uBR", { what: "userFiltersUpdated" }); } catch (e) { console.warn("[uBlock Ultimate] BroadcastChannel userFiltersUpdated:", e); }
        return { ok: true, rejected: 0 };
    } catch (e) {
        return { ok: false, error: String(e) };
    }
}

// ---------------------------------------------------------------------------
// Filter list management pipeline
// ---------------------------------------------------------------------------
const FILTER_LIST_USER_PATH = "user-filters";
const FILTER_LIST_ASSETS_URL = "assets/assets.json";
let filterListsUpdating = false;
let syncInProgress = false;  // boolean fallback guard for non-token callers

async function getFilterListCache() {
    const stored = await chrome.storage.local.get(STORAGE_KEY_FILTER_CACHE).catch(e => { console.warn("[uBlock Ultimate] sw: getFilterListCache storage.get failed", e); return {}; });
    return stored[STORAGE_KEY_FILTER_CACHE] || {};
}

async function setFilterListCacheEntry(listKey, entry) {
    const cache = await getFilterListCache();
    cache[listKey] = { ...cache[listKey], ...entry, tstamp: Date.now() };
    await chrome.storage.local.set({ [STORAGE_KEY_FILTER_CACHE]: cache });
}

async function purgeFilterListCache(listKey) {
    if (!listKey) {
        await chrome.storage.local.remove(STORAGE_KEY_FILTER_CACHE);
        return;
    }
    const cache = await getFilterListCache();
    delete cache[listKey];
    await chrome.storage.local.set({ [STORAGE_KEY_FILTER_CACHE]: cache });
}

function normalizeListEntries(value) {
    if (Array.isArray(value) === false) return [];
    return value.map(e => typeof e === "string" ? e.trim() : "").filter(e => e !== "");
}

const normalizeImportedLists = normalizeListEntries;
const normalizeSelectedFilterLists = normalizeListEntries;

function isValidExternalList(value) {
    return /^[a-z-]+:\/\/(?:\S+\/\S*|\/\S+)/i.test(value);
}

function extractListURLs(text) {
    return text.split(/\s+/).map(l => l.trim()).filter(l => l !== "" && isValidExternalList(l));
}

function listSupportNameFromURL(value) {
    try { return new URL(value).hostname; } catch (e) { console.warn("[uBlock Ultimate] listSupportNameFromURL: invalid URL", value, e); return ""; }
}

function cloneObject(value) {
    return JSON.parse(JSON.stringify(value));
}

function deriveDefaultSelectedFilterLists(available, userPath) {
    const selected = [userPath];
    for (const [key, details] of Object.entries(available)) {
        if (key === userPath) continue;
        if (details.content !== "filters") continue;
        if (details.off === true) continue;
    selected.push(key);
    }
    return selected;
}

function resolveBundledFilterListPath(asset) {
    const contentURLs = Array.isArray(asset.contentURL)
        ? asset.contentURL
        : typeof asset.contentURL === "string" ? [asset.contentURL] : [];
    return contentURLs.find(url => typeof url === "string" && url.startsWith("assets/"));
}

function resolveStockAssetKeyFromURL(catalog, urlKey) {
    const needle = urlKey.replace(/^https?:/, "");
    for (const [assetKey, asset] of Object.entries(catalog)) {
        if (asset.content !== "filters") continue;
        const contentURLs = Array.isArray(asset.contentURL)
            ? asset.contentURL
            : typeof asset.contentURL === "string" ? [asset.contentURL] : [];
        for (const contentURL of contentURLs) {
            if (contentURL.replace(/^https?:/, "") === needle) return assetKey;
        }
    }
    return urlKey;
}

function buildAvailableFilterLists(catalog, importedLists, selectedListSet, userPath) {
    const available = {
    [userPath]: {
      content: "filters",
      group: "user",
      title: "My filters",
      off: selectedListSet.has(userPath) === false,
    },
    };
    for (const [assetKey, asset] of Object.entries(catalog)) {
        if (asset.content !== "filters") continue;
        available[assetKey] = { ...cloneObject(asset), off: selectedListSet.has(assetKey) === false };
    }
    for (const importedList of importedLists) {
        if (available[importedList] !== void 0) {
            available[importedList].off = selectedListSet.has(importedList) === false;
            continue;
        }
        available[importedList] = {
      content: "filters",
      contentURL: importedList,
      external: true,
      group: "custom",
      submitter: "user",
      supportURL: importedList,
      supportName: listSupportNameFromURL(importedList),
      title: importedList,
      off: selectedListSet.has(importedList) === false,
        };
    }
    return available;
}

async function estimateFilterCounts(available) {
    // Prefer cached compiled counts from last sync for accuracy
    const stored = await chrome.storage.local.get(STORAGE_KEY_COMPILED_COUNTS).catch(e => { console.warn("[uBlock Ultimate] sw: estimateFilterCounts storage.get failed", e); return {}; });
    const cached = stored[STORAGE_KEY_COMPILED_COUNTS];
    if (cached && typeof cached.netFilterCount === "number" && typeof cached.cosmeticFilterCount === "number") {
        return { netFilterCount: cached.netFilterCount, cosmeticFilterCount: cached.cosmeticFilterCount };
    }
    // Fall back to catalog metadata
    let netFilterCount = 0;
    let cosmeticFilterCount = 0;
    for (const details of Object.values(available)) {
        if (details.off === true) continue;
        netFilterCount += details.entryCount || 0;
        cosmeticFilterCount += details.entryUsedCount || 0;
    }
    return { netFilterCount, cosmeticFilterCount };
}

function parseStoredCosmeticFilterData(raw) {
    let parsed = raw;
    if (typeof parsed === "string" && parsed !== "") {
        try { parsed = JSON.parse(parsed); } catch (e) { console.warn("[uBlock Ultimate] parseStoredCosmeticFilterData: JSON parse failed", e); parsed = {}; }
    }
    const data = parsed && typeof parsed === "object" ? parsed : {};
    return {
    genericCosmeticFilters: Array.isArray(data.genericCosmeticFilters) ? data.genericCosmeticFilters : [],
    genericCosmeticExceptions: Array.isArray(data.genericCosmeticExceptions) ? data.genericCosmeticExceptions : [],
    specificCosmeticFilters: Array.isArray(data.specificCosmeticFilters) ? data.specificCosmeticFilters : [],
    scriptletFilters: Array.isArray(data.scriptletFilters) ? data.scriptletFilters : [],
    };
}

async function fetchFilterListCatalog() {
    const url = chrome.runtime.getURL(FILTER_LIST_ASSETS_URL);
  console.log(`[uBlock Ultimate] Fetching catalog from ${url}`);
  const response = await fetch(url);
  if (!response.ok) {
    console.error(`[uBlock Ultimate] Catalog fetch failed: ${response.status} ${response.statusText}`);
    throw new Error(`HTTP ${response.status}`);
  }
  const catalog = await response.json();
  const filterKeys = Object.entries(catalog).filter(([, v]) => v?.content === "filters").map(([k]) => k);
  console.log(`[uBlock Ultimate] Catalog loaded: ${Object.keys(catalog).length} entries, ${filterKeys.length} filter lists`);
  return catalog;
}

function serializeCosmeticFilterData(dnrData) {
    return {
    genericCosmeticFilters: Array.isArray(dnrData?.genericCosmeticFilters) ? dnrData.genericCosmeticFilters : [],
    genericCosmeticExceptions: Array.isArray(dnrData?.genericCosmeticExceptions) ? dnrData.genericCosmeticExceptions : [],
    specificCosmeticFilters: dnrData?.specificCosmetic instanceof Map
        ? Array.from(dnrData.specificCosmetic.entries())
        : Array.isArray(dnrData?.specificCosmetic) ? dnrData.specificCosmetic : [],
    scriptletFilters: dnrData?.scriptlet instanceof Map
        ? Array.from(dnrData.scriptlet.entries())
        : Array.isArray(dnrData?.scriptlet) ? dnrData.scriptlet : [],
    };
}

function generateFallbackRules() {
    const rules = [];
    const baseId = 1;
    const adDomains = [
    "doubleclick.net",
    "googlesyndication.com",
    "pagead2.googlesyndication.com",
    "googleadservices.com",
    "google-analytics.com",
    "ssl.google-analytics.com",
    "analytics.google.com",
    "adservice.google.com",
    "googletagmanager.com",
    "ads.youtube.com",
    "adnxs.com",
    "adsrvr.org",
    "criteo.com",
    "pubmatic.com",
    "rubiconproject.com",
    "openx.net",
    "advertising.com",
    "media.net",
    "static.media.net",
    "casalemedia.com",
    "contextweb.com",
    "scorecardresearch.com",
    "quantserve.com",
    "krxd.net",
    "taboola.com",
    "outbrain.com",
    "amazon-adsystem.com",
    "aax.amazon-adsystem.com",
    "connect.facebook.net",
    "pixel.facebook.com",
    "analytics.tiktok.com",
    "ads-api.tiktok.com",
    "analytics.twitter.com",
    "stats.wp.com",
    "pixel.wp.com",
    "events.reddit.com",
    "ads.linkedin.com",
    "adzerk.net",
    "metrika.yandex.ru",
    "mc.yandex.ru",
    "samsungads.com",
    "smetrics.samsung.com",
    "iadsdk.apple.com",
    "metrics.icloud.com",
    "metrics.mzstatic.com",
    "auction.unityads.unity3d.com",
    "config.unityads.unity3d.com",
    "notify.bugsnag.com",
    "analytics.query.yahoo.com",
    "gemini.yahoo.com",
    "moatads.com",
    "moat.com",
    "exelator.com",
    "tracking.rus.miui.com",
    "data.mistat.xiaomi.com",
    "data.mistat.india.xiaomi.com",
    "data.mistat.rus.xiaomi.com",
    "sdkconfig.ad.xiaomi.com",
    "sdkconfig.ad.intl.xiaomi.com",
    "api.ad.xiaomi.com",
    "grs.hicloud.com",
    "logservice1.hicloud.com",
    "metrics.data.hicloud.com",
    "metrics2.data.hicloud.com",
    "logbak.hicloud.com",
    "logservice.hicloud.com",
    "iot-eu-logser.realme.com",
    "iot-logser.realme.com",
    "bdapi-ads.realmemobile.com",
    "bdapi-in-ads.realmemobile.com",
    "ck.ads.oppomobile.com",
    "adx.ads.oppomobile.com",
    "data.ads.oppomobile.com",
    "adsfs.oppomobile.com",
    "analytics-api.samsunghealthcn.com",
    "api-adservices.apple.com",
    "books-analytics-events.apple.com",
    "weather-analytics-events.apple.com",
    "notes-analytics-events.apple.com",
    "log.byteoversea.com",
    "analytics-sg.tiktok.com",
    "ads-sg.tiktok.com",
    "business-api.tiktok.com",
    "click.googleanalytics.com",
    "log.pinterest.com",
    "trk.pinterest.com",
    "analytics.yahoo.com",
    "adtech.yahooinc.com",
    "analytics.pointdrive.linkedin.com",
    "app.bugsnag.com",
    "browser.sentry-cdn.com",
    "app.getsentry.com",
    "freshmarketer.com",
    "fwtracks.freshmarketer.com",
    "claritybt.freshmarketer.com",
    "adtago.s3.amazonaws.com",
    "advice-ads.s3.amazonaws.com",
    "analytics.s3.amazonaws.com",
    "analyticsengine.s3.amazonaws.com",
    "adsafeprotected.com",
    "criteo.net",
    "ezodn.com",
    ];
    for (let i = 0; i < adDomains.length; i++) {
    rules.push({
      id: baseId + i,
      priority: 1,
      action: { type: "block" },
      condition: {
        urlFilter: `||${adDomains[i]}^`,
        resourceTypes: ["image", "sub_frame", "other"],
      },
    });
    }
    return rules;
}

async function replaceDynamicRules(addRules, removeAll = false) {
    // Remove existing dynamic rules
    const existingRules = await chrome.declarativeNetRequest.getDynamicRules();
    const removeRuleIds = removeAll
        ? existingRules.map(r => r.id)
        : existingRules.map(r => r.id).filter(id => id >= 100 && id < 100 + DYNAMIC_RULE_LIMIT);
    if (removeRuleIds.length > 0) {
        await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds, addRules: [] });
    }
    // Add rules in batches of 4500 to avoid per-call limits
    let added = 0;
    for (let i = 0; i < addRules.length; i += 4500) {
        const batch = addRules.slice(i, i + 4500);
        await chrome.declarativeNetRequest.updateDynamicRules({ addRules: batch, removeRuleIds: [] });
        added += batch.length;
    }
    const refreshedRules = await chrome.declarativeNetRequest.getDynamicRules();
    return removeAll ? refreshedRules.length : refreshedRules.filter(r => r.id >= 100 && r.id < 100 + DYNAMIC_RULE_LIMIT).length;
}

async function enterDegradedAllowMode(reason) {
    console.warn(`[uBlock Ultimate] Entering degraded allow mode: ${reason}`);
    runtimeHealth.degradedMode = true;
    runtimeHealth.degradedModeReason = reason;
    runtimeHealth.degradedModeTimestamp = Date.now();

    await chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: (await chrome.declarativeNetRequest.getDynamicRules()).map(r => r.id),
        addRules: [],
    });

    await chrome.declarativeNetRequest.updateSessionRules({
        removeRuleIds: (await chrome.declarativeNetRequest.getSessionRules()).map(r => r.id),
        addRules: [],
    });

    tabUnprocessedRequest.clear();
    dnrSyncCompleted = true;
    runtimeHealth.dnrDynamicRulesReady = false;
    runtimeHealth.filterListsReady = false;
    runtimeHealth.degradedMode = true;
    runtimeHealth.lastError = reason;

    return 0;
}

// Resource type mapping for filter options
const FILTER_RESOURCE_MAP = {
  script: "script",
  image: "image",
  stylesheet: "stylesheet",
  object: "object",
  xmlhttprequest: "xmlhttprequest",
  subdocument: "sub_frame",
  document: "main_frame",
  font: "font",
  media: "media",
  websocket: "websocket",
  ping: "ping",
  other: "other",
  xhr: "xmlhttprequest",
};

// Options that make a filter DNR-incompatible
const FILTER_INCOMPATIBLE_OPTIONS = new Set([
  "removeparam", "csp", "replace", "popup", "badfilter",
  "redirect", "redirect-rule", "urlskip", "specifichide",
  "generichide", "inline-font", "inline-script", "webrtc",
  "min", "max", "stealth", "empty", "mp4",
]);

// Domain importance scoring — ensures critical ad/tracker domains survive 30K truncation
const CRITICAL_DOMAIN_PRIORITY = {
  "doubleclick.net": 100,
  "googlesyndication.com": 100,
  "pagead2.googlesyndication.com": 100,
  "googleadservices.com": 100,
  "google-analytics.com": 100,
  "ssl.google-analytics.com": 100,
  "analytics.google.com": 100,
  "adservice.google.com": 100,
  "googletagmanager.com": 100,
  "googlesyndication.com/safeframe": 95,
  "google.com/pagead": 95,
  "google.com/ads": 95,
  "youtube.com/api/stats": 95,
  "ads.youtube.com": 95,
  "youtube.com/pagead": 95,
  "adnxs.com": 90,
  "adsrvr.org": 90,
  "criteo.com": 90,
  "pubmatic.com": 90,
  "rubiconproject.com": 90,
  "openx.net": 90,
  "advertising.com": 90,
  "media.net": 90,
  "static.media.net": 90,
  "casalemedia.com": 90,
  "contextweb.com": 90,
  "criteo.net": 85,
  "adsafeprotected.com": 85,
  "moatads.com": 85,
  "moat.com": 85,
  "scorecardresearch.com": 85,
  "quantserve.com": 85,
  "exelator.com": 85,
  "krxd.net": 85,
  "taboola.com": 85,
  "outbrain.com": 85,
  "amazon-adsystem.com": 85,
  "aax.amazon-adsystem.com": 85,
  "s3.amazonaws.com": 80,
  "adtago.s3.amazonaws.com": 80,
  "advice-ads.s3.amazonaws.com": 80,
  "analyticsengine.s3.amazonaws.com": 80,
  "connect.facebook.net": 85,
  "facebook.com/tr": 85,
  "pixel.facebook.com": 85,
  "analytics.tiktok.com": 80,
  "ads-api.tiktok.com": 80,
  "business-api.tiktok.com": 80,
  "ads-sg.tiktok.com": 80,
  "analytics-sg.tiktok.com": 80,
  "analytics.twitter.com": 80,
  "ads-api.twitter.com": 80,
  "analytics.pinterest.com": 80,
  "trk.pinterest.com": 80,
  "log.pinterest.com": 80,
  "events.reddit.com": 80,
  "ads.linkedin.com": 80,
  "analytics.pointdrive.linkedin.com": 80,
  "stats.wp.com": 80,
  "pixel.wp.com": 80,
  "adzerk.net": 80,
  "ezodn.com": 80,
  "tracking.rus.miui.com": 80,
  "data.mistat.xiaomi.com": 80,
  "data.mistat.india.xiaomi.com": 80,
  "data.mistat.rus.xiaomi.com": 80,
  "api.ad.xiaomi.com": 80,
  "sdkconfig.ad.xiaomi.com": 80,
  "sdkconfig.ad.intl.xiaomi.com": 80,
  "grs.hicloud.com": 75,
  "metrics2.data.hicloud.com": 75,
  "logbak.hicloud.com": 75,
  "metrics.data.hicloud.com": 75,
  "logservice1.hicloud.com": 75,
  "logservice.hicloud.com": 75,
  "ck.ads.oppomobile.com": 75,
  "data.ads.oppomobile.com": 75,
  "adx.ads.oppomobile.com": 75,
  "iot-eu-logser.realme.com": 75,
  "bdapi-ads.realmemobile.com": 75,
  "samsungads.com": 80,
  "samsung-com.112.2o7.net": 75,
  "smetrics.samsung.com": 75,
  "nmetrics.samsung.com": 75,
  "analytics-api.samsunghealthcn.com": 75,
  "iadsdk.apple.com": 75,
  "api-adservices.apple.com": 75,
  "books-analytics-events.apple.com": 75,
  "weather-analytics-events.apple.com": 75,
  "metrics.icloud.com": 75,
  "metrics.mzstatic.com": 75,
  "auction.unityads.unity3d.com": 80,
  "webview.unityads.unity3d.com": 80,
  "adserver.unityads.unity3d.com": 80,
  "config.unityads.unity3d.com": 80,
  "metrika.yandex.ru": 80,
  "mc.yandex.ru": 80,
  "appmetrica.yandex.ru": 80,
  "adfox.yandex.ru": 80,
  "adfstat.yandex.ru": 80,
  "analytics.query.yahoo.com": 80,
  "udcm.yahoo.com": 75,
  "geo.yahoo.com": 75,
  "log.fc.yahoo.com": 75,
  "gemini.yahoo.com": 80,
  "partnerads.ysm.yahoo.com": 80,
  "notify.bugsnag.com": 75,
  "sessions.bugsnag.com": 75,
  "api.bugsnag.com": 75,
  "app.bugsnag.com": 75,
  "browser.sentry-cdn.com": 75,
  "app.getsentry.com": 75,
  "fwtracks.freshmarketer.com": 75,
  "claritybt.freshmarketer.com": 75,
  "freshmarketer.com": 75,
  "click.googleanalytics.com": 100,
  "analytics.yahoo.com": 80,
  "adtech.yahooinc.com": 80,
  "log.byteoversea.com": 80,
  "adsfs.oppomobile.com": 75,
  "bdapi-in-ads.realmemobile.com": 75,
  "iot-logser.realme.com": 75,
  "notes-analytics-events.apple.com": 75,
  "analytics.s3.amazonaws.com": 80,
};

function getDomainFromRule(rule) {
  const urlFilter = rule?.condition?.urlFilter;
  if (!urlFilter) return null;
  const m = urlFilter.match(/^\|\|([a-zA-Z0-9][a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
  return m ? m[1] : null;
}

function getDomainPriority(domain) {
  if (!domain) return 0;
  if (CRITICAL_DOMAIN_PRIORITY[domain]) return CRITICAL_DOMAIN_PRIORITY[domain];
  const dots = domain.split(".");
  if (dots.length >= 2) {
    const tldPlus1 = dots.slice(-2).join(".");
    if (CRITICAL_DOMAIN_PRIORITY[tldPlus1]) return CRITICAL_DOMAIN_PRIORITY[tldPlus1];
  }
  return 1;
}

// ---------------------------------------------------------------------------
// Rule-safety compiler gate
// Classifies DNR rules by risk. High-risk rules (main_frame, script,
// xmlhttprequest, websocket, firstParty) that are not site-scoped should
// not be globally installed — they break unknown complex apps.
// ---------------------------------------------------------------------------

// Resource types that are high-risk when blocked globally
const HIGH_RISK_TYPES = new Set(["main_frame", "script", "xmlhttprequest", "websocket"]);

function classifyDnrRuleRisk(rule) {
    const types = new Set(rule.condition?.resourceTypes || []);

    // If no resourceTypes specified, it matches everything — high risk
    if (types.size === 0) return "high";

    for (const t of types) {
        if (HIGH_RISK_TYPES.has(t)) return "high";
    }

    // firstParty domainType without specific initiator is high risk
    if (rule.condition?.domainType === "firstParty" && !rule.condition?.initiatorDomains?.length) {
        return "high";
    }

    // Rules scoped to specific initiator domains are safer
    if (rule.condition?.initiatorDomains?.length > 0 || rule.condition?.requestDomains?.length > 0) {
        return "safe";
    }

    // Unspecific but non-high-risk types (image, sub_frame, other)
    return "medium";
}

function shouldInstallRule(rule) {
    const risk = classifyDnrRuleRisk(rule);

    // High-risk rules need specific site scoping
    if (risk === "high") {
        const hasScoping = (
            (rule.condition?.initiatorDomains?.length > 0) ||
            (rule.condition?.requestDomains?.length > 0) ||
            (rule.condition?.domains?.length > 0)
        );
        // Allow high-risk if scoped AND it has a specific domain filter
        if (hasScoping && rule.condition?.urlFilter) {
            return true;
        }
        // Also allow if it's an allow rule (exceptions)
        if (rule.action?.type === "allow") return true;
        return false;
    }

    // Medium-risk (image-only blocks, etc.) — allow
    if (risk === "medium") return true;

    // Safe — allow
    return true;
}

// Parse a single uBO filter line into DNR rule parts
function parseFilterLine(line) {
    line = line.trim();
    if (!line || line.startsWith("!") || line.startsWith("#") || line.startsWith("[")) return null;

    // HTML filters, scriptlet filters — skip entirely
    if (line.includes("##^") || line.includes("##+js")) return null;

    const result = {
    action: "block", urlFilter: null, resourceTypes: null,
    priority: 1, domain: null, initiatorDomains: null,
    excludedInitiatorDomains: null, domainType: null,
    cosmetic: null, skip: false,
    };

    // Exception filter
    if (line.startsWith("@@")) {
        result.action = "allow";
        result.priority = 100001;
        line = line.slice(2);
    }

    // Extract options (...$option1=val,option2)
    let optionsPart = "";
    const dollarIdx = line.lastIndexOf("$");
    if (dollarIdx !== -1) {
        const before = line.slice(dollarIdx + 1);
        // Allow alphanumeric, underscore, tilde, comma, hyphen, equals
        if (/^[a-zA-Z0-9_,~=-]+$/.test(before)) {
            optionsPart = before;
            line = line.slice(0, dollarIdx);
        } else {
            // Complex options — skip
            return null;
        }
    }

    // Parse options
    if (optionsPart) {
        const parsed = parseFilterOptions(optionsPart);
        if (parsed === null) return null;
        result.resourceTypes = parsed.types.length > 0 ? parsed.types : null;
        result.initiatorDomains = parsed.initiatorDomains;
        result.excludedInitiatorDomains = parsed.excludedInitiatorDomains;
        result.domainType = parsed.domainType;
        if (parsed.important) result.priority = 100001;
    }

    // Network filter patterns
    if (line.startsWith("||")) {
        const rest = line.slice(2);
        const caretIdx = rest.indexOf("^");
        const part = caretIdx !== -1 ? rest.slice(0, caretIdx) : rest;
        result.urlFilter = `||${part}^`;
        result.domain = part.replace(/\/.*$/, "");
    } else if (line.startsWith("|")) {
        result.urlFilter = line;
    } else if (line.endsWith("|")) {
        result.urlFilter = line;
    } else if (line.includes("^")) {
        result.urlFilter = line;
    } else if (/^https?:\/\//.test(line)) {
        result.urlFilter = `||${line.replace(/^https?:\/\//, "")}^`;
    } else if (/^[a-zA-Z0-9][a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/.test(line)) {
        result.urlFilter = `||${line}^`;
    } else if (line.startsWith("/") && line.endsWith("/")) {
    // Regex filter — skip
        return null;
    } else if (line.startsWith("*")) {
    // Wildcard prefix — try extracting domain
        const m = line.match(/^\*([a-zA-Z0-9][a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
        if (m) {
            result.urlFilter = `||${m[1]}^`;
            result.domain = m[1];
        } else {
            return null;
        }
    } else {
        result.urlFilter = line;
    }

    return result;
}

// Parse filter options ($...) into DNR-compatible fields
function parseFilterOptions(optionsStr) {
    const types = [];
    let initiatorDomains = null;
    let excludedInitiatorDomains = null;
    let domainType = null;
    let important = false;

    // Handle domain= option specially (contains =)
    const domainMatch = optionsStr.match(/(?:^|,)domain=([^,]+)/);
    const optionsWithoutDomain = domainMatch
        ? optionsStr.replace(/(?:^|,)domain=[^,]+/, "")
        : optionsStr;

    if (domainMatch) {
        const val = domainMatch[1];
        const domains = val.split("|").filter(Boolean);
        const incl = [];
        const excl = [];
        for (const d of domains) {
            if (d.startsWith("~")) excl.push(d.slice(1));
            else incl.push(d);
        }
        if (incl.length > 0) initiatorDomains = incl;
        if (excl.length > 0) excludedInitiatorDomains = excl;
    }

    const parts = optionsWithoutDomain.split(",").filter(Boolean);
    for (const p of parts) {
        const name = p.replace(/^~/, "").toLowerCase();
        const negated = p.startsWith("~");

        if (FILTER_INCOMPATIBLE_OPTIONS.has(name)) return null;

        if (name === "important") {
            important = true;
        } else if ((name === "third-party" || name === "3p") && !negated) {
            domainType = "thirdParty";
        } else if ((name === "first-party" || name === "1p") && !negated) {
            domainType = "firstParty";
        } else if (name === "match-case") {
            // DNR urlFilter is case-sensitive by default — no action needed
        } else if (FILTER_RESOURCE_MAP[name] && !negated) {
      types.push(FILTER_RESOURCE_MAP[name]);
        }
    // Negated types (~script, ~image) — skip for now
    }

    return { types, initiatorDomains, excludedInitiatorDomains, domainType, important };
}

// Compile filter text to DNR rules
function compileFilterTextToDNR(filterText, startId = 100) {
    const rules = [];
    const cosmeticFilters = { generic: [], specific: [] };
    const seen = new Set();
    let ruleId = startId;

    const lines = filterText.split("\n");
    for (const rawLine of lines) {
        const parsed = parseFilterLine(rawLine);
        if (!parsed) continue;

        // Cosmetic filters
        if (parsed.cosmetic) {
            if (parsed.cosmetic.type === "generic") {
        cosmeticFilters.generic.push(parsed.cosmetic.selector);
            } else {
        cosmeticFilters.specific.push({ domains: parsed.cosmetic.domains, selector: parsed.cosmetic.selector });
            }
            continue;
        }

        // Network filters
        if (!parsed.urlFilter) continue;

        // Deduplicate
        const key = `${parsed.urlFilter}|${Array.isArray(parsed.resourceTypes) ? parsed.resourceTypes.join(",") : ""}|${parsed.action}|${Array.isArray(parsed.initiatorDomains) ? parsed.initiatorDomains.join(",") : ""}|${Array.isArray(parsed.excludedInitiatorDomains) ? parsed.excludedInitiatorDomains.join(",") : ""}`;
        if (seen.has(key)) continue;
    seen.add(key);

    const rule = {
      id: ruleId++,
      priority: parsed.priority,
      action: { type: parsed.action },
      condition: { urlFilter: parsed.urlFilter },
    };

    if (parsed.resourceTypes && parsed.resourceTypes.length > 0) {
        rule.condition.resourceTypes = parsed.resourceTypes;
    }
    if (parsed.initiatorDomains) {
        rule.condition.initiatorDomains = parsed.initiatorDomains;
    }
    if (parsed.excludedInitiatorDomains) {
        rule.condition.excludedInitiatorDomains = parsed.excludedInitiatorDomains;
    }
    if (parsed.domainType) {
        rule.condition.domainType = parsed.domainType;
    }

    rules.push(rule);
    if (ruleId - startId >= 30000) break;
    }

    return { rules, cosmeticFilters };
}

// Fetch with timeout
async function fetchWithTimeout(url, ms = 10000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ms);
    try {
        const response = await fetch(url, { signal: controller.signal });
        return response;
    } finally {
        clearTimeout(timer);
    }
}

// Load a filter list — try bundled first, then CDN fallback
async function loadFilterList(asset) {
    const bundledPath = resolveBundledFilterListPath(asset);
    let text = "";
    if (bundledPath) {
        try {
            const response = await fetch(chrome.runtime.getURL(bundledPath));
            if (response.ok) {
                text = await response.text();
            }
        } catch (e) {
            console.warn("[uBlock Ultimate] fetchBundledResource: fetch failed", bundledPath, e);
        }
    }
    // If bundled is empty or a stub, try CDN
    if ((!text || text.trim() === "stub" || text.trim() === "") && Array.isArray(asset.cdnURLs) && asset.cdnURLs.length > 0) {
        for (const url of asset.cdnURLs) {
            try {
                const response = await fetchWithTimeout(url, 15000);
                if (response.ok) {
                    text = await response.text();
                    if (text && text.trim() !== "stub") break;
                }
            } catch (e) {
        console.warn(`[uBlock Ultimate] CDN fetch failed for ${url}: ${e?.message || e}`);
            }
        }
    }
    return text && text.trim() !== "stub" ? text : null;
}

// Load all selected filter lists and compile to DNR
async function compileSelectedLists() {
    const result = { rules: [], cosmeticFilters: { generic: [], specific: [] }, loadedLists: [] };
    let nextRuleId = 100;

    const stored = await chrome.storage.local.get(["selectedFilterLists", "userFilters", "user-filters", "userSettings"]);
    let selectedLists = normalizeSelectedFilterLists(stored.selectedFilterLists);

    // Bootstrap defaults if empty — use curated default set
    if (selectedLists.length === 0) {
        selectedLists = [
      FILTER_LIST_USER_PATH,
      "ublock-filters",
      "ublock-privacy",
      "ublock-badware",
      "ublock-quick-fixes",
      "ublock-unbreak",
      "easylist",
      "easyprivacy",
      "plowe-0",
        ];
        await chrome.storage.local.set({ selectedFilterLists: selectedLists });
    }

    const catalog = await fetchFilterListCatalog().catch(e => { console.warn("[uBlock Ultimate] sw: compileSelectedLists fetchFilterListCatalog failed", e); return {}; });

  console.log(`[uBlock Ultimate] compileSelectedLists: ${selectedLists.length} lists selected`);
  for (const listKey of selectedLists) {
    console.log(`[uBlock Ultimate]   Processing list: "${listKey}"`);
    // User filters
    if (listKey === FILTER_LIST_USER_PATH) {
        const userFilters = typeof stored.userFilters === "string"
            ? stored.userFilters
            : typeof stored["user-filters"] === "string"
                ? stored["user-filters"]
                : "";
        if (userFilters) {
            const compiled = compileFilterTextToDNR(userFilters, nextRuleId);
            nextRuleId += compiled.rules.length;
        result.rules.push(...compiled.rules);
        result.cosmeticFilters.generic.push(...compiled.cosmeticFilters.generic);
        result.cosmeticFilters.specific.push(...compiled.cosmeticFilters.specific);
        result.loadedLists.push(listKey);
        console.log(`[uBlock Ultimate]   Loaded user filters: ${compiled.rules.length} rules`);
        } else {
        console.log(`[uBlock Ultimate]   User filters: empty, skipping`);
        }
        continue;
    }

    // Catalog-based lists
    const asset = catalog[listKey];
    if (!asset) {
      console.log(`[uBlock Ultimate]   NOT FOUND in catalog, skipping`);
      continue;
    }
    console.log(`[uBlock Ultimate]   Found in catalog, contentURL=${Array.isArray(asset.contentURL) ? asset.contentURL[0] : asset.contentURL}, cdnURLs=${Array.isArray(asset.cdnURLs) ? asset.cdnURLs.length : 0}`);

    const filterText = await loadFilterList(asset);
    if (!filterText) {
      console.log(`[uBlock Ultimate]   loadFilterList returned null, skipping`);
      continue;
    }
    console.log(`[uBlock Ultimate]   Downloaded ${filterText.length} bytes`);

    const compiled = compileFilterTextToDNR(filterText, nextRuleId);
    nextRuleId += compiled.rules.length;
    result.rules.push(...compiled.rules);
    result.cosmeticFilters.generic.push(...compiled.cosmeticFilters.generic);
    result.cosmeticFilters.specific.push(...compiled.cosmeticFilters.specific);
        result.loadedLists.push(listKey);
        await setFilterListCacheEntry(listKey, { writeTime: Date.now() });
        console.log(`[uBlock Ultimate]   Compiled ${compiled.rules.length} rules from ${listKey}`);
    if (result.rules.length >= 200000) {
      console.log(`[uBlock Ultimate]   Reached max total rules (200K), stopping list compilation`);
      break;
    }
  }

  return result;
}

// Main orchestrator: load filter lists, compile to DNR, install rules, store cosmetics
async function syncFilterListDnrRules() {
    if (syncInProgress) return 0;
    syncInProgress = true;
    const token = OperationToken.acquire("dnr-sync", "default", { policyRevision: runtimeHealth.filterListVersions?.revision });
    try {
        const compiled = await compileSelectedLists();
    if (!token.isCurrent()) { console.log("[uBlock Ultimate] DNR sync superseded, discarding"); return 0; }
        const rules = compiled.rules;
    console.log(`[uBlock Ultimate] Compiled ${rules.length} DNR rules from ${compiled.loadedLists.length} lists`);

    if (rules.length === 0) {
      DnrDecisionStore.record({ action: "skip", ruleIds: [], source: "syncFilterListDnrRules", reason: "no-rules-compiled" });
      console.log("[uBlock Ultimate] No rules from filter lists, entering degraded allow mode");
      tabUnprocessedRequest.clear();
      dnrSyncCompleted = true;
      runtimeHealth.degradedMode = true;
      runtimeHealth.lastError = 'No rules compiled from filter lists';
      token.release();
      syncInProgress = false;
      return await enterDegradedAllowMode('No rules compiled from filter lists');
    }

    // Normalize and deduplicate rules while preserving specificity
    const deduped = [];
    const seenKeys = new Set();
    let criticalCount = 0;
    for (const rule of rules) {
        const r = {
            id: rule.id,
            priority: rule.priority || 1,
            action: { type: rule.action?.type || "block" },
            condition: { ...(rule.condition || {}) },
        };
        delete r.condition.domain;
        delete r.condition.cosmetic;
        delete r.condition.skip;
        delete r.condition.exception;
        if (r.condition.regexFilter && r.condition.regexFilter.length > 2048) continue;
        const key = JSON.stringify({ action: r.action, condition: r.condition });
        if (seenKeys.has(key)) continue;
        seenKeys.add(key);
        const domain = getDomainFromRule(r);
        const priority = getDomainPriority(domain);
        if (!shouldInstallRule(r)) {
            continue;
        }
        if (domain && priority >= 75) criticalCount++;
        deduped.push({ rule: r, domain, priority });
    }

    deduped.sort((a, b) => {
        if (b.priority !== a.priority) return b.priority - a.priority;
        return a.rule.id - b.rule.id;
    });

    const allReady = deduped.map(({ rule }) => rule);
    const dynamicRules = allReady.slice(0, DYNAMIC_RULE_LIMIT);

    const hostnameBlockSet = new Set();
    const otherInitialSession = [];
    for (const rule of allReady.slice(DYNAMIC_RULE_LIMIT)) {
        const domain = getDomainFromRule(rule);
        if (domain !== null) {
            hostnameBlockSet.add(domain);
        } else {
            otherInitialSession.push(rule);
        }
    }

    console.log(`[uBlock Ultimate] Normalized ${rules.length} input rules → ${deduped.length} (${criticalCount} priority domains, ${dynamicRules.length} dynamic, ${otherInitialSession.length} session)`);

    // Pre-installation quota check
    const quotaCheck = QuotaManager.checkDnrQuota("dynamic", dynamicRules.length);
    if (!quotaCheck.ok) {
        console.warn(`[uBlock Ultimate] DNR dynamic quota check failed: ${quotaCheck.reason} (current=${quotaCheck.current}, limit=${quotaCheck.limit})`);
    }
    if (otherInitialSession.length > 0) {
        QuotaManager.checkDnrQuota("session", otherInitialSession.length);
    }

    DnrDecisionStore.record({
        action: "install-attempt",
        ruleIds: dynamicRules.slice(0, 100).map(r => String(r.id)),
        source: "syncFilterListDnrRules",
        reason: `dynamic=${dynamicRules.length}, session=${otherInitialSession.length}`,
    });

    try {
        if (!token.isCurrent()) { console.log("[uBlock Ultimate] DNR sync stale before install, aborting"); syncInProgress = false; return 0; }
        const dynCount = await replaceDynamicRules(dynamicRules);

        if (!token.isCurrent()) { console.log("[uBlock Ultimate] DNR sync stale after dynamic install, will not commit session"); syncInProgress = false; return 0; }

        let sessCount = 0;
        if (otherInitialSession.length > 0) {
            await chrome.declarativeNetRequest.updateSessionRules({
            removeRuleIds: (await chrome.declarativeNetRequest.getSessionRules()).filter(r => r.id < 30000).map(r => r.id),
            addRules: otherInitialSession.slice(0, 5000).map((r, i) => ({ ...r, id: 23000000 + i })),
            });
            sessCount = Math.min(otherInitialSession.length, 5000);
        }
        const count = dynCount + sessCount;

        // Record success in audit store
        DnrDecisionStore.record({
            action: "install-success",
            ruleIds: dynamicRules.slice(0, 100).map(r => String(r.id)),
            source: "syncFilterListDnrRules",
            reason: `installed ${dynCount} dynamic, ${sessCount} session`,
        });
        QuotaManager.recordDnrUsage("dynamic", dynCount);
        QuotaManager.recordDnrUsage("session", sessCount);

        await chrome.storage.local.set({ [STORAGE_KEY_HOSTNAME_BLOCK]: [...hostnameBlockSet], [STORAGE_KEY_HOSTNAME_BLOCK_TS]: Date.now() });
        cachedHostnameBlockSet = hostnameBlockSet;
      console.log(`[uBlock Ultimate] Installed ${dynCount} dynamic rules, ${hostnameBlockSet.size} hostnames cached, ${sessCount} initial session rules`);

      if (dynCount >= DYNAMIC_RULE_LIMIT * 0.95 || sessCount >= 5000) {
          runtimeHealth.adaptiveMode = true;
          console.warn(`[uBlock Ultimate] DNR budget near limit, switching to adaptive mode (${dynCount} dynamic, ${sessCount} session)`);
      } else {
          runtimeHealth.adaptiveMode = false;
      }

      if (compiled.listVersions) {
          runtimeHealth.filterListVersions = compiled.listVersions;
          const outdated = Object.entries(compiled.listVersions)
              .filter(([, v]) => v && v.outdated === true)
              .map(([k]) => k);
          if (outdated.length > 0) {
              runtimeHealth.filterListsOutdated = outdated;
              console.warn(`[uBlock Ultimate] Outdated filter lists detected: ${outdated.join(', ')}`);
          }
      }

      if (compiled.cosmeticFilters) {
          await chrome.storage.local.set({
          cosmeticFiltersData: JSON.stringify({
            genericCosmeticFilters: compiled.cosmeticFilters.generic || [],
            genericCosmeticExceptions: [],
            specificCosmeticFilters: compiled.cosmeticFilters.specific || [],
            scriptletFilters: [],
          }),
          });
      }
      await chrome.storage.local.set({ [STORAGE_KEY_COMPILED_COUNTS]: { netFilterCount: count, cosmeticFilterCount: compiled.cosmeticFilters?.generic?.length || 0 } });
      try {
        const ch = new BroadcastChannel("uBR");
        ch.postMessage({ what: "staticFilteringDataChanged" });
        ch.postMessage({ what: "assetsUpdated" });
        ch.close();
      } catch (e) {
        console.warn("[uBlock Ultimate] BroadcastChannel postCompilation:", e);
      }
      tabUnprocessedRequest.clear();
      dnrSyncCompleted = true;
      runtimeHealth.dnrStaticRulesReady = true;
      runtimeHealth.filterListsReady = true;
      runtimeHealth.degradedMode = false;
      runtimeHealth.lastError = '';

      await postCommitFilteringChange("filter-compilation");

      token.release();
      syncInProgress = false;
      return count;
    } catch (e) {
      DnrDecisionStore.record({
          action: "install-failure",
          ruleIds: dynamicRules.slice(0, 100).map(r => String(r.id)),
          source: "syncFilterListDnrRules",
          reason: e instanceof Error ? e.message : String(e),
      });
      console.warn("[uBlock Ultimate] Rule installation failed, entering degraded allow mode:", e);
      tabUnprocessedRequest.clear();
      dnrSyncCompleted = true;
      runtimeHealth.degradedMode = true;
      runtimeHealth.lastError = 'Rule installation failed, entering degraded allow mode';
      token.release();
      syncInProgress = false;
      return await enterDegradedAllowMode('Rule installation failed: ' + (e instanceof Error ? e.message : String(e)));
    }
    } catch (e) {
    DnrDecisionStore.record({
        action: "sync-failure",
        ruleIds: [],
        source: "syncFilterListDnrRules",
        reason: e instanceof Error ? e.message : String(e),
    });
    console.error("[uBlock Ultimate] Failed to sync filter list rules:", e);
    runtimeHealth.degradedMode = true;
    runtimeHealth.lastError = e instanceof Error ? e.message : String(e);
    token.release();
    syncInProgress = false;
    return 0;
    }
}

async function getFilterListState() {
    // Check if DNR rules are installed — if not, trigger sync
    const installedRules = await chrome.declarativeNetRequest.getDynamicRules().catch(e => { console.warn("[uBlock Ultimate] sw: getFilterListState getDynamicRules failed", e); return []; });
    if (installedRules.length === 0) {
        void syncFilterListDnrRules().catch(err => { console.warn("[uBlock Ultimate] DNR sync on startup check failed:", err); });
    }

    const catalog = await fetchFilterListCatalog().catch(e => { console.warn("[uBlock Ultimate] sw: getFilterListState fetchFilterListCatalog failed", e); return {}; });
    const stored = await chrome.storage.local.get(["selectedFilterLists", "availableFilterLists", "userSettings"]);
    const storedUserSettings = stored.userSettings || {};
    const importedLists = normalizeImportedLists(storedUserSettings.importedLists);
    const availableFromStorage = stored.availableFilterLists;

    let selectedFilterLists = normalizeSelectedFilterLists(stored.selectedFilterLists);
    if (selectedFilterLists.length === 0) {
        if (availableFromStorage && Object.keys(availableFromStorage).length !== 0) {
            selectedFilterLists = Object.entries(availableFromStorage)
        .filter(([, d]) => d?.content === "filters" && d?.off !== true)
        .map(([k]) => k);
            if (selectedFilterLists.includes(FILTER_LIST_USER_PATH) === false) {
        selectedFilterLists.unshift(FILTER_LIST_USER_PATH);
            }
        } else {
            selectedFilterLists = deriveDefaultSelectedFilterLists(catalog, FILTER_LIST_USER_PATH);
            await chrome.storage.local.set({ selectedFilterLists });
        }
    }

    const selectedListSet = new Set(selectedFilterLists);
  selectedListSet.add(FILTER_LIST_USER_PATH);
  const available = buildAvailableFilterLists(catalog, importedLists, selectedListSet);
  for (const d of Object.values(available)) {
      if (d?.parent == null) delete d.parent;
  }

  const counts = await estimateFilterCounts(available);
  await chrome.storage.local.set({ availableFilterLists: available });

  const filterListCache = await getFilterListCache();

  return {
    autoUpdate: storedUserSettings.autoUpdate,
    available,
    cache: filterListCache,
    cosmeticFilterCount: counts.cosmeticFilterCount,
    current: cloneObject(available),
    ignoreGenericCosmeticFilters: storedUserSettings.ignoreGenericCosmeticFilters,
    isUpdating: filterListsUpdating,
    netFilterCount: counts.netFilterCount,
    parseCosmeticFilters: true,
    suspendUntilListsAreLoaded: storedUserSettings.suspendUntilListsAreLoaded,
    userFiltersPath: FILTER_LIST_USER_PATH,
  };
}

async function applyFilterListSelection(payload) {
    const catalog = await fetchFilterListCatalog().catch(e => { console.warn("[uBlock Ultimate] sw: applyFilterListSelection fetchFilterListCatalog failed", e); return {}; });
    const stored = await chrome.storage.local.get(["selectedFilterLists", "userSettings"]);
    const currentUserSettings = { ...(stored.userSettings || {}) };
    const importedSet = new Set(normalizeImportedLists(currentUserSettings.importedLists));
    const selectedSet = new Set(normalizeSelectedFilterLists(stored.selectedFilterLists));
  selectedSet.add(FILTER_LIST_USER_PATH);

  if (Array.isArray(payload.toSelect)) {
    selectedSet.clear();
    selectedSet.add(FILTER_LIST_USER_PATH);
    for (const key of payload.toSelect) {
        if (typeof key === "string" && key.trim() !== "") selectedSet.add(key.trim());
    }
  }

  if (typeof payload.toImport === "string" && payload.toImport.trim() !== "") {
      for (const imported of extractListURLs(payload.toImport)) {
          const resolved = resolveStockAssetKeyFromURL(catalog, imported);
          if (resolved === imported) importedSet.add(imported);
      selectedSet.add(resolved);
      }
  }

  if (Array.isArray(payload.toRemove)) {
      for (const key of payload.toRemove) {
          if (typeof key !== "string" || key.trim() === "") continue;
      importedSet.delete(key.trim());
      selectedSet.delete(key.trim());
      }
  }

  const nextUserSettings = { ...currentUserSettings, importedLists: Array.from(importedSet).sort() };
  await chrome.storage.local.set({
    selectedFilterLists: Array.from(selectedSet),
    userSettings: nextUserSettings,
  });

  await syncFilterListDnrRules();
  PolicySnapshot.invalidateAll({ reason: "filter-list-selection" });
  await postCommitFilteringChange("filter-list-selection");
  return getFilterListState();
}

async function reloadAllFilterLists() {
    filterListsUpdating = true;
    try {
        await syncFilterListDnrRules();
        PolicySnapshot.invalidateAll({ reason: "filter-list-reload" });
        await postCommitFilteringChange("filter-list-reload");
        return await getFilterListState();
    } finally {
        filterListsUpdating = false;
    }
}

async function updateFilterListsNow(payload) {
    filterListsUpdating = true;
    try {
        await syncFilterListDnrRules();
        PolicySnapshot.invalidateAll({ reason: "filter-list-update" });
        await postCommitFilteringChange("filter-list-update");
        return await getFilterListState();
    } finally {
        filterListsUpdating = false;
    }
}

const CODE_VIEWER_ALLOW_RULE_MIN = 8_965_000;
const CODE_VIEWER_ALLOW_RULE_MAX = 8_965_999;
const CODE_VIEWER_ALLOW_PRIORITY = 2_500_000;

const codeViewerAllowRulesByTab = new Map();
let codeViewerAllowRuleCursor = CODE_VIEWER_ALLOW_RULE_MIN;

const codeViewerRuleCleanupReady = (async () => {
    const rules = await chrome.declarativeNetRequest.getSessionRules();
    const removeRuleIds = rules.filter(rule =>
        Number.isInteger(rule?.id) &&
        rule.id >= CODE_VIEWER_ALLOW_RULE_MIN &&
        rule.id <= CODE_VIEWER_ALLOW_RULE_MAX
    ).map(rule => rule.id);
    if (removeRuleIds.length === 0) { return; }
    codeViewerAllowRulesByTab.clear();
    await chrome.declarativeNetRequest.updateSessionRules({
        removeRuleIds,
        addRules: [],
    });
})().catch(e => { console.warn("[uBlock Ultimate] code-viewer allow-rule startup cleanup:", e); });

function escapeDnrRegex(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function allocateCodeViewerAllowRuleId() {
    const used = new Set(codeViewerAllowRulesByTab.values());
    for (let attempts = 0; attempts <= CODE_VIEWER_ALLOW_RULE_MAX - CODE_VIEWER_ALLOW_RULE_MIN; attempts += 1) {
        const candidate = codeViewerAllowRuleCursor;
        codeViewerAllowRuleCursor += 1;
        if (codeViewerAllowRuleCursor > CODE_VIEWER_ALLOW_RULE_MAX) {
            codeViewerAllowRuleCursor = CODE_VIEWER_ALLOW_RULE_MIN;
        }
        if (!used.has(candidate)) {
            return candidate;
        }
    }
    throw new Error("No code-viewer DNR allow-rule IDs available");
}

function isCodeViewerSender(msg) {
    try {
        const senderURL = new URL(msg._senderURL);
        const expectedURL = new URL(chrome.runtime.getURL("code-viewer.html"));
        return senderURL.origin === expectedURL.origin && senderURL.pathname === expectedURL.pathname;
    } catch {
        return false;
    }
}

function isCodeViewerAllowRule(rule) {
    return Number.isInteger(rule?.id) && rule.id >= CODE_VIEWER_ALLOW_RULE_MIN && rule.id <= CODE_VIEWER_ALLOW_RULE_MAX;
}

async function removeCodeViewerRulesForTab(tabId) {
    const knownRuleId = codeViewerAllowRulesByTab.get(tabId);
    const rules = await chrome.declarativeNetRequest.getSessionRules();
    const removeRuleIds = rules.filter(rule =>
        isCodeViewerAllowRule(rule) && (rule.id === knownRuleId || rule.condition?.tabIds?.includes(tabId))
    ).map(rule => rule.id);
    codeViewerAllowRulesByTab.delete(tabId);
    if (removeRuleIds.length === 0) { return; }
    await chrome.declarativeNetRequest.updateSessionRules({
        removeRuleIds,
        addRules: [],
    });
}

async function acquireCodeViewerFetchRule(msg) {
    await codeViewerRuleCleanupReady;
    if (!isCodeViewerSender(msg)) {
        throw new Error("Code-viewer rule request from invalid sender");
    }
    const tabId = Number(msg._tabId);
    const url = String(msg.url || "");
    if (!Number.isInteger(tabId) || tabId < 0 || !/^https?:\/\//i.test(url)) {
        throw new Error("Invalid code-viewer fetch request");
    }
    const normalizedURL = new URL(url);
    normalizedURL.hash = "";
    const previous = codeViewerAllowRulesByTab.get(tabId);
    if (previous !== undefined) {
        await chrome.declarativeNetRequest.updateSessionRules({
            removeRuleIds: [previous],
            addRules: [],
        });
    }
    const ruleId = allocateCodeViewerAllowRuleId();
    await chrome.declarativeNetRequest.updateSessionRules({
        removeRuleIds: [],
        addRules: [{
            id: ruleId,
            priority: CODE_VIEWER_ALLOW_PRIORITY,
            action: { type: "allow" },
            condition: {
                regexFilter: `^${escapeDnrRegex(normalizedURL.href)}$`,
                isUrlFilterCaseSensitive: true,
                tabIds: [tabId],
                resourceTypes: ["xmlhttprequest"],
            },
        }],
    });
    codeViewerAllowRulesByTab.set(tabId, ruleId);
    return { ok: true, ruleId };
}

async function releaseCodeViewerFetchRule(msg) {
    if (!isCodeViewerSender(msg)) {
        throw new Error("Code-viewer rule request from invalid sender");
    }
    const tabId = Number(msg._tabId);
    const ruleId = Number(msg.ruleId);
    if (!Number.isInteger(tabId) || !Number.isInteger(ruleId) || ruleId < CODE_VIEWER_ALLOW_RULE_MIN || ruleId > CODE_VIEWER_ALLOW_RULE_MAX) {
        throw new Error("Invalid code-viewer rule release");
    }
    const ownedRuleId = codeViewerAllowRulesByTab.get(tabId);
    if (ownedRuleId !== undefined && ownedRuleId !== ruleId) {
        throw new Error("Code-viewer rule ownership mismatch");
    }
    codeViewerAllowRulesByTab.delete(tabId);
    await chrome.declarativeNetRequest.updateSessionRules({
        removeRuleIds: [ruleId],
        addRules: [],
    });
    return { ok: true };
}

function handleCodeViewer(msg) {
    if (msg.what === "gotoURL") {
        const url = msg?.details?.url;
        if (url) {
            const fullUrl = url.startsWith("http") || url.startsWith("chrome-extension://")
                ? url
                : chrome.runtime.getURL(url);
      chrome.tabs.create({ url: fullUrl, active: true }).catch(e => { console.warn("[uBlock Ultimate] tabs.create codeViewer:", e); });
        }
        return { ok: true };
    }
    if (msg.what === "acquireFetchRule") {
        return acquireCodeViewerFetchRule(msg);
    }
    if (msg.what === "releaseFetchRule") {
        return releaseCodeViewerFetchRule(msg);
    }
    return { error: `Unhandled codeViewer: ${  msg.what}` };
}

function handleDOMInspectorContent(msg, senderTabId, senderFrameId) {
    if (msg.what === "getInspectorArgs") {
    // Broadcast tab/frame identity on contentInspectorChannel AFTER the
    // scriptlet is already running and listening (this handler is called
    // from the content script, not from the logger page).
        if (senderTabId) {
            try {
                broadcastMessage("contentInspectorChannel", { what: "contentInspectorChannel", tabId: senderTabId, frameId: senderFrameId || 0 });
            } catch (e) {
                console.warn("[uBlock Ultimate] BroadcastChannel contentInspectorChannel:", e);
            }
        }
        const secret = Math.random().toString(36).slice(2, 10);
        return {
      inspectorURL: chrome.runtime.getURL(
          `/web_accessible_resources/dom-inspector.html?secret=${secret}`
      ),
        };
    }
    return { error: `Unhandled domInspectorContent: ${  msg.what}` };
}

// ---------------------------------------------------------------------------
// Port-based messaging
// ---------------------------------------------------------------------------
chrome.runtime.onConnect.addListener(port => {
  const senderTabId = port.sender?.tab?.id;

  port.onDisconnect.addListener(() => {
      void chrome.runtime.lastError;
  });

  if (port.sender?.url && port.sender.url.includes("/popup-fenix.html")) {
      popupPortTabId = port.sender?.tab?.id || 0;
      port.onDisconnect.addListener(() => {
          popupPortTabId = 0;
      });
  }

  port.onMessage.addListener(async message => {
      const channel = message?.channel;
      const msgId = message?.msgId;
      const msg = message?.msg;
      try {
          const response = await dispatchMessage(channel, { ...msg, _tabId: senderTabId, _frameId: port.sender?.frameId, _documentId: port.sender?.documentId, _senderURL: port.sender?.url || "" }, senderTabId, port.sender?.frameId);
          if (msgId !== undefined) {
              try { port.postMessage({ msgId, msg: response }); } catch (e) { console.warn('[uBlock Ultimate] port.postMessage response failed:', e); }
              void chrome.runtime.lastError;
          }
      } catch (err) {
          const errMsg = String(err?.message || err);
          console.warn('[uBR SW] Port message error:', errMsg, 'channel:', channel);
          if (msgId !== undefined) {
              try { port.postMessage({ msgId, msg: { error: errMsg } }); } catch (e) { console.warn('[uBlock Ultimate] port.postMessage error response failed:', e); }
              void chrome.runtime.lastError;
          }
      }
  });
});

// ---------------------------------------------------------------------------
// One-shot messaging
// ---------------------------------------------------------------------------
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const channel = message?.channel || message?.topic;
  const msg = message?.msg || message?.payload;
  const senderTabId = sender?.tab?.id;
  void dispatchMessage(channel, { ...msg, _tabId: senderTabId, _frameId: sender.frameId, _documentId: sender.documentId, _senderURL: sender.url || "" }, senderTabId, sender.frameId)
    .then(sendResponse)
    .catch(err => {
        const errMsg = String(err?.message || err);
      console.warn('[uBR SW] One-shot message error:', errMsg, 'channel:', channel);
      sendResponse({ error: errMsg });
    });
  return true;
});

// ---------------------------------------------------------------------------
// Custom new tab interception
// ---------------------------------------------------------------------------
chrome.tabs.onCreated.addListener(tab => {
    if (tab.id) void interceptNewTab(tab.id, tab.url || tab.pendingUrl || "");
});

// ---------------------------------------------------------------------------
// Inject cosmetic CSS into pages when tabs update
// ---------------------------------------------------------------------------
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url !== undefined || changeInfo.status === "loading") {
      void syncActionAvailability(tabId, changeInfo.url || tab.url);
      if (changeInfo.url === "chrome://newtab/") {
          void interceptNewTab(tabId, changeInfo.url);
      }
      if (changeInfo.url && /^https?:\/\//.test(changeInfo.url)) {
          enqueueStateMutation(async () => {
              await syncFirewallDnrRules();
          }).catch(err => {
              console.warn("[uBlock Ultimate] tabs.onUpdated firewall DNR refresh failed:", err);
          });
          scheduleCspReportPolicySync();
          scheduleHostnameSwitchDnrSync();
      }
  }
  if (changeInfo.status === "loading") {
      resetBlockedCountBadge(tabId);
      if (tab.url && !isExtensionURL(tab.url) && tab.url.startsWith("http")) {
          void chrome.scripting.removeCSS({
          target: { tabId },
          css: LEGACY_BUILTIN_COSMETIC_CSS,
          }).catch(e => { console.warn("[uBlock Ultimate] scripting.removeCSS failed for tab", tabId, e); });
      }
      // Bump revision so polling detects tab navigation changes
      markTabChanged(tabId);
      scheduleCspReportPolicySync();
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.url && isYouTubeHost(changeInfo.url)) {
        ytEngine.onTabNavigate(tabId, changeInfo.url);
    }
});

try {
    chrome.webNavigation.onCommitted.addListener(details => {
        loggerRuntime.recordNavigation(details);
        if (details.frameId !== 0 || details.tabId < 0) return;
        // Preserve page-scoped state on same-URL reload, clean up on navigation
        const entry = sessionPageNetFiltering.get(details.tabId);
        if (entry) {
            let sameURL = false;
            if (typeof entry.pageURL === "string" && entry.pageURL !== "") {
                try {
                    sameURL = new URL(details.url).href === new URL(entry.pageURL).href;
                } catch (_) {}
            }
            if (!sameURL) {
                const cleanupTabId = details.tabId;
                const expectedEntry = sessionPageNetFiltering.get(cleanupTabId);
                void enqueueStateMutation(async () => {
                    const current = sessionPageNetFiltering.get(cleanupTabId);
                    // Only delete if the entry hasn't been replaced by another transaction
                    if (current !== expectedEntry) return;
                    const snapshot = snapshotFilteringState();
                    try {
                        sessionPageNetFiltering.delete(cleanupTabId);
                        await persistSessionPageNetFiltering();
                        await syncNetFilteringDnrRules();
                    } catch (error) {
                        await restoreFilteringState(snapshot);
                        console.warn("[uBlock Ultimate] page net-filtering navigation cleanup rollback:", error);
                    }
                }).catch(error => {
                    console.warn("[uBlock Ultimate] page net-filtering navigation cleanup failed:", error);
                });
            }
        }
        void ensurePopupLedgerHydrated().then(() => {
            popupRequestLedgers.commitNavigation(details);
            markTabChanged(details.tabId);
            schedulePopupLedgerPersist();
            enqueueStateMutation(async () => {
                await syncFirewallDnrRules();
            }).catch(err => {
                console.warn("[uBlock Ultimate] navigation firewall DNR refresh failed:", err);
            });
            scheduleCspReportPolicySync();
        });
    });
    chrome.webNavigation.onBeforeNavigate.addListener(details => {
        if (details.frameId !== 0 || details.tabId < 0) return;
        void replaceHostnameSwitchRulesForTab(details.tabId, details.url).catch(err => {
            console.warn("[uBlock Ultimate] hostname switch pre-navigation sync failed:", err);
        });
    });
    chrome.webNavigation.onHistoryStateUpdated.addListener(details => {
        loggerRuntime.recordNavigation(details);
        if (details.frameId !== 0 || details.tabId < 0) return;
        const entry = sessionPageNetFiltering.get(details.tabId);
        if (entry) {
            let sameURL = false;
            if (typeof entry.pageURL === "string" && entry.pageURL !== "") {
                try {
                    sameURL = new URL(details.url).href === new URL(entry.pageURL).href;
                } catch (_) {}
            }
            if (!sameURL) {
                const cleanupTabId = details.tabId;
                const expectedEntry = sessionPageNetFiltering.get(cleanupTabId);
                void enqueueStateMutation(async () => {
                    const current = sessionPageNetFiltering.get(cleanupTabId);
                    if (current !== expectedEntry) return;
                    const snapshot = snapshotFilteringState();
                    try {
                        sessionPageNetFiltering.delete(cleanupTabId);
                        await persistSessionPageNetFiltering();
                        await syncNetFilteringDnrRules();
                    } catch (error) {
                        await restoreFilteringState(snapshot);
                        console.warn("[uBlock Ultimate] page net-filtering history cleanup rollback:", error);
                    }
                }).catch(error => {
                    console.warn("[uBlock Ultimate] page net-filtering history cleanup failed:", error);
                });
            }
        }
    });
    chrome.webNavigation.onCreatedNavigationTarget.addListener(details => {
        void (async () => {
            await ensurePermanentStateLoaded();
            const sourceTab = await chrome.tabs.get(details.sourceTabId);
            const sourceURL = sourceTab?.url || "";
            const sourceHostname = hostnameFromURL(sourceURL);
            if (!sourceHostname || isURLTrusted(sourceURL)) return;
            if (getEffectiveNetFiltering(sourceHostname, sourceURL, details.sourceTabId) === false) return;
            if (getEffectiveHostnameSwitch(sourceHostname, "noPopups") !== true) return;
            await chrome.tabs.remove(details.tabId);
            popupBlockedCountByTab.set(details.sourceTabId, (popupBlockedCountByTab.get(details.sourceTabId) || 0) + 1);
            markTabChanged(details.sourceTabId);
        })().catch(error => {
            if (!isStaleTabError(error)) console.warn("[uBlock Ultimate] popup blocking failed:", error);
        });
    });
    chrome.webNavigation.onReferenceFragmentUpdated.addListener(details => {
        loggerRuntime.recordNavigation(details);
    });
    chrome.webNavigation.onCompleted.addListener(details => {
        if (loggerRuntime.enabled === false || details.frameId !== 0 || !/^https?:/.test(details.url)) {
            return;
        }
        void injectCosmeticLoggerIntoTab(details.tabId);
    });
} catch (err) {
    console.warn("[uBlock Ultimate] webNavigation listener registration failed:", err);
}



// ---------------------------------------------------------------------------
// Keyboard shortcut: toggle custom new tab
// ---------------------------------------------------------------------------
chrome.commands.onCommand.addListener(async (command) => {
    if (command !== "toggle-newtab") return;
    _showCustomNewTab = !_showCustomNewTab;
    await chrome.storage.local.set({ showCustomNewTab: _showCustomNewTab }).catch(() => {});
    await syncNewTabToUserSettings(_showCustomNewTab);
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id) return;
    const ourUrl = chrome.runtime.getURL("pages/newtab.html");
    if (_showCustomNewTab && tab.url === "chrome://newtab/") {
        chrome.tabs.update(tab.id, { url: ourUrl }).catch(() => {});
    } else if (!_showCustomNewTab && tab.url === ourUrl) {
        chrome.tabs.update(tab.id, { url: "chrome://newtab/" }).catch(() => {});
    }
});

chrome.tabs.onActivated.addListener(({ tabId }) => {
    ytEngine.onTabActivate(tabId);
    void chrome.tabs.get(tabId)
        .then(tab => syncActionAvailability(tabId, tab.url))
        .catch(e => { console.warn("[uBlock Ultimate] tabs.get onActivated:", e); });
});

// Clean up stale tab state periodically
chrome.tabs.onRemoved.addListener(tabId => {
  blockedDnrCountByTab.delete(tabId);
  blockedCosmeticCountByTab.delete(tabId);
  popupBlockedCountByTab.delete(tabId);
  pendingBadgeUpdates.delete(tabId);
  matchedRuleLogByTab.delete(tabId);
  loggerRuntime.removeTab(tabId);
  ytEngine.onTabRemove(tabId);
  popupRequestLedgers.removeTab(tabId);
  schedulePopupLedgerPersist();
  scheduleCspReportPolicySync();
  scheduleHostnameSwitchDnrSync();
  reqStats.byTab.delete(tabId);
  tabContentRevision.delete(tabId);
  tabUnprocessedRequest.delete(tabId);
  const tabHns = tabHostnames.get(tabId);
  if (tabHns) {
      for (const hn of tabHns) hostnameStats.delete(hn);
      tabHostnames.delete(tabId);
  }
  void removeCodeViewerRulesForTab(tabId).catch(error => {
      console.warn("[uBlock Ultimate] Code-viewer tab cleanup:", error);
  });
  if (sessionPageNetFiltering.delete(tabId)) {
      void persistSessionPageNetFiltering()
          .then(() => syncNetFilteringDnrRules())
          .catch(error => {
              console.warn("[uBlock Ultimate] page net-filtering tab cleanup failed:", error);
          });
  }
});

chrome.runtime.onInstalled.addListener(() => {
  console.log("[uBlock Ultimate] SW installed/updated — syncing filter lists (first-time download)");
  installContextMenu();
  void loadPolicyProfiles().then(() => {
	    return clearDnrStateForSchemaUpgrade().then(() => syncStealthSurrogateRules()).then(removeLegacyBuiltInCosmetics).then(cleanupStaleYouTubeMastheadFilters).then(() => syncFilterListDnrRules()).then(count => {
	      console.log(`[uBlock Ultimate] Initial DNR sync complete: ${count} rules installed`);
	      return syncFirewallDnrRules()
	          .then(syncNetFilteringDnrRules)
	          .then(syncHostnameSwitchDnrRules)
	          .then(syncURLFilteringDnrRules)
	          .then(syncCspReportPolicyRules);
	    });
	  }).catch(e => {
	    console.warn("[uBlock Ultimate] onInstalled sync failed:", e);
	    void ensureFilterRules().catch(err => { console.warn("[uBlock Ultimate] Retry ensureFilterRules after onInstalled failed:", err); });
	  });
});
registerHybridUpdates();
// Startup: load cached hostname index, restore session state, verify dynamic rules
void (async () => {
    try {
        await migrateStorageToV2(chrome.storage.local);
        await loadPolicyProfiles();
        installContextMenu();
	        await clearDnrStateForSchemaUpgrade();
	        await ensurePermanentStateLoaded();
	        await ensurePopupLedgerHydrated();
	        await loadCachedHostnameIndex();
	        await restoreSessionState();
	        await restoreSessionPageNetFiltering();
	        await syncFirewallDnrRules();
	        await syncNetFilteringDnrRules();
	        await syncHostnameSwitchDnrRules();
        await syncURLFilteringDnrRules();
        await syncCspReportPolicyRules();
        void chrome.declarativeNetRequest.getAvailableStaticRuleCount().then(count => {
            console.log(`[uBlock Ultimate] Available static DNR rule budget: ${count} / 30000`);
        });
        await syncActionAvailabilityForOpenTabs();
        await loadCustomNewTabState();
        await syncStealthSurrogateRules();
        await removeLegacyBuiltInCosmetics();
        await cleanupStaleYouTubeMastheadFilters();
        const tabs = await chrome.tabs.query({});
        for (const tab of tabs) {
            if (tab.id && tab.url && isYouTubeHost(tab.url)) {
                ytEngine.onTabNavigate(tab.id, tab.url);
            }
        }
        ytEngine.init({ manifestVersion: "1.0", criticalEndpointRegistryVersion: "1.0", rulePrioritySchemaVersion: "1.0", youtubeRuleIdRangeVersion: "1.0", surrogateSchemaVersion: "1.0", sanitizerSchemaVersion: "1.0", bootstrapVersion: "1.0", wrapperRiskSchemaVersion: "1.0", cosmeticSelectorRegistryVersion: "1.0" });
        await smartEngine.init();
        void readManagedPolicy();
        startIdleDetection();
        const count = await ensureFilterRules();
        if (count === 0) {
            console.log("[uBlock Ultimate] ensureFilterRules returned 0, fallback may be needed");
        } else {
            console.log(`[uBlock Ultimate] Startup complete: ${count} DNR rules active + ${cachedHostnameBlockSet?.size || 0} hostnames cached for on-demand`);
        }
    } catch (e) {
    console.warn("[uBlock Ultimate] Error during startup filter initialization:", e);
    void ensureFilterRules().catch(err => { console.warn("[uBlock Ultimate] Retry ensureFilterRules failed:", err); });
    }
})();
console.log("[uBlock Ultimate] SW started");
