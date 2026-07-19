// YouTube Backoff and Culprit Isolation — V17 Packet 6 (§25)
// Rollback order, prompt-triggered immediate disable, culprit isolation protocol.

import { type RiskClass } from "./youtube-cosmetic-cleanup"

export const DEFAULT_ROLLBACK_ORDER: RiskClass[] = [
  "SHADOW_DOM_COSMETIC_CLEANUP",
  "LIGHT_DOM_COSMETIC_CLEANUP",
  "FEED_COSMETIC_CLEANUP",
  "INTERSTITIAL_CLEANUP",
  "SHORTS_CLEANUP",
  "DOCUMENT_WRITE_WRAPPER",
  "DOCUMENT_STREAM_WRAPPER",
  "DYNAMIC_SCRIPT_INSERTION_WRAPPER",
]

export const PROMPT_IMMEDIATE_DISABLE: RiskClass[] = [
  "SHADOW_DOM_COSMETIC_CLEANUP",
  "LIGHT_DOM_COSMETIC_CLEANUP",
]

export interface BackoffState {
  active: boolean
  disabledClasses: Set<RiskClass>
  suspectGroup: RiskClass | null
  isolationStep: number
  healthObservationMs: number
  healthObservationStart: number
}

export function createBackoffState(): BackoffState {
    return {
    active: false,
    disabledClasses: new Set(),
    suspectGroup: null,
    isolationStep: 0,
    healthObservationMs: 30_000,
    healthObservationStart: 0,
    }
}

export function enterBackoff(
    state: BackoffState,
    promptDetected: boolean,
    now: number,
): BackoffState {
    const disabled = new Set(state.disabledClasses)

    if (promptDetected) {
        for (const cls of PROMPT_IMMEDIATE_DISABLE) {
      disabled.add(cls)
        }
    }

    return {
    ...state,
    active: true,
    disabledClasses: disabled,
    isolationStep: 0,
    healthObservationStart: now,
    }
}

export function advanceIsolation(
    state: BackoffState,
    healthRecovered: boolean,
    now: number,
): { newState: BackoffState; action: "rollback" | "isolate" | "suspect" | "completed" } {
    if (!state.active) {
        return { newState: state, action: "completed" }
    }

    if (healthRecovered) {
        if (state.isolationStep === 0) {
            return { newState: { ...state, active: false, suspectGroup: null }, action: "completed" }
        }
        const suspectGroup = DEFAULT_ROLLBACK_ORDER[state.isolationStep - 1] ?? null
        return {
      newState: { ...state, active: false, suspectGroup },
      action: "suspect",
        }
    }

    const nextStep = state.isolationStep
    const nextClass = DEFAULT_ROLLBACK_ORDER[nextStep]

    if (!nextClass) {
        return { newState: { ...state, active: false, isolationStep: nextStep }, action: "rollback" }
    }

    const newDisabled = new Set(state.disabledClasses)
  newDisabled.add(nextClass)

  return {
    newState: {
      ...state,
      disabledClasses: newDisabled,
      isolationStep: nextStep + 1,
      healthObservationStart: now,
    },
    action: "isolate",
  }
}

export function isModuleDisabled(
    state: BackoffState,
    riskClass: RiskClass,
): boolean {
    return state.disabledClasses.has(riskClass)
}

export function anyCosmeticDisabled(state: BackoffState): boolean {
    return PROMPT_IMMEDIATE_DISABLE.some(cls => state.disabledClasses.has(cls))
}

export function getDisabledClasses(state: BackoffState): RiskClass[] {
    return Array.from(state.disabledClasses)
}

export function binaryIsolation(
    state: BackoffState,
    modules: RiskClass[],
    half: boolean,
): { disabled: RiskClass[]; remaining: RiskClass[] } {
    const mid = Math.ceil(modules.length / 2)
    const disabled = half ? modules.slice(0, mid) : modules.slice(mid)
    const remaining = half ? modules.slice(mid) : modules.slice(0, mid)
    return { disabled, remaining }
}

export function resolveBackoff(
    state: BackoffState,
    now: number,
    promptScore: number,
): BackoffState {
    if (!state.active) return state

    const elapsed = now - state.healthObservationStart
    if (elapsed < state.healthObservationMs) return state

    if (promptScore >= 80) {
        const newDisabled = new Set(state.disabledClasses)
        for (const cls of PROMPT_IMMEDIATE_DISABLE) {
      newDisabled.add(cls)
        }
        return { ...state, disabledClasses: newDisabled, healthObservationStart: now }
    }

    return { ...state, active: false }
}
