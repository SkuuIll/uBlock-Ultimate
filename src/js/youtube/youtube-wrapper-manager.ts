// YouTube Reversible Wrapper Manager — V17 Packet 3
// §12.4.1 Reversible main-world wrapper lifecycle

export type WrapperTargetKind = "accessor" | "function" | "xhr" | "fetch" | "config" | "beacon" | "shadow-instrumentation"
export type WrapperRestoreState = "active" | "restore-pending" | "restored" | "restore-failed"

export interface MainWorldWrapperRecord {
  wrapperId: string
  targetKind: WrapperTargetKind
  targetName: string
  originalDescriptorHash: string
  installedAt: number
  activationReason: string
  riskClass: string
  restoreState: WrapperRestoreState
}

export interface WrapperCapture {
  wrapperId: string
  targetObject: unknown
  propertyName: string
  targetKind: WrapperTargetKind
  activationReason: string
  originalDescriptor: PropertyDescriptor | undefined
  originalFunction: unknown
  restoreState: WrapperRestoreState
  riskClass: string
}

// §12.4.1 — Mandatory wrapper-manager invariants
export function createWrapperManager() {
    const registry = new Map<string, WrapperCapture>()
    let nextId = 0

    function generateWrapperId(): string {
        return `wrapper_${++nextId}_${Date.now()}`
    }

    function hashDescriptor(desc: PropertyDescriptor | undefined): string {
        if (!desc) return "none"
        const parts: string[] = []
        if (typeof desc.value === "function") parts.push(`fn:${  desc.value.name}`)
        if (typeof desc.get === "function") parts.push("getter")
        if (typeof desc.set === "function") parts.push("setter")
    parts.push(`c:${  Boolean(desc.configurable)}`)
    parts.push(`e:${  Boolean(desc.enumerable)}`)
    parts.push(`w:${  Boolean(desc.writable)}`)
    return parts.join("|")
    }

    // Capture original descriptor before replacement
    function capture(
        targetObject: unknown,
        propertyName: string,
        targetKind: WrapperTargetKind,
        activationReason: string,
        riskClass: string,
    ): WrapperCapture | null {
        let originalDescriptor: PropertyDescriptor | undefined
        let originalFunction: unknown = undefined

        try {
            originalDescriptor = Object.getOwnPropertyDescriptor(targetObject as object, propertyName)
        } catch (e) {
      console.warn('[uBR] youtube-wrapper-manager: getOwnPropertyDescriptor failed for', propertyName, e)
        }

        const wrapperId = generateWrapperId()
        const capture: WrapperCapture = {
      wrapperId,
      targetObject,
      propertyName,
      targetKind,
      activationReason,
      originalDescriptor,
      originalFunction:
        originalDescriptor?.value !== undefined ? originalDescriptor.value : undefined,
      restoreState: "active",
      riskClass,
        }

    registry.set(wrapperId, capture)
    return capture
    }

    // §12.4.1 — Restore behavior
    function restoreAccessor(wrapperId: string): boolean {
        const cap = registry.get(wrapperId)
        if (!cap) return false
        if (cap.restoreState === "restored") return true

        try {
            if (cap.originalDescriptor) {
        Object.defineProperty(cap.targetObject as object, cap.propertyName, cap.originalDescriptor)
            }
            cap.restoreState = "restored"
            return true
        } catch (e) {
      console.warn('[uBR] youtube-wrapper-manager: restoreAccessor defineProperty failed for', cap.propertyName, e)
      cap.restoreState = "restore-failed"
      return false
        }
    }

    function restoreFunction(wrapperId: string): boolean {
        const cap = registry.get(wrapperId)
        if (!cap) return false
        if (cap.restoreState === "restored") return true

        try {
            if (cap.originalFunction !== undefined) {
                ;(cap.targetObject as Record<string, unknown>)[cap.propertyName] = cap.originalFunction
            }
            cap.restoreState = "restored"
            return true
        } catch (e) {
      console.warn('[uBR] youtube-wrapper-manager: restoreFunction assignment failed for', cap.propertyName, e)
      cap.restoreState = "restore-failed"
      return false
        }
    }

    function restoreXHRFetchGuard(wrapperId: string): boolean {
        return restoreFunction(wrapperId)
    }

    function restoreConfigWrapper(wrapperId: string): boolean {
        return restoreAccessor(wrapperId)
    }

    // Disable by wrapperId
    function disableWrapper(wrapperId: string): boolean {
        const cap = registry.get(wrapperId)
        if (!cap) return false

        switch (cap.originalDescriptor?.get !== undefined || cap.originalDescriptor?.set !== undefined) {
        case true:
            return restoreAccessor(wrapperId)
        default:
            return restoreFunction(wrapperId)
        }
    }

    // Disable all wrappers of a given class
    function disableByRiskClass(riskClass: string): { restored: string[]; failed: string[] } {
        const restored: string[] = []
        const failed: string[] = []

        for (const [id, cap] of registry) {
            if (cap.restoreState === "restored") continue
            if (riskClass !== "all" && cap.riskClass !== riskClass) continue

            const ok = disableWrapper(id)
            if (ok) restored.push(id)
            else failed.push(id)
        }

        return { restored, failed }
    }

    // Disable ALL wrappers
    function disableAll(): { restored: string[]; failed: string[] } {
        return disableByRiskClass("all")
    }

    function getRecord(wrapperId: string): MainWorldWrapperRecord | undefined {
        const cap = registry.get(wrapperId)
        if (!cap) return undefined
        return {
      wrapperId: cap.wrapperId,
      targetKind: cap.targetKind,
      targetName: cap.propertyName,
      originalDescriptorHash: cap.originalDescriptor ? hashDescriptor(cap.originalDescriptor) : "none",
      installedAt: 0,
      activationReason: cap.activationReason,
      riskClass: cap.riskClass,
      restoreState: cap.restoreState,
        }
    }

    function getActiveCount(): number {
        let count = 0
        for (const cap of registry.values()) {
            if (cap.restoreState === "active") count++
        }
        return count
    }

    function getAllRecords(): MainWorldWrapperRecord[] {
        const records: MainWorldWrapperRecord[] = []
        for (const cap of registry.values()) {
      records.push({
        wrapperId: cap.wrapperId,
        targetKind: cap.targetKind,
        targetName: cap.propertyName,
        originalDescriptorHash: cap.originalDescriptor ? hashDescriptor(cap.originalDescriptor) : "none",
        installedAt: 0,
        activationReason: cap.activationReason,
        riskClass: cap.riskClass,
        restoreState: cap.restoreState,
      })
        }
        return records
    }

    // §12.4.1 — Communication path
    function createDisableCommand(wrapperIds: string[] | "all", reason: string, commandNonce: string): Record<string, unknown> {
        return {
      source: "uBRYouTubeIsolated",
      type: "UBR_DISABLE_MAINWORLD_WRAPPERS",
      commandNonce,
      wrapperIds,
      reason,
        }
    }

    function createDisableAck(commandNonce: string, restored: string[], failed: string[]): Record<string, unknown> {
        return {
      source: "uBRYouTubeMain",
      type: "UBR_DISABLE_MAINWORLD_WRAPPERS_ACK",
      commandNonce,
      restoredWrapperIds: restored,
      failedWrapperIds: failed,
      activeWrapperCount: getActiveCount(),
        }
    }

    return {
    capture, disableWrapper, disableByRiskClass, disableAll,
    restoreAccessor, restoreFunction, restoreXHRFetchGuard, restoreConfigWrapper,
    getRecord, getActiveCount, getAllRecords,
    createDisableCommand, createDisableAck,
    }
}

export type WrapperManager = ReturnType<typeof createWrapperManager>

// §12.4 — MainWorldWrapperRecord for accessor capture
export function captureAccessor(
    manager: WrapperManager,
    targetObject: unknown,
    propertyName: string,
    activationReason: string,
    riskClass: string,
): string | null {
    const cap = manager.capture(targetObject, propertyName, "accessor", activationReason, riskClass)
    return cap?.wrapperId ?? null
}

export function captureFunctionWrapper(
    manager: WrapperManager,
    targetObject: unknown,
    propertyName: string,
    activationReason: string,
    riskClass: string,
): string | null {
    const cap = manager.capture(targetObject, propertyName, "function", activationReason, riskClass)
    return cap?.wrapperId ?? null
}
