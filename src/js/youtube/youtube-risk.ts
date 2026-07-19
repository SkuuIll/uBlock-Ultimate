// YouTube Risk and Health — V17 Packet 2
// §10 Risk levels, §57.4 Risk vs health

export type RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "PANIC"
export type HealthState = "HEALTHY" | "DEGRADED" | "STUCK" | "PROMPT_DETECTED" | "BROKEN"

export const RISK_ORDER: Record<RiskLevel, number> = { LOW: 0, MEDIUM: 1, HIGH: 2, PANIC: 3 }

export function riskLevelAtLeast(current: RiskLevel, threshold: RiskLevel): boolean {
    return RISK_ORDER[current] >= RISK_ORDER[threshold]
}

export function riskLevelMoreThan(current: RiskLevel, threshold: RiskLevel): boolean {
    return RISK_ORDER[current] > RISK_ORDER[threshold]
}

export function maxRiskLevel(a: RiskLevel, b: RiskLevel): RiskLevel {
    return RISK_ORDER[a] >= RISK_ORDER[b] ? a : b
}

// Health → risk transition
// health anomaly can raise risk
export function healthToRisk(health: HealthState, currentRisk: RiskLevel): RiskLevel {
    switch (health) {
    case "PROMPT_DETECTED": return maxRiskLevel(currentRisk, "HIGH")
    case "BROKEN": return "PANIC"
    case "STUCK": return maxRiskLevel(currentRisk, "HIGH")
    case "DEGRADED": return maxRiskLevel(currentRisk, "MEDIUM")
    case "HEALTHY": return currentRisk
    }
}

export function recomputeRiskLevel(
    currentRisk: RiskLevel,
    health: HealthState,
    shapeConfidence: number,
    promptDetected: boolean,
    pageType: string,
    updatePending: boolean,
): RiskLevel {
    let risk = currentRisk

    if (promptDetected) risk = maxRiskLevel(risk, "HIGH")
    if (updatePending) risk = maxRiskLevel(risk, "MEDIUM")

    risk = maxRiskLevel(risk, healthToRisk(health, risk))

    if (shapeConfidence < 30) risk = maxRiskLevel(risk, "HIGH")
    else if (shapeConfidence < 60) risk = maxRiskLevel(risk, "MEDIUM")

    if (pageType === "LIVE" || pageType === "UNSUPPORTED") risk = maxRiskLevel(risk, "HIGH")
    if (pageType === "EMBED") risk = maxRiskLevel(risk, "MEDIUM")
    if (pageType === "MUSIC") risk = maxRiskLevel(risk, "HIGH")

    return risk
}

// risk gates module activation
export function riskAllows(riskLevel: RiskLevel, requiredMaxRisk: RiskLevel): boolean {
    return RISK_ORDER[riskLevel] <= RISK_ORDER[requiredMaxRisk]
}

// health triggers rollback
export function healthTriggersRollback(health: HealthState): boolean {
    return health === "PROMPT_DETECTED" || health === "BROKEN" || health === "STUCK"
}

export function selectActiveModules(risk: RiskLevel): string[] {
    switch (risk) {
    case "LOW": return ["safe_dnr", "sanitizer", "surrogates", "cosmetic", "instrumented_shadow"]
    case "MEDIUM": return ["safe_dnr", "sanitizer_cautious", "surrogates"]
    case "HIGH": return ["safe_dnr", "shadow_sanitizer"]
    case "PANIC": return ["safe_dnr"]
    }
}
