/*
 * YouTube V17 Main-World Bootstrap — §46.1, §12.5
 * Runs in the page's MAIN world. Orchestrates readiness probe, capability probe,
 * wrapper manager, and capture accessor. Connects to SW via BroadcastChannel.
 */

import { runCapabilityProbe } from "../youtube/youtube-mainworld-capability"
import { waitForReadiness, generateNonce } from "../youtube/youtube-readiness-probe"
import { createWrapperManager, captureAccessor } from "../youtube/youtube-wrapper-manager"
import { collectHookRaceTelemetry } from "../youtube/youtube-hook-race-telemetry"
import { recordEvent, createDiagnosticsState } from "../youtube/youtube-diagnostics"

const BOOTSTRAP_CHANNEL = "youtube-smart-main"
const NONCE_KEY = "ys_nonce"

function getOrCreateNonce(): string {
    const existing = sessionStorage.getItem(NONCE_KEY)
    if (existing) return existing
    const nonce = generateNonce()
  sessionStorage.setItem(NONCE_KEY, nonce)
  return nonce
}

async function bootstrapMainWorld(): Promise<void> {
    const nonce = getOrCreateNonce()
    const diag = createDiagnosticsState()

    recordEvent(diag, "bootstrap", "main-world bootstrap start")

    const capabilityResult = await runCapabilityProbe()
    recordEvent(diag, "capability", `capability probe: ${JSON.stringify(capabilityResult)}`)

    const readinessResult = await waitForReadiness(nonce, "", "1.0.0", 5000)
    recordEvent(diag, "readiness", `readiness result: ${readinessResult}`)

    const wrapperManager = createWrapperManager()
    const captureResult = captureAccessor(wrapperManager, window, "fetch", "main-world bootstrap", "DOCUMENT_WRITE_WRAPPER")
    recordEvent(diag, "wrapper", `fetch capture: ${captureResult ? "captured" : "skipped"}`)

    const hookTelemetry = collectHookRaceTelemetry({
    mainWorldAvailable: !!capabilityResult,
    contentScriptStartTime: Date.now(),
    mainWorldProbeTime: Date.now(),
    pageType: "WATCH",
    frameContext: "top",
    })
    recordEvent(diag, "hook-race", `hook race telemetry: ${JSON.stringify(hookTelemetry)}`)

    const bc = new BroadcastChannel(BOOTSTRAP_CHANNEL)
  bc.postMessage({
    type: "main-world-ready",
    nonce,
    capability: capabilityResult,
    readiness: readinessResult,
    wrapperCount: wrapperManager.getActiveCount(),
    hookRace: hookTelemetry,
    diagnostics: diag.events.length,
  })

  navigator.serviceWorker?.controller?.postMessage({
    type: "youtube-smart-ready",
    nonce,
    source: "main-world",
  })
}

if (document.readyState === "complete" || document.readyState === "interactive") {
  void bootstrapMainWorld()
} else {
  document.addEventListener("DOMContentLoaded", () => { void bootstrapMainWorld() })
}
