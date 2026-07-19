// YouTube Service Worker Restore — V17 Packet 2
// §39.4 Startup restoration protocol, §39.7 Full vs SPA restoration

import { type YouTubeSessionStateV1, validateSessionState, createEmptySessionState, SESSION_STATE_KEY } from "./youtube-session-state"
import { type TabTracker } from "./youtube-tab-tracker"
import { classifyPageType, isYouTubeHost } from "./youtube-page-context"
import { type RiskLevel, maxRiskLevel } from "./youtube-risk"
import { type GlobalRulePlanMode } from "./youtube-session-state"
import { type RuleReconciliationInput, computeRulePlanHash, reconcileRules, checkExtensionUpdate, type VersionVector } from "./youtube-rule-reconciler"

export interface SwRestorationInput {
  tracker: TabTracker
  currentVersion: VersionVector
  persistedVersion: Partial<VersionVector>
  persistedState: YouTubeSessionStateV1 | null
  criticalRuleIDs: number[]
  youtubeRuleIDRangeMin: number
  youtubeRuleIDRangeMax: number
  youtubeBudgetReserve: number
}

export interface SwRestorationOutput {
  sessionState: YouTubeSessionStateV1
  globalRulePlanMode: GlobalRulePlanMode
  aggregateRiskLevel: RiskLevel
  criticalRulesInstalled: boolean
  requiresReconnect: boolean
  requiresUpdateReset: boolean
  staleOptionalRulesRemoved: number[]
  missingCriticalRuleIDs: number[]
  noYouTubeTabs: boolean
}

// §39.4 Startup restoration protocol
export async function runStartupRestoration(input: SwRestorationInput): Promise<SwRestorationOutput> {
    const { tracker, currentVersion, persistedVersion, persistedState, criticalRuleIDs, youtubeRuleIDRangeMin, youtubeRuleIDRangeMax, youtubeBudgetReserve } = input

    // (1)-(2): Load and validate persisted state
    let sessionState: YouTubeSessionStateV1
    let stateValid = false
    if (persistedState && validateSessionState(persistedState)) {
        sessionState = persistedState
        stateValid = true
    } else {
        sessionState = createEmptySessionState(String(Date.now()))
    }

    // (3)-(4): Query open tabs
    // Note: actual chrome.tabs.query must be provided by caller
    // Here we use the tracker state as a proxy for the open tab query
    const openYouTubeTabs = tracker.getYouTubeTabs()

    // (5): Discard stale tab snapshots
    const currentTabIds = new Set(openYouTubeTabs.map(t => t.tabId))
    sessionState.tabSnapshots = sessionState.tabSnapshots.filter(ts => currentTabIds.has(ts.tabId))

    // (6)-(7): Build minimal PageContext and merge persisted state
    for (const tab of openYouTubeTabs) {
        const persisted = sessionState.tabSnapshots.find(ts => ts.tabId === tab.tabId)
        if (persisted && persisted.url === tab.url && classifyPageType(tab.url) === tab.pageType) {
            tab.riskLevel = maxRiskLevel(tab.riskLevel, persisted.riskLevel)
        }
    }

    // (8): Restore session-wide disabled modules
    // (9): Recompute global rule plan
    const noYouTubeTabs = openYouTubeTabs.length === 0
    let globalRulePlanMode: GlobalRulePlanMode = noYouTubeTabs ? "SAFE_CONSERVATIVE" : sessionState.globalRulePlanMode
    let aggregateRiskLevel: RiskLevel = noYouTubeTabs ? "LOW" : sessionState.lastAggregateRiskLevel

    // (10)-(12): Verify and reinstall critical rules
    const reconciliationInput: RuleReconciliationInput = {
    installedRuleIDs: sessionState.installedYouTubeRuleIDs,
    criticalRuleIDs,
    optionalRuleIDs: sessionState.installedYouTubeRuleIDs.filter(id => !criticalRuleIDs.includes(id)),
    globalRulePlanMode,
    lastAggregateRiskLevel: aggregateRiskLevel,
    lastRulePlanHash: sessionState.lastRulePlanHash,
    expectedRulePlanHash: computeRulePlanHash([
      ...criticalRuleIDs,
      ...sessionState.installedYouTubeRuleIDs.filter(id => !criticalRuleIDs.includes(id)),
    ]),
    registryVersion: currentVersion.criticalEndpointRegistryVersion,
    manifestVersion: currentVersion.manifestVersion,
    youtubeRuleIDRangeMin,
    youtubeRuleIDRangeMax,
    youtubeBudgetReserve,
    userRuleInterference: new Set(sessionState.userRuleInterference.map(r => r.ruleId)),
    }
    const reconciled = reconcileRules(reconciliationInput)

    let criticalRulesInstalled = reconciled.criticalRulesPresent
    if (reconciled.requiresPanic) {
        globalRulePlanMode = "PANIC"
        aggregateRiskLevel = "PANIC"
    }

    // (13)-(14): Send reconnect messages
    const requiresReconnect = true // always attempt reconnect on startup

    // Check for extension update
    const changedKeys = checkExtensionUpdate(currentVersion, persistedVersion)
    const requiresUpdateReset = changedKeys.length > 0

    // Mandatory no-context purge
    if (noYouTubeTabs) {
        globalRulePlanMode = "SAFE_CONSERVATIVE"
        sessionState.installedYouTubeRuleIDs = [...criticalRuleIDs]
        sessionState.lastRulePlanHash = ""
        sessionState.panicSessionActive = false
        sessionState.panicReason = undefined
        sessionState.panicTabIds = []
    }

    sessionState.globalRulePlanMode = globalRulePlanMode
    sessionState.lastAggregateRiskLevel = aggregateRiskLevel
    sessionState.updatedAt = Date.now()

    return {
    sessionState,
    globalRulePlanMode,
    aggregateRiskLevel,
    criticalRulesInstalled,
    requiresReconnect,
    requiresUpdateReset,
    staleOptionalRulesRemoved: reconciled.staleOptionalRules,
    missingCriticalRuleIDs: reconciled.missingCriticalRules,
    noYouTubeTabs,
    }
}

// §39.7 Full vs SPA restoration path selection
export type RestorationPath = "SERVICE_WORKER_RESTART" | "FULL_DOCUMENT_NAVIGATION" | "YOUTUBE_SPA_NAVIGATION"

export function selectRestorationPath(isSwRestart: boolean, isFullDocument: boolean, isSPA: boolean): RestorationPath {
    if (isSwRestart) return "SERVICE_WORKER_RESTART"
    if (isFullDocument) return "FULL_DOCUMENT_NAVIGATION"
    if (isSPA) return "YOUTUBE_SPA_NAVIGATION"
    return "FULL_DOCUMENT_NAVIGATION"
}
