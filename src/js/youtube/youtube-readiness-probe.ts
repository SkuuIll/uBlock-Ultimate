// YouTube Readiness Probe — V17 Packet 3
// §12.5.2 Readiness probe delivery, §12.5.2.1 Secure nonce handshake, §12.5.2.2 Hash timing

export const READINESS_GRACE_WINDOW_MS = 250
export const READINESS_EVENT = "uBRYouTubeMainReady"
export const BOOTSTRAP_VERSION = "1.0.0"

export interface ReadinessProbeInput {
  nonce: string
  bootstrapSalt: string
  bootstrapVersion: string
}

export interface ReadinessProbeResult {
  accepted: boolean
  mainWorldAvailable: boolean
  nonceHashMatch: boolean
  bootstrapVersionMatch: boolean
  arrivedLate: boolean
  arrivalMs: number
}

// Generate a cryptographically-random nonce
export function generateNonce(): string {
    const arr = new Uint8Array(16)
    if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(arr)
    } else {
    // Fallback for non-browser environments (testing)
        for (let i = 0; i < 16; i++) arr[i] = Math.floor(Math.random() * 256)
    }
    return Array.from(arr).map(b => b.toString(16).padStart(2, "0")).join("")
}

// Compute expected hash: sha256(nonce + bootstrapSalt + bootstrapVersion)
export async function computeExpectedHash(input: ReadinessProbeInput): Promise<string> {
    const data = new TextEncoder().encode(input.nonce + input.bootstrapSalt + input.bootstrapVersion)
    const hashBuffer = await crypto.subtle.digest("SHA-256", data)
    const hashArray = Array.from(new Uint8Array(hashBuffer))
    return hashArray.map(b => b.toString(16).padStart(2, "0")).join("")
}

export function validateReadinessEvent(
    detail: Record<string, unknown>,
    expectedHash: string,
    currentBootstrapVersion: string,
    startTime: number,
): { accepted: boolean; nonceHashMatch: boolean; bootstrapVersionMatch: boolean; arrivedLate: boolean; arrivalMs: number } {
    const arrival = performance.now()
    const arrivalMs = arrival - startTime
    const arrivedLate = arrivalMs > READINESS_GRACE_WINDOW_MS

    const nonceHashMatch = detail.nonceHash === expectedHash
    const bootstrapVersionMatch = detail.bootstrapVersion === currentBootstrapVersion

    const accepted = nonceHashMatch && bootstrapVersionMatch && !arrivedLate

    return { accepted, nonceHashMatch, bootstrapVersionMatch, arrivedLate, arrivalMs }
}

// §12.5.2.2 — Bounded timing policy
export async function waitForReadiness(
    nonce: string,
    bootstrapSalt: string,
    bootstrapVersion: string,
    timeoutMs: number = READINESS_GRACE_WINDOW_MS,
): Promise<ReadinessProbeResult> {
    const startTime = performance.now()
    const expectedHash = await computeExpectedHash({ nonce, bootstrapSalt, bootstrapVersion })

    return new Promise((resolve) => {
        if (typeof window === "undefined") {
            resolve({ accepted: false, mainWorldAvailable: false, nonceHashMatch: false, bootstrapVersionMatch: false, arrivedLate: false, arrivalMs: 0 })
            return
        }

        const timeout = setTimeout(() => {
      window.removeEventListener(READINESS_EVENT, handler)
      window.removeEventListener("message", messageHandler)
      resolve({ accepted: false, mainWorldAvailable: false, nonceHashMatch: false, bootstrapVersionMatch: false, arrivedLate: false, arrivalMs: performance.now() - startTime })
        }, timeoutMs)

        // Primary channel: CustomEvent
        const handler = (event: Event) => {
            const customEvent = event as CustomEvent
            if (!customEvent.detail) return
            const result = validateReadinessEvent(customEvent.detail as Record<string, unknown>, expectedHash, bootstrapVersion, startTime)
            if (result.accepted) {
                clearTimeout(timeout)
        window.removeEventListener(READINESS_EVENT, handler)
        window.removeEventListener("message", messageHandler)
        resolve({ ...result, mainWorldAvailable: result.accepted })
            }
        }

        // Fallback channel: postMessage
        const messageHandler = (event: MessageEvent) => {
            if (event.data?.source !== "uBRYouTubeMain") return
            if (event.origin !== location.origin) return
            const result = validateReadinessEvent(event.data, expectedHash, bootstrapVersion, startTime)
            if (result.accepted) {
                clearTimeout(timeout)
        window.removeEventListener(READINESS_EVENT, handler)
        window.removeEventListener("message", messageHandler)
        resolve({ ...result, mainWorldAvailable: result.accepted })
            }
        }

    window.addEventListener(READINESS_EVENT, handler)
    window.addEventListener("message", messageHandler)
    })
}

// §12.5.1 — mainWorldAvailable == false → PASSIVE_DOM_SHADOW
export function readinessToShadowMode(available: boolean): string {
    return available ? "INSTRUMENTED_SHADOW" : "PASSIVE_DOM_SHADOW"
}
