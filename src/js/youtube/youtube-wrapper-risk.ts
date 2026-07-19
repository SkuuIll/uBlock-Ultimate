// YouTube Wrapper-Risk Registry — V17 Phase 0
// Every main-world wrapper/hook must have risk metadata, activation mode,
// rollback owner, and health signal.

export type ActivationMode = "ALWAYS" | "EVIDENCE_GATED" | "DISABLED_BY_DEFAULT"

export type RollbackOwner = "MAIN_WORLD" | "ISOLATED_WORLD" | "SW"

export interface WrapperRiskEntry {
  name: string
  riskLevel: "LOW" | "MEDIUM" | "HIGH"
  activationMode: ActivationMode
  reversible: boolean
  rollbackOwner: RollbackOwner
  detectabilityAcknowledged: boolean
  noWrapperFallback: string
  description: string
  requiredEvidence?: string
}

export const WRAPPER_RISK_REGISTRY: Record<string, WrapperRiskEntry> = {
  earlyAccessor: {
    name: "earlyAccessor",
    riskLevel: "HIGH",
    activationMode: "EVIDENCE_GATED",
    reversible: true,
    rollbackOwner: "MAIN_WORLD",
    detectabilityAcknowledged: true,
    noWrapperFallback: "retroactive_sanitizer_or_response_guard",
    description: "Object.defineProperty hooks for ytInitialPlayerResponse and ytInitialData",
    requiredEvidence: "hookRaceEvidence.earlyAccessorWinsLikely === true",
  },
  fetchGuard: {
    name: "fetchGuard",
    riskLevel: "HIGH",
    activationMode: "DISABLED_BY_DEFAULT",
    reversible: true,
    rollbackOwner: "MAIN_WORLD",
    detectabilityAcknowledged: true,
    noWrapperFallback: "dnr_and_sanitizer_only",
    description: "Fetch interception for response header sanitization",
  },
  xhrGuard: {
    name: "xhrGuard",
    riskLevel: "HIGH",
    activationMode: "DISABLED_BY_DEFAULT",
    reversible: true,
    rollbackOwner: "MAIN_WORLD",
    detectabilityAcknowledged: true,
    noWrapperFallback: "dnr_and_sanitizer_only",
    description: "XHR interception for response header sanitization",
  },
  configWrapper: {
    name: "configWrapper",
    riskLevel: "MEDIUM",
    activationMode: "DISABLED_BY_DEFAULT",
    reversible: true,
    rollbackOwner: "MAIN_WORLD",
    detectabilityAcknowledged: true,
    noWrapperFallback: "sanitizer_only",
    description: "ytcfg accessor wrappers for config sanitization",
  },
  documentWriteWrapper: {
    name: "documentWriteWrapper",
    riskLevel: "HIGH",
    activationMode: "DISABLED_BY_DEFAULT",
    reversible: true,
    rollbackOwner: "MAIN_WORLD",
    detectabilityAcknowledged: true,
    noWrapperFallback: "passive_dom_cleanup",
    description: "document.write/open/close interception (treated as one class)",
  },
  dynamicScriptWrapper: {
    name: "dynamicScriptWrapper",
    riskLevel: "HIGH",
    activationMode: "DISABLED_BY_DEFAULT",
    reversible: true,
    rollbackOwner: "MAIN_WORLD",
    detectabilityAcknowledged: true,
    noWrapperFallback: "dnr_and_sanitizer_only",
    description: "createElement('script') / appendChild / insertBefore interception",
  },
}
