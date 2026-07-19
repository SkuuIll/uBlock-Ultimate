import type { TargetEntry } from '../smart-rule-schema'

export interface TargetMatchResult {
  matched: boolean
  matchedTarget?: TargetEntry
}

export function matchTargets(
    url: string,
    hostname: string,
    targets: TargetEntry[],
): TargetMatchResult {
    for (const target of targets) {
        switch (target.form) {
        case 'host':
            if (hostname === target.value) {
                return { matched: true, matchedTarget: target }
            }
            break
        case 'domain':
            if (hostname === target.value || hostname.endsWith(`.${  target.value}`)) {
                return { matched: true, matchedTarget: target }
            }
            break
        case 'entity':
            try {
                const parts = hostname.split('.')
                const entityParts = target.value.split('.')
                if (parts.length >= entityParts.length) {
                    const hostSuffix = parts.slice(-entityParts.length).join('.')
                    if (hostSuffix === target.value) {
                        return { matched: true, matchedTarget: target }
                    }
                }
            } catch (e) {
          console.warn('[uBR] target-matcher: matchTargets entity match failed', target.value, e)
          continue
            }
            break
        case 'regex':
            try {
                const re = new RegExp(target.value, 'i')
                if (re.test(hostname)) {
                    return { matched: true, matchedTarget: target }
                }
            } catch (e) {
          console.warn('[uBR] target-matcher: matchTargets regex failed', target.value, e)
          continue
            }
            break
        }
    }

    return { matched: false }
}

export function firstMatchingTarget(
    url: string,
    hostname: string,
    targets: TargetEntry[],
): TargetEntry | undefined {
    return targets.find(t => matchTargets(url, hostname, [t]).matched)
}

export * as TargetMatcher from './target-matcher'
