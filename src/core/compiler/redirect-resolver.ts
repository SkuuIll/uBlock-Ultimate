/**
 * src/core/compiler/redirect-resolver.ts
 *
 * Resolves redirect resource tokens (e.g. "noopjs", "1x1.gif")
 * to extension paths for DNR `redirect.extensionPath` actions.
 *
 * The resource catalog is read from
 * platform/chromium/web_accessible_resources/redirect-resources.json
 * at build time. Unknown tokens return null.
 */

import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

export interface RedirectResource {
  extensionPath: string
  mimeType: string
  safe: boolean
}

export type RedirectCatalog = Record<string, RedirectResource>

const CATALOG_REL = 'platform/chromium/web_accessible_resources/redirect-resources.json'

let cachedCatalog: RedirectCatalog | null = null

const REDIRECT_TOKEN_ALIASES: Record<string, string> = {
    'noop.js': 'noopjs',
    'noop.txt': 'nooptext',
    'noopjson': 'noop.json',
    'noopmp3-0.1s': 'noop-0.1s.mp3',
    'noopmp4-1s': 'noop-1s.mp4',
    'fuckadblock.js-3.2.0': 'nofab.js',
    'none': 'empty',
}

function getCatalogPath(): string {
    return resolve(process.cwd(), CATALOG_REL)
}

function loadCatalog(): RedirectCatalog {
    if (cachedCatalog) return cachedCatalog
    const p = getCatalogPath()
    if (!existsSync(p)) {
        cachedCatalog = {}
        return cachedCatalog
    }
    try {
        cachedCatalog = JSON.parse(readFileSync(p, 'utf8')) as RedirectCatalog
    } catch {
        cachedCatalog = {}
    }
    return cachedCatalog
}

export function getRedirectCatalog(): RedirectCatalog {
    return loadCatalog()
}

/**
 * Look up a redirect resource token (e.g. "noopjs", "1x1.gif")
 * and return its extension path. Returns null if unknown.
 */
export function resolveRedirectToken(token: string): string | null {
    const catalog = loadCatalog()
    const normalized = normalizeRedirectToken(token)
    const entry = catalog[normalized]
    if (!entry) return null
    return entry.extensionPath
}

function normalizeRedirectToken(token: string): string {
    const withoutPriority = String(token || '').split(':')[0]
    return REDIRECT_TOKEN_ALIASES[withoutPriority] || withoutPriority
}

/**
 * Return the set of known redirect token names.
 */
export function knownRedirectTokens(): string[] {
    return Object.keys(loadCatalog())
}

/**
 * Check whether a resource token is known and safe.
 */
export function isSafeRedirectToken(token: string): boolean {
    const catalog = loadCatalog()
    const normalized = normalizeRedirectToken(token)
    const entry = catalog[normalized]
    return entry !== undefined && entry.safe === true
}
