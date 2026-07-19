/**
 * psl-runtime.js — Browser-safe, static Public Suffix List subset
 *
 * Covers common multi-part TLDs sufficient for registrable-domain
 * extraction.  This is NOT a full PSL; it does not support exception
 * rules or wildcards under TLDs.  For the full list the extension
 * relies on the WASM publicsuffixlist module at runtime where available.
 */

// Two-label TLDs: map of TLD labels -> domain-level label count
// e.g. "co.uk" is 3 labels: co, uk, <domain>
const TWO_PART_TLDS = new Set([
    "co.uk","org.uk","me.uk","net.uk",
    "co.jp","or.jp","ne.jp","go.jp","lg.jp",
    "co.kr","or.kr","ne.kr","go.kr",
    "co.nz","net.nz","org.nz","govt.nz","ac.nz",
    "co.za","org.za","net.za","gov.za",
    "com.au","net.au","org.au","edu.au","gov.au","co.au",
    "com.br","net.br","org.br","com.mx","net.mx","org.mx",
    "com.cn","net.cn","org.cn","gov.cn","ac.cn",
    "com.sg","net.sg","org.sg","edu.sg","gov.sg",
    "com.ar","com.co","com.ec","com.pe","com.py","com.uy",
    "com.tr","net.tr","org.tr","biz.tr","name.tr","web.tr","gen.tr",
    "co.in","net.in","org.in","edu.in","res.in","gen.in","ind.in",
    "co.th","ac.th","go.th","in.th",
    "com.hk","net.hk","org.hk","edu.hk",
    "com.tw","net.tw","org.tw","idv.tw",
    "co.il","org.il","net.il","co.zw","ac.zw","org.zw",
    "co.ke","ac.ke","or.ke","ne.ke","go.ke",
    "co.tz","ac.tz","go.tz","ne.tz","or.tz",
    "com.vc","com.fj","co.fj","com.pg","co.za",
    "com.my","net.my","org.my","edu.my","gov.my",
    "com.pk","net.pk","org.pk","edu.pk",
    "com.eg","net.eg","org.eg","edu.eg","gov.eg",
    "com.sa","com.eg","net.sa","org.sa","edu.sa","gov.sa","med.sa","pub.sa","sch.sa",
    "com.kh","net.kh","org.kh","edu.kh","gov.kh",
    "com.mm","net.mm","org.mm","edu.mm","gov.mm",
    "co.lk","org.lk","net.lk","gov.lk","edu.lk",
    "com.ph","net.ph","org.ph","edu.ph","gov.ph",
    "com.do","net.do","org.do","edu.do","gov.do",
    "com.gt","net.gt","org.gt","edu.gt","gob.gt",
    "co.ni","net.ni","org.ni","edu.ni","gob.ni",
    "com.pa","net.pa","org.pa","edu.pa",
    "com.cr","net.cr","ac.cr","co.cr",
    "com.cu","net.cu","org.cu","edu.cu","gov.cu",
    "co.ve","com.ve","net.ve","org.ve","info.ve","co.ve","web.ve","gob.ve","edu.ve","gov.ve",
    "com.uy","net.uy","org.uy","edu.uy","gub.uy",
    "com.bo","net.bo","org.bo","tv.bo","gob.bo","int.bo","mov.bo",
]);

// Two-part TLDs that are themselves second-level domains under a ccTLD
// where the third label IS the registrable domain.
// e.g. blogspot.co.uk -> blogspot is second-level, not registrable.
const TWO_PART_SLD_TLDS = new Set([
    "blogspot.com","amazonaws.com","azurewebsites.net","cloudfront.net",
    "github.io","githubapp.com","githubusercontent.com",
    "gitlab.io","herokuapp.com","firebaseapp.com",
    "googleapis.com","google.com","googleapis.com","cloudfunctions.net",
    "amazon.com","elasticbeanstalk.com","s3.amazonaws.com",
    "heroku.com","now.sh","vercel.app","netlify.app",
    "pages.dev","workers.dev",
]);

/**
 * Extract the public-suffix portion of a hostname.
 *
 * For "www.bbc.co.uk" -> "co.uk"
 * For "example.com"   -> "com"
 * For "example.co.uk" -> "co.uk"
 */
export function getPublicSuffix(hostname) {
    const parts = hostname.split(".");
    const len = parts.length;
    if (len < 2) return hostname;

    // Check for two-part TLD first (e.g. co.uk)
    if (len >= 3) {
        const tld = parts[len - 2] + "." + parts[len - 1];
        if (TWO_PART_TLDS.has(tld)) {
            return tld;
        }
    }
    return parts[len - 1];
}

/**
 * Get the registrable domain (eTLD+1) for a hostname.
 *
 * "www.bbc.co.uk" -> "bbc.co.uk"
 * "example.com"   -> "example.com"
 * "a.example.co.uk" -> "example.co.uk"
 */
export function domainFromHostname(hostname) {
    const parts = hostname.split(".");
    const len = parts.length;
    if (len < 2) return hostname;

    // Check two-part TLD (e.g. co.uk)
    if (len >= 3) {
        const tld = parts[len - 2] + "." + parts[len - 1];
        if (TWO_PART_TLDS.has(tld)) {
            return parts[len - 3] + "." + tld;
        }
    }

    return parts[len - 2] + "." + parts[len - 1];
}

/**
 * Normalize a hostname for comparison (lowercase, strip www prefix).
 */
export function normalizeHostname(hostname) {
    const h = hostname.toLowerCase();
    if (h.startsWith("www.")) return h.slice(4);
    return h;
}

/**
 * Determine whether requestHostname is third-party relative to documentHostname.
 * Two hostnames are first-party if they share the same registrable domain.
 */
export function isThirdParty(requestHostname, documentHostname) {
    return domainFromHostname(requestHostname) !== domainFromHostname(documentHostname);
}
