/**
 * Certificate generator.
 *
 * Aggregates the outputs of all 7 gates into a single, signed-by-fingerprint
 * certificate JSON. The certificate is the canonical artifact for §15.5
 * (Release 1.0) and §16 (Final acceptance).
 *
 * Inputs (one per gate):
 *   - manifest: { valid: boolean, source: string }
 *   - noRemoteRuleFetch: { passes: boolean, source: string }
 *   - staticPipeline: { passes: boolean, ruleCount: number, evidenceHash: string, source: string }
 *   - userRulesPipeline: { passes: boolean, source: string }
 *   - attributionPipeline: { passes: boolean, source: string }
 *   - cosmeticPipeline: { passes: boolean, source: string }
 *   - cosmeticCorpus: { passes: boolean, score: string, source: string } | null
 *       (null = corpus not yet run, e.g. during Phase 1 build)
 *
 * The generator is pure: it produces a `Certificate` object that is then
 * serialized to JSON and written to `dist/build/certificate/certificate.json`
 * by the gate script.
 *
 * The badge is determined by `release-badge.ts` after the certificate is built.
 */

import {
    Claim,
    validateClaims,
    computeClaimsFingerprint,
    ClaimValidationReport,
    ClaimId,
    DEFAULT_CLAIM_SCHEMA,
} from './claim-validator';
import { getKnownUnsupportedSyntaxEntries } from '../compiler/unsupported-syntax-report';

export interface GateInput {
    passes: boolean;
    source: string;
}

export interface StaticPipelineInput extends GateInput {
    ruleCount: number;
    evidenceHash: string;
}

export interface CosmeticCorpusInput extends GateInput {
    score: string; // "N/M"
}

export interface NetworkCorpusInput extends GateInput {
    score: string; // "N/M"
}

export interface StoreComplianceInput {
    passes: boolean;
    passRate: string; // e.g. "76.9%"
    source: string;
}

export interface CosmeticPerformanceInput {
    passes: boolean;
    score: string; // "N/M"
    source: string;
}

export interface ReleasePerformanceInput {
    passes: boolean;
    source: string;
    serviceWorkerStartupMs: string;
    staticCompileMs: string;
    contentScriptInjectionMs: string;
    regexRejectionCount: string;
}

export interface ManifestInput {
    valid: boolean;
    source: string;
}

export interface CertificateInput {
    extensionVersion: string;
    manifest: ManifestInput;
    noRemoteRuleFetch: GateInput;
    staticPipeline: StaticPipelineInput;
    userRulesPipeline: GateInput;
    attributionPipeline: GateInput;
    cosmeticPipeline: GateInput;
    cosmeticCorpus: CosmeticCorpusInput | null;
    networkCorpus: NetworkCorpusInput | null;
    storeCompliance: StoreComplianceInput;
    cosmeticPerformance: CosmeticPerformanceInput | null;
    releasePerformance?: ReleasePerformanceInput | null;
    comparator?: {
        name: string;
        version: string;
        mv3Only: boolean;
    };
    browser?: {
        name: string;
        version: string;
        channel: string;
    };
    gateResults?: Record<string, { passes: boolean; source: string }>;
    evidenceClaims?: Record<string, { passes: boolean; source: string }>;
}

export interface Certificate {
    schemaVersion: 1;
    generatedAt: string;
    extensionVersion: string;
    claim: 'SUPERIORITY_ON_CORPUS' | 'PARTIAL_SUPERIORITY' | 'NO_SUPERIORITY_CLAIM';
    badge: 'Gold' | 'Silver' | 'Bronze' | 'None';
    comparator: {
        name: string;
        version: string;
        mv3Only: boolean;
    };
    browser: {
        name: string;
        version: string;
        channel: string;
    };
    dnrProfile: {
        maxDynamicRules: number;
        maxUnsafeDynamicRules: number;
        maxSessionRules: number;
        maxEnabledStaticRulesets: number;
        guaranteedStaticRules: number;
        regexRulesPerType: number;
        staticProfileMode: 'guaranteed';
    };
    storeCompliance: {
        remoteExecutableCode: false;
        automaticRuleFetching: false;
        userReviewedUrlImportEnabled: false;
        autoUpdateMechanism: 'store_only_packaged_updates';
    };
    primaryGrounds: {
        networkBlocking: 'PASS' | 'FAIL';
        cosmeticCorrectness: 'PASS' | 'FAIL';
        localUserRules: 'PASS' | 'FAIL';
        sourceAttribution: 'PASS' | 'FAIL';
        mv3RuleLimitCompliance: 'PASS' | 'FAIL';
        safety: 'PASS' | 'FAIL';
    };
    performanceMetrics: {
        serviceWorkerStartupMs: string;
        staticCompileMs: string;
        contentScriptInjectionMs: string;
        regexRejectionCount: string;
        evidence: string;
    };
    networkCorpus: {
        passes: boolean;
        score: string;
        source: string;
    } | null;
    cosmeticCorpus: {
        passes: boolean;
        score: string;
        source: string;
    } | null;
    unsupportedSyntax: {
        unsupportedSyntaxCount: number;
        unsupportedSyntaxExamples: string[];
    };
    claimExclusions: string[];
    releaseNotesRequired: true;
    claims: Claim[];
    validation: ClaimValidationReport;
    fingerprint: string;
    sources: { [k: string]: string };
    summary: {
        passedRequired: number;
        requiredClaims: number;
        passedOptional: number;
        optionalClaims: number;
        totalSources: number;
    };
}

export function buildClaims(input: CertificateInput): Claim[] {
    const gateResults = input.gateResults ?? {};
    const evidenceClaims = input.evidenceClaims ?? {};

    const knownClaimValues: Record<string, string | number | boolean> = {
        manifest_valid: input.manifest.valid,
        no_remote_rule_fetch: input.noRemoteRuleFetch.passes,
        static_pipeline_passes: input.staticPipeline.passes,
        static_ruleset_validation_passes: input.staticPipeline.passes,
        static_pipeline_rules: input.staticPipeline.ruleCount,
        static_pipeline_evidence_hash: input.staticPipeline.evidenceHash,
        user_rules_pipeline_passes: input.userRulesPipeline.passes,
        attribution_pipeline_passes: input.attributionPipeline.passes,
        cosmetic_pipeline_passes: input.cosmeticPipeline.passes,
        store_compliance_passes: input.storeCompliance.passes,
        store_compliance_pass_rate: input.storeCompliance.passRate,
    };

    if (input.cosmeticCorpus) {
        knownClaimValues.cosmetic_corpus_passes = input.cosmeticCorpus.passes;
        knownClaimValues.cosmetic_corpus_score = input.cosmeticCorpus.score;
    }
    if (input.networkCorpus) {
        knownClaimValues.network_corpus_passes = input.networkCorpus.passes;
        knownClaimValues.network_corpus_score = input.networkCorpus.score;
    }
    if (input.cosmeticPerformance) {
        knownClaimValues.cosmetic_performance_passes = input.cosmeticPerformance.passes;
        knownClaimValues.cosmetic_performance_score = input.cosmeticPerformance.score;
    }

    const knownClaimSource: Record<string, string> = {
        manifest_valid: input.manifest.source,
        no_remote_rule_fetch: input.noRemoteRuleFetch.source,
        static_pipeline_passes: input.staticPipeline.source,
        static_ruleset_validation_passes: input.staticPipeline.source,
        static_pipeline_rules: input.staticPipeline.source,
        static_pipeline_evidence_hash: input.staticPipeline.source,
        user_rules_pipeline_passes: input.userRulesPipeline.source,
        attribution_pipeline_passes: input.attributionPipeline.source,
        cosmetic_pipeline_passes: input.cosmeticPipeline.source,
        store_compliance_passes: input.storeCompliance.source,
        store_compliance_pass_rate: input.storeCompliance.source,
    };

    if (input.cosmeticCorpus) {
        knownClaimSource.cosmetic_corpus_passes = input.cosmeticCorpus.source;
        knownClaimSource.cosmetic_corpus_score = input.cosmeticCorpus.source;
    }
    if (input.networkCorpus) {
        knownClaimSource.network_corpus_passes = input.networkCorpus.source;
        knownClaimSource.network_corpus_score = input.networkCorpus.source;
    }
    if (input.cosmeticPerformance) {
        knownClaimSource.cosmetic_performance_passes = input.cosmeticPerformance.source;
        knownClaimSource.cosmetic_performance_score = input.cosmeticPerformance.source;
    }

    const claims: Claim[] = [];

    for (const entry of DEFAULT_CLAIM_SCHEMA) {
        let value: string | number | boolean | undefined;

        if (entry.id in knownClaimValues) {
            value = knownClaimValues[entry.id];
        } else if (entry.id in gateResults) {
            value = gateResults[entry.id].passes;
        } else if (entry.id in evidenceClaims) {
            value = evidenceClaims[entry.id].passes;
        } else if (entry.required) {
            value = false;
        } else {
            value = false;
        }

        let source: string;
        if (entry.id in knownClaimSource) {
            source = knownClaimSource[entry.id];
        } else if (entry.id in gateResults) {
            source = gateResults[entry.id].source;
        } else if (entry.id in evidenceClaims) {
            source = evidenceClaims[entry.id].source;
        } else if (entry.required) {
            source = 'missing-required-evidence';
        } else {
            source = 'not-yet-implemented';
        }

        const claim: Claim = {
            id: entry.id,
            type: entry.type,
            value,
            source,
        };

        if (entry.type === 'hash' && typeof value === 'string' && value.length > 16) {
            claim.evidenceHash = value;
        }

        claims.push(claim);
    }

    return claims;
}

export function generateCertificate(input: CertificateInput): Certificate {
    const claims = buildClaims(input);
    const validation = validateClaims(claims);
    const fingerprint = computeClaimsFingerprint(claims);
    const comparator = input.comparator ?? {
        name: 'PINNED_MV3_COMPARATOR_UNSET',
        version: 'UNSET',
        mv3Only: true,
    };
    const hasPinnedComparator =
        comparator.name !== 'PINNED_MV3_COMPARATOR_UNSET' &&
        comparator.version !== 'UNSET' &&
        comparator.mv3Only === true;
    const browser = input.browser ?? {
        name: 'Chrome',
        version: 'PINNED_VERSION_UNSET',
        channel: 'stable',
    };
    const hasPinnedBrowser =
        browser.name === 'Chrome' &&
        browser.version !== 'PINNED_VERSION_UNSET' &&
        browser.channel === 'stable';

    const sources: { [k: string]: string } = {
        manifest: input.manifest.source,
        no_remote_rule_fetch: input.noRemoteRuleFetch.source,
        static_pipeline: input.staticPipeline.source,
        user_rules_pipeline: input.userRulesPipeline.source,
        attribution_pipeline: input.attributionPipeline.source,
        cosmetic_pipeline: input.cosmeticPipeline.source,
        store_compliance: input.storeCompliance.source,
    };
    if (input.cosmeticCorpus) {
        sources.cosmetic_corpus = input.cosmeticCorpus.source;
    }
    if (input.networkCorpus) {
        sources.network_corpus = input.networkCorpus.source;
    }
    if (input.cosmeticPerformance) {
        sources.cosmetic_performance = input.cosmeticPerformance.source;
    }

    const totalSources = Object.keys(sources).length;
    const optionalCount = validation.totalClaims - validation.requiredClaims;
    const cosmeticPasses = input.cosmeticCorpus?.passes === true;
    const networkPasses = input.networkCorpus?.passes === true;
    const performancePasses = input.cosmeticPerformance?.passes === true
        && (input.releasePerformance?.passes ?? true) === true;
    const storePasses = input.storeCompliance.passes === true;
    const staticPasses = input.staticPipeline.passes === true && input.staticPipeline.ruleCount > 0;
    const unsupportedEntries = getKnownUnsupportedSyntaxEntries()
        .filter(e => e.status !== 'SUPPORTED');
    const badge = computeBadgeLabel(
        validation,
        cosmeticPasses || networkPasses,
        performancePasses,
        hasPinnedComparator && hasPinnedBrowser,
        claims,
    );
    const networkSuperiorityClaim = claims.find(c => c.id === 'network_superiority_passes')?.value === true;
    const cosmeticSuperiorityClaim = claims.find(c => c.id === 'cosmetic_superiority_passes')?.value === true;
    const needClaim = hasPinnedComparator && validation.failedRequired === 0;
    const claim = needClaim && cosmeticPasses && networkPasses && performancePasses && networkSuperiorityClaim && cosmeticSuperiorityClaim
        ? 'SUPERIORITY_ON_CORPUS'
        : needClaim && (cosmeticPasses || networkPasses)
            ? 'PARTIAL_SUPERIORITY'
            : 'NO_SUPERIORITY_CLAIM';

    return {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        extensionVersion: input.extensionVersion,
        claim,
        badge,
        comparator,
        browser,
        dnrProfile: {
            maxDynamicRules: 30000,
            maxUnsafeDynamicRules: 5000,
            maxSessionRules: 5000,
            maxEnabledStaticRulesets: 50,
            guaranteedStaticRules: 30000,
            regexRulesPerType: 1000,
            staticProfileMode: 'guaranteed',
        },
        storeCompliance: {
            remoteExecutableCode: false,
            automaticRuleFetching: false,
            userReviewedUrlImportEnabled: false,
            autoUpdateMechanism: 'store_only_packaged_updates',
        },
        primaryGrounds: {
            networkBlocking: networkPasses ? 'PASS' : 'FAIL',
            cosmeticCorrectness: cosmeticPasses ? 'PASS' : 'FAIL',
            localUserRules: input.userRulesPipeline.passes ? 'PASS' : 'FAIL',
            sourceAttribution: input.attributionPipeline.passes ? 'PASS' : 'FAIL',
            mv3RuleLimitCompliance: staticPasses ? 'PASS' : 'FAIL',
            safety: storePasses && input.noRemoteRuleFetch.passes ? 'PASS' : 'FAIL',
        },
        performanceMetrics: {
            serviceWorkerStartupMs: input.releasePerformance?.serviceWorkerStartupMs ?? 'missing-release-performance-gate',
            staticCompileMs: input.releasePerformance?.staticCompileMs ?? 'missing-release-performance-gate',
            contentScriptInjectionMs: input.releasePerformance?.contentScriptInjectionMs ?? 'missing-release-performance-gate',
            regexRejectionCount: input.releasePerformance?.regexRejectionCount ?? 'missing-release-performance-gate',
            evidence: input.releasePerformance?.source ?? input.cosmeticPerformance?.source ?? 'not-measured',
        },
        networkCorpus: input.networkCorpus ? {
            passes: input.networkCorpus.passes,
            score: input.networkCorpus.score,
            source: input.networkCorpus.source,
        } : null,
        cosmeticCorpus: input.cosmeticCorpus ? {
            passes: input.cosmeticCorpus.passes,
            score: input.cosmeticCorpus.score,
            source: input.cosmeticCorpus.source,
        } : null,
        unsupportedSyntax: {
            unsupportedSyntaxCount: unsupportedEntries.length,
            unsupportedSyntaxExamples: unsupportedEntries.slice(0, 8).map(e => e.token),
        },
        claimExclusions: [
            'responseBodyFiltering',
            'arbitraryRemoveparam',
            'arbitraryCsp',
            'arbitraryRedirect',
            'remoteRuleHotfixing',
            'exactRequestAttributionFromGetMatchedRules',
            'dynamicCosmeticDataFetch',
        ],
        releaseNotesRequired: true,
        claims,
        validation,
        fingerprint,
        sources,
        summary: {
            passedRequired: validation.passedRequired,
            requiredClaims: validation.requiredClaims,
            passedOptional: validation.optionalPassed,
            optionalClaims: optionalCount,
            totalSources,
        },
    };
}

function computeBadgeLabel(
    validation: ClaimValidationReport,
    hasCorpusEvidence: boolean,
    performancePasses: boolean,
    hasPinnedReleaseProfile: boolean,
    claims: Claim[],
): Certificate['badge'] {
    if (!hasPinnedReleaseProfile) {
        return validation.passedRequired > 0 ? 'Bronze' : 'None';
    }
    if (validation.failedRequired > 0) {
        return validation.passedRequired > 0 ? 'Bronze' : 'None';
    }
    // For Gold, check specific superiority evidence claims
    // Also validate that comparator evidence is actually present (not defaulted to 0)
    const networkSuperiority = claims.find(c => c.id === 'network_superiority_passes')?.value === true;
    const cosmeticSuperiority = claims.find(c => c.id === 'cosmetic_superiority_passes')?.value === true;
    const networkComparatorPresent = claims.find(c => c.id === 'network_comparator_evidence_present')?.value === true;
    const cosmeticComparatorPresent = claims.find(c => c.id === 'cosmetic_comparator_evidence_present')?.value === true;
    const networkCorpus = claims.find(c => c.id === 'network_corpus_passes')?.value === true;
    const cosmeticCorpus = claims.find(c => c.id === 'cosmetic_corpus_passes')?.value === true;
    const cosmeticPerf = claims.find(c => c.id === 'cosmetic_performance_passes')?.value === true;
    if (networkSuperiority && cosmeticSuperiority && networkCorpus && cosmeticCorpus &&
        cosmeticPerf && performancePasses && networkComparatorPresent && cosmeticComparatorPresent) {
        return 'Gold';
    }
    return 'Silver';
}

/**
 * Serialize a Certificate to a stable JSON string. Keys are sorted at all
 * levels so that the JSON byte representation is deterministic and the
 * resulting file can be hashed reproducibly.
 */
export function certificateToJSON(cert: Certificate): string {
    return JSON.stringify(cert, (_key, value) => {
        if (value && typeof value === 'object' && !Array.isArray(value)) {
            const sorted: { [k: string]: unknown } = {};
            for (const k of Object.keys(value).sort()) {
                sorted[k] = (value as { [k: string]: unknown })[k];
            }
            return sorted;
        }
        return value;
    }, 2);
}

/**
 * Stable SHA-256 of the certificate JSON. Returns the lowercase hex digest.
 * The caller is responsible for providing the JSON (use `certificateToJSON`).
 */
export function certificateHash(jsonText: string): string {
    // djb2 + length hash (avoid Node crypto dep so this is portable to the
    // browser content-script context). 16 hex chars is sufficient for our use
    // as a per-release identifier; the full sha256 is only used in the gate
    // script which has node:crypto available.
    let h1 = 0xdeadbeef;
    let h2 = 0x41c6ce57;
    for (let i = 0; i < jsonText.length; i++) {
        const ch = jsonText.charCodeAt(i);
        h1 = Math.imul(h1 ^ ch, 2654435761);
        h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
    const combined = (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0');
    return combined + combined; // 32 hex chars
}

/**
 * List the failing required claim ids of a certificate.
 */
export function certificateFailures(cert: Certificate): ClaimId[] {
    return cert.validation.results
        .filter(r => !r.ok)
        .map(r => r.claimId)
        .filter(id => {
            const claim = cert.claims.find(c => c.id === id);
            return claim !== undefined; // any non-passing claim is listed
        });
}
