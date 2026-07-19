// YouTube Hook-Race Telemetry — V17 Packet 3
// §12.6 Early hook-race telemetry

export interface HookRaceTelemetryInput {
  mainWorldAvailable: boolean
  contentScriptStartTime: number
  mainWorldProbeTime: number
  pageType: string
  frameContext: string
}

export interface HookRaceEvidence {
  earlyAccessorWinsLikely: boolean
  ytInitialPlayerResponseAlreadyDefinedAtProbe: boolean
  ytInitialDataAlreadyDefinedAtProbe: boolean
  preExistingDescriptorKind: "absent" | "data" | "accessor" | "unknown"
  inlineAssignmentEvidenceFromDOM: "none" | "script_seen_before_probe" | "script_seen_after_probe" | "unknown"
  retroactiveSanitizerSucceeded: boolean
  accessorWouldHaveWon: "yes" | "no" | "unknown"
}

export function collectHookRaceTelemetry(input: HookRaceTelemetryInput): HookRaceEvidence {
    const ytInitialPlayerResponseAlreadyDefinedAtProbe = checkGlobalDefined("ytInitialPlayerResponse")
    const ytInitialDataAlreadyDefinedAtProbe = checkGlobalDefined("ytInitialData")
    const ytplayerAlreadyDefined = checkGlobalDefined("ytplayer")
    const ytcfgAlreadyDefined = checkGlobalDefined("ytcfg")

    const totalChecked = [ytInitialPlayerResponseAlreadyDefinedAtProbe, ytInitialDataAlreadyDefinedAtProbe, ytplayerAlreadyDefined, ytcfgAlreadyDefined]
    const alreadyDefinedCount = totalChecked.filter(Boolean).length

    return {
    earlyAccessorWinsLikely: alreadyDefinedCount < 2,
    ytInitialPlayerResponseAlreadyDefinedAtProbe,
    ytInitialDataAlreadyDefinedAtProbe,
    preExistingDescriptorKind: classifyDescriptorKind(),
    inlineAssignmentEvidenceFromDOM: "unknown",
    retroactiveSanitizerSucceeded: false,
    accessorWouldHaveWon: alreadyDefinedCount < 2 ? "yes" : "no",
    }
}

function checkGlobalDefined(name: string): boolean {
    if (typeof window === "undefined") return false
    return name in window && (window as unknown as Record<string, unknown>)[name] !== undefined
}

function classifyDescriptorKind(): "absent" | "data" | "accessor" | "unknown" {
    if (typeof window === "undefined") return "unknown"
    const checks = ["ytInitialPlayerResponse", "ytInitialData", "ytplayer"]
    let bestResult: "absent" | "data" | "accessor" | "unknown" = "absent"
    for (const name of checks) {
        try {
            const desc = Object.getOwnPropertyDescriptor(window, name)
            if (!desc) continue
            if (desc.get !== undefined || desc.set !== undefined) return "accessor"
            bestResult = "data"
        } catch (e) {
      console.warn('[uBR] youtube-hook-race-telemetry: classifyDescriptorKind getOwnPropertyDescriptor failed for', name, e)
      return "unknown"
        }
    }
    return bestResult
}

// §12.6 — Activation rule
export interface EarlyAccessorGateInput {
  hookRaceEvidence: HookRaceEvidence
  mainWorldAvailable: boolean
  pageTypeIsFixtureCovered: boolean
  sanitizerShapeConfidenceAboveThreshold: boolean
  noAntiBlockPromptOrWrapperAnomaly: boolean
  descriptorRiskBudgetAvailable: boolean
}

export function earlyAccessorAllowed(input: EarlyAccessorGateInput): boolean {
    if (!input.hookRaceEvidence.earlyAccessorWinsLikely) return false
    if (!input.mainWorldAvailable) return false
    if (!input.pageTypeIsFixtureCovered) return false
    if (!input.sanitizerShapeConfidenceAboveThreshold) return false
    if (!input.noAntiBlockPromptOrWrapperAnomaly) return false
    if (!input.descriptorRiskBudgetAvailable) return false
    return true
}
