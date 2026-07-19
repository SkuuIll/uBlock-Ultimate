// YouTube Main-World Capability Probe — V17 Packet 3
// §46 MainWorldCapabilityProbe, §60.7 detectability containment

export type CapabilityResult =
  | "MAIN_WORLD_CAPABLE_CLEAN"
  | "MAIN_WORLD_CAPABLE_DOM_VISIBLE"
  | "MAIN_WORLD_UNAVAILABLE"
  | "MAIN_WORLD_PROBE_FAILED"
  | "MAIN_WORLD_COMMUNICATION_FAILED"

export interface CapabilityProbeResult {
  result: CapabilityResult
  domVisibleScriptElementCreated: boolean
  persistentChromeExtensionURLVisible: boolean
  temporaryChromeExtensionURLVisible: boolean
  probeRoundTripMs: number
  mainWorldExecuted: boolean
  mainWorldActuallyPageWorld: boolean
  browserName?: string
  browserVersion?: string
}

// §46.1 Required probe sequence
export async function runCapabilityProbe(timeoutMs: number = 250): Promise<CapabilityProbeResult> {
    const start = performance.now()
    let mainWorldExecuted = false
    let mainWorldActuallyPageWorld = false
    let domVisible = false
    let persistentURLVisible = false
    let temporaryURLVisible = false

    // Scan for pre-existing extension-origin scripts before probe
    if (typeof document !== "undefined") {
        for (const script of document.scripts) {
            if (script.src && script.src.startsWith("chrome-extension://")) {
                persistentURLVisible = true
                domVisible = true
            }
        }
    }

    // Attempt probe execution
    try {
        const result = await attemptMinimalBootstrap(timeoutMs)
        mainWorldExecuted = result.executed
        mainWorldActuallyPageWorld = result.inPageWorld
        if (result.domVisibleExtensionOrigin) {
            domVisible = true
            temporaryURLVisible = true
        }
    } catch (e) {
    console.warn('[uBR] youtube-mainworld-capability: probeMainWorldCapability bootstrap failed', e)
    return {
      result: "MAIN_WORLD_PROBE_FAILED",
      domVisibleScriptElementCreated: false,
      persistentChromeExtensionURLVisible: persistentURLVisible,
      temporaryChromeExtensionURLVisible: false,
      probeRoundTripMs: performance.now() - start,
      mainWorldExecuted: false,
      mainWorldActuallyPageWorld: false,
    }
    }

    const elapsed = performance.now() - start

    if (!mainWorldExecuted) {
        return {
      result: "MAIN_WORLD_UNAVAILABLE",
      domVisibleScriptElementCreated: domVisible,
      persistentChromeExtensionURLVisible: persistentURLVisible,
      temporaryChromeExtensionURLVisible: temporaryURLVisible,
      probeRoundTripMs: elapsed,
      mainWorldExecuted: false,
      mainWorldActuallyPageWorld: false,
        }
    }

    if (!mainWorldActuallyPageWorld) {
        return {
      result: "MAIN_WORLD_COMMUNICATION_FAILED",
      domVisibleScriptElementCreated: domVisible,
      persistentChromeExtensionURLVisible: persistentURLVisible,
      temporaryChromeExtensionURLVisible: temporaryURLVisible,
      probeRoundTripMs: elapsed,
      mainWorldExecuted: true,
      mainWorldActuallyPageWorld: false,
        }
    }

    if (domVisible) {
        return {
      result: "MAIN_WORLD_CAPABLE_DOM_VISIBLE",
      domVisibleScriptElementCreated: domVisible,
      persistentChromeExtensionURLVisible: persistentURLVisible,
      temporaryChromeExtensionURLVisible: temporaryURLVisible,
      probeRoundTripMs: elapsed,
      mainWorldExecuted: true,
      mainWorldActuallyPageWorld: true,
        }
    }

    return {
    result: "MAIN_WORLD_CAPABLE_CLEAN",
    domVisibleScriptElementCreated: false,
    persistentChromeExtensionURLVisible: false,
    temporaryChromeExtensionURLVisible: false,
    probeRoundTripMs: elapsed,
    mainWorldExecuted: true,
    mainWorldActuallyPageWorld: true,
    }
}

// §46.1 minimal main-world bootstrap
async function attemptMinimalBootstrap(timeoutMs: number): Promise<{ executed: boolean; inPageWorld: boolean; domVisibleExtensionOrigin: boolean }> {
    return new Promise((resolve) => {
        if (typeof document === "undefined" || typeof window === "undefined") {
            resolve({ executed: false, inPageWorld: false, domVisibleExtensionOrigin: false })
            return
        }

        const marker = `__uBR_capability_probe_${  Math.random().toString(36).slice(2)}`
        const timeout = setTimeout(() => {
            resolve({ executed: false, inPageWorld: false, domVisibleExtensionOrigin: false })
        }, timeoutMs)

        const handler = (event: MessageEvent) => {
            if (event.data?.source === "uBRYouTubeMain" && event.data?.type === "CAPABILITY_PROBE_RESULT" && event.data?.marker === marker) {
                clearTimeout(timeout)
        window.removeEventListener("message", handler)
        resolve({
          executed: true,
          inPageWorld: event.data.inPageWorld === true,
          domVisibleExtensionOrigin: event.data.domVisible === true,
        })
            }
        }

    window.addEventListener("message", handler)

    // Send probe request to main world
    // The main-world bootstrap would set window[marker] = true
    // We check briefly if proxy mechanism allows round-trip
    try {
      window.postMessage({
        source: "uBRYouTubeIsolated",
        type: "CAPABILITY_PROBE",
        marker,
      }, location.origin)
    } catch (e) {
      console.warn('[uBR] youtube-mainworld-capability: postMessage probe failed', e)
      clearTimeout(timeout)
      window.removeEventListener("message", handler)
      resolve({ executed: false, inPageWorld: false, domVisibleExtensionOrigin: false })
    }
    })
}

// §60.7 — Run at most once per full document lifecycle
let cachedProbe: CapabilityProbeResult | null = null

export function getCachedProbe(): CapabilityProbeResult | null {
    return cachedProbe
}

export function setCachedProbe(result: CapabilityProbeResult): void {
    cachedProbe = result
}

export function clearCachedProbe(): void {
    cachedProbe = null
}

// §46.2 — DOM-visible extension-origin detection
export function scanForExtensionOriginScripts(): { hasExtensionOriginScript: boolean; scripts: string[] } {
    const found: string[] = []
    if (typeof document === "undefined") return { hasExtensionOriginScript: false, scripts: [] }
    for (const script of document.scripts) {
        if (script.src && script.src.includes("chrome-extension://")) {
      found.push(script.src)
        }
    }
    return { hasExtensionOriginScript: found.length > 0, scripts: found }
}

// §46.3 — Combined gate
export interface MainWorldGateInput {
  capabilityOk: boolean
  readinessAccepted: boolean
  hookRacePermitsEarlyAccessors: boolean
  shapeConfidencePermits: boolean
  riskLevelPermits: boolean
}

export function mainWorldActiveAllowed(input: MainWorldGateInput): boolean {
    if (!input.capabilityOk) return false
    if (!input.readinessAccepted) return false
    if (!input.hookRacePermitsEarlyAccessors) return false
    if (!input.shapeConfidencePermits) return false
    if (!input.riskLevelPermits) return false
    return true
}
