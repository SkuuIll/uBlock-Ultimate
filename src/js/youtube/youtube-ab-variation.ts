// YouTube AB/Experiment Variation Detection — V17 Packet 5 (§12)
// Detects experiment flags and variations that affect ad rendering,
// tracks per-variation confidence, and prevents false confidence from
// stale observations under a different experiment bucket.

import { type PageType } from "./youtube-types"

export interface ABVariationKey {
  experimentId: string
  variation: string
  pageType: PageType
  schemaFingerprint: string
}

export interface ABVariationState {
  key: ABVariationKey
  firstSeenAt: number
  lastSeenAt: number
  observationCount: number
  cleanObservationCount: number
  confidence: number
  disabled: boolean
}

export interface ABVariationInput {
  data: Record<string, unknown>
  pageType: PageType
  schemaFingerprint: string
  knownExperiments: Map<string, string[]>
}

export interface ABVariationOutput {
  detected: boolean
  experimentId: string | null
  variation: string | null
  confidenceImpact: number
}

export const EXPERIMENT_SIGNAL_PATTERNS = [
  "experiments",
  "experiment_ids",
  "client.experimentIds",
  "client.experiments",
  "variation",
  "bucket",
  "flags",
  "encodedExperimentFlags",
  "client.experimentFlags",
] as const

const DEFAULT_KNOWN_EXPERIMENTS: Map<string, string[]> = new Map([
  ["ad_variation", ["control", "treatment_1", "treatment_2"]],
  ["player_ui", ["control", "new_layout"]],
  ["recommendation_feed", ["control", "dense", "expanded"]],
])

export function getDefaultKnownExperiments(): Map<string, string[]> {
    return new Map(DEFAULT_KNOWN_EXPERIMENTS)
}

export function detectExperimentSignals(data: Record<string, unknown>): Record<string, string> {
    const signals: Record<string, string> = {}

    for (const pattern of EXPERIMENT_SIGNAL_PATTERNS) {
        const parts = pattern.split(".")
        let current: unknown = data
        let found = true

        for (const part of parts) {
            if (typeof current === "object" && current !== null && part in (current as Record<string, unknown>)) {
                current = (current as Record<string, unknown>)[part]
            } else {
                found = false
                break
            }
        }

        if (found && typeof current === "string") {
            signals[pattern] = current
        }
    }

    return signals
}

export function parseVariationFromSignals(signals: Record<string, string>, knownExperiments: Map<string, string[]>): ABVariationOutput {
    for (const [signalKey, signalValue] of Object.entries(signals)) {
        for (const [expId, variations] of knownExperiments.entries()) {
            if (signalValue.includes(expId) || signalKey.includes(expId)) {
                for (const variation of variations) {
                    if (signalValue.includes(variation)) {
                        return {
              detected: true,
              experimentId: expId,
              variation,
              confidenceImpact: -10,
                        }
                    }
                }
            }
        }
    }

    return {
    detected: false,
    experimentId: null,
    variation: null,
    confidenceImpact: 0,
    }
}

export function createABVariationState(key: ABVariationKey): ABVariationState {
    return {
    key,
    firstSeenAt: Date.now(),
    lastSeenAt: Date.now(),
    observationCount: 0,
    cleanObservationCount: 0,
    confidence: 0,
    disabled: false,
    }
}

export function updateABVariationState(state: ABVariationState, isClean: boolean): ABVariationState {
    const updated = { ...state }
    updated.lastSeenAt = Date.now()
    updated.observationCount += 1

    if (isClean) {
        updated.cleanObservationCount += 1
    }

    const ratio = updated.observationCount > 0 ? updated.cleanObservationCount / updated.observationCount : 0
    updated.confidence = Math.round(ratio * 100)

    if (updated.observationCount >= 10 && ratio < 0.3) {
        updated.disabled = true
    }

    return updated
}

export function detectABVariation(input: ABVariationInput): ABVariationOutput {
    const signals = detectExperimentSignals(input.data)
    return parseVariationFromSignals(signals, input.knownExperiments)
}
