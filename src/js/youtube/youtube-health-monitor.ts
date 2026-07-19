// YouTube Player Health Monitor — V17 Packet 6 (§24, §54.2)
// Health signal collection and dynamic tick interval management.

import { type HealthState } from "./youtube-risk"

export interface HealthSignals {
  videoElementExists: boolean
  readyStateHealthy: boolean
  currentTimeAdvances: boolean
  noPersistentSpinner: boolean
  noFatalError: boolean
  playerControlsUsable: boolean
  commentsReachable: boolean
  descriptionReachable: boolean
  mastheadSearchVisible: boolean
  spaNavigationWorks: boolean
  antiBlockPromptAbsent: boolean
}

export const DEFAULT_HEALTH_SIGNALS: HealthSignals = {
  videoElementExists: true,
  readyStateHealthy: true,
  currentTimeAdvances: true,
  noPersistentSpinner: true,
  noFatalError: true,
  playerControlsUsable: true,
  commentsReachable: true,
  descriptionReachable: true,
  mastheadSearchVisible: true,
  spaNavigationWorks: true,
  antiBlockPromptAbsent: true,
}

export function computeHealthState(signals: HealthSignals): HealthState {
    if (!signals.antiBlockPromptAbsent) return "PROMPT_DETECTED"
    if (!signals.videoElementExists) return "BROKEN"
    if (signals.noFatalError === false) return "BROKEN"
    if (signals.currentTimeAdvances === false && signals.videoElementExists) return "STUCK"
    if (signals.noPersistentSpinner === false) return "STUCK"
    if (!signals.readyStateHealthy) return "DEGRADED"
    if (!signals.playerControlsUsable) return "DEGRADED"
    if (!signals.commentsReachable) return "DEGRADED"

    let healthyCount = 0
    if (signals.videoElementExists) healthyCount++
    if (signals.readyStateHealthy) healthyCount++
    if (signals.currentTimeAdvances) healthyCount++
    if (signals.noPersistentSpinner) healthyCount++
    if (signals.noFatalError) healthyCount++
    if (signals.playerControlsUsable) healthyCount++
    if (signals.commentsReachable) healthyCount++
    if (signals.descriptionReachable) healthyCount++
    if (signals.mastheadSearchVisible) healthyCount++
    if (signals.spaNavigationWorks) healthyCount++
    if (signals.antiBlockPromptAbsent) healthyCount++

    return healthyCount >= 9 ? "HEALTHY" : "DEGRADED"
}

export interface TickConfig {
  baseIntervalMs: number
  currentIntervalMs: number
  consecutiveHealthyTicks: number
  consecutiveRecoveryTicks: number
  recoveryMode: boolean
  hidden: boolean
}

export type PageCategory = "WATCH" | "BROWSE" | "SHORTS" | "EMBED"

export function getBaseInterval(pageCategory: PageCategory): number {
    switch (pageCategory) {
    case "WATCH": return 1000
    case "BROWSE": return 2000
    case "SHORTS": return 2000
    case "EMBED": return 5000
    }
}

export function computeTickInterval(
    config: TickConfig,
    health: HealthState,
): TickConfig {
    if (config.hidden) {
        return { ...config, currentIntervalMs: config.baseIntervalMs, consecutiveHealthyTicks: 0, consecutiveRecoveryTicks: 0, recoveryMode: false }
    }

    let consecutiveHealthyTicks = config.consecutiveHealthyTicks
    let consecutiveRecoveryTicks = config.consecutiveRecoveryTicks
    let recoveryMode = config.recoveryMode

    if (health === "HEALTHY") {
        consecutiveHealthyTicks++
        consecutiveRecoveryTicks = 0
        recoveryMode = false
    } else if (health === "PROMPT_DETECTED" || health === "BROKEN") {
        consecutiveHealthyTicks = 0
        consecutiveRecoveryTicks++
        recoveryMode = true
    } else {
        consecutiveHealthyTicks = 0
    }

    let currentIntervalMs = config.baseIntervalMs

    if (recoveryMode && consecutiveRecoveryTicks <= 10) {
        currentIntervalMs = Math.min(currentIntervalMs, 500)
    }

    if (consecutiveHealthyTicks >= 10 && !recoveryMode) {
        currentIntervalMs = Math.max(currentIntervalMs, 2000)
    }

    return {
    ...config,
    currentIntervalMs,
    consecutiveHealthyTicks,
    consecutiveRecoveryTicks,
    recoveryMode,
    }
}

export interface HealthMonitorState {
  currentHealth: HealthState
  lastSignal: HealthSignals
  tickConfig: TickConfig
  healthHistory: HealthState[]
}

export function createHealthMonitorState(
    pageCategory: PageCategory,
    initialSignals?: Partial<HealthSignals>,
): HealthMonitorState {
    const signals = { ...DEFAULT_HEALTH_SIGNALS, ...initialSignals }
    return {
    currentHealth: computeHealthState(signals),
    lastSignal: signals,
    tickConfig: {
      baseIntervalMs: getBaseInterval(pageCategory),
      currentIntervalMs: getBaseInterval(pageCategory),
      consecutiveHealthyTicks: 0,
      consecutiveRecoveryTicks: 0,
      recoveryMode: false,
      hidden: false,
    },
    healthHistory: [],
    }
}

export function recordHealthTick(
    state: HealthMonitorState,
    signals: HealthSignals,
    now: number,
): HealthMonitorState {
    const health = computeHealthState(signals)
    const healthHistory = [...state.healthHistory, health].slice(-100)
    const tickConfig = computeTickInterval(state.tickConfig, health)

    return {
    ...state,
    currentHealth: health,
    lastSignal: signals,
    tickConfig,
    healthHistory,
    }
}

export function isHealthNormal(state: HealthMonitorState): boolean {
    return state.currentHealth === "HEALTHY" || state.currentHealth === "DEGRADED"
}

export function healthTriggersBackoff(state: HealthMonitorState): boolean {
    return state.currentHealth === "PROMPT_DETECTED"
    || state.currentHealth === "BROKEN"
    || state.currentHealth === "STUCK"
}

export function visibilityPause(state: HealthMonitorState, hidden: boolean): HealthMonitorState {
    return {
    ...state,
    tickConfig: { ...state.tickConfig, hidden },
    }
}
