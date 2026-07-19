// YouTube CORS Preflight Policy — V17 Packet 8 (§60.4)
// CORS preflight handling for surrogate API/JSON endpoints.

export interface CorsPreflightFixture {
  requestMethod: string
  requestMode: string
  credentialsMode: string
  originHeaderPresent: boolean
  accessControlRequestMethod: string | null
  accessControlRequestHeaders: string | null
  responseAccessControlAllowOrigin: string
  responseAccessControlAllowCredentials: boolean
  responseAccessControlAllowHeaders: string | null
  responseAccessControlAllowMethods: string | null
  preflightCacheBehavior: string
}

export interface CorsPreflightDecision {
  allowed: boolean
  reason: string
  surrogateEligible: boolean
}

export const DEFAULT_CORS_POLICY = {
  optionsAllowByDefault: true,
  doNotRedirectOptions: true,
  requirePreflightParity: true,
  failOpenOnParityFailure: true,
}

export const KNOWN_API_FIXTURES: CorsPreflightFixture[] = [
  {
    requestMethod: "POST",
    requestMode: "cors",
    credentialsMode: "include",
    originHeaderPresent: true,
    accessControlRequestMethod: "POST",
    accessControlRequestHeaders: "content-type,authorization",
    responseAccessControlAllowOrigin: "https://www.youtube.com",
    responseAccessControlAllowCredentials: true,
    responseAccessControlAllowHeaders: "content-type,authorization",
    responseAccessControlAllowMethods: "POST,OPTIONS",
    preflightCacheBehavior: "cache-3600",
  },
  {
    requestMethod: "GET",
    requestMode: "cors",
    credentialsMode: "include",
    originHeaderPresent: true,
    accessControlRequestMethod: null,
    accessControlRequestHeaders: null,
    responseAccessControlAllowOrigin: "https://www.youtube.com",
    responseAccessControlAllowCredentials: true,
    responseAccessControlAllowHeaders: null,
    responseAccessControlAllowMethods: "GET,OPTIONS",
    preflightCacheBehavior: "cache-3600",
  },
]

export function isOptionsRequest(method: string): boolean {
    return method.toUpperCase() === "OPTIONS"
}

export function shouldAllowOptionsRequest(
    url: string,
    method: string,
    hasFixture: boolean,
): CorsPreflightDecision {
    if (!isOptionsRequest(method)) {
        return { allowed: true, reason: "not_options", surrogateEligible: true }
    }

    if (hasFixture) {
        return { allowed: true, reason: "options_with_fixture", surrogateEligible: true }
    }

    return {
    allowed: true,
    reason: "options_default_allow",
    surrogateEligible: false,
    }
}

export function evaluateSurrogateCorsParity(
    fixture: CorsPreflightFixture,
    observed: Partial<CorsPreflightFixture>,
): { parity: boolean; mismatches: string[] } {
    const mismatches: string[] = []

    if (observed.responseAccessControlAllowOrigin !== undefined &&
      observed.responseAccessControlAllowOrigin !== fixture.responseAccessControlAllowOrigin) {
    mismatches.push("access-control-allow-origin")
    }

    if (observed.responseAccessControlAllowCredentials !== undefined &&
      observed.responseAccessControlAllowCredentials !== fixture.responseAccessControlAllowCredentials) {
    mismatches.push("access-control-allow-credentials")
    }

    if (observed.responseAccessControlAllowMethods !== undefined &&
      observed.responseAccessControlAllowMethods !== fixture.responseAccessControlAllowMethods) {
    mismatches.push("access-control-allow-methods")
    }

    if (observed.responseAccessControlAllowHeaders !== undefined &&
      observed.responseAccessControlAllowHeaders !== fixture.responseAccessControlAllowHeaders) {
    mismatches.push("access-control-allow-headers")
    }

    return { parity: mismatches.length === 0, mismatches }
}

export function shouldSuppressSurrogate(
    originalPreflightSucceeds: boolean,
    surrogateChangesCors: boolean,
): boolean {
    if (!originalPreflightSucceeds) return true
    if (surrogateChangesCors) return true
    return false
}

export function selectCorsAction(
    isPreflight: boolean,
    hasFixture: boolean,
    preflightSucceeds: boolean,
    surrogateChangesCors: boolean,
): "ALLOW" | "SURROGATE_WITH_VALIDATION" | "ALLOW_WITH_SANITIZER" {
    if (isPreflight) return "ALLOW"

    if (!preflightSucceeds) return "ALLOW_WITH_SANITIZER"

    if (surrogateChangesCors) return "ALLOW_WITH_SANITIZER"

    if (hasFixture) return "SURROGATE_WITH_VALIDATION"

    return "ALLOW"
}

export function getCorsActionForEndpoint(
    url: string,
    method: string,
    fixture: CorsPreflightFixture | null,
): CorsPreflightDecision {
    if (isOptionsRequest(method)) {
        return shouldAllowOptionsRequest(url, method, fixture !== null)
    }

    if (!fixture) {
        return { allowed: true, reason: "no_fixture_allow", surrogateEligible: false }
    }

    return { allowed: true, reason: "fixture_match", surrogateEligible: true }
}

