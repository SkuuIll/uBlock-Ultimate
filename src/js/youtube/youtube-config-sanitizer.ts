// YouTube Global Config Sanitizer — V17 Packet 5 (§19)
// Wraps ytcfg getters/setters to sanitize ad-related config fragments.
// Preserves unrelated and experiment flags. Fail-open on unknown args.

import { type RiskLevel } from "./youtube-types"

export const AD_CONFIG_KEYS = [
  "adSlots",
  "adConfig",
  "adSignalsInfo",
  "enable_ad_detection_logging",
  "ad_preroll",
  "ad_device_signals",
  "ad_break",
  "adPlacements",
] as const

export type AdConfigKey = (typeof AD_CONFIG_KEYS)[number]

export interface ConfigSanitizerInput {
  key: string
  value: unknown
  callerOrigin: string
  riskLevel: RiskLevel
  confidence: number
}

export interface ConfigSanitizerOutput {
  sanitizedValue: unknown
  action: "PASSTHROUGH" | "SANITIZED" | "FAIL_OPEN"
  reason: string | null
}

export function getAdConfigKeys(): string[] {
    return [...AD_CONFIG_KEYS]
}

export function isAdConfigKey(key: string): boolean {
    return (AD_CONFIG_KEYS as readonly string[]).includes(key)
}

export function isAdConfigValue(value: unknown): boolean {
    if (value === null || value === undefined) return false
    const str = (typeof value === "object" ? JSON.stringify(value) : String(value)).toLowerCase()
    const adTerms = ["ad", "sponsored", "promoted", "campaign", "placement"]
    return adTerms.some(t => str.includes(t))
}

export function sanitizeConfigValue(key: string, value: unknown): unknown {
    if (Array.isArray(value)) return []
    if (typeof value === "object" && value !== null) return {}
    if (typeof value === "number") return 0
    if (typeof value === "boolean") return false
    if (typeof value === "string") return ""
    return value
}

export function handleConfigSet(input: ConfigSanitizerInput): ConfigSanitizerOutput {
    if (input.riskLevel === "PANIC") {
        return { sanitizedValue: null, action: "FAIL_OPEN", reason: "PANIC_RISK" }
    }

    if (input.confidence < 30) {
        return { sanitizedValue: input.value, action: "PASSTHROUGH", reason: "CONFIDENCE_TOO_LOW" }
    }

    if (!isAdConfigKey(input.key)) {
        return { sanitizedValue: input.value, action: "PASSTHROUGH", reason: "NOT_AD_KEY" }
    }

    if (typeof input.value === "object" && input.value !== null) {
        return { sanitizedValue: sanitizeConfigValue(input.key, input.value), action: "SANITIZED", reason: "AD_CONFIG_SANITIZED" }
    }

    return { sanitizedValue: input.value, action: "PASSTHROUGH", reason: "SCALAR_VALUE_KEPT" }
}

export function handleConfigGet(input: ConfigSanitizerInput): ConfigSanitizerOutput {
    if (input.riskLevel === "PANIC") {
        return { sanitizedValue: null, action: "FAIL_OPEN", reason: "PANIC_RISK" }
    }

    if (input.confidence < 30) {
        return { sanitizedValue: input.value, action: "PASSTHROUGH", reason: "CONFIDENCE_TOO_LOW" }
    }

    if (!isAdConfigKey(input.key)) {
        return { sanitizedValue: input.value, action: "PASSTHROUGH", reason: "NOT_AD_KEY" }
    }

    const sanitized = sanitizeConfigValue(input.key, input.value)
    return { sanitizedValue: sanitized, action: "SANITIZED", reason: "AD_CONFIG_VALUE_REPLACED" }
}

export function handleConfigUpdate(input: ConfigSanitizerInput): ConfigSanitizerOutput {
    if (input.riskLevel === "PANIC" || input.confidence < 30) {
        return { sanitizedValue: input.value, action: "FAIL_OPEN", reason: "PANIC_OR_LOW_CONFIDENCE" }
    }

    if (typeof input.value !== "object" || input.value === null) {
        return { sanitizedValue: input.value, action: "PASSTHROUGH", reason: "NON_OBJECT_VALUE" }
    }

    const value = input.value as Record<string, unknown>
    const sanitized: Record<string, unknown> = {}
    let changed = false

    for (const [k, v] of Object.entries(value)) {
        if (isAdConfigKey(k)) {
            sanitized[k] = sanitizeConfigValue(k, v)
            changed = true
        } else {
            sanitized[k] = v
        }
    }

    if (!changed) {
        return { sanitizedValue: input.value, action: "PASSTHROUGH", reason: "NO_AD_KEYS_IN_UPDATE" }
    }

    return { sanitizedValue: sanitized, action: "SANITIZED", reason: "AD_KEYS_SANITIZED_IN_UPDATE" }
}
