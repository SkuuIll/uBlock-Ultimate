/**
 * platform/chromium/js/policy-resolver.js
 *
 * Central policy authority for all filtering layers.
 * Every subsystem (content script, DNR, video, cosmetic, scriptlets)
 * asks this module what it's allowed to do for a given page.
 *
 * Design principle:
 *   Unknown apps get safe defaults. Full filtering requires evidence.
 *   No site-by-site exception lists — policy is derived from risk model.
 *   Profile definitions come from config/page-policy.json.
 *
 * Usage:
 *   import { loadPolicyProfiles, resolvePagePolicy } from "./policy-resolver.js";
 *   await loadPolicyProfiles();  // once at SW startup
 *   const policy = resolvePagePolicy({ url, hostname, trusted, ... });
 */

import { classifyFirstKnownProfile, PAGE_PROFILE } from "./page-signal-classifier.js";
import { domainFromHostname as pslDomainFromHostname } from "./psl-runtime.js";

// ---------------------------------------------------------------------------
// Profile alias migration — old names map to current names
// ---------------------------------------------------------------------------
const PROFILE_ALIASES = Object.freeze({
    "full-block": "trusted-off",
});

// ---------------------------------------------------------------------------
// Policy profile cache — loaded from config/page-policy.json at startup.
// ---------------------------------------------------------------------------
let loadedProfiles = null;
const DEFAULT_PROFILE_ID = "app-shell";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const POLICY_NETWORK_FULL = "full";
const POLICY_NETWORK_SAFE = "safe";
const POLICY_NETWORK_OFF = "off";

const POLICY_FIRSTPARTY_EXPLICIT_ONLY = "explicit-only";
const POLICY_FIRSTPARTY_OFF = "off";

const POLICY_COSMETIC_FULL = "full";
const POLICY_COSMETIC_SPECIFIC_ONLY = "specific-only";
const POLICY_COSMETIC_OFF = "off";

const POLICY_SCRIPLETS_TRUSTED_SPECIFIC_ONLY = "trusted-specific-only";
const POLICY_SCRIPLETS_OFF = "off";

const POLICY_GENERIC_VIDEO_OBSERVE_ONLY = "observe-only";
const POLICY_GENERIC_VIDEO_KNOWN_ADAPTER_ONLY = "known-adapter-only";
const POLICY_GENERIC_VIDEO_FULL = "full";
const POLICY_GENERIC_VIDEO_OFF = "off";

const POLICY_MAINWORLD_TRUSTED_SPECIFIC_ONLY = "trusted-specific-only";
const POLICY_MAINWORLD_OFF = "off";

const POLICY_OBSERVE_ONLY = "observe-only";
const POLICY_DRY_RUN = "dry-run";
const POLICY_ANTI_ADBLOCK_AUTO = "auto";
const POLICY_ENERGY_AWARE = "energy-aware";

// Inline fallback profile used before page-policy.json loads.
const FALLBACK_PROFILE = Object.freeze({
    network: POLICY_NETWORK_SAFE,
    firstPartyNetwork: POLICY_FIRSTPARTY_EXPLICIT_ONLY,
    cosmetic: POLICY_COSMETIC_SPECIFIC_ONLY,
    genericCosmetic: false,
    proceduralCosmetic: false,
    smartCosmetic: false,
    scriptlets: POLICY_SCRIPLETS_TRUSTED_SPECIFIC_ONLY,
    genericVideo: POLICY_GENERIC_VIDEO_KNOWN_ADAPTER_ONLY,
    mainWorldHooks: POLICY_MAINWORLD_TRUSTED_SPECIFIC_ONLY,
    observeOnly: false,
    dryRun: false,
    antiAdblockCountermeasures: false,
    energyAwareScanBudget: false,
    scriptletBudget: 50,
    privtree: false,
    privacyAnnotations: false,
    strictAppMode: false,
    layoutShiftBudget: 0.1,
    // Safe contentScript defaults — matches app-shell profile config.
    // Prevents deepMerge from keeping computed-default loadVideoRuntime:true
    // when page-policy.json hasn't loaded yet.
    contentScript: {
        enabled: true,
        loadCosmeticRuntime: true,
        loadSmartRuntime: false,
        loadVideoRuntime: false,
        loadInterceptors: false,
        firstPartyDomDetection: false,
        fetchWrapping: false,
        xhrMutation: false,
        domMarking: false,
    },
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function deepMerge(target, source) {
    const out = { ...target };
    for (const key of Object.keys(source || {})) {
        const sv = source[key];
        if (sv !== null && typeof sv === "object" && !Array.isArray(sv)) {
            out[key] = deepMerge(out[key] || {}, sv);
        } else if (sv !== undefined) {
            out[key] = sv;
        }
    }
    return out;
}

// Shared domain/URL normalization helpers (Item 281-283, 286)
export function extractHostname(url) {
    try { return new URL(url).hostname; } catch (e) { return ''; }
}

export function extractDomain(url) {
    const hostname = extractHostname(url);
    return domainFromHostname(hostname);
}

export function domainFromHostname(hostname) {
    return pslDomainFromHostname(hostname);
}

export function hostnameMatches(hostname, domain) {
    return hostname === domain || hostname.endsWith('.' + domain);
}

export function groupByDomain(entries) {
    const groups = {};
    for (const entry of entries) {
        const hostname = extractHostname(entry.url || entry);
        if (!hostname) continue;
        const domain = domainFromHostname(hostname);
        if (!groups[domain]) groups[domain] = [];
        groups[domain].push(entry);
    }
    return groups;
}

function getProfile(profileId) {
    const resolvedId = PROFILE_ALIASES[profileId] || profileId;
    if (loadedProfiles && loadedProfiles[resolvedId]) {
        return loadedProfiles[resolvedId];
    }
    return null;
}

function resolveProfile(hostname, hasKnownFilterSupport, trusted, pageSignals) {
    if (trusted) return PAGE_PROFILE.TRUSTED_OFF;

    const classified = classifyFirstKnownProfile(pageSignals, hasKnownFilterSupport, hasEstablishedFilterSupport(hostname));
    if (classified) return classified;

    return DEFAULT_PROFILE_ID;
}

function hasEstablishedFilterSupport(hostname) {
    if (!loadedProfiles) return false;
    const domain = domainFromHostname(hostname);
    // Check if any loaded profile covers this domain via hostname matching
    for (const profileId of Object.keys(loadedProfiles)) {
        const profile = loadedProfiles[profileId];
        if (profile && Array.isArray(profile.matchDomains)) {
            for (const matchDomain of profile.matchDomains) {
                if (hostname === matchDomain || hostname.endsWith('.' + matchDomain)) {
                    return true;
                }
            }
        }
    }
    return false;
}

function getNestedNetwork(mode, firstPartyMode) {
    const allowFullBlock = mode === POLICY_NETWORK_FULL;
    const allowSafeBlock = mode === POLICY_NETWORK_SAFE;
    return {
        mode,
        firstParty: firstPartyMode,
        highRiskResources: mode === POLICY_NETWORK_FULL ? "specific-only" : "off",
        firstPartyResponseMutation: false,
        allowBlock: allowFullBlock || allowSafeBlock,
        allowAllow: allowFullBlock || allowSafeBlock,
        allowRedirect: false,
        allowUpgrade: false,
        allowSurrogate: false,
        modifyHeaders: false,
        allowHeaderMutation: false,
        redirectPolicy: "block-only",
        surrogatePolicy: "extension-only",
        upgradePolicy: "https-only",
        diagnostics: {
            enabled: false,
            collectMatchedRules: false,
            collectNetworkReport: false,
        },
        budget: {
            maxResourceChecks: 500,
            maxHeaderModifications: 50,
        },
        cookieBlocking: false,
        cookieBlockingMode: "off",
        cspMutation: false,
        cspMutationMode: "off",
    };
}

// Selector risk classification (Items 131-132)
export function classifySelectorRisk(selector) {
    if (!selector || typeof selector !== 'string') return { risk: 'unknown', safe: false };
    const s = selector.trim();
    if (s === '*' || s === 'html' || s === 'body') return { risk: 'critical', safe: false };
    if (s.startsWith(':has(') || s.startsWith(':matches-css') || s.includes(':has-text')) return { risk: 'procedural', safe: false };
    const parts = s.split(/\s+/);
    if (parts.length > 5) return { risk: 'complex', safe: false };
    if (s.includes('[class*="') || s.includes('[id*="') || s.includes('[src*="')) return { risk: 'substring', safe: false };
    if (s.includes('[') || s.includes('#')) return { risk: 'specific', safe: true };
    if (s.startsWith('.')) return { risk: 'class', safe: true };
    return { risk: 'unknown', safe: false };
}

function getNestedCosmetic(specific, generic, procedural, smart) {
    return {
        specific, generic, procedural, smart, provenances: [],
        budget: {
            maxProceduralCalls: 100,
            maxElementsPerSelector: 50,
            maxGenericRules: 1000,
        },
        diagnostics: {
            enabled: false,
            collectMatchedRules: false,
        },
    };
}

function getNestedVideo(mode) {
    return {
        mode,
        allowObservation: mode === POLICY_GENERIC_VIDEO_OBSERVE_ONLY || mode === POLICY_GENERIC_VIDEO_KNOWN_ADAPTER_ONLY || mode === POLICY_GENERIC_VIDEO_FULL,
        allowMutation: mode === POLICY_GENERIC_VIDEO_KNOWN_ADAPTER_ONLY || mode === POLICY_GENERIC_VIDEO_FULL,
        allowSkipClick: mode === POLICY_GENERIC_VIDEO_KNOWN_ADAPTER_ONLY || mode === POLICY_GENERIC_VIDEO_FULL,
        observerBudget: mode === POLICY_GENERIC_VIDEO_FULL ? { maxNodes: 500, maxMs: 100 } :
                        mode === POLICY_GENERIC_VIDEO_KNOWN_ADAPTER_ONLY ? { maxNodes: 200, maxMs: 50 } :
                        { maxNodes: 50, maxMs: 20 },
        backoffOnReject: mode === POLICY_GENERIC_VIDEO_FULL ? 1000 : 5000,
        needsUserGesture: mode !== POLICY_GENERIC_VIDEO_FULL,
        provenances: [],
        diagnostics: {
            enabled: false,
            collectSkipReports: false,
            collectMutationFailures: false,
            collectObservationStats: false,
        },
        budget: {
            maxObservationMutations: mode === POLICY_GENERIC_VIDEO_FULL ? 100 : 20,
            maxSkipClicksPerMinute: mode === POLICY_GENERIC_VIDEO_FULL ? 30 : 10,
        },
    };
}

function getNestedScriptlets(mode, hooks) {
    return {
        mode,
        mainWorldHooks: hooks === POLICY_MAINWORLD_TRUSTED_SPECIFIC_ONLY,
        budget: {
            maxScriptletCalls: 50,
            maxMainWorldHooks: 10,
            maxScriptletDurationMs: 500,
        },
        diagnostics: {
            enabled: false,
            collectScriptletLogs: false,
        },
    };
}

function getNestedContentScript(enabled, loadCosmetic, loadSmart, loadVideo, loadInterceptors, fetchWrapping, xhrMutation, domMarking, firstPartyDomDetection, loadCosmeticGeneric, loadCosmeticProcedural) {
    return {
        enabled,
        loadCosmeticRuntime: loadCosmetic,
        loadCosmeticGeneric: loadCosmeticGeneric !== undefined ? loadCosmeticGeneric : loadCosmetic,
        loadCosmeticProcedural: loadCosmeticProcedural !== undefined ? loadCosmeticProcedural : loadCosmetic,
        loadSmartRuntime: loadSmart,
        loadVideoRuntime: loadVideo,
        loadInterceptors,
        firstPartyDomDetection: firstPartyDomDetection !== undefined ? firstPartyDomDetection : loadInterceptors,
        fetchWrapping: fetchWrapping !== undefined ? fetchWrapping : loadInterceptors,
        xhrMutation: xhrMutation !== undefined ? xhrMutation : loadInterceptors,
        domMarking: domMarking !== undefined ? domMarking : loadInterceptors,
        cssLayer: "ubr-cosmetic",
        styleScope: "isolated",
        idleWatcher: {
            enabled: false,
            idleThresholdMs: 5000,
            maxInactiveMs: 120000,
        },
        diagnostics: {
            enabled: false,
            collectScriptletInjectionReports: false,
            collectStyleInjectionReports: false,
        },
        budget: {
            maxRuntimeMs: 50,
            maxStyleInjectionCount: 200,
            maxDomMutationCount: 100,
        },
    };
}

function getNestedInstrumentation(loggerAttribution, collectMatchedRules) {
    return {
        webRequestTracking: loggerAttribution,
        loggerAttribution,
        collectMatchedRules,
    };
}

// Browser capability cache (loaded from config/browser-capabilities.json)
let browserCapabilities = null;

function dnrFeedbackAvailable() {
    if (!browserCapabilities) return false;
    return browserCapabilities.dnrFeedback === true || browserCapabilities.dnrFeedback === "dev-only";
}

function userScriptsAvailable() {
    if (!browserCapabilities) return false;
    return browserCapabilities.userScripts === true;
}

// ---------------------------------------------------------------------------
// Load profiles from config/page-policy.json
// ---------------------------------------------------------------------------
export async function loadPolicyProfiles() {
    try {
        const url = chrome.runtime.getURL("config/page-policy.json");
        const response = await fetch(url);
        if (!response.ok) {
            console.warn("[uBlock Ultimate] policy-resolver: failed to load page-policy.json:", response.status);
            return;
        }
        const data = await response.json();
        if (data && data.profiles && typeof data.profiles === "object") {
            loadedProfiles = data.profiles;
            console.log("[uBlock Ultimate] policy-resolver: loaded", Object.keys(loadedProfiles).length, "profiles from page-policy.json");
        }
    } catch (e) {
        console.warn("[uBlock Ultimate] policy-resolver: error loading page-policy.json:", e);
    }
    // Load browser capabilities alongside profiles
    try {
        const capsUrl = chrome.runtime.getURL("config/browser-capabilities.json");
        const capsResp = await fetch(capsUrl);
        if (capsResp.ok) {
            const caps = await capsResp.json();
            const ua = navigator.userAgent || "";
            if (ua.includes("Edg")) {
                browserCapabilities = caps.edge || caps.chromium;
            } else if (ua.includes("Firefox")) {
                browserCapabilities = caps["firefox-mv3"] || caps.chromium;
            } else {
                browserCapabilities = caps.chromium;
            }
            console.log("[uBlock Ultimate] policy-resolver: loaded browser capabilities");
        }
    } catch (e) {
        console.warn("[uBlock Ultimate] policy-resolver: error loading browser-capabilities.json:", e);
    }
}

export function getLoadedProfileIds() {
    return loadedProfiles ? Object.keys(loadedProfiles) : [];
}

// Policy explanation generator for debugging (Item 53)
export function explainPolicy(url, hostname, policy) {
    if (!policy) return "No policy available";
    const lines = [];
    lines.push(`Policy for: ${hostname || url}`);
    lines.push(`Profile: ${policy.profileId || 'fallback'}`);
    lines.push(`Content script: ${policy.contentScriptMode || 'unknown'}`);
    lines.push(`Network: ${policy.network || 'off'}`);
    lines.push(`Cosmetic: ${policy.cosmetic || 'off'} (generic: ${policy.genericCosmetic}, procedural: ${policy.proceduralCosmetic}, smart: ${policy.smartCosmetic})`);
    lines.push(`Scriptlets: ${policy.scriptlets || 'off'}`);
    lines.push(`Video: ${policy.genericVideo || 'off'}`);
    lines.push(`Main-world hooks: ${policy.mainWorldHooks || 'off'}`);
    if (policy.trustedSite) lines.push('Trusted site: true');
    if (policy.observeOnly) lines.push('Observe-only mode (no mutations)');
    if (policy.dryRun) lines.push('Dry-run mode (simulating only)');
    if (policy.strictAppMode) lines.push('Strict app mode (limited capabilities)');
    if (policy.antiAdblockCountermeasures) lines.push('Anti-adblock countermeasures enabled');
    return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Policy decision reasons — every disabled/reduced field has a reason code
// ---------------------------------------------------------------------------

/**
 * @param {string} layer - Layer name (network, cosmetic, scriptlets, video, etc.)
 * @param {string} capability - Specific capability within the layer
 * @param {"enabled"|"disabled"|"observe-only"|"specific-only"|"limited"} state
 * @param {string} reasonCode - Machine-readable reason
 * @param {string} explanation - Human-readable explanation
 * @param {"profile"|"setting"|"managed"|"browser-capability"|"trust-tier"|"safe-mode"|"compatibility"} source
 * @returns {object} policy reason record
 */
export function policyReason(layer, capability, state, reasonCode, explanation, source) {
    return { layer, capability, state, reasonCode, explanation, source };
}

// ---------------------------------------------------------------------------
// resolvePagePolicy — sync, uses cached profiles.
// ---------------------------------------------------------------------------
export function resolvePagePolicy(opts) {
    const {
        url,
        hostname,
        trusted = false,
        netFilteringEnabled = true,
        hostnameSwitches = {},
        hasKnownFilterSupport = false,
        pageSignals = {},
        loggerAttribution = false,
        collectMatchedRules = false,
    } = opts;

    const profileId = resolveProfile(hostname, hasKnownFilterSupport, trusted, pageSignals);
    const profile = getProfile(profileId) || FALLBACK_PROFILE;

    const noCosmeticFiltering = hostnameSwitches.noCosmeticFiltering === true;
    const noScripting = hostnameSwitches.noScripting === true;
    const noRemoteFonts = hostnameSwitches.noRemoteFonts === true;
    const noLargeMedia = hostnameSwitches.noLargeMedia === true;
    const noPopups = hostnameSwitches.noPopups === true;
    
    // Strict app mode: force all layers to specific-only/observe-only (Item 296)
    const strictAppMode = profile.strictAppMode === true;

    // Apply browser capability limits — main-world hooks unavailable without userScripts permission
    const mainWorldHooksSupported = userScriptsAvailable();
    const effectiveMainWorldHooks = mainWorldHooksSupported ? POLICY_MAINWORLD_TRUSTED_SPECIFIC_ONLY : POLICY_MAINWORLD_OFF;

    if (trusted) {
        return {
            profileId: "trusted-off",
            contentScriptMode: "off",
            network: POLICY_NETWORK_OFF,
            firstPartyNetwork: POLICY_FIRSTPARTY_OFF,
            cosmetic: POLICY_COSMETIC_OFF,
            genericCosmetic: false,
            proceduralCosmetic: false,
            smartCosmetic: false,
            scriptlets: POLICY_SCRIPLETS_OFF,
            genericVideo: POLICY_GENERIC_VIDEO_OFF,
            mainWorldHooks: POLICY_MAINWORLD_OFF,
            remoteFontsAllowed: true,
            largeMediaAllowed: true,
            popupsAllowed: true,
            trustedSite: true,
            netFilteringEnabled: false,
            cosmeticFilteringEnabled: false,
            scriptletsEnabled: false,
            observeOnly: false,
            dryRun: false,
            antiAdblockCountermeasures: false,
            energyAwareScanBudget: false,
            scriptletBudget: 0,
            privtree: false,
            privacyAnnotations: false,
            strictAppMode: false,
            layoutShiftBudget: 0,
            networkField: getNestedNetwork(POLICY_NETWORK_OFF, POLICY_FIRSTPARTY_OFF),
            cosmeticField: getNestedCosmetic(false, false, false, false),
            video: getNestedVideo(POLICY_GENERIC_VIDEO_OFF),
            scriptletsField: getNestedScriptlets(POLICY_SCRIPLETS_OFF, POLICY_MAINWORLD_OFF),
            contentScript: getNestedContentScript(false, false, false, false, false),
            instrumentation: getNestedInstrumentation(false, false),
            reasons: [
                policyReason("all", "all", "disabled", "trusted-site", "Site is trusted/whitelisted — all filtering disabled", "profile"),
            ],
        };
    }

    if (netFilteringEnabled === false) {
        const cosmeticOn = !noCosmeticFiltering && profile.cosmetic !== POLICY_COSMETIC_OFF;
        return {
            profileId,
            contentScriptMode: "cosmetic-only",
            network: POLICY_NETWORK_OFF,
            firstPartyNetwork: POLICY_FIRSTPARTY_OFF,
            cosmetic: cosmeticOn ? profile.cosmetic : POLICY_COSMETIC_OFF,
            genericCosmetic: cosmeticOn ? profile.genericCosmetic : false,
            proceduralCosmetic: false,
            smartCosmetic: false,
            scriptlets: POLICY_SCRIPLETS_OFF,
            genericVideo: POLICY_GENERIC_VIDEO_OFF,
            mainWorldHooks: POLICY_MAINWORLD_OFF,
            remoteFontsAllowed: !noRemoteFonts,
            largeMediaAllowed: !noLargeMedia,
            popupsAllowed: !noPopups,
            allowPopups: !noPopups,
            allowPointerCapture: true,
            trustedSite: false,
            netFilteringEnabled: false,
            cosmeticFilteringEnabled: cosmeticOn,
            scriptletsEnabled: false,
            observeOnly: false,
            dryRun: false,
            antiAdblockCountermeasures: false,
            energyAwareScanBudget: false,
            scriptletBudget: 0,
            privtree: false,
            privacyAnnotations: false,
            strictAppMode: false,
            layoutShiftBudget: 0,
            networkField: getNestedNetwork(POLICY_NETWORK_OFF, POLICY_FIRSTPARTY_OFF),
            cosmeticField: getNestedCosmetic(cosmeticOn, false, false, false),
            video: getNestedVideo(POLICY_GENERIC_VIDEO_OFF),
            scriptletsField: getNestedScriptlets(POLICY_SCRIPLETS_OFF, POLICY_MAINWORLD_OFF),
            contentScript: getNestedContentScript(cosmeticOn, cosmeticOn, false, false, false),
            instrumentation: getNestedInstrumentation(false, false),
            reasons: [
                policyReason("network", "all", "disabled", "net-off", "Net filtering disabled by setting", "setting"),
                policyReason("scriptlets", "all", "disabled", "net-off", "Scriptlets disabled when net filtering off", "setting"),
                policyReason("video", "all", "disabled", "net-off", "Generic video filtering disabled when net filtering off", "setting"),
                policyReason("mainWorldHooks", "all", "disabled", "net-off", "MainWorld hooks disabled when net filtering off", "setting"),
                cosmeticOn ? null : policyReason("cosmetic", "all", "disabled", "hostname-switch", "Cosmetic filtering disabled by hostname switch", "setting"),
            ].filter(Boolean),
        };
    }

    // Apply user switches on top of profile
    const cosmeticOn = !noCosmeticFiltering && profile.cosmetic !== POLICY_COSMETIC_OFF;

    // Build fields with profile first, then apply non-negotiable restrictions
    const cosmeticField = deepMerge(
        getNestedCosmetic(
            profile.cosmetic !== POLICY_COSMETIC_OFF,
            profile.genericCosmetic === true,
            profile.proceduralCosmetic === true,
            profile.smartCosmetic === true,
        ),
        profile.cosmeticField,
    );

    const scriptletsField = deepMerge(
        getNestedScriptlets(
            profile.scriptlets || POLICY_SCRIPLETS_TRUSTED_SPECIFIC_ONLY,
            mainWorldHooksSupported ? (profile.mainWorldHooks || POLICY_MAINWORLD_TRUSTED_SPECIFIC_ONLY) : POLICY_MAINWORLD_OFF,
        ),
        profile.scriptletsField,
    );

    const contentScript = deepMerge(
        getNestedContentScript(
            true,
            profile.cosmetic !== POLICY_COSMETIC_OFF,
            profile.smartCosmetic === true,
            profile.genericVideo !== POLICY_GENERIC_VIDEO_OFF,
            false,
        ),
        profile.contentScript,
    );

    if (!cosmeticOn) {
        cosmeticField.specific = false;
        cosmeticField.generic = false;
        cosmeticField.procedural = false;
        cosmeticField.smart = false;

        contentScript.loadCosmeticRuntime = false;
        contentScript.loadCosmeticGeneric = false;
        contentScript.loadCosmeticProcedural = false;
        contentScript.loadSmartRuntime = false;
    } else if (strictAppMode) {
        cosmeticField.specific = true;
        cosmeticField.generic = false;
        cosmeticField.procedural = false;
        cosmeticField.smart = false;

        contentScript.loadCosmeticRuntime = true;
        contentScript.loadCosmeticGeneric = false;
        contentScript.loadCosmeticProcedural = false;
        contentScript.loadSmartRuntime = false;
    }

    if (noScripting) {
        scriptletsField.mode = POLICY_SCRIPLETS_OFF;
        scriptletsField.mainWorldHooks = false;
    } else if (strictAppMode) {
        scriptletsField.mode = POLICY_SCRIPLETS_TRUSTED_SPECIFIC_ONLY;
        scriptletsField.mainWorldHooks = false;
    }

    // Apply effective values — resolve strict mode overrides once
    const effectiveNetwork = strictAppMode
        ? POLICY_NETWORK_SAFE
        : profile.network ?? POLICY_NETWORK_SAFE;
    const effectiveFirstParty = strictAppMode
        ? POLICY_FIRSTPARTY_EXPLICIT_ONLY
        : profile.firstPartyNetwork ?? POLICY_FIRSTPARTY_EXPLICIT_ONLY;
    const effectiveVideo = strictAppMode
        ? POLICY_GENERIC_VIDEO_OBSERVE_ONLY
        : profile.genericVideo ?? POLICY_GENERIC_VIDEO_OFF;
    const effectiveScriptlets = noScripting
        ? POLICY_SCRIPLETS_OFF
        : strictAppMode
            ? POLICY_SCRIPLETS_TRUSTED_SPECIFIC_ONLY
            : profile.scriptlets ?? POLICY_SCRIPLETS_TRUSTED_SPECIFIC_ONLY;
    const effectiveCosmetic = !cosmeticOn
        ? POLICY_COSMETIC_OFF
        : strictAppMode
            ? POLICY_COSMETIC_SPECIFIC_ONLY
            : profile.cosmetic;

    // Build nested fields from effective values, then merge profile overrides
    const networkField = deepMerge(
        getNestedNetwork(effectiveNetwork, effectiveFirstParty),
        profile.networkField,
    );
    const video = deepMerge(getNestedVideo(effectiveVideo), profile.video);

    // Reapply non-negotiable strict-mode restrictions after merging
    if (strictAppMode) {
        networkField.mode = POLICY_NETWORK_SAFE;
        networkField.firstParty = POLICY_FIRSTPARTY_EXPLICIT_ONLY;
        networkField.firstPartyResponseMutation = false;
        networkField.allowRedirect = false;
        networkField.allowSurrogate = false;
        video.mode = POLICY_GENERIC_VIDEO_OBSERVE_ONLY;
        video.allowObservation = true;
        video.allowMutation = false;
        video.allowSkipClick = false;
    }

    const contentScriptEnabled = contentScript.enabled !== false;
    const contentScriptMode = contentScriptEnabled
        ? (contentScript.loadVideoRuntime === true ||
           contentScript.loadSmartRuntime === true ||
           contentScript.loadInterceptors === true)
            ? "full"
            : "cosmetic-only"
        : "off";
    const scriptletsEnabled = effectiveScriptlets !== POLICY_SCRIPLETS_OFF;

    return {
        profileId,
        observeOnly: profile.observeOnly === true,
        dryRun: profile.dryRun === true,
        antiAdblockCountermeasures: profile.antiAdblockCountermeasures === true,
        energyAwareScanBudget: profile.energyAwareScanBudget === true,
        contentScriptMode,
        network: effectiveNetwork,
        firstPartyNetwork: effectiveFirstParty,
        cosmetic: effectiveCosmetic,
        genericCosmetic: strictAppMode ? false : (cosmeticOn ? (profile.genericCosmetic || false) : false),
        proceduralCosmetic: strictAppMode ? false : (cosmeticOn ? (profile.proceduralCosmetic || false) : false),
        smartCosmetic: strictAppMode ? false : (cosmeticOn ? (profile.smartCosmetic || false) : false),
        scriptlets: effectiveScriptlets,
        genericVideo: effectiveVideo,
        mainWorldHooks: (noScripting || !mainWorldHooksSupported || strictAppMode) ? POLICY_MAINWORLD_OFF : (profile.mainWorldHooks || POLICY_MAINWORLD_OFF),
        scriptletBudget: typeof profile.scriptletBudget === 'number' ? profile.scriptletBudget : 50,
        privtree: profile.privtree === true,
        privacyAnnotations: profile.privacyAnnotations === true,
        strictAppMode: profile.strictAppMode === true,
        layoutShiftBudget: typeof profile.layoutShiftBudget === 'number' ? profile.layoutShiftBudget : 0.1,
        remoteFontsAllowed: !noRemoteFonts,
        largeMediaAllowed: !noLargeMedia,
        popupsAllowed: !noPopups,
        allowPopups: !noPopups,
        allowPointerCapture: profile.allowPointerCapture !== false,
        needsUserGesture: profile.needsUserGesture === true || strictAppMode,
        trustedSite: false,
        netFilteringEnabled: true,
        cosmeticFilteringEnabled: cosmeticOn,
        scriptletsEnabled,

        networkField,
        cosmeticField,
        video,
        scriptletsField,
        contentScript,
        instrumentation: getNestedInstrumentation(loggerAttribution, collectMatchedRules),
        reasons: [
            strictAppMode ? policyReason("network", "all", "safe", "strict-mode", "Strict app mode — network reduced to safe", "profile") : null,
            strictAppMode && cosmeticOn ? policyReason("cosmetic", "all", "specific-only", "strict-mode", "Strict app mode — cosmetic reduced to specific-only", "profile") : null,
            strictAppMode ? policyReason("scriptlets", "all", "trusted-specific-only", "strict-mode", "Strict app mode — scriptlets reduced to trusted-specific-only", "profile") : null,
            strictAppMode ? policyReason("video", "all", "observe-only", "strict-mode", "Strict app mode — generic video reduced to observe-only", "profile") : null,
            strictAppMode ? policyReason("mainWorldHooks", "all", "disabled", "strict-mode", "Strict app mode — main-world hooks disabled", "profile") : null,
            noCosmeticFiltering ? policyReason("cosmetic", "all", "disabled", "hostname-switch", "Cosmetic filtering disabled by hostname switch", "setting") : null,
            noScripting ? policyReason("scriptlets", "all", "disabled", "hostname-switch", "Scriptlets disabled by hostname switch", "setting") : null,
            !mainWorldHooksSupported ? policyReason("mainWorldHooks", "all", "disabled", "browser-capability", "MainWorld hooks not supported without userScripts permission", "browser-capability") : null,
            !noScripting && profile.scriptlets === POLICY_SCRIPLETS_OFF ? policyReason("scriptlets", "all", "disabled", "profile", "Profile sets scriptlets to off", "profile") : null,
        ].filter(Boolean),
    };
}
