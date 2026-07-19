/**
 * Claim validator for the release certificate.
 *
 * The certificate is a set of "claims" (e.g., "static pipeline produced N rules",
 * "cosmetic corpus passed 9/9"). Each claim is verifiable, has a source pointer,
 * and is checked against a fixed schema.
 *
 * Per the Rev15 plan, every claim must:
 *   1. Reference a measurable artifact (a gate output, a JSON file, etc.)
 *   2. Have a typed value (integer, boolean, string, or hash)
 *   3. Pass a per-claim predicate (range check, regex match, etc.)
 *   4. Optionally carry an evidence hash (sha256 of the source artifact)
 *
 * The validator is pure: it takes claims + schema, returns per-claim results
 * and an aggregate ok/fail. The certificate generator (Phase 3.2) uses it
 * to decide Gold/Silver/Bronze/None.
 *
 * §15.5 (Release 1.0) and §16 (Final acceptance).
 */

export type ClaimId = string;

export type ClaimType = 'integer' | 'boolean' | 'string' | 'hash';

export interface Claim {
    id: ClaimId;
    type: ClaimType;
    value: string | number | boolean;
    source: string;
    evidenceHash?: string;
    description?: string;
}

export interface ClaimSchemaEntry {
    id: ClaimId;
    type: ClaimType;
    required: boolean;
    predicate?: (_claim: Claim) => string | null;
}

export interface ClaimValidationResult {
    claimId: ClaimId;
    ok: boolean;
    reason?: string;
}

export interface ClaimValidationReport {
    totalClaims: number;
    requiredClaims: number;
    passedRequired: number;
    failedRequired: number;
    optionalPassed: number;
    optionalFailed: number;
    results: ClaimValidationResult[];
    ok: boolean;
}

/**
 * The default claim schema. Every claim required by the Rev15 plan
 * appears here. Optional claims are not required for the Silver badge.
 *
 * Claims are organized by domain:
 *   - Core gates (required): gate pipeline pass/fail booleans
 *   - Preserved gates (required): release-quality booleans from §1002-1041
 *   - Corpus/performance (optional): optional corpus and perf scores
 *   - Evidence claims (optional): evidence-pipeline assertions for Gold
 */
export const DEFAULT_CLAIM_SCHEMA: ClaimSchemaEntry[] = [
    // ── Core gates (required) ──────────────────────────────────────────
    {
        id: 'manifest_valid',
        type: 'boolean',
        required: true,
        predicate: c => (c.value === true ? null : 'manifest invalid'),
    },
    {
        id: 'no_remote_rule_fetch',
        type: 'boolean',
        required: true,
        predicate: c => (c.value === true ? null : 'remote fetch detected'),
    },
    {
        id: 'static_pipeline_passes',
        type: 'boolean',
        required: true,
        predicate: c => (c.value === true ? null : 'static pipeline gate failed'),
    },
    {
        id: 'static_pipeline_rules',
        type: 'integer',
        required: true,
        predicate: c => (Number(c.value) > 0 ? null : 'static pipeline produced no rules'),
    },
    {
        id: 'static_pipeline_evidence_hash',
        type: 'hash',
        required: true,
        predicate: c => (/^[0-9a-f]{16,64}$/.test(String(c.value)) ? null : 'invalid evidence hash'),
    },
    {
        id: 'user_rules_pipeline_passes',
        type: 'boolean',
        required: true,
        predicate: c => (c.value === true ? null : 'user rules gate failed'),
    },
    {
        id: 'attribution_pipeline_passes',
        type: 'boolean',
        required: true,
        predicate: c => (c.value === true ? null : 'attribution gate failed'),
    },
    {
        id: 'cosmetic_pipeline_passes',
        type: 'boolean',
        required: false,
        predicate: c => (c.value === true ? null : 'cosmetic gate failed'),
    },
    {
        id: 'store_compliance_passes',
        type: 'boolean',
        required: false,
        predicate: c => (c.value === true ? null : 'store compliance failed'),
    },

    // ── Preserved gates from §1002-1041 (required) ─────────────────────
    {
        id: 'static_ruleset_validation_passes',
        type: 'boolean',
        required: true,
        predicate: c => (c.value === true ? null : 'static ruleset validation failed'),
    },
    {
        id: 'source_map_validation_passes',
        type: 'boolean',
        required: true,
        predicate: c => (c.value === true ? null : 'source map validation failed'),
    },
    {
        id: 'dnr_capability_profile_passes',
        type: 'boolean',
        required: true,
        predicate: c => (c.value === true ? null : 'DNR capability profile failed'),
    },
    {
        id: 'safe_dynamic_user_rules_pass',
        type: 'boolean',
        required: true,
        predicate: c => (c.value === true ? null : 'safe dynamic user rules gate failed'),
    },
    {
        id: 'local_import_export_review_pass',
        type: 'boolean',
        required: true,
        predicate: c => (c.value === true ? null : 'local import/export review failed'),
    },
    {
        id: 'dangerous_rule_confirmation_pass',
        type: 'boolean',
        required: true,
        predicate: c => (c.value === true ? null : 'dangerous rule confirmation failed'),
    },
    {
        id: 'cosmetic_safety_policy_pass',
        type: 'boolean',
        required: true,
        predicate: c => (c.value === true ? null : 'cosmetic safety policy gate failed'),
    },
    {
        id: 'has_budget_policy_pass',
        type: 'boolean',
        required: true,
        predicate: c => (c.value === true ? null : ':has() budget policy gate failed'),
    },
    {
        id: 'high_risk_site_policy_pass',
        type: 'boolean',
        required: true,
        predicate: c => (c.value === true ? null : 'high-risk site policy gate failed'),
    },
    {
        id: 'strict_store_build_profile_passes',
        type: 'boolean',
        required: true,
        predicate: c => (c.value === true ? null : 'strict-store build profile failed'),
    },
    {
        id: 'manifest_permission_audit_pass',
        type: 'boolean',
        required: true,
        predicate: c => (c.value === true ? null : 'manifest permission audit failed'),
    },
    {
        id: 'diagnostics_privacy_pass',
        type: 'boolean',
        required: true,
        predicate: c => (c.value === true ? null : 'diagnostics privacy gate failed'),
    },
    {
        id: 'safe_redirect_header_policy_pass',
        type: 'boolean',
        required: true,
        predicate: c => (c.value === true ? null : 'safe redirect/header policy gate failed'),
    },
    {
        id: 'dnr_priority_policy_pass',
        type: 'boolean',
        required: true,
        predicate: c => (c.value === true ? null : 'DNR priority policy gate failed'),
    },
    {
        id: 'production_module_audit_pass',
        type: 'boolean',
        required: true,
        predicate: c => (c.value === true ? null : 'production module audit failed'),
    },
    {
        id: 'forbidden_pattern_audit_pass',
        type: 'boolean',
        required: true,
        predicate: c => (c.value === true ? null : 'forbidden pattern audit failed'),
    },
    {
        id: 'optional_url_import_audit_pass',
        type: 'boolean',
        required: true,
        predicate: c => (c.value === true ? null : 'optional URL import audit failed'),
    },
    {
        id: 'ui_workflow_evidence_pass',
        type: 'boolean',
        required: true,
        predicate: c => (c.value === true ? null : 'UI workflow evidence gate failed'),
    },
    {
        id: 'parser_syntax_report_pass',
        type: 'boolean',
        required: true,
        predicate: c => (c.value === true ? null : 'parser syntax report gate failed'),
    },
    {
        id: 'static_shard_inventory_pass',
        type: 'boolean',
        required: true,
        predicate: c => (c.value === true ? null : 'static shard inventory gate failed'),
    },
    {
        id: 'static_compiler_report_pass',
        type: 'boolean',
        required: true,
        predicate: c => (c.value === true ? null : 'static compiler report gate failed'),
    },
    {
        id: 'baseline_smoke_pass',
        type: 'boolean',
        required: true,
        predicate: c => (c.value === true ? null : 'baseline smoke gate failed'),
    },
    {
        id: 'runtime_code_safety_pass',
        type: 'boolean',
        required: true,
        predicate: c => (c.value === true ? null : 'runtime code safety gate failed'),
    },
    {
        id: 'dnr_action_lane_policy_pass',
        type: 'boolean',
        required: true,
        predicate: c => (c.value === true ? null : 'DNR action lane policy gate failed'),
    },
    {
        id: 'source_map_schema_pass',
        type: 'boolean',
        required: true,
        predicate: c => (c.value === true ? null : 'source-map schema gate failed'),
    },
    {
        id: 'cosmetic_selector_safety_pass',
        type: 'boolean',
        required: true,
        predicate: c => (c.value === true ? null : 'cosmetic selector safety gate failed'),
    },
    {
        id: 'performance_metrics_pass',
        type: 'boolean',
        required: true,
        predicate: c => (c.value === true ? null : 'performance metrics gate failed'),
    },

    // ── Old optional corpus/performance claims (optional) ──────────────
    {
        id: 'cosmetic_corpus_passes',
        type: 'boolean',
        required: false,
        predicate: c => (c.value === true ? null : 'cosmetic corpus failed'),
    },
    {
        id: 'cosmetic_corpus_score',
        type: 'string',
        required: false,
        predicate: c => (/^\d+\/\d+$/.test(String(c.value)) ? null : 'malformed score (expected N/M)'),
    },
    {
        id: 'network_corpus_passes',
        type: 'boolean',
        required: false,
        predicate: c => (c.value === true ? null : 'network corpus failed'),
    },
    {
        id: 'network_corpus_score',
        type: 'string',
        required: false,
        predicate: c => (/^\d+\/\d+$/.test(String(c.value)) ? null : 'malformed score (expected N/M)'),
    },
    {
        id: 'store_compliance_pass_rate',
        type: 'string',
        required: false,
        predicate: c => (/^\d+\.\d+%$/.test(String(c.value)) ? null : 'malformed pass rate (expected N.N%)'),
    },
    {
        id: 'cosmetic_performance_passes',
        type: 'boolean',
        required: false,
        predicate: c => (c.value === true ? null : 'cosmetic performance gate failed'),
    },
    {
        id: 'cosmetic_performance_score',
        type: 'string',
        required: false,
        predicate: c => (/^\d+\/\d+$/.test(String(c.value)) ? null : 'malformed score (expected N/M)'),
    },

    // ── Release profile / evidence claims (optional) ───────────────────
    {
        id: 'release_profile_pinned',
        type: 'boolean',
        required: false,
        predicate: c => (c.value === true ? null : 'release profile not pinned'),
    },
    {
        id: 'evidence_manifest_complete',
        type: 'boolean',
        required: false,
        predicate: c => (c.value === true ? null : 'evidence manifest incomplete'),
    },
    {
        id: 'stale_artifacts_rejected',
        type: 'boolean',
        required: false,
        predicate: c => (c.value === true ? null : 'stale artifacts detected'),
    },
    {
        id: 'dependency_provenance_pinned',
        type: 'boolean',
        required: false,
        predicate: c => (c.value === true ? null : 'dependency provenance not pinned'),
    },
    {
        id: 'source_provenance_pinned',
        type: 'boolean',
        required: true,
        predicate: c => (c.value === true ? null : 'source provenance not pinned'),
    },
    {
        id: 'release_profile_no_placeholders',
        type: 'boolean',
        required: true,
        predicate: c => (c.value === true ? null : 'release profile contains placeholder values'),
    },
    {
        id: 'public_claim_artifact_hashed',
        type: 'boolean',
        required: true,
        predicate: c => (c.value === true ? null : 'public claim artifact not hashed'),
    },
    {
        id: 'stable_evidence_hash_reproducible',
        type: 'boolean',
        required: false,
        predicate: c => (c.value === true ? null : 'stable evidence hash not reproducible'),
    },
    {
        id: 'schema_validation_passes',
        type: 'boolean',
        required: false,
        predicate: c => (c.value === true ? null : 'schema validation failed'),
    },
    {
        id: 'fixture_evidence_rejected',
        type: 'boolean',
        required: false,
        predicate: c => (c.value === true ? null : 'fixture evidence not rejected'),
    },
    {
        id: 'strict_store_profile_pinned',
        type: 'boolean',
        required: false,
        predicate: c => (c.value === true ? null : 'strict-store profile not pinned'),
    },
    {
        id: 'dnr_profile_pinned',
        type: 'boolean',
        required: false,
        predicate: c => (c.value === true ? null : 'DNR profile not pinned'),
    },
    {
        id: 'dnr_version_features_pinned',
        type: 'boolean',
        required: false,
        predicate: c => (c.value === true ? null : 'DNR version features not pinned'),
    },
    {
        id: 'benchmark_harness_reproducible',
        type: 'boolean',
        required: false,
        predicate: c => (c.value === true ? null : 'benchmark harness not reproducible'),
    },
    {
        id: 'benchmark_methodology_pinned',
        type: 'boolean',
        required: false,
        predicate: c => (c.value === true ? null : 'benchmark methodology not pinned'),
    },
    {
        id: 'benchmark_environment_pinned',
        type: 'boolean',
        required: false,
        predicate: c => (c.value === true ? null : 'benchmark environment not pinned'),
    },
    {
        id: 'cache_and_cold_warm_policy_pinned',
        type: 'boolean',
        required: false,
        predicate: c => (c.value === true ? null : 'cache/cold-warm policy not pinned'),
    },
    {
        id: 'no_undeclared_user_state',
        type: 'boolean',
        required: false,
        predicate: c => (c.value === true ? null : 'undeclared user state detected'),
    },
    {
        id: 'attribution_api_shape_valid',
        type: 'boolean',
        required: false,
        predicate: c => (c.value === true ? null : 'attribution API shape invalid'),
    },
    {
        id: 'attribution_policy_pinned',
        type: 'boolean',
        required: false,
        predicate: c => (c.value === true ? null : 'attribution policy not pinned'),
    },
    {
        id: 'attribution_privacy_passes',
        type: 'boolean',
        required: false,
        predicate: c => (c.value === true ? null : 'attribution privacy failed'),
    },

    // ── Comparator / superiority claims (optional) ─────────────────────
    {
        id: 'comparator_pinned',
        type: 'boolean',
        required: false,
        predicate: c => (c.value === true ? null : 'comparator not pinned'),
    },
    {
        id: 'comparator_predeclared',
        type: 'boolean',
        required: false,
        predicate: c => (c.value === true ? null : 'comparator not predeclared'),
    },
    {
        id: 'browser_profile_pinned',
        type: 'boolean',
        required: false,
        predicate: c => (c.value === true ? null : 'browser profile not pinned'),
    },
    {
        id: 'candidate_package_pinned',
        type: 'boolean',
        required: false,
        predicate: c => (c.value === true ? null : 'candidate package not pinned'),
    },
    {
        id: 'candidate_package_matches_benchmark',
        type: 'boolean',
        required: false,
        predicate: c => (c.value === true ? null : 'candidate package does not match benchmark'),
    },
    {
        id: 'submitted_package_matches_audited_package',
        type: 'boolean',
        required: false,
        predicate: c => (c.value === true ? null : 'submitted package mismatch'),
    },
    {
        id: 'candidate_runtime_state_pinned',
        type: 'boolean',
        required: false,
        predicate: c => (c.value === true ? null : 'candidate runtime state not pinned'),
    },
    {
        id: 'comparator_runtime_state_pinned',
        type: 'boolean',
        required: false,
        predicate: c => (c.value === true ? null : 'comparator runtime state not pinned'),
    },
    {
        id: 'corpus_provenance_pinned',
        type: 'boolean',
        required: false,
        predicate: c => (c.value === true ? null : 'corpus provenance not pinned'),
    },
    {
        id: 'corpus_selection_predeclared',
        type: 'boolean',
        required: false,
        predicate: c => (c.value === true ? null : 'corpus selection not predeclared'),
    },
    {
        id: 'corpus_hashes_match',
        type: 'boolean',
        required: false,
        predicate: c => (c.value === true ? null : 'corpus hashes do not match'),
    },
    {
        id: 'score_stability_passes',
        type: 'boolean',
        required: false,
        predicate: c => (c.value === true ? null : 'score stability check failed'),
    },
    {
        id: 'network_comparator_evidence_present',
        type: 'boolean',
        required: false,
        predicate: c => (c.value === true ? null : 'network comparator evidence missing'),
    },
    {
        id: 'network_superiority_passes',
        type: 'boolean',
        required: false,
        predicate: c => (c.value === true ? null : 'network superiority not proven'),
    },
    {
        id: 'cosmetic_comparator_evidence_present',
        type: 'boolean',
        required: false,
        predicate: c => (c.value === true ? null : 'cosmetic comparator evidence missing'),
    },
    {
        id: 'cosmetic_superiority_passes',
        type: 'boolean',
        required: false,
        predicate: c => (c.value === true ? null : 'cosmetic superiority not proven'),
    },

    // ── Public claim / disclosure claims (optional) ────────────────────
    {
        id: 'public_claim_text_valid',
        type: 'boolean',
        required: false,
        predicate: c => (c.value === true ? null : 'public claim text invalid'),
    },
    {
        id: 'unsupported_syntax_disclosed',
        type: 'boolean',
        required: false,
        predicate: c => (c.value === true ? null : 'unsupported syntax not disclosed'),
    },
    {
        id: 'claim_exclusions_disclosed',
        type: 'boolean',
        required: false,
        predicate: c => (c.value === true ? null : 'claim exclusions not disclosed'),
    },
    {
        id: 'release_notes_disclose_exclusions',
        type: 'boolean',
        required: false,
        predicate: c => (c.value === true ? null : 'release notes do not disclose exclusions'),
    },

    // ── Source-map coverage claims (optional) ──────────────────────────
    {
        id: 'source_map_coverage_valid',
        type: 'boolean',
        required: false,
        predicate: c => (c.value === true ? null : 'source-map coverage invalid'),
    },
    {
        id: 'source_map_keys_ruleset_ruleid',
        type: 'boolean',
        required: false,
        predicate: c => (c.value === true ? null : 'source-map keys not in rulesetId:ruleId format'),
    },

    // ── Packed-release attestation claims (optional) ───────────────────
    {
        id: 'packed_release_excludes_onRuleMatchedDebug',
        type: 'boolean',
        required: false,
        predicate: c => (c.value === true ? null : 'onRuleMatchedDebug present in packed release'),
    },
    {
        id: 'strict_store_url_import_removed',
        type: 'boolean',
        required: false,
        predicate: c => (c.value === true ? null : 'URL import assistant not removed from strict-store build'),
    },
    {
        id: 'guaranteed_static_profile_enforced',
        type: 'boolean',
        required: false,
        predicate: c => (c.value === true ? null : 'static profile mode is not guaranteed'),
    },
    {
        id: 'dnr_capability_profile_enforced',
        type: 'boolean',
        required: false,
        predicate: c => (c.value === true ? null : 'DNR capability profile not enforced'),
    },
    {
        id: 'unsupported_for_browser_profile_reported',
        type: 'boolean',
        required: false,
        predicate: c => (c.value === true ? null : 'unsupported-for-browser-profile not reported'),
    },
    {
        id: 'no_priority_tie_dependency',
        type: 'boolean',
        required: false,
        predicate: c => (c.value === true ? null : 'DNR priority tie dependency detected'),
    },
    {
        id: 'rev15_syntax_policy_enforced',
        type: 'boolean',
        required: false,
        predicate: c => (c.value === true ? null : 'Rev15 syntax policy not enforced'),
    },
    {
        id: 'rule_budget_limits_enforced',
        type: 'boolean',
        required: false,
        predicate: c => (c.value === true ? null : 'rule budget limits not enforced'),
    },
    {
        id: 'performance_metrics_present',
        type: 'boolean',
        required: false,
        predicate: c => (c.value === true ? null : 'performance metrics absent from certificate'),
    },
    {
        id: 'user_rule_workspace_evidence_present',
        type: 'boolean',
        required: false,
        predicate: c => (c.value === true ? null : 'user-rule workspace evidence missing'),
    },
    {
        id: 'session_rules_temporary_only',
        type: 'boolean',
        required: false,
        predicate: c => (c.value === true ? null : 'session rules not cleared on shutdown/update'),
    },
    {
        id: 'session_rule_lifecycle_enforced',
        type: 'boolean',
        required: false,
        predicate: c => (c.value === true ? null : 'session rule lifecycle not enforced'),
    },
    {
        id: 'popup_quick_actions_present',
        type: 'boolean',
        required: false,
        predicate: c => (c.value === true ? null : 'popup quick actions missing'),
    },
    {
        id: 'diagnostics_fields_present',
        type: 'boolean',
        required: false,
        predicate: c => (c.value === true ? null : 'diagnostics fields missing'),
    },
    {
        id: 'unsupported_recognized_syntax_reported',
        type: 'boolean',
        required: false,
        predicate: c => (c.value === true ? null : 'unsupported-recognized syntax not reported'),
    },
    {
        id: 'badfilter_resolver_evidence_present',
        type: 'boolean',
        required: false,
        predicate: c => (c.value === true ? null : 'badfilter resolver evidence missing'),
    },
    {
        id: 'public_harness_available',
        type: 'boolean',
        required: false,
        predicate: c => (c.value === true ? null : 'public benchmark harness unavailable'),
    },

    // ── Additional strict claims from spec §6 (optional) ──────────────
    {
        id: 'safe_dynamic_user_rules_enforced',
        type: 'boolean',
        required: false,
        predicate: c => (c.value === true ? null : 'safe dynamic user rules not enforced'),
    },
    {
        id: 'dangerous_rule_confirmation_enforced',
        type: 'boolean',
        required: false,
        predicate: c => (c.value === true ? null : 'dangerous rule confirmation not enforced'),
    },
    {
        id: 'local_import_export_reviewed',
        type: 'boolean',
        required: false,
        predicate: c => (c.value === true ? null : 'local import/export not reviewed'),
    },
    {
        id: 'cosmetic_safety_policy_enforced',
        type: 'boolean',
        required: false,
        predicate: c => (c.value === true ? null : 'cosmetic safety policy not enforced'),
    },
    {
        id: 'has_budget_policy_enforced',
        type: 'boolean',
        required: false,
        predicate: c => (c.value === true ? null : ':has() budget policy not enforced'),
    },
    {
        id: 'high_risk_site_policy_enforced',
        type: 'boolean',
        required: false,
        predicate: c => (c.value === true ? null : 'high-risk site policy not enforced'),
    },
    {
        id: 'safe_redirect_header_policy_enforced',
        type: 'boolean',
        required: false,
        predicate: c => (c.value === true ? null : 'safe redirect/header policy not enforced'),
    },
    {
        id: 'diagnostics_export_privacy_enforced',
        type: 'boolean',
        required: false,
        predicate: c => (c.value === true ? null : 'diagnostics export privacy not enforced'),
    },
    {
        id: 'manifest_permissions_pinned',
        type: 'boolean',
        required: false,
        predicate: c => (c.value === true ? null : 'manifest permissions not pinned'),
    },
    {
        id: 'permission_justification_present',
        type: 'boolean',
        required: false,
        predicate: c => (c.value === true ? null : 'permission justification missing'),
    },
    {
        id: 'dnr_priority_policy_enforced',
        type: 'boolean',
        required: false,
        predicate: c => (c.value === true ? null : 'DNR priority policy not enforced'),
    },
    {
        id: 'production_module_audit_passes',
        type: 'boolean',
        required: false,
        predicate: c => (c.value === true ? null : 'production module audit not passing'),
    },
    {
        id: 'unsupported_runtime_modules_excluded',
        type: 'boolean',
        required: false,
        predicate: c => (c.value === true ? null : 'unsupported runtime modules not excluded'),
    },
    {
        id: 'forbidden_update_patterns_absent',
        type: 'boolean',
        required: false,
        predicate: c => (c.value === true ? null : 'forbidden update patterns present'),
    },
    {
        id: 'optional_url_import_safeguards_enforced',
        type: 'boolean',
        required: false,
        predicate: c => (c.value === true ? null : 'optional URL import safeguards not enforced'),
    },
    {
        id: 'ui_workflow_evidence_present',
        type: 'boolean',
        required: false,
        predicate: c => (c.value === true ? null : 'UI workflow evidence missing'),
    },
    {
        id: 'parser_syntax_evidence_present',
        type: 'boolean',
        required: false,
        predicate: c => (c.value === true ? null : 'parser syntax evidence missing'),
    },
    {
        id: 'static_shard_inventory_pinned',
        type: 'boolean',
        required: false,
        predicate: c => (c.value === true ? null : 'static shard inventory not pinned'),
    },
    {
        id: 'static_compiler_budget_report_present',
        type: 'boolean',
        required: false,
        predicate: c => (c.value === true ? null : 'static compiler budget report missing'),
    },
    {
        id: 'baseline_smoke_passes',
        type: 'boolean',
        required: false,
        predicate: c => (c.value === true ? null : 'baseline smoke not passing'),
    },
    {
        id: 'runtime_code_safety_passes',
        type: 'boolean',
        required: false,
        predicate: c => (c.value === true ? null : 'runtime code safety not passing'),
    },
    {
        id: 'dnr_action_lane_policy_enforced',
        type: 'boolean',
        required: false,
        predicate: c => (c.value === true ? null : 'DNR action lane policy not enforced'),
    },
    {
        id: 'source_map_schema_enforced',
        type: 'boolean',
        required: false,
        predicate: c => (c.value === true ? null : 'source-map schema not enforced'),
    },
    {
        id: 'cosmetic_selector_safety_enforced',
        type: 'boolean',
        required: false,
        predicate: c => (c.value === true ? null : 'cosmetic selector safety not enforced'),
    },
];

export function claimById(claims: Claim[], id: ClaimId): Claim | undefined {
    return claims.find(c => c.id === id);
}

export function validateClaims(
    claims: Claim[],
    schema: ClaimSchemaEntry[] = DEFAULT_CLAIM_SCHEMA,
): ClaimValidationReport {
    const results: ClaimValidationResult[] = [];
    let passedRequired = 0;
    let failedRequired = 0;
    let optionalPassed = 0;
    let optionalFailed = 0;
    let requiredClaims = 0;

    for (const entry of schema) {
        if (entry.required) requiredClaims++;
        const claim = claimById(claims, entry.id);

        if (!claim) {
            const reason = entry.required ? 'missing required claim' : 'missing optional claim';
            results.push({ claimId: entry.id, ok: false, reason });
            if (entry.required) failedRequired++;
            else optionalFailed++;
            continue;
        }

        if (claim.type !== entry.type) {
            const reason = `type mismatch: schema=${entry.type} claim=${claim.type}`;
            results.push({ claimId: entry.id, ok: false, reason });
            if (entry.required) failedRequired++;
            else optionalFailed++;
            continue;
        }

        if (entry.predicate) {
            const reason = entry.predicate(claim);
            if (reason) {
                results.push({ claimId: entry.id, ok: false, reason });
                if (entry.required) failedRequired++;
                else optionalFailed++;
                continue;
            }
        }

        results.push({ claimId: entry.id, ok: true });
        if (entry.required) passedRequired++;
        else optionalPassed++;
    }

    return {
        totalClaims: schema.length,
        requiredClaims,
        passedRequired,
        failedRequired,
        optionalPassed,
        optionalFailed,
        results,
        ok: failedRequired === 0,
    };
}

/**
 * djb2-style 64-bit hash, hex-truncated to 16 chars. Stable across runs.
 * Used to fingerprint a claims list for the certificate.
 */
export function computeClaimsFingerprint(claims: Claim[]): string {
    const sorted = [...claims].sort((a, b) => a.id.localeCompare(b.id));
    const text = sorted
        .map(c => `${c.id}:${c.type}:${String(c.value)}:${c.source}:${c.evidenceHash ?? ''}`)
        .join('|');
    let h1 = 0xdeadbeef ^ 0;
    let h2 = 0x41c6ce57 ^ 0;
    for (let i = 0; i < text.length; i++) {
        const ch = text.charCodeAt(i);
        h1 = Math.imul(h1 ^ ch, 2654435761);
        h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    const combined = (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0');
    return combined.slice(0, 16);
}

/**
 * Convenience: returns the list of failing required claims (empty if all pass).
 */
export function failedRequiredClaims(report: ClaimValidationReport, schema: ClaimSchemaEntry[] = DEFAULT_CLAIM_SCHEMA): ClaimId[] {
    const requiredIds = new Set(schema.filter(e => e.required).map(e => e.id));
    return report.results.filter(r => requiredIds.has(r.claimId) && !r.ok).map(r => r.claimId);
}
