// YouTube Anti-Block Prompt Detector — V17 Packet 6 (§22)
// Multi-signal detector using structural scoring, not fragile text matching.

export type PromptConfidence = "NONE" | "SUSPECTED" | "CONFIRMED"

export interface PromptScoreInput {
  modalOverlayPresent: boolean
  playerBlockedOrPaused: boolean
  localizedTextMatch: boolean
  primaryActionButtonVisible: boolean
  knownEnforcementShape: boolean
  dialogRolePresent: boolean
  ariaModalPresent: boolean
  enforcementOverlayNearPlayer: boolean
}

export interface PromptDetectionResult {
  score: number
  confidence: PromptConfidence
  signals: string[]
}

export const PROMPT_CONFIRMED_THRESHOLD = 80
export const PROMPT_SUSPECTED_THRESHOLD = 50

export const PROMPT_SCORE_WEIGHTS = {
  MODAL_OVERLAY: 20,
  PLAYER_BLOCKED: 20,
  TEXT_MATCH: 30,
  ACTION_BUTTON: 10,
  KNOWN_SHAPE: 20,
  DIALOG_ROLE: 15,
  ARIA_MODAL: 15,
  ENFORCEMENT_OVERLAY: 20,
} as const

export const PROMPT_SIGNAL_NAMES: Record<string, string> = {
  modalOverlayPresent: "modal_overlay",
  playerBlockedOrPaused: "player_blocked",
  localizedTextMatch: "ad_blocker_text",
  primaryActionButtonVisible: "action_button",
  knownEnforcementShape: "known_enforcement_shape",
  dialogRolePresent: "dialog_role",
  ariaModalPresent: "aria_modal",
  enforcementOverlayNearPlayer: "enforcement_overlay",
}

export function scorePromptSignals(input: PromptScoreInput): PromptDetectionResult {
    let score = 0
    const signals: string[] = []

    if (input.modalOverlayPresent) {
        score += PROMPT_SCORE_WEIGHTS.MODAL_OVERLAY
    signals.push("modal_overlay")
    }
    if (input.playerBlockedOrPaused) {
        score += PROMPT_SCORE_WEIGHTS.PLAYER_BLOCKED
    signals.push("player_blocked")
    }
    if (input.localizedTextMatch) {
        score += PROMPT_SCORE_WEIGHTS.TEXT_MATCH
    signals.push("ad_blocker_text")
    }
    if (input.primaryActionButtonVisible) {
        score += PROMPT_SCORE_WEIGHTS.ACTION_BUTTON
    signals.push("action_button")
    }
    if (input.knownEnforcementShape) {
        score += PROMPT_SCORE_WEIGHTS.KNOWN_SHAPE
    signals.push("known_enforcement_shape")
    }
    if (input.dialogRolePresent) {
        score += PROMPT_SCORE_WEIGHTS.DIALOG_ROLE
    signals.push("dialog_role")
    }
    if (input.ariaModalPresent) {
        score += PROMPT_SCORE_WEIGHTS.ARIA_MODAL
    signals.push("aria_modal")
    }
    if (input.enforcementOverlayNearPlayer) {
        score += PROMPT_SCORE_WEIGHTS.ENFORCEMENT_OVERLAY
    signals.push("enforcement_overlay")
    }

    let confidence: PromptConfidence = "NONE"
    if (score >= PROMPT_CONFIRMED_THRESHOLD) confidence = "CONFIRMED"
    else if (score >= PROMPT_SUSPECTED_THRESHOLD) confidence = "SUSPECTED"

    return { score, confidence, signals }
}

export interface PromptDetectorState {
  score: number
  confidence: PromptConfidence
  signalHistory: string[]
  suspicionWindowStart: number
  consecutiveConfirmations: number
  disabled: boolean
}

export function createPromptDetectorState(): PromptDetectorState {
    return {
    score: 0,
    confidence: "NONE",
    signalHistory: [],
    suspicionWindowStart: 0,
    consecutiveConfirmations: 0,
    disabled: false,
    }
}

export function updatePromptDetectorState(
    state: PromptDetectorState,
    result: PromptDetectionResult,
    now: number,
): PromptDetectorState {
    if (state.disabled) return state

    const signalHistory = [...state.signalHistory, ...result.signals].slice(-50)
    const suspicionWindowStart = result.confidence !== "NONE"
        ? (state.suspicionWindowStart === 0 ? now : state.suspicionWindowStart)
        : state.suspicionWindowStart

    const consecutiveConfirmations = result.confidence === "CONFIRMED"
        ? state.consecutiveConfirmations + 1
        : 0

    return {
    ...state,
    score: result.score,
    confidence: result.confidence,
    signalHistory,
    suspicionWindowStart,
    consecutiveConfirmations,
    }
}

export function promptTriggersImmediateBackoff(state: PromptDetectorState): boolean {
    return state.confidence === "CONFIRMED"
}

export function promptTriggersDisableCosmetic(state: PromptDetectorState): boolean {
    return state.confidence === "CONFIRMED" || state.confidence === "SUSPECTED"
}

export function promptDisablesLocalComplete(state: PromptDetectorState): boolean {
    return state.confidence === "CONFIRMED"
}

export function classifyPromptConfidence(score: number): PromptConfidence {
    if (score >= PROMPT_CONFIRMED_THRESHOLD) return "CONFIRMED"
    if (score >= PROMPT_SUSPECTED_THRESHOLD) return "SUSPECTED"
    return "NONE"
}
