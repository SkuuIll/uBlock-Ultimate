// YouTube Redirect-Chain Handling — V17 Packet 8 (§60.3)
// Endpoint redirect-chain awareness for DNR surrogates and safe-block rules.

export interface RedirectChainFixture {
  initialUrlPattern: string
  observedRedirectStatusCodes: number[]
  observedLocationHostPatterns: string[]
  finalUrlPatterns: string[]
  resourceType: string
  initiatorDomain: string
  frameContext: string
  monitoredByDefault: boolean
  sriObserved: boolean
  corsPreflightObserved: boolean
}

export interface RedirectChainResult {
  initialUrl: string
  redirectChain: string[]
  finalUrl: string
  known: boolean
  action: "SURROGATE" | "SAFE_BLOCK" | "ALLOW" | "SHADOW_OBSERVE" | "UNKNOWN_REDIRECT_FINAL"
  reason: string
}

export const KNOWN_REDIRECT_FIXTURES: RedirectChainFixture[] = [
  {
    initialUrlPattern: "*://*.doubleclick.net/*/ad*",
    observedRedirectStatusCodes: [302, 307],
    observedLocationHostPatterns: ["*.doubleclick.net", "*.google.com"],
    finalUrlPatterns: ["*://*.doubleclick.net/*"],
    resourceType: "script",
    initiatorDomain: "youtube.com",
    frameContext: "top_level",
    monitoredByDefault: true,
    sriObserved: false,
    corsPreflightObserved: false,
  },
  {
    initialUrlPattern: "*://googleads.g.doubleclick.net/*",
    observedRedirectStatusCodes: [302],
    observedLocationHostPatterns: ["*.doubleclick.net"],
    finalUrlPatterns: ["*://*.doubleclick.net/*"],
    resourceType: "image",
    initiatorDomain: "youtube.com",
    frameContext: "top_level",
    monitoredByDefault: true,
    sriObserved: false,
    corsPreflightObserved: false,
  },
]

export function classifyRedirectChain(
    initialUrl: string,
    redirectChain: string[],
    fixtures: RedirectChainFixture[],
): RedirectChainResult {
    const finalUrl = redirectChain.length > 0 ? redirectChain[redirectChain.length - 1] : initialUrl

    const chainStr = [initialUrl, ...redirectChain].join(" -> ")

    for (const fixture of fixtures) {
        const pattern = new RegExp(fixture.initialUrlPattern.replace(/\./g, "\\.").replace(/\*/g, ".*"))
        if (!pattern.test(initialUrl)) continue

        const finalMatch = fixture.finalUrlPatterns.some(fp => {
            const fpPattern = new RegExp(fp.replace(/\./g, "\\.").replace(/\*/g, ".*"))
            return fpPattern.test(finalUrl)
        })

        if (finalMatch) {
            if (fixture.monitoredByDefault) {
                return {
          initialUrl, redirectChain, finalUrl, known: true,
          action: "ALLOW", reason: "redirect_known_monitored",
                }
            }
            return {
        initialUrl, redirectChain, finalUrl, known: true,
        action: "SURROGATE", reason: "redirect_known_surrogate_eligible",
            }
        }

        return {
      initialUrl, redirectChain, finalUrl, known: false,
      action: "UNKNOWN_REDIRECT_FINAL", reason: "redirect_final_unknown",
        }
    }

    return {
    initialUrl, redirectChain, finalUrl, known: false,
    action: "ALLOW", reason: "redirect_no_fixture_allow",
    }
}

export function recordRedirectChainResult(
    result: RedirectChainResult,
    fixtures: RedirectChainFixture[],
): RedirectChainFixture[] {
    if (result.action !== "UNKNOWN_REDIRECT_FINAL") return fixtures

    const newFixture: RedirectChainFixture = {
    initialUrlPattern: result.initialUrl.replace(/\/\d+/g, "/*"),
    observedRedirectStatusCodes: [302],
    observedLocationHostPatterns: [],
    finalUrlPatterns: [result.finalUrl.replace(/\/\d+/g, "/*")],
    resourceType: "unknown",
    initiatorDomain: "youtube.com",
    frameContext: "top_level",
    monitoredByDefault: true,
    sriObserved: false,
    corsPreflightObserved: false,
    }

    return [...fixtures, newFixture]
}

export function isRedirectSafeToBlock(chain: string[], fixtures: RedirectChainFixture[]): boolean {
    if (chain.length === 0) return true
    const result = classifyRedirectChain(chain[0], chain.slice(1), fixtures)
    return result.known && (result.action === "SURROGATE" || result.action === "SAFE_BLOCK")
}

export function shouldBroadenUrlPattern(pattern: string, fixtureCount: number): boolean {
    if (fixtureCount < 3) return false
    return true
}

