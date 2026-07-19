// YouTube Performance Resource Timeline Policy — V17 Packet 7 (§5.7, §49)
// Enhanced MONITORED_BY_DEFAULT heuristic, surrogate timing requirements,
// and performanceTimingRisk integration.

import { type TimelineVisibility } from "./youtube-performance-timeline-policy"

export type PerformanceTimingRisk = "MONITORED_BY_DEFAULT" | "LIKELY_MONITORED" | "UNLIKELY_MONITORED"

export interface PerformanceTimelineEntry {
  endpoint: string
  risk: PerformanceTimingRisk
  reason: string
}

export interface SurrogateTimingRequirement {
  endpoint: string
  entryType: string
  urlClass: string
  initiatorType: string
  timingEnvelopeMs: { min: number; max: number }
  extensionOriginAcceptable: boolean
}

export interface MonitoredResourceDecision {
  action: "ALLOW" | "SURROGATE_WITH_VALIDATION" | "LOCAL_COMPLETE" | "BLOCK_ONLY_WITH_FIXTURE" | "SHADOW_OBSERVE"
  reason: string
  performanceTimingRisk: PerformanceTimingRisk
}

export function classifyPerformanceTimingRisk(
    endpoint: string,
    inCriticalRegistry: boolean,
    hasShadowTelemetry: boolean,
    hasFixtureEvidence: boolean,
    pageObservesPerformance: boolean,
): PerformanceTimingRisk {
    if (inCriticalRegistry) return "MONITORED_BY_DEFAULT"
    if (pageObservesPerformance) return "MONITORED_BY_DEFAULT"
    if (endpoint.match(/\/player|\/bootstrap|\/ad|\/beacon|\/measure|\/ping|\/collect/i)) return "MONITORED_BY_DEFAULT"
    if (hasShadowTelemetry && !hasFixtureEvidence) return "LIKELY_MONITORED"
    if (hasFixtureEvidence && !pageObservesPerformance) return "UNLIKELY_MONITORED"
    return "MONITORED_BY_DEFAULT"
}

export function selectTimelineAction(
    risk: PerformanceTimingRisk,
    surrogateEligible: boolean,
    fixtureProven: boolean,
    shapeConfidence: number,
): MonitoredResourceDecision {
    if (risk === "UNLIKELY_MONITORED") {
        return {
      action: "BLOCK_ONLY_WITH_FIXTURE",
      reason: "low_monitoring_risk",
      performanceTimingRisk: risk,
        }
    }

    if (risk === "LIKELY_MONITORED") {
        if (surrogateEligible && fixtureProven && shapeConfidence >= 85) {
            return {
        action: "SURROGATE_WITH_VALIDATION",
        reason: "surrogate_with_timing_validation",
        performanceTimingRisk: risk,
            }
        }
        return {
      action: "SHADOW_OBSERVE",
      reason: "likely_monitored_shadow_observe",
      performanceTimingRisk: risk,
        }
    }

    if (surrogateEligible && fixtureProven && shapeConfidence >= 90) {
        return {
      action: "SURROGATE_WITH_VALIDATION",
      reason: "surrogate_with_fixture",
      performanceTimingRisk: risk,
        }
    }

    return {
    action: "ALLOW",
    reason: "monitored_by_default_allow",
    performanceTimingRisk: risk,
    }
}

export function surrogateExtensionOriginAcceptable(
    endpoint: string,
    requirement: SurrogateTimingRequirement | null,
): boolean {
    if (!requirement) return false
    return requirement.extensionOriginAcceptable
}

export function evaluateSurrogateTiming(
    surrogateEntry: { url: string; transferSize: number; duration: number },
    requirement: SurrogateTimingRequirement,
): { acceptable: boolean; reasons: string[] } {
    const reasons: string[] = []
    let acceptable = true

    if (surrogateEntry.url.startsWith("chrome-extension://")) {
        if (!requirement.extensionOriginAcceptable) {
      reasons.push("extension_origin_not_acceptable")
      acceptable = false
        }
    }

    if (surrogateEntry.duration < requirement.timingEnvelopeMs.min) {
    reasons.push("timing_too_fast")
    acceptable = false
    }

    if (surrogateEntry.duration > requirement.timingEnvelopeMs.max) {
    reasons.push("timing_too_slow")
    acceptable = false
    }

    if (surrogateEntry.transferSize === 0) {
    reasons.push("zero_transfer_size")
    acceptable = false
    }

    return { acceptable, reasons }
}

export function selectRuleActionForEndpoint(
    endpoint: string,
    performanceTimingRisk: PerformanceTimingRisk,
    surrogateEligible: boolean,
    fixtureProven: boolean,
    shapeConfidence: number,
): "ALLOW" | "SURROGATE" | "BLOCK" {
    const decision = selectTimelineAction(performanceTimingRisk, surrogateEligible, fixtureProven, shapeConfidence)

    switch (decision.action) {
    case "BLOCK_ONLY_WITH_FIXTURE":
        return fixtureProven ? "BLOCK" : "ALLOW"
    case "SURROGATE_WITH_VALIDATION":
        return "SURROGATE"
    case "SHADOW_OBSERVE":
        return "ALLOW"
    case "ALLOW":
        return "ALLOW"
    case "LOCAL_COMPLETE":
        return "ALLOW"
    }
}

export function getTimelineVisibilityFromRisk(risk: PerformanceTimingRisk): TimelineVisibility {
    switch (risk) {
    case "MONITORED_BY_DEFAULT": return "MONITORED_BY_DEFAULT"
    case "LIKELY_MONITORED": return "LIKELY_MONITORED"
    case "UNLIKELY_MONITORED": return "UNLIKELY_MONITORED"
    }
}

export const SURROGATE_TIMING_REQUIREMENTS: SurrogateTimingRequirement[] = [
  {
    endpoint: "doubleclick.net",
    entryType: "resource",
    urlClass: "ad-script",
    initiatorType: "script",
    timingEnvelopeMs: { min: 50, max: 3000 },
    extensionOriginAcceptable: false,
  },
  {
    endpoint: "googlevideo.com/videoplayback",
    entryType: "media",
    urlClass: "video",
    initiatorType: "media",
    timingEnvelopeMs: { min: 200, max: 10000 },
    extensionOriginAcceptable: false,
  },
]

export function getSurrogateTimingRequirement(endpoint: string): SurrogateTimingRequirement | null {
    for (const req of SURROGATE_TIMING_REQUIREMENTS) {
        if (endpoint.includes(req.endpoint)) return req
    }
    return null
}

