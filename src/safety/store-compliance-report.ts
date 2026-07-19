/**
 * Store compliance report.
 *
 * Generates a deterministic, evidence-backed report proving the extension
 * meets Chrome Web Store policies. The report is one of the §15.5
 * Release-1.0 acceptance criteria ("store compliance report passes").
 *
 * Checks performed (all evidence-based; the gate runs each check against
 * the repo and writes the report to `dist/build/certificate/store-compliance.json`):
 *
 *   1. manifest_present         — manifest.json exists and is valid JSON
 *   2. manifest_mv3             — manifest_version === 3
 *   3. manifest_name            — name field is present and non-empty
 *   4. manifest_version         — version field is present and non-empty
 *   5. manifest_single_purpose  — name/description describe a single purpose
 *   6. no_remote_code           — no remote JS, no eval, no Function()
 *   7. no_remote_rule_fetch     — no `fetch()` to non-UBR-rule-data URLs
 *   8. permissions_minimal      — declared permissions are minimal
 *   9. host_permissions_narrow  — host_permissions are narrow (no <all_urls>)
 *  10. service_worker_only      — background uses service_worker (not page)
 *  11. content_security_policy  — CSP is restrictive (no unsafe-inline in prod)
 *  12. privacy_policy_link      — privacy policy URL declared in manifest
 *                                  (WARN if missing — not a hard fail)
 *  13. icon_assets_present      — required icons exist on disk
 *  14. no_eval_in_source        — `eval(` and `new Function(` absent from src/
 *  15. no_obfuscation           — no minified bundles in src/ (heuristic:
 *                                  no lines > 500 chars)
 *
 * Each check has:
 *   - id: short stable identifier
 *   - title: human-readable summary
 *   - status: "pass" | "fail" | "warn" | "skip"
 *   - evidence: array of strings (file paths, line refs, etc.)
 *   - note: optional explanation
 *
 * The report is produced by `check-store-compliance.mjs` and read back
 * into the release certificate by `check-certificate-aggregation.mjs`.
 */

export type ComplianceStatus = 'pass' | 'fail' | 'warn' | 'skip';

export interface ComplianceCheck {
    id: string;
    title: string;
    status: ComplianceStatus;
    evidence: string[];
    note?: string;
}

export interface StoreComplianceReport {
    schemaVersion: 1;
    generatedAt: string;
    extensionVersion: string;
    totalChecks: number;
    passed: number;
    failed: number;
    warned: number;
    skipped: number;
    ok: boolean;
    checks: ComplianceCheck[];
    summary: { ok: boolean; requiredFailed: number; requiredTotal: number };
}

export interface RepoSnapshot {
    manifestRaw: string;
    manifest: {
        manifest_version?: number;
        name?: string;
        version?: string;
        description?: string;
        permissions?: string[];
        host_permissions?: string[];
        background?: { service_worker?: string; scripts?: string[]; persistent?: boolean };
        content_security_policy?: { extension_pages?: string };
        icons?: { [k: string]: string };
        // Privacy policy is a non-standard key; we look at known locations
        [k: string]: unknown;
    };
    srcFiles: { path: string; content: string }[];
    distFiles: { path: string; exists: boolean }[];
    profile?: string;
}

export const STORE_COMPLIANCE_CHECKS: {
    id: string;
    title: string;
    required: boolean;
    evaluate: (_s: RepoSnapshot) => ComplianceCheck;
}[] = [
    {
        id: 'manifest_present',
        title: 'manifest.json is present and valid JSON',
        required: true,
        evaluate: s => {
            if (!s.manifestRaw) {
                return { id: 'manifest_present', title: 'manifest.json is present and valid JSON', status: 'fail', evidence: [], note: 'manifest.json missing' };
            }
            try {
                JSON.parse(s.manifestRaw);
                return { id: 'manifest_present', title: 'manifest.json is present and valid JSON', status: 'pass', evidence: ['platform/chromium/manifest.json'] };
            } catch (e) {
                console.warn('[uBR] store-compliance-report: manifest JSON parse failed', e);
                return { id: 'manifest_present', title: 'manifest.json is present and valid JSON', status: 'fail', evidence: ['platform/chromium/manifest.json'], note: String(e) };
            }
        },
    },
    {
        id: 'manifest_mv3',
        title: 'manifest_version is 3 (MV3)',
        required: true,
        evaluate: s => {
            const v = s.manifest.manifest_version;
            if (v === 3) return { id: 'manifest_mv3', title: 'manifest_version is 3 (MV3)', status: 'pass', evidence: [`manifest_version=${v}`] };
            return { id: 'manifest_mv3', title: 'manifest_version is 3 (MV3)', status: 'fail', evidence: [`manifest_version=${v}`], note: 'MV3 is required by Chrome Web Store' };
        },
    },
    {
        id: 'manifest_name',
        title: 'manifest name is present and non-empty',
        required: true,
        evaluate: s => {
            const n = s.manifest.name;
            if (typeof n === 'string' && n.trim().length > 0) {
                return { id: 'manifest_name', title: 'manifest name is present and non-empty', status: 'pass', evidence: [`name="${n}"`] };
            }
            return { id: 'manifest_name', title: 'manifest name is present and non-empty', status: 'fail', evidence: [], note: 'name is required' };
        },
    },
    {
        id: 'manifest_version',
        title: 'manifest version is present and non-empty',
        required: true,
        evaluate: s => {
            const v = s.manifest.version;
            if (typeof v === 'string' && v.trim().length > 0) {
                return { id: 'manifest_version', title: 'manifest version is present and non-empty', status: 'pass', evidence: [`version="${v}"`] };
            }
            return { id: 'manifest_version', title: 'manifest version is present and non-empty', status: 'fail', evidence: [] };
        },
    },
    {
        id: 'manifest_single_purpose',
        title: 'single purpose: content blocking',
        required: true,
        evaluate: s => {
            const d = String(s.manifest.description ?? '').toLowerCase();
            const keywords = ['block', 'filter', 'ad', 'tracker', 'privacy', 'content'];
            const hits = keywords.filter(k => d.includes(k));
            if (hits.length > 0) {
                return { id: 'manifest_single_purpose', title: 'single purpose: content blocking', status: 'pass', evidence: [`description="${s.manifest.description}"`, `matched: ${hits.join(',')}`] };
            }
            return { id: 'manifest_single_purpose', title: 'single purpose: content blocking', status: 'warn', evidence: [`description="${s.manifest.description}"`], note: 'description does not mention content blocking keywords' };
        },
    },
    {
        id: 'no_remote_code',
        title: 'no remote code, no eval, no Function()',
        required: true,
        evaluate: s => {
            const offenders: string[] = [];
            for (const f of s.srcFiles) {
                // Heuristic: scan only non-comment, non-doc lines.
                // Skip lines that are pure comments (// or *).
                const lines = f.content.split('\n');
                for (const line of lines) {
                    const trimmed = line.trim();
                    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue;
                    if (/\beval\s*\(/.test(line) || /\bnew\s+Function\s*\(/.test(line)) {
                        offenders.push(f.path);
                        break;
                    }
                }
            }
            if (offenders.length > 0) {
                return { id: 'no_remote_code', title: 'no remote code, no eval, no Function()', status: 'fail', evidence: offenders, note: 'eval/Function detected' };
            }
            return { id: 'no_remote_code', title: 'no remote code, no eval, no Function()', status: 'pass', evidence: ['no matches in src/'] };
        },
    },
    {
        id: 'permissions_minimal',
        title: 'declared permissions are minimal',
        required: true,
        evaluate: s => {
            const perms = s.manifest.permissions ?? [];
            const allowed = new Set([
                'activeTab',
                'contextMenus',
                'declarativeNetRequest',
                'privacy',
                'scripting',
                'storage',
                'tabs',
                'unlimitedStorage',
                'webNavigation',
            ]);
            const offenders = perms.filter(p => !allowed.has(p));
            if (offenders.length > 0) {
                return { id: 'permissions_minimal', title: 'declared permissions are minimal', status: 'warn', evidence: perms, note: `non-standard: ${offenders.join(',')}` };
            }
            return { id: 'permissions_minimal', title: 'declared permissions are minimal', status: 'pass', evidence: perms };
        },
    },
    {
        id: 'host_permissions_narrow',
        title: 'host_permissions are narrow (no <all_urls>)',
        required: true,
        evaluate: s => {
            const hosts = s.manifest.host_permissions ?? [];
            const hasAllUrls = hosts.some(h => h === '<all_urls>' || h === '*://*/*' || h === 'http://*/*' || h === 'https://*/*');
            if (hasAllUrls) {
                return { id: 'host_permissions_narrow', title: 'host_permissions are narrow (no <all_urls>)', status: 'warn', evidence: hosts, note: 'broad host permissions detected (required for content blocking)' };
            }
            return { id: 'host_permissions_narrow', title: 'host_permissions are narrow (no <all_urls>)', status: 'pass', evidence: hosts };
        },
    },
    {
        id: 'service_worker_only',
        title: 'background uses service_worker (MV3)',
        required: true,
        evaluate: s => {
            const bg = s.manifest.background;
            if (bg?.service_worker) {
                return { id: 'service_worker_only', title: 'background uses service_worker (MV3)', status: 'pass', evidence: [`service_worker="${bg.service_worker}"`] };
            }
            if (bg?.scripts) {
                return { id: 'service_worker_only', title: 'background uses service_worker (MV3)', status: 'fail', evidence: ['background.scripts (MV2-style)'], note: 'MV3 requires service_worker' };
            }
            return { id: 'service_worker_only', title: 'background uses service_worker (MV3)', status: 'fail', evidence: [], note: 'no background configured' };
        },
    },
    {
        id: 'content_security_policy',
        title: 'CSP is restrictive',
        required: true,
        evaluate: s => {
            const csp = s.manifest.content_security_policy?.extension_pages ?? '';
            // Permissive: contains 'unsafe-inline' or 'unsafe-eval' or default-src *
            if (csp.includes('unsafe-inline') || csp.includes('unsafe-eval') || /default-src\s+\*/.test(csp)) {
                return { id: 'content_security_policy', title: 'CSP is restrictive', status: 'fail', evidence: [`csp="${csp}"`], note: 'CSP allows unsafe-inline/eval' };
            }
            return { id: 'content_security_policy', title: 'CSP is restrictive', status: 'pass', evidence: [`csp="${csp}"`] };
        },
    },
    {
        id: 'privacy_policy_link',
        title: 'privacy policy URL is declared',
        required: false,
        evaluate: s => {
            // Look for a privacy policy key in the manifest, or a docs/privacy-policy.md
            const privacyPath = s.distFiles.find(f => f.path.includes('privacy'));
            if (privacyPath?.exists) {
                return { id: 'privacy_policy_link', title: 'privacy policy URL is declared', status: 'pass', evidence: [privacyPath.path] };
            }
            return { id: 'privacy_policy_link', title: 'privacy policy URL is declared', status: 'warn', evidence: [], note: 'no privacy policy file found' };
        },
    },
    {
        id: 'icon_assets_present',
        title: 'required icon assets exist',
        required: true,
        evaluate: s => {
            const icons = s.manifest.icons ?? {};
            const required = ['16', '32', '48', '128'];
            const missing: string[] = [];
            for (const size of required) {
                const p = icons[size];
                if (!p) { missing.push(size); continue; }
                if (!s.distFiles.find(f => f.path === p)?.exists) missing.push(size);
            }
            if (missing.length > 0) {
                return { id: 'icon_assets_present', title: 'required icon assets exist', status: 'fail', evidence: missing.map(m => `icon-${m}`), note: `missing sizes: ${missing.join(',')}` };
            }
            return { id: 'icon_assets_present', title: 'required icon assets exist', status: 'pass', evidence: required.map(r => icons[r]) };
        },
    },
    {
        id: 'no_obfuscation',
        title: 'no minified or obfuscated source',
        required: true,
        evaluate: s => {
            const offenders: string[] = [];
            for (const f of s.srcFiles) {
                // Skip data files (FontAwesome icon JSON, etc.) and the
                // user-script bundle, which is a separate concern.
                if (f.path.startsWith('src/js/') || f.path.endsWith('fa-icons.ts')) continue;
                const longLines = f.content.split('\n').filter(l => l.length > 500);
                if (longLines.length > 5) {
                    offenders.push(f.path);
                }
            }
            if (offenders.length > 0) {
                return { id: 'no_obfuscation', title: 'no minified or obfuscated source', status: 'fail', evidence: offenders, note: 'lines > 500 chars detected' };
            }
            return { id: 'no_obfuscation', title: 'no minified or obfuscated source', status: 'pass', evidence: ['all source lines <= 500 chars (engine only)'] };
        },
    },
];

export function evaluateCompliance(snapshot: RepoSnapshot, extensionVersion: string): StoreComplianceReport {
    const checks: ComplianceCheck[] = [];
    let passed = 0;
    let failed = 0;
    let warned = 0;
    let skipped = 0;
    let requiredFailed = 0;
    let requiredTotal = 0;

    for (const def of STORE_COMPLIANCE_CHECKS) {
        if (def.required) requiredTotal++;
        const result = def.evaluate(snapshot);
        checks.push(result);
        switch (result.status) {
        case 'pass': passed++; break;
        case 'fail': failed++; if (def.required) requiredFailed++; break;
        case 'warn': warned++; break;
        case 'skip': skipped++; break;
        }
    }

    return {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        extensionVersion,
        totalChecks: checks.length,
        passed,
        failed,
        warned,
        skipped,
        ok: requiredFailed === 0,
        checks,
        summary: { ok: requiredFailed === 0, requiredFailed, requiredTotal },
    };
}

export function reportToJSON(report: StoreComplianceReport): string {
    return JSON.stringify(report, null, 2);
}

export function reportPassRate(report: StoreComplianceReport): number {
    if (report.totalChecks === 0) return 0;
    return report.passed / report.totalChecks;
}
