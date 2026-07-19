// YouTube Global DNR Rule-Plan Aggregator — V17 Packet 4 (§13.2)
// Aggregates DNR rules across all active YouTube contexts (tabs, embeds)
// and produces a unified rule plan with the most conservative mode required.

import { type RiskLevel, type HealthState } from "./youtube-risk"
import { type TabState, type RegisteredEmbed } from "./youtube-tab-tracker"

export type GlobalRulePlanMode =
  | "SAFE_CONSERVATIVE"
  | "EMBED_CONSERVATIVE"
  | "BALANCED"
  | "BACKOFF"
  | "PANIC"

import { type PerformanceTimingRisk } from "./youtube-performance-timeline"

export interface ContextualRiskSummary {
  hasTopLevelYouTube: boolean
  hasRegisteredEmbed: boolean
  maxTabRisk: RiskLevel
  maxEmbedRisk: RiskLevel
  embedCount: number
  healthState: HealthState
  promptScore: number
  monitoredEndpointCount: number
  hasMobileVariant: boolean
  hasNoCookieVariant: boolean
}

export interface DnrRulePlan {
  globalMode: GlobalRulePlanMode
  criticalAllowRuleIDs: number[]
  safeBlockRuleIDs: number[]
  surrogateRuleIDs: number[]
  beaconRuleIDs: number[]
  shadowRuleIDs: number[]
  planHash: string
}

export interface DnrAggregatorInput {
  tabStates: TabState[]
  registeredEmbeds: RegisteredEmbed[]
  criticalRuleIDs: number[]
  safeBlockRuleIDs: number[]
  surrogateRuleIDs: number[]
  beaconRuleIDs: number[]
  shadowRuleIDs: number[]
  riskByTab: Map<number, RiskLevel>
  riskByEmbed: Map<string, RiskLevel>
  hasMainWorldCapability: boolean
  readinessProbePassed: boolean
  localCompleteAllowed: boolean
  healthState?: HealthState
  promptScore?: number
  monitoredEndpointCount?: number
  domainVariant?: "top_level" | "mobile" | "no_cookie" | "music" | "embed" | "sandboxed" | "unknown"
}

function riskToNumeric(risk: RiskLevel): number {
    switch (risk) {
    case "LOW": return 0
    case "MEDIUM": return 1
    case "HIGH": return 2
    case "PANIC": return 3
    }
}

export function computeContextualRiskSummary(input: DnrAggregatorInput): ContextualRiskSummary {
    const hasTopLevelYouTube = input.tabStates.length > 0
    const hasRegisteredEmbed = input.registeredEmbeds.length > 0

    let maxTabRisk: RiskLevel = hasTopLevelYouTube ? "LOW" : "LOW"
    for (const tab of input.tabStates) {
        const risk = input.riskByTab.get(tab.tabId) ?? "LOW"
        if (riskToNumeric(risk) > riskToNumeric(maxTabRisk)) maxTabRisk = risk
    }

    let maxEmbedRisk: RiskLevel = hasRegisteredEmbed ? "LOW" : "LOW"
    for (const embed of input.registeredEmbeds) {
        const key = `${embed.tabId}:${embed.frameId}`
        const risk = input.riskByEmbed.get(key) ?? "LOW"
        if (riskToNumeric(risk) > riskToNumeric(maxEmbedRisk)) maxEmbedRisk = risk
    }

    const hasMobileVariant = input.domainVariant === "mobile"
    const hasNoCookieVariant = input.domainVariant === "no_cookie"

    return {
    hasTopLevelYouTube, hasRegisteredEmbed, maxTabRisk, maxEmbedRisk,
    embedCount: input.registeredEmbeds.length,
    healthState: input.healthState ?? "HEALTHY",
    promptScore: input.promptScore ?? 0,
    monitoredEndpointCount: input.monitoredEndpointCount ?? 0,
    hasMobileVariant,
    hasNoCookieVariant,
    }
}

export function computeGlobalPlanMode(summary: ContextualRiskSummary): GlobalRulePlanMode {
    if (summary.hasMobileVariant) return "SAFE_CONSERVATIVE"
    if (summary.hasNoCookieVariant && summary.monitoredEndpointCount > 10) return "EMBED_CONSERVATIVE"
    if (summary.healthState === "BROKEN" || summary.maxTabRisk === "PANIC" || summary.maxEmbedRisk === "PANIC") return "PANIC"
    if (summary.healthState === "PROMPT_DETECTED" || summary.promptScore >= 80) return "BACKOFF"
    if (summary.healthState === "STUCK") return "BACKOFF"
    if (summary.maxTabRisk === "HIGH" || summary.maxEmbedRisk === "HIGH") return "BACKOFF"
    if (!summary.hasTopLevelYouTube && summary.hasRegisteredEmbed) return "EMBED_CONSERVATIVE"
    if (!summary.hasTopLevelYouTube && !summary.hasRegisteredEmbed) return "SAFE_CONSERVATIVE"
    return "BALANCED"
}

export function buildRulePlan(mode: GlobalRulePlanMode, input: DnrAggregatorInput): DnrRulePlan {
    const criticalIds = [...input.criticalRuleIDs]
    let safeBlockIds: number[] = []
    let surrogateIds: number[] = []
    let beaconIds: number[] = []
    let shadowIds: number[] = []

    if (mode === "SAFE_CONSERVATIVE") {
        safeBlockIds = []
        surrogateIds = []
        beaconIds = []
        shadowIds = []
    } else if (mode === "EMBED_CONSERVATIVE") {
        safeBlockIds = input.safeBlockRuleIDs
        surrogateIds = input.surrogateRuleIDs.filter(id => id % 2 === 0)
        beaconIds = []
        shadowIds = []
    } else if (mode === "BALANCED") {
        safeBlockIds = input.safeBlockRuleIDs
        surrogateIds = input.surrogateRuleIDs
        beaconIds = input.beaconRuleIDs
        shadowIds = input.shadowRuleIDs
    } else if (mode === "BACKOFF") {
        const promptDriven = (input.promptScore ?? 0) >= 80 || input.healthState === "PROMPT_DETECTED"
        if (promptDriven) {
            surrogateIds = input.surrogateRuleIDs.slice(0, Math.ceil(input.surrogateRuleIDs.length / 4))
            safeBlockIds = input.safeBlockRuleIDs.slice(0, Math.ceil(input.safeBlockRuleIDs.length / 2))
        } else {
            surrogateIds = input.surrogateRuleIDs.slice(0, Math.ceil(input.surrogateRuleIDs.length / 2))
            safeBlockIds = input.safeBlockRuleIDs
        }
        beaconIds = []
        shadowIds = []
    }

    const allIds = [...criticalIds, ...safeBlockIds, ...surrogateIds, ...beaconIds, ...shadowIds]
    const planHash = allIds.sort((a, b) => a - b).join(",")

    return {
    globalMode: mode,
    criticalAllowRuleIDs: criticalIds,
    safeBlockRuleIDs: safeBlockIds,
    surrogateRuleIDs: surrogateIds,
    beaconRuleIDs: beaconIds,
    shadowRuleIDs: shadowIds,
    planHash,
    }
}

export function aggregateDnrRulePlan(input: DnrAggregatorInput): DnrRulePlan {
    const summary = computeContextualRiskSummary(input)
    const mode = computeGlobalPlanMode(summary)
    return buildRulePlan(mode, input)
}
