// YouTube Surrogate Eligibility — V17 Phase 0
// SRI/CORS/preflight/redirect-chain eligibility checks.

export type SurrogateEligibility = "ELIGIBLE" | "INELIGIBLE_SRI" | "INELIGIBLE_CORS" | "INELIGIBLE_REDIRECT_CHAIN" | "NEEDS_FIXTURE"

export interface SurrogateCandidate {
  endpoint: string
  surrogatePath: string
  hasSRI: boolean
  isScriptOrStyle: boolean
  isJsonOrApi: boolean
  corsMode: string
  redirectChain: string[]
}

export function checkSurrogateEligibility(candidate: SurrogateCandidate): SurrogateEligibility {
    // Never redirect SRI-protected scripts/styles
    if (candidate.hasSRI && candidate.isScriptOrStyle) {
        return "INELIGIBLE_SRI"
    }

    // JSON/API surrogates need CORS validation
    if (candidate.isJsonOrApi) {
        if (candidate.corsMode !== "cors" && candidate.corsMode !== "same-origin") {
            return "INELIGIBLE_CORS"
        }
        return "NEEDS_FIXTURE"
    }

    // Redirect chains need endpoint ownership fixtures
    if (candidate.redirectChain.length > 1) {
        const hasUnknown = candidate.redirectChain.some(url => !url.startsWith("https://www.youtube.com/") && !url.startsWith("https://doubleclick.net/"))
        if (hasUnknown) {
            return "INELIGIBLE_REDIRECT_CHAIN"
        }
    }

    return "ELIGIBLE"
}
