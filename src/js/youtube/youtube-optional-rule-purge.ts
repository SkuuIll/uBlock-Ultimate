// YouTube Optional-Rule Purge — V17 Phase 0
// Removes optional YouTube DNR rules when no top-level YouTube tab is open.

export function shouldPurgeOptionalRules(hasTopLevelYouTube: boolean): boolean {
    return !hasTopLevelYouTube
}

export function getPurgePolicy(): {
  retainCritical: boolean
  removeOptional: boolean
  preserveSessionBans: boolean
  } {
    return {
    retainCritical: true,
    removeOptional: true,
    preserveSessionBans: true,
    }
}

export function selectRulesToPurge(ruleIds: number[], criticalIds: Set<number>): number[] {
    return ruleIds.filter(id => !criticalIds.has(id))
}
