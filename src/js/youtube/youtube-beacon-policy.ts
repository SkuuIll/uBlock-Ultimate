// YouTube Beacon Integrity Policy — V17 Packet 6 (§16)
// Defines beacon handling modes and LOCAL_COMPLETE experimental guardrails.

export type BeaconMode = "ALLOW" | "PIXEL_SURROGATE" | "BLOCK" | "LOCAL_COMPLETE"

export interface BeaconPolicyConfig {
  defaultMode: BeaconMode
  localCompleteExperimental: boolean
  localCompleteAllowlist: string[]
  shapeConfidenceThreshold: number
  healthNormalRequired: boolean
}

export const DEFAULT_BEACON_POLICY: BeaconPolicyConfig = {
  defaultMode: "ALLOW",
  localCompleteExperimental: false,
  localCompleteAllowlist: [],
  shapeConfidenceThreshold: 85,
  healthNormalRequired: true,
}

export interface BeaconDecisionInput {
  endpoint: string
  method: string
  contentType: string
  shapeConfidence: number
  healthNormal: boolean
  localCompleteConfig: BeaconPolicyConfig
}

export interface BeaconDecision {
  mode: BeaconMode
  reason: string
}

export function selectBeaconMode(input: BeaconDecisionInput): BeaconDecision {
    if (input.localCompleteConfig.localCompleteExperimental) {
        if (input.localCompleteConfig.localCompleteAllowlist.includes(input.endpoint)) {
            if (input.shapeConfidence >= input.localCompleteConfig.shapeConfidenceThreshold) {
                if (!input.localCompleteConfig.healthNormalRequired || input.healthNormal) {
                    return { mode: "LOCAL_COMPLETE", reason: "local_complete_eligible" }
                }
            }
        }
    }

    if (isPixelEndpoint(input.endpoint, input.method, input.contentType)) {
        return { mode: "PIXEL_SURROGATE", reason: "pixel_surrogate_eligible" }
    }

    if (isLowRiskBeacon(input.endpoint)) {
        return { mode: "BLOCK", reason: "low_risk_beacon" }
    }

    return { mode: "ALLOW", reason: "default_allow" }
}

export function isPixelEndpoint(endpoint: string, method: string, contentType: string): boolean {
    if (method !== "GET" && method !== "POST") return false
    if (contentType === "image/gif" || contentType === "image/png") return true
    if (endpoint.match(/\/beacon|\/ping|\/collect|\/log|\/analytics|\/metrics/i)) return true
    return false
}

export function isLowRiskBeacon(endpoint: string): boolean {
    const lowRiskPatterns = [
    /\/heartbeat/i,
    /\/playback_metrics/i,
    /\/stats\/[a-z]/i,
    /\/ad_break/i,
    ]
    return lowRiskPatterns.some(p => p.test(endpoint))
}

export function selectBeaconPolicy(
    pageType: string,
    riskLevel: string,
    hasPrompt: boolean,
): BeaconPolicyConfig {
    if (hasPrompt || riskLevel === "PANIC") {
        return { ...DEFAULT_BEACON_POLICY, defaultMode: "ALLOW", localCompleteExperimental: false }
    }
    if (riskLevel === "HIGH") {
        return { ...DEFAULT_BEACON_POLICY, defaultMode: "PIXEL_SURROGATE", localCompleteExperimental: false }
    }
    if (pageType === "EMBED" || pageType === "LIVE") {
        return { ...DEFAULT_BEACON_POLICY, defaultMode: "PIXEL_SURROGATE" }
    }
    return DEFAULT_BEACON_POLICY
}

export function handleLocalCompleteSurrogateDrift(
    endpoint: string,
    expectedFingerprint: string,
    actualFingerprint: string,
): { driftDetected: boolean } {
    return { driftDetected: expectedFingerprint !== actualFingerprint }
}

export function disableLocalCompleteOnPrompt(
    config: BeaconPolicyConfig,
    promptDetected: boolean,
): BeaconPolicyConfig {
    if (!promptDetected) return config
    return { ...config, localCompleteExperimental: false }
}
