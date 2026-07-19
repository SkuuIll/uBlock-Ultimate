// YouTube MutationObserver Budget & Shadow DOM Observation — V17 Packet 6 (§21.1, §21.2, §54.1)
// Scoped MutationObserver budgets, node batch limits, overflow backoff,
// and Shadow DOM open-root observation.

export interface ObserverRootConfig {
  rootType: "PLAYER_SUBTREE" | "FEED_GRID" | "DOCUMENT_BODY"
  active: boolean
  subtree: boolean
  maxNodesPerBatch: number
  throttleMs: number
  rootDepthLimit: number
}

export const DEFAULT_OBSERVER_CONFIGS: ObserverRootConfig[] = [
  { rootType: "PLAYER_SUBTREE", active: true, subtree: true, maxNodesPerBatch: 200, throttleMs: 200, rootDepthLimit: 3 },
  { rootType: "FEED_GRID", active: false, subtree: true, maxNodesPerBatch: 200, throttleMs: 200, rootDepthLimit: 2 },
  { rootType: "DOCUMENT_BODY", active: false, subtree: true, maxNodesPerBatch: 200, throttleMs: 500, rootDepthLimit: 1 },
]

export const DEFAULT_MAX_NODES_PER_BATCH = 200
export const DEFAULT_HARD_THROTTLE_MS = 200
export const OVERFLOW_BACKOFF_LIMIT = 3
export const OVERFLOW_BACKOFF_WINDOW_MS = 60_000

export type OverflowEvent = "OBSERVER_OVERFLOW" | "OBSERVER_OVERFLOW_BACKOFF"

export interface ObserverBudgetState {
  configs: ObserverRootConfig[]
  overflowCount: number
  overflowWindowStart: number
  backoffActive: boolean
  shadowRootCount: number
  maxShadowRoots: number
  shadowOverflowCount: number
}

export function createObserverBudgetState(): ObserverBudgetState {
    return {
    configs: [...DEFAULT_OBSERVER_CONFIGS],
    overflowCount: 0,
    overflowWindowStart: 0,
    backoffActive: false,
    shadowRootCount: 0,
    maxShadowRoots: 5,
    shadowOverflowCount: 0,
    }
}

export interface ProcessedBatch {
  nodesProcessed: number
  overflow: boolean
  remainingNodes: number
  events: OverflowEvent[]
}

export function processObserverBatch(
    state: ObserverBudgetState,
    nodeCount: number,
    now: number,
): { result: ProcessedBatch; newState: ObserverBudgetState } {
    if (state.backoffActive) {
        return {
      result: { nodesProcessed: 0, overflow: false, remainingNodes: nodeCount, events: [] },
      newState: state,
        }
    }

    if (nodeCount <= DEFAULT_MAX_NODES_PER_BATCH) {
        return {
      result: { nodesProcessed: nodeCount, overflow: false, remainingNodes: 0, events: [] },
      newState: state,
        }
    }

    const remaining = nodeCount - DEFAULT_MAX_NODES_PER_BATCH
    let overflowCount = state.overflowCount + 1
    let overflowWindowStart = state.overflowWindowStart
    const events: OverflowEvent[] = ["OBSERVER_OVERFLOW"]

    if (overflowCount === 1) {
        overflowWindowStart = now
    }

    const elapsed = now - overflowWindowStart
    if (overflowCount >= OVERFLOW_BACKOFF_LIMIT && elapsed <= OVERFLOW_BACKOFF_WINDOW_MS) {
    events.push("OBSERVER_OVERFLOW_BACKOFF")
    return {
      result: { nodesProcessed: DEFAULT_MAX_NODES_PER_BATCH, overflow: true, remainingNodes: remaining, events },
      newState: { ...state, overflowCount: 0, overflowWindowStart: 0, backoffActive: true },
    }
    }

    if (elapsed > OVERFLOW_BACKOFF_WINDOW_MS) {
        overflowCount = 1
        overflowWindowStart = now
    }

    return {
    result: { nodesProcessed: DEFAULT_MAX_NODES_PER_BATCH, overflow: true, remainingNodes: remaining, events },
    newState: { ...state, overflowCount, overflowWindowStart },
    }
}

export interface ShadowRootObservation {
  rootDepth: number
  open: boolean
  playerRelated: boolean
}

export function canObserveShadowRoot(
    state: ObserverBudgetState,
    candidate: ShadowRootObservation,
): boolean {
    if (state.shadowRootCount >= state.maxShadowRoots && !candidate.playerRelated) return false
    if (candidate.rootDepth > 3) return false
    if (!candidate.open) return false
    if (state.shadowOverflowCount >= state.maxShadowRoots) return false
    return true
}

export function observeShadowRoot(
    state: ObserverBudgetState,
): ObserverBudgetState {
    return {
    ...state,
    shadowRootCount: state.shadowRootCount + 1,
    }
}

export function disconnectShadowRoot(
    state: ObserverBudgetState,
): ObserverBudgetState {
    return {
    ...state,
    shadowRootCount: Math.max(0, state.shadowRootCount - 1),
    }
}

export function enableFeedObservation(state: ObserverBudgetState): ObserverBudgetState {
    return {
    ...state,
    configs: state.configs.map(c =>
        c.rootType === "FEED_GRID" ? { ...c, active: true } : c
    ),
    }
}

export function disableFeedObservation(state: ObserverBudgetState): ObserverBudgetState {
    return {
    ...state,
    configs: state.configs.map(c =>
        c.rootType === "FEED_GRID" ? { ...c, active: false } : c
    ),
    }
}

export function disconnectAllObservers(state: ObserverBudgetState): ObserverBudgetState {
    return {
    ...state,
    configs: state.configs.map(c => ({ ...c, active: false })),
    backoffActive: true,
    }
}

export function hasActiveObservers(state: ObserverBudgetState): boolean {
    return state.configs.some(c => c.active) && !state.backoffActive
}

export function isPassiveDomShadowEligible(state: ObserverBudgetState): boolean {
    return state.backoffActive || !hasActiveObservers(state)
}
