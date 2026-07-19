// YouTube Engine V17 — SW integration entry point
// Imports all Packet 1+2+3+4 modules and provides SW lifecycle hooks
// Also imports DNR installer for runtime rule installation.

// Values used by YouTubeEngine class — must be locally imported, not just re-exported
import { createTabTracker } from "../youtube/youtube-tab-tracker"
import { createEmptySessionState, YouTubeSessionStateV1 } from "../youtube/youtube-session-state"
import { runStartupRestoration, SwRestorationOutput } from "../youtube/youtube-sw-restore"
import { classifyPageType } from "../youtube/youtube-page-context"
import type { VersionVector } from "../youtube/youtube-rule-reconciler"
import { createPromptDetectorState, scorePromptSignals, updatePromptDetectorState, type PromptDetectorState } from "../youtube/youtube-prompt-detector"
import { createHealthMonitorState, recordHealthTick, type HealthMonitorState } from "../youtube/youtube-health-monitor"
import { createObserverBudgetState, processObserverBatch, type ObserverBudgetState } from "../youtube/youtube-observer-budget"
import { selectBeaconPolicy, type BeaconPolicyConfig } from "../youtube/youtube-beacon-policy"
import { createBackoffState, enterBackoff, advanceIsolation, type BackoffState } from "../youtube/youtube-backoff"
import { createDiagnosticsState, type DiagnosticsState } from "../youtube/youtube-diagnostics"
import { aggregateDnrRulePlan } from "../youtube/youtube-dnr-aggregator"
import type { DnrAggregatorInput } from "../youtube/youtube-dnr-aggregator"
import { applyPlanWithFailureHandling, buildCriticalAllowRules } from "../youtube/youtube-dnr-installer"
import type { InstallResult } from "../youtube/youtube-dnr-installer"

// Packet 1: Registry imports (initialized at module level)
export { CRITICAL_ENDPOINTS as YOUTUBE_CRITICAL_ENDPOINTS } from "../youtube/youtube-critical-endpoints"
export { DEFAULT_BUDGET as YOUTUBE_RULE_BUDGET } from "../youtube/youtube-dnr-budget"
export { ENDPOINT_OWNERSHIP as YOUTUBE_OWNED_ENDPOINTS } from "../youtube/youtube-endpoint-ownership"
export { selectShadowMode } from "../youtube/youtube-shadow-mode"
export { YOUTUBE_PRIORITY } from "../youtube/youtube-rule-priorities"
export { getRuleAuthority, categorizeRuleBySourceAndPriority, capUserOrImportedRulePriority } from "../youtube/youtube-rule-authority"
export type { RuleAuthority } from "../youtube/youtube-rule-authority"

// Packet 4: DNR aggregation, safe-block, surrogates, budget, interference
export { aggregateDnrRulePlan, computeContextualRiskSummary, computeGlobalPlanMode } from "../youtube/youtube-dnr-aggregator"
export type { DnrRulePlan, DnrAggregatorInput, ContextualRiskSummary, GlobalRulePlanMode } from "../youtube/youtube-dnr-aggregator"

export { SAFE_BLOCK_ENDPOINTS, classifySafeBlockEndpoint, isSafeBlockEndpoint, hasFixturesForSafeBlock } from "../youtube/youtube-safe-block"
export type { SafeBlockEntry } from "../youtube/youtube-safe-block"

export { SURROGATE_REDIRECT_REGISTRY, getSurrogateForEndpoint, isSurrogateEligible, getSurrogatePaths } from "../youtube/youtube-surrogate-redirects"
export type { SurrogateRedirectEntry } from "../youtube/youtube-surrogate-redirects"

export { ADAPTIVE_BUDGET_TIERS, ALLOCATION_PRIORITY_ORDER, allocateBudget } from "../youtube/youtube-dnr-budget"
export type { AllocationTier, AllocationRequest, AllocationResult } from "../youtube/youtube-dnr-budget"

export { simulateUserRuleInterference, detectConflictingPriorities } from "../youtube/youtube-rule-interference-sim"
export type { UserRuleInterferenceInput, UserRuleInterferenceOutput, InterferenceRecord } from "../youtube/youtube-rule-interference-sim"

export { handlePartialFailure, createTieredFailureState, DEFAULT_FAILURE_POLICY } from "../youtube/youtube-optional-rule-failure"
export type { PartialFailureInput, PartialFailureOutput, OptionalRuleFailurePolicy, TieredFailureState } from "../youtube/youtube-optional-rule-failure"

// V17 Feature gate settings
export { readYouTubeSettings, readYouTubeSettingsFromStorage, createSettingDefaultsPayload, YOUTUBE_SETTING_KEYS, YOUTUBE_SETTING_DEFAULTS } from "../youtube/youtube-config"
export type { YouTubeSettings, YouTubeSettingKey } from "../youtube/youtube-config"

// Packet 4: DNR installer — bridges aggregator output to chrome.declarativeNetRequest API
export { applyPlanWithFailureHandling, installCriticalRulesOnly, installRulePlan, removeAllYouTubeRules, getInstalledYouTubeRules, verifyCriticalRulesInstalled, buildCriticalAllowRules, compileRulesFromPlan } from "../youtube/youtube-dnr-installer"
export type { InstallInput, InstallResult } from "../youtube/youtube-dnr-installer"

export { isLocalCompleteAllowed, getLocalCompleteBudgetExtension, DEFAULT_LOCAL_COMPLETE_CONFIG } from "../youtube/youtube-local-complete"
export type { LocalCompleteConfig } from "../youtube/youtube-local-complete"

// Packet 5: Data sanitizers, response guards, config wrappers
export { sanitizePlayerResponse, sanitizePlayerResponseIdempotent, isPlayerAdField, isPlayerProtectedField, getPlayerAdFieldNames, getPlayerProtectedFieldNames } from "../youtube/youtube-player-sanitizer"
export type { PlayerSanitizerInput, PlayerSanitizerOutput } from "../youtube/youtube-player-sanitizer"

export { sanitizeData, containsAdRenderer, getAdRendererPatterns } from "../youtube/youtube-data-sanitizer"
export type { DataSanitizerInput, DataSanitizerOutput } from "../youtube/youtube-data-sanitizer"

export { handleConfigSet, handleConfigGet, handleConfigUpdate, isAdConfigKey, isAdConfigValue, getAdConfigKeys } from "../youtube/youtube-config-sanitizer"
export type { ConfigSanitizerInput, ConfigSanitizerOutput } from "../youtube/youtube-config-sanitizer"

export { evaluateFetchInterception, sanitizeResponseHeader, sanitizeAllResponseHeaders, isGuardedUrl, classifyEndpoint, getGuardedEndpoints, getApiOrigins, getAdHeaders } from "../youtube/youtube-fetch-guard"
export type { FetchGuardInput, FetchGuardOutput, XhrHeaderInput, XhrHeaderOutput } from "../youtube/youtube-fetch-guard"

export { evaluateCleanObservation, evaluateRetroactiveSanitization, shouldSkipTraversal, getMaxDepthForPath, getMaxDepth, DEFAULT_TRAVERSAL_CONFIG } from "../youtube/youtube-sanitizer-traversal"
export type { TraversalConfig, CleanObservationInput, CleanObservationOutput, RetroactiveSanitizationInput, RetroactiveSanitizationOutput } from "../youtube/youtube-sanitizer-traversal"

export { detectABVariation, createABVariationState, updateABVariationState, detectExperimentSignals, parseVariationFromSignals, getDefaultKnownExperiments } from "../youtube/youtube-ab-variation"
export type { ABVariationKey, ABVariationState, ABVariationInput, ABVariationOutput } from "../youtube/youtube-ab-variation"

// Packet 2: Lifecycle and persistence imports
export { classifyPageType, rebuildPageContext, isYouTubeHost, createFrameContext, classifyPageTypeCategory } from "../youtube/youtube-page-context"
export type { PageType, PageContext, FrameContext, PageTypeCategory } from "../youtube/youtube-page-context"

export { recomputeRiskLevel, riskAllows, healthTriggersRollback, selectActiveModules, maxRiskLevel, riskLevelAtLeast, healthToRisk } from "../youtube/youtube-risk"
export type { RiskLevel, HealthState } from "../youtube/youtube-risk"

export { computeShapeConfidence, confidenceToMode, canPromoteToBalanced } from "../youtube/youtube-shape-confidence"
export type { ConfidenceKey, SanitizerPathState } from "../youtube/youtube-shape-confidence"

export { initializeNavigation, onFullDocumentStart, onYouTubeNavigationFinish, onBFCacheRestore, handleBFCacheRestore, isSPAEvent } from "../youtube/youtube-navigation"
export type { NavigationType, NavigationSignal, NavigationState } from "../youtube/youtube-navigation"

export { createEmptySessionState, validateSessionState, shouldWriteImmediately, pruneTabSnapshots, evictCriticalOnly, SESSION_STATE_KEY, SCHEMA_VERSION } from "../youtube/youtube-session-state"
export type { YouTubeSessionStateV1, TabSnapshot, UserRuleInterference } from "../youtube/youtube-session-state"

export { createTabTracker } from "../youtube/youtube-tab-tracker"
export type { TabTracker, TabState, RegisteredEmbed } from "../youtube/youtube-tab-tracker"

export { reconcileRules, checkExtensionUpdate, ENGINE_UPDATE_RESET, ENGINE_UPDATE_RESET_ACK } from "../youtube/youtube-rule-reconciler"
export type { RuleReconciliationInput, RuleReconciliationOutput, VersionVector } from "../youtube/youtube-rule-reconciler"

export { runStartupRestoration, selectRestorationPath } from "../youtube/youtube-sw-restore"
export type { SwRestorationOutput, RestorationPath } from "../youtube/youtube-sw-restore"

export { computeConservativeState, mergeRegistration, createReconnectResponse } from "../youtube/youtube-content-reconnect"
export type { YouTubeContentState, ContentScriptRegistration } from "../youtube/youtube-content-reconnect"

// Packet 3: Main-world capability, readiness, wrappers
export { runCapabilityProbe, scanForExtensionOriginScripts, mainWorldActiveAllowed, clearCachedProbe } from "../youtube/youtube-mainworld-capability"
export type { CapabilityResult, CapabilityProbeResult, MainWorldGateInput } from "../youtube/youtube-mainworld-capability"

export { generateNonce, waitForReadiness, validateReadinessEvent, readinessToShadowMode, READINESS_EVENT, READINESS_GRACE_WINDOW_MS, BOOTSTRAP_VERSION } from "../youtube/youtube-readiness-probe"
export type { ReadinessProbeInput, ReadinessProbeResult } from "../youtube/youtube-readiness-probe"

export { createWrapperManager, captureAccessor, captureFunctionWrapper } from "../youtube/youtube-wrapper-manager"
export type { WrapperManager, MainWorldWrapperRecord, WrapperCapture, WrapperTargetKind, WrapperRestoreState } from "../youtube/youtube-wrapper-manager"

export { collectHookRaceTelemetry, earlyAccessorAllowed } from "../youtube/youtube-hook-race-telemetry"
export type { HookRaceEvidence, HookRaceTelemetryInput, EarlyAccessorGateInput } from "../youtube/youtube-hook-race-telemetry"

// Packet 6: Prompt detector, health, observers, beacons, cosmetic cleanup, backoff
export { scorePromptSignals, updatePromptDetectorState, createPromptDetectorState, classifyPromptConfidence, PROMPT_CONFIRMED_THRESHOLD, PROMPT_SUSPECTED_THRESHOLD, PROMPT_SCORE_WEIGHTS } from "../youtube/youtube-prompt-detector"
export type { PromptConfidence, PromptScoreInput, PromptDetectionResult, PromptDetectorState } from "../youtube/youtube-prompt-detector"

export { computeHealthState, createHealthMonitorState, recordHealthTick, getBaseInterval, computeTickInterval, isHealthNormal, healthTriggersBackoff, visibilityPause } from "../youtube/youtube-health-monitor"
export type { HealthSignals, TickConfig, HealthMonitorState, PageCategory } from "../youtube/youtube-health-monitor"

export { selectBeaconMode, selectBeaconPolicy, isPixelEndpoint, isLowRiskBeacon, disableLocalCompleteOnPrompt, handleLocalCompleteSurrogateDrift, DEFAULT_BEACON_POLICY } from "../youtube/youtube-beacon-policy"
export type { BeaconMode, BeaconPolicyConfig, BeaconDecisionInput, BeaconDecision } from "../youtube/youtube-beacon-policy"

export { createObserverBudgetState, processObserverBatch, canObserveShadowRoot, observeShadowRoot, disconnectShadowRoot, enableFeedObservation, disconnectAllObservers, hasActiveObservers, isPassiveDomShadowEligible, DEFAULT_MAX_NODES_PER_BATCH, DEFAULT_HARD_THROTTLE_MS, OVERFLOW_BACKOFF_LIMIT } from "../youtube/youtube-observer-budget"
export type { ObserverRootConfig, ObserverBudgetState, ProcessedBatch, ShadowRootObservation, OverflowEvent } from "../youtube/youtube-observer-budget"

export { validateSelector, isForbiddenSelector, shouldCleanTransientUI, detectInterstitial, computeRiskClassEnabled, selectRollbackOrder, createShortsCleanupConfig, updateShortsCleanupConfig, RISK_CLASS_PRIORITY, FORBIDDEN_SELECTORS, TRANSIENT_UI_ELEMENTS } from "../youtube/youtube-cosmetic-cleanup"
export type { AllowedSelector, TransientUIElement, InterstitialDetectionSignals, ShortsCleanupConfig, RiskClass } from "../youtube/youtube-cosmetic-cleanup"

export { createBackoffState, enterBackoff, advanceIsolation, isModuleDisabled, anyCosmeticDisabled, getDisabledClasses, resolveBackoff, DEFAULT_ROLLBACK_ORDER, PROMPT_IMMEDIATE_DISABLE } from "../youtube/youtube-backoff"
export type { BackoffState } from "../youtube/youtube-backoff"

// Packet 7: Domain variants, performance timeline, endpoint ownership
export { classifyDomainVariant, getDomainPolicy, domainAllowsMainWorld, domainAllowsSanitizer, domainAllowsCosmeticCleanup, canPromoteDomain, selectSafeDefault, isDomainSupported } from "../youtube/youtube-domain-variant"
export type { DomainVariant, DomainVariantPolicy, PhaseGate } from "../youtube/youtube-domain-variant"

export { classifyPerformanceTimingRisk, selectTimelineAction, surrogateExtensionOriginAcceptable, evaluateSurrogateTiming, selectRuleActionForEndpoint, getSurrogateTimingRequirement, getTimelineVisibilityFromRisk, SURROGATE_TIMING_REQUIREMENTS } from "../youtube/youtube-performance-timeline"
export type { PerformanceTimingRisk, PerformanceTimelineEntry, SurrogateTimingRequirement, MonitoredResourceDecision } from "../youtube/youtube-performance-timeline"

export { getEndpointOwner, getPerformanceTimingRisk, isEndpointMonitoredByDefault, registerThirdPartyInitiator, resolveOwnerConflict } from "../youtube/youtube-endpoint-ownership"
export type { EndpointOwnershipEntry } from "../youtube/youtube-endpoint-ownership"

export { getTimelinePolicy, getMonitoredEndpointEntry, isMonitored, downgradeToUnlikely, selectEndpointAction, MONITORED_ENDPOINTS } from "../youtube/youtube-performance-timeline-policy"
export type { TimelineVisibility, MonitoredEndpoint } from "../youtube/youtube-performance-timeline-policy"

// Packet 8: Diagnostics, redirect chain, CORS preflight
export { createDiagnosticsState, recordEvent, maybePrune, pruneByCategory, pruneByAge, getEventsByCategory, getEventsSince, getLatestEvents, summarizeEvents, createSanitizerDecisionEvent, createRuleInstallEvent, createPromptTransitionEvent, createHealthTransitionEvent, createRiskTransitionEvent, isDiagnosticStorageAvailable, estimateStorageSize, shouldPruneStorage } from "../youtube/youtube-diagnostics"
export type { DiagnosticEvent, DiagnosticCategory, DiagnosticsConfig, DiagnosticsState } from "../youtube/youtube-diagnostics"

export { classifyRedirectChain, recordRedirectChainResult, isRedirectSafeToBlock, shouldBroadenUrlPattern, KNOWN_REDIRECT_FIXTURES } from "../youtube/youtube-redirect-chain"
export type { RedirectChainFixture, RedirectChainResult } from "../youtube/youtube-redirect-chain"

export { isOptionsRequest, shouldAllowOptionsRequest, evaluateSurrogateCorsParity, shouldSuppressSurrogate, selectCorsAction, getCorsActionForEndpoint, KNOWN_API_FIXTURES, DEFAULT_CORS_POLICY } from "../youtube/youtube-cors-preflight"
export type { CorsPreflightFixture, CorsPreflightDecision } from "../youtube/youtube-cors-preflight"

// YouTube Engine class — wires lifecycle into SW hooks
export class YouTubeEngine {
    tracker = createTabTracker()
    sessionState: YouTubeSessionStateV1 | null = null
    versionVector: VersionVector | null = null
    healthMonitor: HealthMonitorState | null = null
    promptDetector: PromptDetectorState = createPromptDetectorState()
    observerBudget: ObserverBudgetState = createObserverBudgetState()
    beaconPolicy: BeaconPolicyConfig | null = null
    backoff: BackoffState = createBackoffState()
    diagnostics: DiagnosticsState = createDiagnosticsState()

    init(version: VersionVector): void {
        this.versionVector = version
        this.sessionState = createEmptySessionState(String(Date.now()))
    }

    async onStartup(criticalRuleIDs: number[]): Promise<SwRestorationOutput> {
        if ( !this.versionVector ) {
            throw new Error("YouTube engine not initialized");
        }
        return runStartupRestoration({
      tracker: this.tracker,
      currentVersion: this.versionVector,
      persistedVersion: {},
      persistedState: this.sessionState,
      criticalRuleIDs,
      youtubeRuleIDRangeMin: 1_000_000,
      youtubeRuleIDRangeMax: 2_000_000,
      youtubeBudgetReserve: 5000,
        })
    }

    onTabNavigate(tabId: number, url: string): void {
    this.tracker.upsertTab(tabId, url)
    }

    onTabRemove(tabId: number): void {
    this.tracker.removeTab(tabId)
    }

    onTabActivate(tabId: number): void {
    this.tracker.heartbeatTab(tabId)
    }

    onEmbedRegister(tabId: number, frameId: number, url: string, parentOriginKnown: boolean): void {
        const pageType = classifyPageType(url)
    this.tracker.registerEmbed({
      tabId, frameId, url, parentOriginKnown, pageType,
      mainWorldAvailable: "unknown",
      firstSeenAt: Date.now(), lastHeartbeatAt: Date.now(),
    })
    }

    getActiveYouTubeTabCount(): number {
        return this.tracker.getYouTubeTabs().length
    }

    getGlobalPlanMode(): string {
        if (this.getActiveYouTubeTabCount() === 0) return "SAFE_CONSERVATIVE"
        return this.sessionState?.globalRulePlanMode ?? "SAFE_CONSERVATIVE"
    }

    initializeHealthMonitor(pageCategory: string): void {
        this.healthMonitor = createHealthMonitorState(pageCategory as any)
    }

    recordHealthTick(signals: Record<string, boolean>): void {
        if (!this.healthMonitor) return
        const fullSignals = {
      videoElementExists: signals.videoElementExists ?? true,
      readyStateHealthy: signals.readyStateHealthy ?? true,
      currentTimeAdvances: signals.currentTimeAdvances ?? true,
      noPersistentSpinner: signals.noPersistentSpinner ?? true,
      noFatalError: signals.noFatalError ?? true,
      playerControlsUsable: signals.playerControlsUsable ?? true,
      commentsReachable: signals.commentsReachable ?? true,
      descriptionReachable: signals.descriptionReachable ?? true,
      mastheadSearchVisible: signals.mastheadSearchVisible ?? true,
      spaNavigationWorks: signals.spaNavigationWorks ?? true,
      antiBlockPromptAbsent: signals.antiBlockPromptAbsent ?? true,
        }
        this.healthMonitor = recordHealthTick(this.healthMonitor, fullSignals, Date.now())
    }

    evaluatePrompt(input: Record<string, boolean>): void {
        const result = scorePromptSignals({
      modalOverlayPresent: input.modalOverlayPresent ?? false,
      playerBlockedOrPaused: input.playerBlockedOrPaused ?? false,
      localizedTextMatch: input.localizedTextMatch ?? false,
      primaryActionButtonVisible: input.primaryActionButtonVisible ?? false,
      knownEnforcementShape: input.knownEnforcementShape ?? false,
      dialogRolePresent: input.dialogRolePresent ?? false,
      ariaModalPresent: input.ariaModalPresent ?? false,
      enforcementOverlayNearPlayer: input.enforcementOverlayNearPlayer ?? false,
        })
        this.promptDetector = updatePromptDetectorState(this.promptDetector, result, Date.now())

        if (this.promptDetector.confidence === "CONFIRMED") {
            this.backoff = enterBackoff(this.backoff, true, Date.now())
        }
    }

    processObserverBatch(nodeCount: number): void {
        const { result, newState } = processObserverBatch(this.observerBudget, nodeCount, Date.now())
        this.observerBudget = newState
        if (result.events.includes("OBSERVER_OVERFLOW_BACKOFF")) {
            this.backoff = enterBackoff(this.backoff, false, Date.now())
        }
    }

    selectBeaconPolicy(pageType: string, riskLevel: string): void {
        this.beaconPolicy = selectBeaconPolicy(pageType, riskLevel, this.promptDetector.confidence !== "NONE")
    }

    advanceBackoffIfNeeded(): void {
        const { newState } = advanceIsolation(
      this.backoff,
      this.healthMonitor?.currentHealth === "HEALTHY",
      Date.now(),
        )
        this.backoff = newState
    }

    async applyRulePlan(tabIds: number[]): Promise<InstallResult> {
        if (!this.sessionState) return { kind: "ERROR", message: "Engine not initialized" }

        const criticalIds = buildCriticalAllowRules().map((r) => r.id)
        const aggregatorInput: DnrAggregatorInput = {
      tabStates: this.tracker.getYouTubeTabs(),
      registeredEmbeds: this.tracker.getEmbeds(),
      criticalRuleIDs: criticalIds,
      safeBlockRuleIDs: [],
      surrogateRuleIDs: [],
      beaconRuleIDs: [],
      shadowRuleIDs: [],
      riskByTab: new Map(),
      riskByEmbed: new Map(),
      hasMainWorldCapability: false,
      readinessProbePassed: false,
      localCompleteAllowed: false,
      healthState: this.healthMonitor?.currentHealth ?? "HEALTHY",
      promptScore: this.promptDetector.score ?? 0,
        }

        const plan = aggregateDnrRulePlan(aggregatorInput)
        const result = await applyPlanWithFailureHandling({
      plan,
      sessionState: this.sessionState,
      tabIds,
        })

        if (result.kind === "PANIC") {
            this.sessionState.panicSessionActive = true
            this.sessionState.panicReason = result.panicState.panicReason
            this.sessionState.panicTabIds = result.panicState.panicTabIds
            this.sessionState.globalRulePlanMode = "PANIC"
            this.sessionState.lastRulePlanHash = plan.planHash
        } else if (result.kind === "SUCCESS") {
            this.sessionState.lastRulePlanHash = plan.planHash
            this.sessionState.installedYouTubeRuleIDs = plan.criticalAllowRuleIDs
            this.sessionState.criticalRuleInstallVerified = true
        }

        return result
    }
}
