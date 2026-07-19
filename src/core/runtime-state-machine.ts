export type RuntimeLayer = "cosmetic" | "smart" | "video" | "interceptors"

export type RuntimeState =
  | "unloaded"
  | "policy-requested"
  | "policy-denied"
  | "activating"
  | "active"
  | "deactivating"
  | "deactivated"
  | "revoked"
  | "failed-safe"

export const ALL_STATES: RuntimeState[] = [
  "unloaded",
  "policy-requested",
  "policy-denied",
  "activating",
  "active",
  "deactivating",
  "deactivated",
  "revoked",
  "failed-safe",
]

const TRANSITIONS: Record<RuntimeState, RuntimeState[]> = {
  unloaded: ["policy-requested"],
  "policy-requested": ["policy-denied", "activating"],
  "policy-denied": ["deactivated"],
  activating: ["active", "failed-safe"],
  active: ["deactivating", "revoked", "failed-safe"],
  deactivating: ["deactivated"],
  deactivated: ["policy-requested"],
  revoked: ["deactivated"],
  "failed-safe": ["deactivated"],
}

const ALLOWED_MUTATION_STATES: Set<RuntimeState> = new Set(["active"])
const ALLOWED_CLEANUP_STATES: Set<RuntimeState> = new Set(["revoked", "failed-safe", "deactivating", "deactivated"])
const ALLOWED_ACTIVATION_STATES: Set<RuntimeState> = new Set(["activating"])

export function isValidTransition(from: RuntimeState, to: RuntimeState): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false
}

export function transitionOrThrow(from: RuntimeState, to: RuntimeState, layer: RuntimeLayer): RuntimeState {
  if (!isValidTransition(from, to)) {
    throw new Error(
      `Invalid state transition for layer "${layer}": ${from} → ${to}`
    )
  }
  return to
}

export function canMutate(state: RuntimeState): boolean {
  return ALLOWED_MUTATION_STATES.has(state)
}

export function canCleanup(state: RuntimeState): boolean {
  return ALLOWED_CLEANUP_STATES.has(state)
}

export function isActivationInProgress(state: RuntimeState): boolean {
  return ALLOWED_ACTIVATION_STATES.has(state)
}
