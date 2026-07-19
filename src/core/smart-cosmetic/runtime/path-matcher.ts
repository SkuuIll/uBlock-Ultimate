import type { PathEntry } from '../smart-rule-schema'

export function matchPaths(
    url: string,
    paths: PathEntry[],
): boolean {
    if (!paths || paths.length === 0) return true

    let urlPath: string
    try {
        urlPath = new URL(url).pathname
    } catch (e) {
    console.warn('[uBR] path-matcher: matchPaths URL parse failed', url, e)
    urlPath = url
    }

    for (const path of paths) {
        switch (path.form) {
        case 'exact':
            if (urlPath === path.value) return true
            break
        case 'glob':
            if (matchGlob(urlPath, path.value)) return true
            break
        case 'regex':
            try {
                const re = new RegExp(path.value, 'i')
                if (re.test(urlPath)) return true
            } catch (e) {
          console.warn('[uBR] path-matcher: matchPaths regex failed', path.value, e)
          continue
            }
            break
        }
    }

    return false
}

function matchGlob(path: string, pattern: string): boolean {
    const regexStr = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.')
    try {
        return new RegExp(`^${regexStr}$`).test(path)
    } catch (e) {
    console.warn('[uBR] path-matcher: matchGlob regex compile failed', pattern, e)
    return false
    }
}

export function getPathScope(url: string): string {
    try {
        const u = new URL(url)
        const parts = u.pathname.split('/').filter(Boolean)
        if (parts.length === 0) return '/'
        return `/${  parts.slice(0, 2).join('/')}`
    } catch (e) {
    console.warn('[uBR] path-matcher: getPathScope URL parse failed', url, e)
    return '/'
    }
}

export * as PathMatcher from './path-matcher'
