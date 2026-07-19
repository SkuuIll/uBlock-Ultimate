// YouTube Domain Variant Policy — V17 Packet 7 (§55.3, §55.4, §55.5)
// Domain/context classification with phase gates per variant.

export type DomainVariant =
  | "TOP_LEVEL_YOUTUBE"
  | "WWW_YOUTUBE"
  | "MOBILE_YOUTUBE"
  | "NO_COOKIE_YOUTUBE"
  | "MUSIC_YOUTUBE"
  | "EMBED_IFRAME"
  | "SANDBOXED_EMBED"
  | "NESTED_FRAME"
  | "UNKNOWN"

export type PhaseGate = "PHASE_1" | "PHASE_2" | "PHASE_3" | "PHASE_4" | "DISABLED"

export interface DomainVariantPolicy {
  variant: DomainVariant
  phaseGate: PhaseGate
  safeDefault: string
  dnrMode: string
  mainWorldAllowed: boolean
  sanitizerAllowed: boolean
  cosmeticCleanupAllowed: boolean
  requiresFixtures: boolean
}

export const DOMAIN_VARIANT_POLICIES: Record<DomainVariant, DomainVariantPolicy> = {
  TOP_LEVEL_YOUTUBE: {
    variant: "TOP_LEVEL_YOUTUBE", phaseGate: "PHASE_4", safeDefault: "BALANCED",
    dnrMode: "BALANCED", mainWorldAllowed: true, sanitizerAllowed: true,
    cosmeticCleanupAllowed: true, requiresFixtures: false,
  },
  WWW_YOUTUBE: {
    variant: "WWW_YOUTUBE", phaseGate: "PHASE_4", safeDefault: "BALANCED",
    dnrMode: "BALANCED", mainWorldAllowed: true, sanitizerAllowed: true,
    cosmeticCleanupAllowed: true, requiresFixtures: false,
  },
  MOBILE_YOUTUBE: {
    variant: "MOBILE_YOUTUBE", phaseGate: "PHASE_2", safeDefault: "SAFE_CONSERVATIVE",
    dnrMode: "SAFE_CONSERVATIVE", mainWorldAllowed: false, sanitizerAllowed: false,
    cosmeticCleanupAllowed: false, requiresFixtures: true,
  },
  NO_COOKIE_YOUTUBE: {
    variant: "NO_COOKIE_YOUTUBE", phaseGate: "PHASE_3", safeDefault: "EMBED_CONSERVATIVE",
    dnrMode: "EMBED_CONSERVATIVE", mainWorldAllowed: false, sanitizerAllowed: true,
    cosmeticCleanupAllowed: false, requiresFixtures: false,
  },
  MUSIC_YOUTUBE: {
    variant: "MUSIC_YOUTUBE", phaseGate: "PHASE_1", safeDefault: "SAFE_CONSERVATIVE",
    dnrMode: "SAFE_CONSERVATIVE", mainWorldAllowed: false, sanitizerAllowed: false,
    cosmeticCleanupAllowed: false, requiresFixtures: true,
  },
  EMBED_IFRAME: {
    variant: "EMBED_IFRAME", phaseGate: "PHASE_3", safeDefault: "EMBED_CONSERVATIVE",
    dnrMode: "EMBED_CONSERVATIVE", mainWorldAllowed: false, sanitizerAllowed: true,
    cosmeticCleanupAllowed: false, requiresFixtures: false,
  },
  SANDBOXED_EMBED: {
    variant: "SANDBOXED_EMBED", phaseGate: "PHASE_2", safeDefault: "SAFE_CONSERVATIVE",
    dnrMode: "SAFE_CONSERVATIVE", mainWorldAllowed: false, sanitizerAllowed: false,
    cosmeticCleanupAllowed: false, requiresFixtures: true,
  },
  NESTED_FRAME: {
    variant: "NESTED_FRAME", phaseGate: "PHASE_1", safeDefault: "SAFE_CONSERVATIVE",
    dnrMode: "SAFE_CONSERVATIVE", mainWorldAllowed: false, sanitizerAllowed: false,
    cosmeticCleanupAllowed: false, requiresFixtures: true,
  },
  UNKNOWN: {
    variant: "UNKNOWN", phaseGate: "PHASE_1", safeDefault: "SAFE_CONSERVATIVE",
    dnrMode: "SAFE_CONSERVATIVE", mainWorldAllowed: false, sanitizerAllowed: false,
    cosmeticCleanupAllowed: false, requiresFixtures: false,
  },
}

export function classifyDomainVariant(hostname: string, isTopFrame: boolean, parentOriginKnown: boolean, isSandboxed: boolean): DomainVariant {
    if (isSandboxed) return "SANDBOXED_EMBED"
    if (!isTopFrame) {
        if (parentOriginKnown) return "NESTED_FRAME"
        return "EMBED_IFRAME"
    }
    const host = hostname.replace(/^www\./, "")
    if (host === "youtube.com") return "TOP_LEVEL_YOUTUBE"
    if (host === "m.youtube.com") return "MOBILE_YOUTUBE"
    if (host === "youtube-nocookie.com") return "NO_COOKIE_YOUTUBE"
    if (host === "music.youtube.com") return "MUSIC_YOUTUBE"
    return "UNKNOWN"
}

export function getDomainPolicy(hostname: string, isTopFrame: boolean, parentOriginKnown: boolean, isSandboxed: boolean): DomainVariantPolicy {
    const variant = classifyDomainVariant(hostname, isTopFrame, parentOriginKnown, isSandboxed)
    return DOMAIN_VARIANT_POLICIES[variant]
}

export function domainAllowsMainWorld(policy: DomainVariantPolicy): boolean {
    return policy.mainWorldAllowed && policy.phaseGate !== "PHASE_1" && policy.phaseGate !== "DISABLED"
}

export function domainAllowsSanitizer(policy: DomainVariantPolicy): boolean {
    return policy.sanitizerAllowed && policy.phaseGate !== "PHASE_1" && policy.phaseGate !== "DISABLED"
}

export function domainAllowsCosmeticCleanup(policy: DomainVariantPolicy): boolean {
    return policy.cosmeticCleanupAllowed && policy.phaseGate !== "PHASE_1" && policy.phaseGate !== "PHASE_2" && policy.phaseGate !== "DISABLED"
}

export function canPromoteDomain(policy: DomainVariantPolicy, fixtureEvidence: boolean, shapeConfidence: number): DomainVariantPolicy {
    if (policy.phaseGate === "DISABLED") return policy
    if (!fixtureEvidence && policy.requiresFixtures) return policy
    if (shapeConfidence < 70) return policy

    const promotionMap: Record<PhaseGate, PhaseGate> = {
    PHASE_1: "PHASE_2",
    PHASE_2: "PHASE_3",
    PHASE_3: "PHASE_4",
    PHASE_4: "PHASE_4",
    DISABLED: "DISABLED",
    }

    return { ...policy, phaseGate: promotionMap[policy.phaseGate] }
}

export function selectSafeDefault(variant: DomainVariant): string {
    return DOMAIN_VARIANT_POLICIES[variant].safeDefault
}

export function isDomainSupported(hostname: string): boolean {
    const host = hostname.replace(/^www\./, "")
    return ["youtube.com", "m.youtube.com", "youtube-nocookie.com", "music.youtube.com"].includes(host)
}

