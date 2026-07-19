/*
 * YouTube V17 Isolated-World Bootstrap — §46.1, §12.5
 * Runs in the extension's ISOLATED world. Coordinates capability probe,
 * health monitoring setup, and rollback messaging with the SW.
 */

import { createHealthMonitorState, recordHealthTick, type HealthSignals } from "../youtube/youtube-health-monitor"
import { createObserverBudgetState, processObserverBatch } from "../youtube/youtube-observer-budget"
import { createBackoffState, enterBackoff, advanceIsolation } from "../youtube/youtube-backoff"
import { recordEvent, createDiagnosticsState } from "../youtube/youtube-diagnostics"

const BOOTSTRAP_CHANNEL = "youtube-smart-isolated"
const HEALTH_INTERVAL_MS = 30000

let healthMonitor = createHealthMonitorState("WATCH")
let observerBudget = createObserverBudgetState()
let backoff = createBackoffState()
const diag = createDiagnosticsState()
let healthChannel: BroadcastChannel | null = null

recordEvent(diag, "bootstrap", "isolated-world bootstrap start")

async function connectToServiceWorker(): Promise<void> {
    try {
        const response = await chrome.runtime.sendMessage({ what: "youtubeSmartPing", source: "isolated-world" })
        recordEvent(diag, "connect", `SW response: ${JSON.stringify(response)}`)
        return
    } catch (e) {
    console.warn('[uBR] youtube-smart-isolated: connectToServiceWorker failed', e);
    recordEvent(diag, "connect", "SW not reachable, retrying")
    setTimeout(() => { void connectToServiceWorker() }, 1000)
    }
}

function collectHealthSignals(): HealthSignals {
    const video = document.querySelector("video")
    const player = document.querySelector("#movie_player, ytd-player, #player-container")
    const comments = document.querySelector("#comments, ytd-comments")
    const description = document.querySelector("#description, ytd-video-secondary-info-renderer")
    const mastheadSearch = document.querySelector("#masthead input, ytd-searchbox")
    const antiBlock = document.querySelector("ytd-enforcement-message-view-model, tp-yt-paper-dialog")

    return {
    videoElementExists: !!video,
    readyStateHealthy: video ? video.readyState >= 2 : true,
    currentTimeAdvances: true,
    noPersistentSpinner: player ? !player.querySelector('[aria-label="Loading"]') : true,
    noFatalError: !document.querySelector("#error-screen, yt-error-screen"),
    playerControlsUsable: player ? !!player.querySelector(".ytp-chrome-controls") : true,
    commentsReachable: !!comments,
    descriptionReachable: !!description,
    mastheadSearchVisible: !!mastheadSearch,
    spaNavigationWorks: true,
    antiBlockPromptAbsent: !antiBlock,
    }
}

function runHealthCheck(): void {
    const signals = collectHealthSignals()
    healthMonitor = recordHealthTick(healthMonitor, signals, Date.now())

    const healthOk = healthMonitor.currentHealth === "HEALTHY"
    const { newState } = advanceIsolation(backoff, healthOk, Date.now())
    backoff = newState

    if ( !healthChannel ) { healthChannel = new BroadcastChannel(BOOTSTRAP_CHANNEL); }
    healthChannel.postMessage({
    type: "health-tick",
    health: healthMonitor.currentHealth,
    backoffActive: backoff.isolationStep > 0,
    timestamp: Date.now(),
  })
}

function startHealthMonitoring(): void {
    runHealthCheck()
    setInterval(runHealthCheck, HEALTH_INTERVAL_MS)
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.what === "youtubeRollbackRequest") {
      const classesToDisable = message.classes ?? []
      if (classesToDisable.includes("backoff")) {
          backoff = enterBackoff(backoff, true, Date.now())
      }
      sendResponse({ ok: true, backoffLevel: backoff.isolationStep })
      return true
  }

  if (message.what === "youtubeHealthQuery") {
      sendResponse({
      health: healthMonitor.currentHealth,
      backoffLevel: backoff.isolationStep,
      observerOverflow: observerBudget.overflowCount,
      })
      return true
  }

  if (message.what === "youtubeDiagnosticsQuery") {
      sendResponse({ eventCount: diag.events.length })
      return true
  }

  return false
})

void connectToServiceWorker().then(() => {
    startHealthMonitoring()
})
