// YouTube Shape Confidence Model — V17 Packet 2
// §10.4 Shape confidence scoring, thresholds, and decay

export interface ConfidenceKey {
  endpointClass: string
  pageType: string
  sanitizerPath: string
  schemaFingerprint: string
  browserMajorVersion: number
  extensionVersion: string
}

export interface ConfidenceEvidence {
  fixtureExists: boolean
  shapeMatchesFixture: boolean
  expectedParentKeysPresent: boolean
  shadowCleanObservations: number
  consecutiveCleanLoads: number
  unknownParentKey: boolean
  typeDrift: boolean
  promptAfterSanitize: boolean
  playbackErrorAfterSanitize: boolean
  domBreakageAfterSanitize: boolean
  surrogateMismatch: boolean
  browserMajorUpdateSinceValidation: boolean
}

export const ACTIVATION_THRESHOLDS = {
  SHADOW_ONLY: 0,
  CAUTIOUS: 50,
  BALANCED: 70,
  STABLE: 85,
  MAX: 100,
}

export function computeShapeConfidence(key: ConfidenceKey, evidence: ConfidenceEvidence): number {
    let score = 0

    if (evidence.fixtureExists && evidence.shapeMatchesFixture) score += 35
    else if (evidence.fixtureExists) score += 20

    if (evidence.expectedParentKeysPresent) score += 15

    score += Math.min(evidence.shadowCleanObservations * 10, 20)

    if (evidence.consecutiveCleanLoads >= 3) score += 15
    else if (evidence.consecutiveCleanLoads >= 1) score += 5

    if (evidence.unknownParentKey) score -= 30
    if (evidence.typeDrift) score -= 30
    if (evidence.promptAfterSanitize) score -= 50
    if (evidence.playbackErrorAfterSanitize) score -= 50
    if (evidence.domBreakageAfterSanitize) score -= 50
    if (evidence.surrogateMismatch) score -= 40
    if (evidence.browserMajorUpdateSinceValidation) score = Math.min(score, 60)

    return Math.max(0, Math.min(100, score))
}

export function confidenceToMode(score: number): "SHADOW_ONLY" | "CAUTIOUS" | "BALANCED" | "STABLE" {
    if (score >= ACTIVATION_THRESHOLDS.STABLE) return "STABLE"
    if (score >= ACTIVATION_THRESHOLDS.BALANCED) return "BALANCED"
    if (score >= ACTIVATION_THRESHOLDS.CAUTIOUS) return "CAUTIOUS"
    return "SHADOW_ONLY"
}

export interface SanitizerPathState {
  confidenceKey: ConfidenceKey
  score: number
  consecutiveCleanObservations: number
  lastObservedAt: number
  modeAtLastObservation: string
  disabledForSession: boolean
}

export function canPromoteToBalanced(state: SanitizerPathState): boolean {
    if (state.disabledForSession) return false
    if (!state.confidenceKey.schemaFingerprint) return false
    if (state.consecutiveCleanObservations < 3) return false
    if (state.score < ACTIVATION_THRESHOLDS.BALANCED) return false
    return true
}

export function recordObservation(state: SanitizerPathState, clean: boolean, score: number): SanitizerPathState {
    return {
    ...state,
    score,
    consecutiveCleanObservations: clean ? state.consecutiveCleanObservations + 1 : 0,
    lastObservedAt: Date.now(),
    modeAtLastObservation: confidenceToMode(score),
    }
}

export function resetConfidenceOnShapeChange(state: SanitizerPathState): SanitizerPathState {
    return {
    ...state,
    score: state.confidenceKey.schemaFingerprint ? Math.min(state.score, 60) : 0,
    consecutiveCleanObservations: 0,
    }
}

export function scoreAfterShapeChange(oldScore: number, fixtureScoreOnly: boolean, schemaFingerprintPresent: boolean): number {
    if (fixtureScoreOnly) return Math.min(oldScore, 35)
    if (schemaFingerprintPresent) return Math.min(oldScore, 60)
    return 0
}
