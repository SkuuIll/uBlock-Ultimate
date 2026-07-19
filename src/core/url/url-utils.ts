/**
 * src/core/url/url-utils.ts
 *
 * URL canonicalization utilities for matching and normalization.
 */

export function normalizeURLForMatching(url: string): string {
    if (!url) return ''
    try {
        const u = new URL(url)
        let hostname = u.hostname.toLowerCase()
        try {
            hostname = new URL(`http://${hostname}`).hostname
        } catch {
            // keep as-is
        }
        if (hostname.endsWith('.')) hostname = hostname.slice(0, -1)

        let result = `${u.protocol  }//${  hostname}`
        const port = u.port
        if (port === '80' && u.protocol === 'http:') {
            // omit default HTTP port
        } else if (port === '443' && u.protocol === 'https:') {
            // omit default HTTPS port
        } else if (port) {
            result += `:${  port}`
        }
        result += u.pathname
        if (u.search) result += u.search
        // strip fragment
        return result
    } catch {
        return url.toLowerCase().replace(/#.*$/, '')
    }
}

export function normalizeRequestURL(url: string): string {
    if (!url) return ''
    try {
        const u = new URL(url)
        let hostname = u.hostname.toLowerCase()
        try {
            hostname = new URL(`http://${hostname}`).hostname
        } catch {
            // keep as-is
        }
        if (hostname.endsWith('.')) hostname = hostname.slice(0, -1)

        let result = `${u.protocol  }//${  hostname}`
        const port = u.port
        if (port === '80' && u.protocol === 'http:') {
            // omit default HTTP port
        } else if (port === '443' && u.protocol === 'https:') {
            // omit default HTTPS port
        } else if (port) {
            result += `:${  port}`
        }
        result += u.pathname
        if (u.search) result += u.search
        if (u.hash) result += u.hash
        return result
    } catch {
        return url.toLowerCase()
    }
}

export function isSpecialScheme(url: string): boolean {
    return /^https?:\/\//i.test(url) || /^ws[sc]?:\/\//i.test(url)
}

export function inheritsOriginFromParent(url: string): boolean {
    return url === 'about:blank' || url === 'about:srcdoc' || url.startsWith('blob:') || url.startsWith('data:')
}
