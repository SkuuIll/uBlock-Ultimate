// YouTube Shadow Mode Decision Policy — V17 Phase 0
// Mode is selected by page type, risk level, prompt history, shape confidence,
// and update state.

export type ShadowMode = "PASSIVE_DOM_SHADOW" | "INSTRUMENTED_SHADOW" | "OFFLINE_FIXTURE_SHADOW"

export type PageType = "WATCH" | "BROWSE" | "SEARCH" | "SHORTS" | "EMBED" | "LIVE" | "MUSIC" | "UNSUPPORTED"

export type RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "PANIC"

export interface ShadowDecisionInput {
  pageType: PageType
  riskLevel: RiskLevel
  promptDetected: boolean
  shapeConfidence: number
  mainWorldAvailable: boolean
  updatePending: boolean
}

export function selectShadowMode(input: ShadowDecisionInput): ShadowMode {
    if (input.riskLevel === "PANIC") return "PASSIVE_DOM_SHADOW"
    if (input.promptDetected) return "PASSIVE_DOM_SHADOW"
    if (!input.mainWorldAvailable) return "PASSIVE_DOM_SHADOW"
    if (input.riskLevel === "HIGH") return "PASSIVE_DOM_SHADOW"
    if (input.updatePending) return "PASSIVE_DOM_SHADOW"

    if (input.riskLevel === "MEDIUM" && input.shapeConfidence >= 70) {
        return "INSTRUMENTED_SHADOW"
    }

    if (input.riskLevel === "LOW" && input.shapeConfidence >= 90) {
        return "OFFLINE_FIXTURE_SHADOW"
    }

    if (input.riskLevel === "LOW" && input.shapeConfidence >= 70) {
        return "INSTRUMENTED_SHADOW"
    }

    return "PASSIVE_DOM_SHADOW"
}
