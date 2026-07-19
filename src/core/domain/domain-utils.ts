/**
 * src/core/domain/domain-utils.ts
 *
 * PSL-aware domain utility for eTLD+1 extraction, hostname normalization,
 * third-party detection, and domain option matching.
 *
 * The public suffix list (effective_tld_names.dat) is loaded at startup and
 * cached. If the file is unavailable, a minimal built-in fallback covers the
 * most common TLDs (co.uk, com.au, etc.) and last-two-label logic is used for
 * everything else. degradedMode should be set when the full PSL is missing.
 */

import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

// ---------------------------------------------------------------------------
// Minimal built-in rules for common two-part TLDs (ICANN section only).
// Full list is loaded from effective_tld_names.dat at startup.
// ---------------------------------------------------------------------------
const BUILT_IN_RULES: Set<string> = new Set([
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'net.uk', 'nhs.uk', 'police.uk', 'mod.uk',
  'co.jp', 'or.jp', 'ne.jp', 'ac.jp', 'go.jp', 'ed.jp',
  'com.au', 'net.au', 'org.au', 'edu.au', 'gov.au',
  'co.nz', 'net.nz', 'org.nz',
  'co.za', 'net.za', 'org.za', 'gov.za', 'ac.za',
  'com.br', 'org.br', 'net.br', 'gov.br',
  'co.in', 'net.in', 'org.in', 'gov.in', 'ac.in',
  'com.cn', 'net.cn', 'org.cn', 'gov.cn',
  'co.kr', 'or.kr', 'ne.kr',
  'com.mx', 'org.mx', 'net.mx', 'gob.mx',
  'co.il', 'org.il', 'net.il', 'ac.il', 'gov.il',
  'com.ar', 'net.ar', 'org.ar', 'gov.ar',
  'com.pl', 'org.pl', 'net.pl', 'gov.pl',
  'co.at', 'or.at', 'ac.at',
  'co.hu', 'info.hu', 'org.hu',
  'co.id', 'or.id', 'ac.id', 'go.id',
  'co.th', 'or.th', 'ac.th', 'go.th',
  'co.ve', 'com.ve', 'net.ve', 'org.ve', 'gob.ve',
  'co.ug', 'or.ug', 'ac.ug', 'go.ug',
  'co.tz', 'or.tz', 'ac.tz', 'go.tz',
  'co.ke', 'or.ke', 'ne.ke', 'ac.ke', 'go.ke',
  'co.zw', 'org.zw', 'ac.zw', 'gov.zw',
  'co.bw', 'org.bw', 'ac.bw',
  'co.ao', 'og.ao', 'gv.ao',
  'co.cr', 'or.cr', 'ac.cr', 'go.cr',
  'co.vi', 'org.vi', 'gov.vi',
  'co.ck', 'org.ck', 'edu.ck', 'gov.ck',
  'co.fk', 'org.fk', 'ac.fk', 'gov.fk',
  'co.pn', 'org.pn', 'edu.pn', 'gov.pn',
  'co.sh', 'org.sh', 'ac.sh', 'gov.sh',
  'co.uz', 'com.uz', 'org.uz',
  'co.ve', 'com.ve', 'net.ve', 'org.ve', 'gob.ve',
  'co.ws', 'org.ws', 'gov.ws',
  'com.ai', 'net.ai', 'org.ai', 'gov.ai',
  'com.bn', 'net.bn', 'org.bn', 'gov.bn',
  'com.cy', 'net.cy', 'org.cy', 'gov.cy',
  'com.do', 'net.do', 'org.do', 'gov.do',
  'com.ec', 'net.ec', 'org.ec', 'gov.ec',
  'com.fj', 'net.fj', 'org.fj', 'ac.fj', 'gov.fj',
  'com.gh', 'net.gh', 'org.gh', 'gov.gh',
  'com.gi', 'net.gi', 'org.gi', 'gov.gi',
  'com.gp', 'net.gp', 'org.gp',
  'com.gr', 'net.gr', 'org.gr',
  'com.gt', 'net.gt', 'org.gt', 'gob.gt',
  'com.gy', 'net.gy', 'org.gy', 'coop.gy',
  'com.hk', 'net.hk', 'org.hk', 'gov.hk', 'edu.hk',
  'com.jm', 'net.jm', 'org.jm', 'gov.jm',
  'com.kh', 'net.kh', 'org.kh', 'gov.kh',
  'com.kw', 'net.kw', 'org.kw', 'gov.kw',
  'com.lb', 'net.lb', 'org.lb', 'gov.lb',
  'com.ly', 'net.ly', 'org.ly', 'gov.ly',
  'com.mm', 'net.mm', 'org.mm', 'gov.mm',
  'com.mt', 'net.mt', 'org.mt', 'gov.mt',
  'com.mv', 'net.mv', 'org.mv', 'gov.mv',
  'com.mw', 'net.mw', 'org.mw', 'ac.mw', 'gov.mw',
  'com.my', 'net.my', 'org.my', 'gov.my', 'edu.my',
  'com.nf', 'net.nf', 'org.nf',
  'com.ng', 'net.ng', 'org.ng', 'gov.ng', 'ac.ng',
  'com.ni', 'net.ni', 'org.ni', 'gob.ni',
  'com.np', 'net.np', 'org.np',
  'com.om', 'net.om', 'org.om', 'gov.om',
  'com.pa', 'net.pa', 'org.pa', 'ac.pa', 'gob.pa',
  'com.pe', 'net.pe', 'org.pe', 'gob.pe',
  'com.pg', 'net.pg', 'org.pg', 'ac.pg',
  'com.pk', 'net.pk', 'org.pk', 'gov.pk', 'ac.pk',
  'com.pr', 'net.pr', 'org.pr', 'ac.pr', 'gov.pr',
  'com.py', 'net.py', 'org.py', 'gov.py',
  'com.qa', 'net.qa', 'org.qa', 'gov.qa',
  'com.sa', 'net.sa', 'org.sa', 'gov.sa',
  'com.sb', 'net.sb', 'org.sb', 'gov.sb',
  'com.sc', 'net.sc', 'org.sc', 'gov.sc',
  'com.sg', 'net.sg', 'org.sg', 'gov.sg', 'edu.sg',
  'com.sl', 'net.sl', 'org.sl', 'gov.sl',
  'com.sv', 'net.sv', 'org.sv', 'gob.sv',
  'com.sy', 'net.sy', 'org.sy', 'gov.sy',
  'com.tj', 'net.tj', 'org.tj', 'ac.tj', 'go.tj',
  'com.tn', 'net.tn', 'org.tn', 'gov.tn',
  'com.tt', 'net.tt', 'org.tt', 'gov.tt',
  'com.ua', 'net.ua', 'org.ua', 'gov.ua',
  'com.uy', 'net.uy', 'org.uy', 'gub.uy',
  'com.vc', 'net.vc', 'org.vc', 'gov.vc',
  'com.ve', 'net.ve', 'org.ve', 'gob.ve',
  'com.vn', 'net.vn', 'org.vn', 'gov.vn',
  'edu.au', 'ac.nz', 'govt.nz',
  'gov.uk', 'ac.uk', 'mod.uk', 'nhs.uk', 'police.uk',
  'net.au', 'org.nz',
  'sch.uk',
  'blogspot.co.uk', 'blogspot.com',
  'github.io', 'githubusercontent.com',
  'herokuapp.com', 'heroku.com',
  'netlify.app', 'vercel.app',
  'firebaseapp.com', 'web.app',
  'pages.dev', 'workers.dev',
  'railway.app', 'fly.dev',
  'onrender.com',
  'azurewebsites.net', 'azureedge.net',
  'cloudfront.net', 's3.amazonaws.com',
  'compute.amazonaws.com', 'compute-1.amazonaws.com',
])

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let loadedRules: Set<string> | null = null
let loadingAttempted = false

// ---------------------------------------------------------------------------
// PSL loading
// ---------------------------------------------------------------------------

export function loadPublicSuffixList(filePath?: string): boolean {
    loadingAttempted = true
    const path = filePath ?? resolve(__dirname, '../../platform/chromium/assets/thirdparties/publicsuffix.org/list/effective_tld_names.dat')
    try {
        if (!existsSync(path)) {
            loadedRules = null
            return false
        }
        const text = readFileSync(path, 'utf8')
        if (!text || text.trim().length === 0) {
            loadedRules = null
            return false
        }
        const rules = new Set<string>()
        for (const line of text.split('\n')) {
            const trimmed = line.trim()
            if (trimmed === '' || trimmed.startsWith('//')) continue
            // Skip leading ! rules (wildcard exceptions) — keep simple
            if (trimmed.startsWith('!')) continue
      rules.add(trimmed)
        }
        loadedRules = rules
        return true
    } catch {
        loadedRules = null
        return false
    }
}

export function hasPublicSuffixList(): boolean {
    if (!loadingAttempted) loadPublicSuffixList()
    return loadedRules !== null && loadedRules.size > 0
}

function getRules(): Set<string> {
    if (!loadingAttempted) loadPublicSuffixList()
    return loadedRules ?? BUILT_IN_RULES
}

// ---------------------------------------------------------------------------
// Core helpers
// ---------------------------------------------------------------------------

export function normalizeHostname(input: string): string {
    let h = input.trim().toLowerCase()
    // Remove trailing dot
    if (h.endsWith('.')) h = h.slice(0, -1)
    // Remove brackets around IPv6
    if (h.startsWith('[') && h.endsWith(']')) h = h.slice(1, -1)
    // Punycode encode
    try {
        h = new URL(`http://${h}`).hostname
    } catch {
    // keep original
    }
    return h
}

export function isIPAddress(hostname: string): boolean {
    const h = hostname.trim()
    // IPv6
    if (h.includes(':')) return true
    // IPv4
    const parts = h.split('.')
    if (parts.length === 4) return parts.every(p => /^\d{1,3}$/.test(p) && Number(p) <= 255)
    return false
}

export function getPublicSuffix(hostname: string): string {
    const h = normalizeHostname(hostname)
    if (isIPAddress(h)) return h
    const labels = h.split('.')
    if (labels.length <= 1) return h

    const rules = getRules()

    // Try longest match first (up to labels.length - 1)
    for (let i = 1; i < labels.length; i++) {
        const candidate = labels.slice(i).join('.')
        if (rules.has(candidate)) return candidate
        // Check wildcard: *.domain (e.g. *.bd for Bangladesh)
        if (rules.has(`*.${candidate}`)) return labels.slice(i - 1).join('.')
    }

    // Fallback: last label
    return labels[labels.length - 1]
}

export function getRegistrableDomain(hostname: string): string {
    const h = normalizeHostname(hostname)
    if (isIPAddress(h)) return h
    const labels = h.split('.')
    const suffix = getPublicSuffix(h)
    const suffixLabels = suffix.split('.')

    const registrableCount = labels.length - suffixLabels.length
    if (registrableCount <= 0) return h
    return labels.slice(labels.length - suffixLabels.length - 1).join('.')
}

export function isSubdomainOrSame(hostname: string, domain: string): boolean {
    const h = normalizeHostname(hostname)
    const d = normalizeHostname(domain)
    if (h === d) return true
    return h.endsWith(`.${  d}`)
}

export function isThirdParty(requestHostname: string, documentHostname: string): boolean {
    const reqDomain = getRegistrableDomain(requestHostname)
    const docDomain = getRegistrableDomain(documentHostname)
    return reqDomain !== docDomain
}

export function matchesDomainOption(hostname: string, domainOption: string): boolean {
    // domain=example.com or domain=example.com|other.com
    // ~ prefix means negation
    const h = normalizeHostname(hostname)
    const dom = normalizeHostname(domainOption.replace(/^~/, ''))
    const negate = domainOption.startsWith('~')
    const match = h === dom || h.endsWith(`.${  dom}`)
    return negate ? !match : match
}

export function domainFromHostname(hostname: string): string {
    return getRegistrableDomain(hostname)
}
