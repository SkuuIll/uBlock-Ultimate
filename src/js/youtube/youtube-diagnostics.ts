// YouTube Local Diagnostics & Telemetry — V17 Packet 8
// Local-only telemetry, bounded logs, storage pruning, decision paths.

export interface DiagnosticEvent {
  timestamp: number
  category: string
  message: string
  data?: Record<string, unknown>
}

export type DiagnosticCategory =
  | "SANITIZER_DECISION"
  | "RULE_INSTALL"
  | "RULE_INTERFERENCE"
  | "UNKNOWN_CHANGE"
  | "PROMPT_TRANSITION"
  | "HEALTH_TRANSITION"
  | "RISK_TRANSITION"
  | "MAIN_WORLD_CAPABILITY"
  | "WRAPPER_EVENT"
  | "STORAGE_FAILURE"
  | "QUOTA_PRUNING"
  | "PERFORMANCE_BUDGET"
  | "MEMORY_BUDGET"
  | "bootstrap"
  | "connect"
  | "capability"
  | "readiness"
  | "wrapper"
  | "hook-race"

export interface DiagnosticsConfig {
  maxEvents: number
  pruneThreshold: number
  enabledCategories: DiagnosticCategory[]
  storageKey: string
}

export const DEFAULT_DIAGNOSTICS_CONFIG: DiagnosticsConfig = {
  maxEvents: 500,
  pruneThreshold: 400,
  enabledCategories: [
    "SANITIZER_DECISION", "RULE_INSTALL", "RULE_INTERFERENCE",
    "UNKNOWN_CHANGE", "PROMPT_TRANSITION", "HEALTH_TRANSITION",
    "RISK_TRANSITION", "MAIN_WORLD_CAPABILITY",
  ],
  storageKey: "ubrYouTubeDiagnosticsV1",
}

export interface DiagnosticsState {
  events: DiagnosticEvent[]
  config: DiagnosticsConfig
  pruneCount: number
}

export function createDiagnosticsState(config?: Partial<DiagnosticsConfig>): DiagnosticsState {
    return {
    events: [],
    config: { ...DEFAULT_DIAGNOSTICS_CONFIG, ...config },
    pruneCount: 0,
    }
}

export function recordEvent(
    state: DiagnosticsState,
    category: DiagnosticCategory,
    message: string,
    data?: Record<string, unknown>,
): DiagnosticsState {
    if (!state.config.enabledCategories.includes(category)) return state

    const event: DiagnosticEvent = {
    timestamp: Date.now(),
    category,
    message,
    data,
    }

    const events = [...state.events, event]
    return maybePrune({ ...state, events })
}

export function maybePrune(state: DiagnosticsState): DiagnosticsState {
    if (state.events.length <= state.config.maxEvents) return state

    const excess = state.events.length - state.config.pruneThreshold
    const pruned = state.events.slice(excess)
    return {
    ...state,
    events: pruned,
    pruneCount: state.pruneCount + 1,
    }
}

export function pruneByCategory(state: DiagnosticsState, category: DiagnosticCategory): DiagnosticsState {
    return {
    ...state,
    events: state.events.filter(e => e.category !== category),
    }
}

export function pruneByAge(state: DiagnosticsState, maxAgeMs: number): DiagnosticsState {
    const cutoff = Date.now() - maxAgeMs
    return {
    ...state,
    events: state.events.filter(e => e.timestamp >= cutoff),
    }
}

export function getEventsByCategory(state: DiagnosticsState, category: DiagnosticCategory): DiagnosticEvent[] {
    return state.events.filter(e => e.category === category)
}

export function getEventsSince(state: DiagnosticsState, since: number): DiagnosticEvent[] {
    return state.events.filter(e => e.timestamp >= since)
}

export function getLatestEvents(state: DiagnosticsState, count: number): DiagnosticEvent[] {
    return state.events.slice(-count)
}

export function summarizeEvents(state: DiagnosticsState): Record<string, number> {
    const summary: Record<string, number> = {}
    for (const event of state.events) {
        summary[event.category] = (summary[event.category] || 0) + 1
    }
    summary.prune_count = state.pruneCount
    summary.total_events = state.events.length
    return summary
}

export function createSanitizerDecisionEvent(
    endpoint: string,
    action: string,
    shapeConfidence: number,
    reason: string,
): Omit<DiagnosticEvent, "timestamp"> {
    return {
    category: "SANITIZER_DECISION",
    message: `Sanitizer ${action} for ${endpoint}`,
    data: { endpoint, action, shapeConfidence, reason },
    }
}

export function createRuleInstallEvent(
    ruleIds: number[],
    mode: string,
): Omit<DiagnosticEvent, "timestamp"> {
    return {
    category: "RULE_INSTALL",
    message: `Installed ${ruleIds.length} rules in ${mode} mode`,
    data: { ruleCount: ruleIds.length, mode, ruleIds: ruleIds.slice(0, 10) },
    }
}

export function createPromptTransitionEvent(
    fromScore: number,
    toScore: number,
    confidence: string,
    signals: string[],
): Omit<DiagnosticEvent, "timestamp"> {
    return {
    category: "PROMPT_TRANSITION",
    message: `Prompt score ${fromScore} → ${toScore} (${confidence})`,
    data: { fromScore, toScore, confidence, signalCount: signals.length, signals: signals.slice(0, 5) },
    }
}

export function createHealthTransitionEvent(
    from: string,
    to: string,
): Omit<DiagnosticEvent, "timestamp"> {
    return {
    category: "HEALTH_TRANSITION",
    message: `Health ${from} → ${to}`,
    data: { from, to },
    }
}

export function createRiskTransitionEvent(
    from: string,
    to: string,
    reason: string,
): Omit<DiagnosticEvent, "timestamp"> {
    return {
    category: "RISK_TRANSITION",
    message: `Risk ${from} → ${to}: ${reason}`,
    data: { from, to, reason },
    }
}

export function isDiagnosticStorageAvailable(): boolean {
    try {
        return typeof chrome !== "undefined" && chrome.storage !== undefined && chrome.storage.local !== undefined
    } catch (e) {
    console.warn('[uBR] youtube-diagnostics: isDiagnosticStorageAvailable check failed', e)
    return false
    }
}

export function estimateStorageSize(state: DiagnosticsState): number {
    return new TextEncoder().encode(JSON.stringify(state)).length
}

export function shouldPruneStorage(state: DiagnosticsState, maxSizeBytes: number): boolean {
    return estimateStorageSize(state) > maxSizeBytes
}

