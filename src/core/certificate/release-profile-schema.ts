export const RELEASE_PROFILE_SCHEMA_VERSION = 1;

export const PLACEHOLDER_PATTERN = /^(UNSET|PINNED_.*_UNSET|latest|current|nightly|dev|canary|unknown)$/;
export const SHA256_PATTERN = /^[0-9a-f]{64}$/;

export function isPlaceholder(value: string): boolean {
    return PLACEHOLDER_PATTERN.test(value);
}

export function isValidSha256(value: string): boolean {
    return SHA256_PATTERN.test(value);
}

export interface SchemaMeta {
  releaseProfileSchemaVersion: number;
  releaseProfileSchemaHash: string;
  unknownCriticalFieldsPolicy: 'fail-closed';
}

export interface CertificateReproducibility {
  sourceDateEpoch: number | null;
  generatedAtPolicy: 'excluded-from-stable-evidence-hash-or-pinned-by-source-date-epoch';
  canonicalJsonPolicy: 'sorted-keys-no-unstable-metadata';
  stableEvidenceHash: string;
}

export interface SourceProvenance {
  gitCommit: string;
  dirtyWorktree: boolean;
  sourceTreeHash: string;
  packageLockHash: string;
  packageManager: string;
  installCommand: string;
  dependencyTreeHash: string;
  nodeVersion: string;
  npmVersion: string;
}

export interface EvidenceManifestSection {
  inputManifestHash: string;
  allArtifactsRegeneratedInThisRun: boolean;
  artifactHashes: { [artifactName: string]: string };
}

export interface CandidateInfo {
  name: string;
  version: string;
  buildCommand: string;
  packagePath: string;
  packageSha256: string;
  submittedPackagePath: string;
  submittedPackageSha256: string;
  submittedPackageType: 'zip' | 'crx' | 'directory-manifest';
  manifestSha256: string;
  dnrRulesetSha256: string;
  sourceMapSha256: string;
  unsupportedSyntaxReportSha256: string;
}

export interface RuntimeState {
  settingsHash: string;
  enabledStaticRulesetsHash: string;
  disabledStaticRuleIdsHash: string;
  dynamicRulesHash: string;
  sessionRulesHash: string;
  userRulesLedgerHash: string;
  localStorageSnapshotHash: string;
  sessionStorageSnapshotHash: string;
  serviceWorkerStatePolicy: string;
  cachePolicy: string;
  manualSetupStepsHash: string;
}

export interface ComparatorInfo {
  name: string;
  version: string;
  mv3Only: boolean;
  source: string;
  sha256: string;
}

export interface BrowserInfo {
  name: string;
  version: string;
  channel: string;
  os: string;
  profileHash: string;
  profileNotes: string;
}

export interface BenchmarkEnvironment {
  hardwareHash: string;
  cpuModel: string;
  memoryGb: string;
  powerMode: string;
  thermalPolicy: string;
  networkMode: string;
  browserCachePolicy: string;
  coldWarmPolicy: string;
  profileIsolationPolicy: string;
}

export interface StoreProfile {
  name: 'strict-store' | (string & {});
  reviewedUrlImportEnabled: boolean;
  urlImportAssistantRemovedAtBuildTime: boolean;
  automaticRuleFetching: boolean;
  remoteExecutableCode: boolean;
  forbiddenPatternAuditHash: string;
  runtimeCodeSafetyHash: string;
  usesRuntimeEval: boolean;
  usesNewFunction: boolean;
  usesRemoteJavascript: boolean;
  usesRemoteScriptlets: boolean;
  usesRemoteLibraries: boolean;
  usesRemoteWebAssembly: boolean;
  usesSpeculativeBrowserApis: boolean;
}

export interface OptionalUrlImportPolicy {
  profile: string;
  disabledByDefault: boolean;
  visibleUserClickRequired: boolean;
  manualUrlEntryRequired: boolean;
  allowlistInitiallyEmpty: boolean;
  allowlistExactDomainsOnly: boolean;
  plainTextOnly: boolean;
  noRedirectsOutsideAllowlist: boolean;
  reviewOrDiffBeforeApply: boolean;
  explicitInstallConfirmation: boolean;
  prominentWarningHash: string;
  appliesAsLocalUserRules: boolean;
  removedFromStrictStore: boolean;
  reportHash: string;
}

export interface ManifestPermissions {
  permissionsHash: string;
  hostPermissionsHash: string;
  optionalPermissionsHash: string;
  usesActiveTabForAttribution: boolean;
  usesDeclarativeNetRequestFeedback: boolean;
  permissionJustificationHash: string;
  storeListingJustificationHash: string;
  gracefulFallbackWithoutAttributionPermission: boolean;
}

export interface DnrProfile {
  minimumChromeVersion: string;
  capabilityProbeHash: string;
  capabilityProfileReadAtStartup: boolean;
  capabilityProfileReadOnExtensionUpdate: boolean;
  unsupportedForBrowserProfileReportHash: string;
  maxDynamicRules: number;
  maxUnsafeDynamicRules: number;
  maxSessionRules: number;
  maxDisabledStaticRuleIds: number;
  maxEnabledStaticRulesets: number;
  guaranteedStaticRules: number;
  regexRulesPerType: number;
  staticProfileMode: 'guaranteed' | (string & {});
  opportunisticStaticRulesUsedForPublicClaim: boolean;
  rulesUsingUnavailableFieldsRejected: boolean;
  safeDynamicActions: string[];
  unsafeDynamicActions: string[];
  sessionRulesClearedOnBrowserShutdown: boolean;
  sessionRulesClearedOnExtensionUpdate: boolean;
  features: { [feature: string]: string };
  profileHash: string;
}

export interface StaticRulesetValidation {
  shardInventoryHash: string;
  defaultEnabledShards: string[];
  optionalShardPatterns: string[];
  schemaValidatedBeforePackaging: boolean;
  invalidStaticRules: number;
  budgetReportHash: string;
  deduplicatesEquivalentRules: boolean;
  mergesSafeDomainConditions: boolean;
  avoidsRegexWhenUrlFilterEnough: boolean;
  rejectsOverbroadRulesUnlessWhitelisted: boolean;
  overbroadRuleWhitelistHash: string;
  deterministicRuleIds: boolean;
  deterministicPriorities: boolean;
  ruleIdsUniqueWithinRuleset: boolean;
  sourceMapKeyFormat: string;
  sourceMapRequiredFields: string[];
  sourceMapSchemaHash: string;
  sourceMapCoverageHash: string;
  unsupportedSyntaxReportHash: string;
  opportunisticStaticCapacityPolicy: string;
}

export interface DnrPriorityPolicy {
  priorityBandHash: string;
  explicitPrioritiesRequired: boolean;
  noOverlappingLaneRanges: boolean;
  rejectsCrossLanePriorityOverlap: boolean;
  doesNotDependOnSamePriorityTieBehavior: boolean;
  doesNotDependOnCrossExtensionOrdering: boolean;
  staticRulesNeverUseDynamicRanges: boolean;
  dynamicRulesNeverUseStaticRanges: boolean;
  reportHash: string;
}

export interface SyntaxPolicy {
  parserSyntaxReportHash: string;
  supportedSyntaxMatrixHash: string;
  unsupportedRecognizedSyntaxHash: string;
  malformedInputTestHash: string;
  badfilterResolverHash: string;
  staticKeyRemoveparamOnly: boolean;
  popupPolicy: string;
  regexCompiledSizeLimitBytes: number;
  regexCheckedWithIsRegexSupportedWhereAvailable: boolean;
  userRegexRuleCap: number;
  domainConditionMaxSerializedChars: number;
  unsafeDynamicRulesSeparatelyBudgeted: boolean;
  sessionRuleWarningAt: number;
  userRegexWarningAt: number;
  reportHash: string;
}

export interface UserRuleWorkspace {
  persistentNetworkRulesUseSafeDynamicRules: boolean;
  temporaryRulesUseSessionRules: boolean;
  unsafeDynamicRulesSeparatelyBudgeted: boolean;
  dynamicRuleUpdatesAtomic: boolean;
  localRuleLedgerHash: string;
  ledgerRebuildReportHash: string;
  importExportEnabled: boolean;
  importRequiresValidationPreviewBudgetImpactAndConfirmation: boolean;
  dangerousBroadRuleRequiresExtraConfirmation: boolean;
  remoteImportsStoredAsLocalUserRules: boolean;
  noAutomaticRemoteUpdates: boolean;
  sessionRuleCleanupPolicyHash: string;
  disabledStaticRuleIdBudgetHash: string;
  reportHash: string;
}

export interface ProductionModuleAudit {
  noPredictiveEngineInPublicPackage: boolean;
  noNavigationTriggerPreloadInPublicPackage: boolean;
  noResponseBodyEngineInPublicPackage: boolean;
  noHtmlFilterEngineInPublicPackage: boolean;
  noReplaceEngineInPublicPackage: boolean;
  noDebugAttributionLoggerInPublicPackage: boolean;
  noUserScriptsExpertManagerInPublicPackage: boolean;
  noRemoteConfigManagersInPublicPackage: boolean;
  noCanaryRollbackHotfixManagersInPublicPackage: boolean;
  noPostMessageRuleDeliveryInPublicPackage: boolean;
  noTimerOrAlarmRuleFetchInPublicPackage: boolean;
  reportHash: string;
}

export interface BaselineSmoke {
  extensionLoadsWithoutRuntimeErrors: boolean;
  serviceWorkerStartsReliably: boolean;
  onePackagedDnrBlockRuleWorks: boolean;
  onePackagedCosmeticSelectorWorks: boolean;
  npmTestPasses: boolean;
  reportHash: string;
}

export interface UiWorkflowEvidence {
  popupActionsHash: string;
  hasBlockThisDomain: boolean;
  hasAllowThisDomain: boolean;
  hasTemporarilyAllowThisSite: boolean;
  hasCreateCosmeticRule: boolean;
  hasWhyWasThisBlocked: boolean;
  hasDisableMatchedRule: boolean;
  hasUndoLastChange: boolean;
  optionsEditorHash: string;
  supportsPasteWriteValidatePreviewSaveUndo: boolean;
  showsUnsupportedLines: boolean;
  showsBudgetImpact: boolean;
  supportsEnableDisableDelete: boolean;
  supportsFileImportExport: boolean;
  diagnosticsFieldsHash: string;
  diagnosticsIncludeMatchedRuleIdRulesetIdSourceListLineTextHashLanePriorityActionConditionSummary: boolean;
  diagnosticsIncludeSafeDisableAndSanitizedExport: boolean;
  reportHash: string;
}

export interface CosmeticSafety {
  engine: string;
  documentStartInjection: boolean;
  mutationBatchLimitPerSecond: number;
  mutationSelectorRecheckLimit: number;
  hasSelectorsNativeOnly: boolean;
  hasDefaultPerDomain: number;
  hasDefaultTotal: number;
  hasUserAdjustableBudget: boolean;
  selectorTextLengthCapHash: string;
  prohibitedSelectorPolicyHash: string;
  userSelectorUndo: boolean;
  foucMitigationPolicyHash: string;
  highRiskSitePolicyHash: string;
  longTaskPolicyHash: string;
  disableAdvancedCssToggle: boolean;
  noV1ScriptletInjection: boolean;
  noV1ProceduralSelectors: boolean;
  reportHash: string;
}

export interface SafeRedirectHeaderPolicy {
  packagedRedirectOnly: boolean;
  safeUrlTransformOnly: boolean;
  webAccessibleResourcesHash: string;
  noRemoteExecutableRedirectTarget: boolean;
  headerAllowlistHash: string;
  arbitraryRedirectUnsupportedRecognized: boolean;
  arbitraryHeaderUnsupportedRecognized: boolean;
  reportHash: string;
}

export interface DiagnosticsPrivacy {
  sanitizedExportHash: string;
  publicEvidenceRedactsFullUrls: boolean;
  bugReportsRedactFullUrlsByDefault: boolean;
  fullUrlExportRequiresExplicitUserConfirmation: boolean;
  noCookiesAuthHeadersRequestBodiesTelemetry: boolean;
  reportHash: string;
}

export interface PerformanceMetrics {
  serviceWorkerStartupMs: number;
  staticCompileMs: number;
  contentScriptInjectionMs: number;
  regexRejectionCount: number;
  reportHash: string;
}

export interface HarnessInfo {
  name: string;
  version: string;
  commandsDocumentedIn: string;
  fixtureMode: boolean;
}

export interface CorpusInfo {
  selectionRecordHash: string;
  selectionPinnedAt: string;
  networkCorpusHash: string;
  networkOracleHash: string;
  networkCorpusLicense: string;
  cosmeticCorpusHash: string;
  cosmeticOracleHash: string;
  cosmeticCorpusLicense: string;
  fixtureCorpus: boolean;
}

export interface AttributionInfo {
  mode: string;
  apiShapeAuditHash: string;
  matchedRuleReportHash: string;
  sourceMapHash: string;
  sourceMapKeyFormat: string;
  sourceMapCoverageHash: string;
  usesRulesMatchedInfoArray: boolean;
  usesRequestIdFromGetMatchedRules: boolean;
  usesOnRuleMatchedDebugInPackedRelease: boolean;
  usesDeclarativeNetRequestFeedbackPermission: boolean;
  usesCustomDnrMatcher: boolean;
  usesBackgroundPolling: boolean;
  usesAttributionCache: boolean;
  claimsExactRequestAttribution: boolean;
  uiText: string;
}

export interface PublicClaimInfo {
  claimTextArtifactHash: string;
  releaseNotesArtifactHash: string;
  storeListingJustificationHash: string;
  allowedPattern: string;
}

export interface ReleaseProfile {
  schemaVersion: number;
  schema: SchemaMeta;
  certificateReproducibility: CertificateReproducibility;
  sourceProvenance: SourceProvenance;
  evidenceManifest: EvidenceManifestSection;
  candidate: CandidateInfo;
  candidateRuntimeState: RuntimeState;
  comparator: ComparatorInfo;
  comparatorRuntimeState: RuntimeState;
  browser: BrowserInfo;
  benchmarkEnvironment: BenchmarkEnvironment;
  storeProfile: StoreProfile;
  optionalUrlImportPolicy: OptionalUrlImportPolicy;
  manifestPermissions: ManifestPermissions;
  dnrProfile: DnrProfile;
  staticRulesetValidation: StaticRulesetValidation;
  dnrPriorityPolicy: DnrPriorityPolicy;
  syntaxPolicy: SyntaxPolicy;
  userRuleWorkspace: UserRuleWorkspace;
  productionModuleAudit: ProductionModuleAudit;
  baselineSmoke: BaselineSmoke;
  uiWorkflowEvidence: UiWorkflowEvidence;
  cosmeticSafety: CosmeticSafety;
  safeRedirectHeaderPolicy: SafeRedirectHeaderPolicy;
  diagnosticsPrivacy: DiagnosticsPrivacy;
  performanceMetrics: PerformanceMetrics;
  harness: HarnessInfo;
  corpus: CorpusInfo;
  attribution: AttributionInfo;
  publicClaim: PublicClaimInfo;
}

const KNOWN_TOP_LEVEL_KEYS = new Set([
  'schemaVersion', 'schema', 'certificateReproducibility', 'sourceProvenance',
  'evidenceManifest', 'candidate', 'candidateRuntimeState', 'comparator',
  'comparatorRuntimeState', 'browser', 'benchmarkEnvironment', 'storeProfile',
  'optionalUrlImportPolicy', 'manifestPermissions', 'dnrProfile', 'staticRulesetValidation',
  'dnrPriorityPolicy', 'syntaxPolicy', 'userRuleWorkspace', 'productionModuleAudit',
  'baselineSmoke', 'uiWorkflowEvidence', 'cosmeticSafety', 'safeRedirectHeaderPolicy',
  'diagnosticsPrivacy', 'performanceMetrics', 'harness', 'corpus', 'attribution', 'publicClaim',
]);

export function validateReleaseProfile(profile: unknown): string[] {
    const errors: string[] = [];
    if (!profile || typeof profile !== 'object') {
    errors.push('release profile must be an object');
    return errors;
    }
    const p = profile as Record<string, unknown>;
    // Reject unknown top-level keys
    for (const key of Object.keys(p)) {
        if (!KNOWN_TOP_LEVEL_KEYS.has(key)) {
      errors.push(`unknown critical field: "${key}"`);
        }
    }
    if ((p as any).schemaVersion !== RELEASE_PROFILE_SCHEMA_VERSION) {
    errors.push(`schemaVersion must be ${RELEASE_PROFILE_SCHEMA_VERSION}`);
    }
    const schema = p.schema as Record<string, unknown> | undefined;
    if (!schema || typeof schema !== 'object') {
    errors.push('schema section is required');
    return errors;
    }
    if ((schema as any).unknownCriticalFieldsPolicy !== 'fail-closed') {
    errors.push('schema.unknownCriticalFieldsPolicy must be "fail-closed"');
    }
    validateSourceProvenance(p.sourceProvenance as Record<string, unknown> | undefined, errors);
    validateStoreProfile(p.storeProfile as Record<string, unknown> | undefined, errors);
    validateDnrProfile(p.dnrProfile as Record<string, unknown> | undefined, errors);
    validateCandidate(p.candidate as Record<string, unknown> | undefined, errors);
    validateComparator(p.comparator as Record<string, unknown> | undefined, errors);
    validateBrowser(p.browser as Record<string, unknown> | undefined, errors);
    validateCorpus(p.corpus as Record<string, unknown> | undefined, errors);
    validateHarness(p.harness as Record<string, unknown> | undefined, errors);
    validateAttribution(p.attribution as Record<string, unknown> | undefined, errors);
    return errors;
}

function validateSourceProvenance(sp: Record<string, unknown> | undefined, errors: string[]) {
    if (!sp) { errors.push('sourceProvenance is required'); return; }
    if (!sp.gitCommit || typeof sp.gitCommit !== 'string') errors.push('sourceProvenance.gitCommit must be a non-empty string');
    if (typeof sp.gitCommit === 'string' && isPlaceholder(sp.gitCommit)) errors.push('sourceProvenance.gitCommit must not be a placeholder');
    if (typeof sp.packageLockHash === 'string' && !isValidSha256(sp.packageLockHash) && sp.packageLockHash !== 'omitted-with-reason') {
    errors.push('sourceProvenance.packageLockHash must be a valid SHA-256');
    }
}

function validateStoreProfile(sp: Record<string, unknown> | undefined, errors: string[]) {
    if (!sp) { errors.push('storeProfile is required'); return; }
    if (sp.name !== 'strict-store') errors.push('storeProfile.name must be "strict-store"');
    if (sp.automaticRuleFetching !== false) errors.push('storeProfile.automaticRuleFetching must be false');
    if (sp.remoteExecutableCode !== false) errors.push('storeProfile.remoteExecutableCode must be false');
    if (typeof sp.forbiddenPatternAuditHash === 'string' && !isValidSha256(sp.forbiddenPatternAuditHash)) {
    errors.push('storeProfile.forbiddenPatternAuditHash must be a valid SHA-256');
    }
}

function validateDnrProfile(dp: Record<string, unknown> | undefined, errors: string[]) {
    if (!dp) { errors.push('dnrProfile is required'); return; }
    if (typeof dp.minimumChromeVersion === 'string') {
        if (isPlaceholder(dp.minimumChromeVersion)) errors.push('dnrProfile.minimumChromeVersion must not be a placeholder');
    } else {
    errors.push('dnrProfile.minimumChromeVersion must be a string');
    }
    if (dp.staticProfileMode !== 'guaranteed') errors.push('dnrProfile.staticProfileMode must be "guaranteed"');
    if (dp.opportunisticStaticRulesUsedForPublicClaim !== false) errors.push('dnrProfile.opportunisticStaticRulesUsedForPublicClaim must be false');
    if (typeof dp.profileHash === 'string' && !isValidSha256(dp.profileHash)) {
    errors.push('dnrProfile.profileHash must be a valid SHA-256');
    }
}

function validateCandidate(c: Record<string, unknown> | undefined, errors: string[]) {
    if (!c) { errors.push('candidate is required'); return; }
    if (typeof c.name !== 'string' || !c.name) errors.push('candidate.name must be a non-empty string');
    if (typeof c.version !== 'string' || !c.version) errors.push('candidate.version must be a non-empty string');
    if (typeof c.version === 'string' && isPlaceholder(c.version)) errors.push('candidate.version must not be a placeholder');
    if (typeof c.packageSha256 === 'string' && !isValidSha256(c.packageSha256)) errors.push('candidate.packageSha256 must be a valid SHA-256');
    if (typeof c.submittedPackageSha256 === 'string' && !isValidSha256(c.submittedPackageSha256)) errors.push('candidate.submittedPackageSha256 must be a valid SHA-256');
}

function validateComparator(c: Record<string, unknown> | undefined, errors: string[]) {
    if (!c) { errors.push('comparator is required'); return; }
    if (typeof c.name !== 'string' || !c.name) errors.push('comparator.name must be a non-empty string');
    if (typeof c.name === 'string' && c.name === 'PINNED_MV3_COMPARATOR_UNSET') errors.push('comparator.name must not be the placeholder "PINNED_MV3_COMPARATOR_UNSET"');
    if (typeof c.version !== 'string' || !c.version) errors.push('comparator.version must be a non-empty string');
    if (typeof c.version === 'string' && isPlaceholder(c.version)) errors.push('comparator.version must not be a placeholder');
    if (c.mv3Only !== true) errors.push('comparator.mv3Only must be true');
}

function validateBrowser(b: Record<string, unknown> | undefined, errors: string[]) {
    if (!b) { errors.push('browser is required'); return; }
    if (b.name !== 'Chrome') errors.push('browser.name must be "Chrome"');
    if (typeof b.version === 'string') {
        if (isPlaceholder(b.version)) errors.push('browser.version must not be a placeholder');
    } else {
    errors.push('browser.version must be a string');
    }
    if (b.channel !== 'stable') errors.push('browser.channel must be "stable"');
}

function validateCorpus(c: Record<string, unknown> | undefined, errors: string[]) {
    if (!c) { errors.push('corpus is required'); return; }
    if (typeof c.networkCorpusHash === 'string' && !isValidSha256(c.networkCorpusHash) && !isPlaceholder(c.networkCorpusHash)) {
    errors.push('corpus.networkCorpusHash must be a valid SHA-256');
    }
    if (typeof c.cosmeticCorpusHash === 'string' && !isValidSha256(c.cosmeticCorpusHash) && !isPlaceholder(c.cosmeticCorpusHash)) {
    errors.push('corpus.cosmeticCorpusHash must be a valid SHA-256');
    }
    if (c.fixtureCorpus === true) errors.push('corpus.fixtureCorpus must not be true in a release profile');
}

function validateHarness(h: Record<string, unknown> | undefined, errors: string[]) {
    if (!h) { errors.push('harness is required'); return; }
    if (typeof h.name !== 'string' || !h.name) errors.push('harness.name must be a non-empty string');
    if (typeof h.version !== 'string' || !h.version) errors.push('harness.version must be a non-empty string');
    if (h.fixtureMode === true) errors.push('harness.fixtureMode must not be true in a release profile');
}

function validateAttribution(a: Record<string, unknown> | undefined, errors: string[]) {
    if (!a) { errors.push('attribution is required'); return; }
    if (a.mode !== 'user-triggered-activeTab-getMatchedRules') errors.push('attribution.mode must be "user-triggered-activeTab-getMatchedRules"');
    if (a.usesRequestIdFromGetMatchedRules === true) errors.push('attribution.usesRequestIdFromGetMatchedRules must be false');
    if (a.usesOnRuleMatchedDebugInPackedRelease === true) errors.push('attribution.usesOnRuleMatchedDebugInPackedRelease must be false');
    if (a.usesCustomDnrMatcher === true) errors.push('attribution.usesCustomDnrMatcher must be false');
    if (a.usesBackgroundPolling === true) errors.push('attribution.usesBackgroundPolling must be false');
    if (a.usesAttributionCache === true) errors.push('attribution.usesAttributionCache must be false');
    if (a.claimsExactRequestAttribution === true) errors.push('attribution.claimsExactRequestAttribution must be false');
}

export const defaultReleaseProfile: ReleaseProfile = {
  schemaVersion: RELEASE_PROFILE_SCHEMA_VERSION,
  schema: {
    releaseProfileSchemaVersion: RELEASE_PROFILE_SCHEMA_VERSION,
    releaseProfileSchemaHash: '0000000000000000000000000000000000000000000000000000000000000000',
    unknownCriticalFieldsPolicy: 'fail-closed',
  },
  certificateReproducibility: {
    sourceDateEpoch: null,
    generatedAtPolicy: 'excluded-from-stable-evidence-hash-or-pinned-by-source-date-epoch',
    canonicalJsonPolicy: 'sorted-keys-no-unstable-metadata',
    stableEvidenceHash: '0000000000000000000000000000000000000000000000000000000000000000',
  },
  sourceProvenance: {
    gitCommit: 'UNSET',
    dirtyWorktree: false,
    sourceTreeHash: '0000000000000000000000000000000000000000000000000000000000000000',
    packageLockHash: '0000000000000000000000000000000000000000000000000000000000000000',
    packageManager: 'npm',
    installCommand: 'npm ci',
    dependencyTreeHash: '0000000000000000000000000000000000000000000000000000000000000000',
    nodeVersion: 'UNSET',
    npmVersion: 'UNSET',
  },
  evidenceManifest: {
    inputManifestHash: '0000000000000000000000000000000000000000000000000000000000000000',
    allArtifactsRegeneratedInThisRun: false,
    artifactHashes: {},
  },
  candidate: {
    name: 'uBlockUltimate',
    version: 'UNSET',
    buildCommand: 'npm run build',
    packagePath: 'dist/build/uBlock0.chromium-mv3',
    packageSha256: '0000000000000000000000000000000000000000000000000000000000000000',
    submittedPackagePath: 'dist/build/uBlock0.chromium-mv3.zip',
    submittedPackageSha256: '0000000000000000000000000000000000000000000000000000000000000000',
    submittedPackageType: 'zip',
    manifestSha256: '0000000000000000000000000000000000000000000000000000000000000000',
    dnrRulesetSha256: '0000000000000000000000000000000000000000000000000000000000000000',
    sourceMapSha256: '0000000000000000000000000000000000000000000000000000000000000000',
    unsupportedSyntaxReportSha256: '0000000000000000000000000000000000000000000000000000000000000000',
  },
  candidateRuntimeState: {
    settingsHash: '0000000000000000000000000000000000000000000000000000000000000000',
    enabledStaticRulesetsHash: '0000000000000000000000000000000000000000000000000000000000000000',
    disabledStaticRuleIdsHash: '0000000000000000000000000000000000000000000000000000000000000000',
    dynamicRulesHash: '0000000000000000000000000000000000000000000000000000000000000000',
    sessionRulesHash: '0000000000000000000000000000000000000000000000000000000000000000',
    userRulesLedgerHash: '0000000000000000000000000000000000000000000000000000000000000000',
    localStorageSnapshotHash: '0000000000000000000000000000000000000000000000000000000000000000',
    sessionStorageSnapshotHash: '0000000000000000000000000000000000000000000000000000000000000000',
    serviceWorkerStatePolicy: 'fresh-install-or-declared-warm-state',
    cachePolicy: 'clear-before-run',
    manualSetupStepsHash: '0000000000000000000000000000000000000000000000000000000000000000',
  },
  comparator: {
    name: 'PINNED_MV3_COMPARATOR_UNSET',
    version: 'UNSET',
    mv3Only: true,
    source: 'UNSET',
    sha256: '0000000000000000000000000000000000000000000000000000000000000000',
  },
  comparatorRuntimeState: {
    settingsHash: '0000000000000000000000000000000000000000000000000000000000000000',
    enabledStaticRulesetsHash: '0000000000000000000000000000000000000000000000000000000000000000',
    disabledStaticRuleIdsHash: '0000000000000000000000000000000000000000000000000000000000000000',
    dynamicRulesHash: '0000000000000000000000000000000000000000000000000000000000000000',
    sessionRulesHash: '0000000000000000000000000000000000000000000000000000000000000000',
    userRulesLedgerHash: '0000000000000000000000000000000000000000000000000000000000000000',
    localStorageSnapshotHash: '0000000000000000000000000000000000000000000000000000000000000000',
    sessionStorageSnapshotHash: '0000000000000000000000000000000000000000000000000000000000000000',
    serviceWorkerStatePolicy: 'fresh-install-or-declared-warm-state',
    cachePolicy: 'clear-before-run',
    manualSetupStepsHash: '0000000000000000000000000000000000000000000000000000000000000000',
  },
  browser: {
    name: 'Chrome',
    version: 'PINNED_VERSION_UNSET',
    channel: 'stable',
    os: 'UNSET',
    profileHash: '0000000000000000000000000000000000000000000000000000000000000000',
    profileNotes: 'fresh profile, other extensions disabled',
  },
  benchmarkEnvironment: {
    hardwareHash: '0000000000000000000000000000000000000000000000000000000000000000',
    cpuModel: 'UNSET',
    memoryGb: 'UNSET',
    powerMode: 'AC/performance profile',
    thermalPolicy: 'predeclared',
    networkMode: 'replay/offline/live-with-recorded-hash',
    browserCachePolicy: 'clear-before-run',
    coldWarmPolicy: 'cold-only',
    profileIsolationPolicy: 'separate-clean-browser-profile-per-extension',
  },
  storeProfile: {
    name: 'strict-store',
    reviewedUrlImportEnabled: false,
    urlImportAssistantRemovedAtBuildTime: true,
    automaticRuleFetching: false,
    remoteExecutableCode: false,
    forbiddenPatternAuditHash: '0000000000000000000000000000000000000000000000000000000000000000',
    runtimeCodeSafetyHash: '0000000000000000000000000000000000000000000000000000000000000000',
    usesRuntimeEval: false,
    usesNewFunction: false,
    usesRemoteJavascript: false,
    usesRemoteScriptlets: false,
    usesRemoteLibraries: false,
    usesRemoteWebAssembly: false,
    usesSpeculativeBrowserApis: false,
  },
  optionalUrlImportPolicy: {
    profile: 'reviewed-url-import-developer-only-or-absent',
    disabledByDefault: true,
    visibleUserClickRequired: true,
    manualUrlEntryRequired: true,
    allowlistInitiallyEmpty: true,
    allowlistExactDomainsOnly: true,
    plainTextOnly: true,
    noRedirectsOutsideAllowlist: true,
    reviewOrDiffBeforeApply: true,
    explicitInstallConfirmation: true,
    prominentWarningHash: '0000000000000000000000000000000000000000000000000000000000000000',
    appliesAsLocalUserRules: true,
    removedFromStrictStore: true,
    reportHash: '0000000000000000000000000000000000000000000000000000000000000000',
  },
  manifestPermissions: {
    permissionsHash: '0000000000000000000000000000000000000000000000000000000000000000',
    hostPermissionsHash: '0000000000000000000000000000000000000000000000000000000000000000',
    optionalPermissionsHash: '0000000000000000000000000000000000000000000000000000000000000000',
    usesActiveTabForAttribution: true,
    usesDeclarativeNetRequestFeedback: false,
    permissionJustificationHash: '0000000000000000000000000000000000000000000000000000000000000000',
    storeListingJustificationHash: '0000000000000000000000000000000000000000000000000000000000000000',
    gracefulFallbackWithoutAttributionPermission: true,
  },
  dnrProfile: {
    minimumChromeVersion: 'PINNED_MINIMUM',
    capabilityProbeHash: '0000000000000000000000000000000000000000000000000000000000000000',
    capabilityProfileReadAtStartup: true,
    capabilityProfileReadOnExtensionUpdate: true,
    unsupportedForBrowserProfileReportHash: '0000000000000000000000000000000000000000000000000000000000000000',
    maxDynamicRules: 30000,
    maxUnsafeDynamicRules: 5000,
    maxSessionRules: 5000,
    maxDisabledStaticRuleIds: 5000,
    maxEnabledStaticRulesets: 50,
    guaranteedStaticRules: 30000,
    regexRulesPerType: 1000,
    staticProfileMode: 'guaranteed',
    opportunisticStaticRulesUsedForPublicClaim: false,
    rulesUsingUnavailableFieldsRejected: true,
    safeDynamicActions: ['block', 'allow', 'allowAllRequests', 'upgradeScheme'],
    unsafeDynamicActions: ['redirect', 'modifyHeaders'],
    sessionRulesClearedOnBrowserShutdown: true,
    sessionRulesClearedOnExtensionUpdate: true,
    features: {
      safeDynamic30000: 'required-for-1.0',
      responseHeadersCondition: 'optional-chrome-128-plus',
      topDomains: 'optional-chrome-145-plus',
      urlTransformQueryTransform: 'required-only-if-removeparam-enabled',
    },
    profileHash: '0000000000000000000000000000000000000000000000000000000000000000',
  },
  staticRulesetValidation: {
    shardInventoryHash: '0000000000000000000000000000000000000000000000000000000000000000',
    defaultEnabledShards: ['core-ads', 'core-trackers', 'core-allow', 'annoyances-lite-if-within-budget'],
    optionalShardPatterns: ['regional-pack-*', 'site-pack-*'],
    schemaValidatedBeforePackaging: true,
    invalidStaticRules: 0,
    budgetReportHash: '0000000000000000000000000000000000000000000000000000000000000000',
    deduplicatesEquivalentRules: true,
    mergesSafeDomainConditions: true,
    avoidsRegexWhenUrlFilterEnough: true,
    rejectsOverbroadRulesUnlessWhitelisted: true,
    overbroadRuleWhitelistHash: '0000000000000000000000000000000000000000000000000000000000000000',
    deterministicRuleIds: true,
    deterministicPriorities: true,
    ruleIdsUniqueWithinRuleset: true,
    sourceMapKeyFormat: 'rulesetId:ruleId',
    sourceMapRequiredFields: ['rulesetId', 'ruleId', 'lane', 'sourceList', 'sourceLine', 'sourceTextHash', 'generatedBy'],
    sourceMapSchemaHash: '0000000000000000000000000000000000000000000000000000000000000000',
    sourceMapCoverageHash: '0000000000000000000000000000000000000000000000000000000000000000',
    unsupportedSyntaxReportHash: '0000000000000000000000000000000000000000000000000000000000000000',
    opportunisticStaticCapacityPolicy: 'runtime-only-not-public-claim',
  },
  dnrPriorityPolicy: {
    priorityBandHash: '0000000000000000000000000000000000000000000000000000000000000000',
    explicitPrioritiesRequired: true,
    noOverlappingLaneRanges: true,
    rejectsCrossLanePriorityOverlap: true,
    doesNotDependOnSamePriorityTieBehavior: true,
    doesNotDependOnCrossExtensionOrdering: true,
    staticRulesNeverUseDynamicRanges: true,
    dynamicRulesNeverUseStaticRanges: true,
    reportHash: '0000000000000000000000000000000000000000000000000000000000000000',
  },
  syntaxPolicy: {
    parserSyntaxReportHash: '0000000000000000000000000000000000000000000000000000000000000000',
    supportedSyntaxMatrixHash: '0000000000000000000000000000000000000000000000000000000000000000',
    unsupportedRecognizedSyntaxHash: '0000000000000000000000000000000000000000000000000000000000000000',
    malformedInputTestHash: '0000000000000000000000000000000000000000000000000000000000000000',
    badfilterResolverHash: '0000000000000000000000000000000000000000000000000000000000000000',
    staticKeyRemoveparamOnly: true,
    popupPolicy: 'tabs-api-optional-or-unsupported-recognized',
    regexCompiledSizeLimitBytes: 2048,
    regexCheckedWithIsRegexSupportedWhereAvailable: true,
    userRegexRuleCap: 200,
    domainConditionMaxSerializedChars: 2048,
    unsafeDynamicRulesSeparatelyBudgeted: true,
    sessionRuleWarningAt: 4000,
    userRegexWarningAt: 150,
    reportHash: '0000000000000000000000000000000000000000000000000000000000000000',
  },
  userRuleWorkspace: {
    persistentNetworkRulesUseSafeDynamicRules: true,
    temporaryRulesUseSessionRules: true,
    unsafeDynamicRulesSeparatelyBudgeted: true,
    dynamicRuleUpdatesAtomic: true,
    localRuleLedgerHash: '0000000000000000000000000000000000000000000000000000000000000000',
    ledgerRebuildReportHash: '0000000000000000000000000000000000000000000000000000000000000000',
    importExportEnabled: true,
    importRequiresValidationPreviewBudgetImpactAndConfirmation: true,
    dangerousBroadRuleRequiresExtraConfirmation: true,
    remoteImportsStoredAsLocalUserRules: true,
    noAutomaticRemoteUpdates: true,
    sessionRuleCleanupPolicyHash: '0000000000000000000000000000000000000000000000000000000000000000',
    disabledStaticRuleIdBudgetHash: '0000000000000000000000000000000000000000000000000000000000000000',
    reportHash: '0000000000000000000000000000000000000000000000000000000000000000',
  },
  productionModuleAudit: {
    noPredictiveEngineInPublicPackage: true,
    noNavigationTriggerPreloadInPublicPackage: true,
    noResponseBodyEngineInPublicPackage: true,
    noHtmlFilterEngineInPublicPackage: true,
    noReplaceEngineInPublicPackage: true,
    noDebugAttributionLoggerInPublicPackage: true,
    noUserScriptsExpertManagerInPublicPackage: true,
    noRemoteConfigManagersInPublicPackage: true,
    noCanaryRollbackHotfixManagersInPublicPackage: true,
    noPostMessageRuleDeliveryInPublicPackage: true,
    noTimerOrAlarmRuleFetchInPublicPackage: true,
    reportHash: '0000000000000000000000000000000000000000000000000000000000000000',
  },
  baselineSmoke: {
    extensionLoadsWithoutRuntimeErrors: false,
    serviceWorkerStartsReliably: false,
    onePackagedDnrBlockRuleWorks: false,
    onePackagedCosmeticSelectorWorks: false,
    npmTestPasses: false,
    reportHash: '0000000000000000000000000000000000000000000000000000000000000000',
  },
  uiWorkflowEvidence: {
    popupActionsHash: '0000000000000000000000000000000000000000000000000000000000000000',
    hasBlockThisDomain: false,
    hasAllowThisDomain: false,
    hasTemporarilyAllowThisSite: false,
    hasCreateCosmeticRule: false,
    hasWhyWasThisBlocked: false,
    hasDisableMatchedRule: false,
    hasUndoLastChange: false,
    optionsEditorHash: '0000000000000000000000000000000000000000000000000000000000000000',
    supportsPasteWriteValidatePreviewSaveUndo: false,
    showsUnsupportedLines: false,
    showsBudgetImpact: false,
    supportsEnableDisableDelete: false,
    supportsFileImportExport: false,
    diagnosticsFieldsHash: '0000000000000000000000000000000000000000000000000000000000000000',
    diagnosticsIncludeMatchedRuleIdRulesetIdSourceListLineTextHashLanePriorityActionConditionSummary: false,
    diagnosticsIncludeSafeDisableAndSanitizedExport: false,
    reportHash: '0000000000000000000000000000000000000000000000000000000000000000',
  },
  cosmeticSafety: {
    engine: 'basic-css-injection',
    documentStartInjection: true,
    mutationBatchLimitPerSecond: 5,
    mutationSelectorRecheckLimit: 100,
    hasSelectorsNativeOnly: true,
    hasDefaultPerDomain: 5,
    hasDefaultTotal: 50,
    hasUserAdjustableBudget: true,
    selectorTextLengthCapHash: '0000000000000000000000000000000000000000000000000000000000000000',
    prohibitedSelectorPolicyHash: '0000000000000000000000000000000000000000000000000000000000000000',
    userSelectorUndo: true,
    foucMitigationPolicyHash: '0000000000000000000000000000000000000000000000000000000000000000',
    highRiskSitePolicyHash: '0000000000000000000000000000000000000000000000000000000000000000',
    longTaskPolicyHash: '0000000000000000000000000000000000000000000000000000000000000000',
    disableAdvancedCssToggle: true,
    noV1ScriptletInjection: true,
    noV1ProceduralSelectors: true,
    reportHash: '0000000000000000000000000000000000000000000000000000000000000000',
  },
  safeRedirectHeaderPolicy: {
    packagedRedirectOnly: true,
    safeUrlTransformOnly: true,
    webAccessibleResourcesHash: '0000000000000000000000000000000000000000000000000000000000000000',
    noRemoteExecutableRedirectTarget: true,
    headerAllowlistHash: '0000000000000000000000000000000000000000000000000000000000000000',
    arbitraryRedirectUnsupportedRecognized: true,
    arbitraryHeaderUnsupportedRecognized: true,
    reportHash: '0000000000000000000000000000000000000000000000000000000000000000',
  },
  diagnosticsPrivacy: {
    sanitizedExportHash: '0000000000000000000000000000000000000000000000000000000000000000',
    publicEvidenceRedactsFullUrls: true,
    bugReportsRedactFullUrlsByDefault: true,
    fullUrlExportRequiresExplicitUserConfirmation: true,
    noCookiesAuthHeadersRequestBodiesTelemetry: true,
    reportHash: '0000000000000000000000000000000000000000000000000000000000000000',
  },
  performanceMetrics: {
    serviceWorkerStartupMs: 0,
    staticCompileMs: 0,
    contentScriptInjectionMs: 0,
    regexRejectionCount: 0,
    reportHash: '0000000000000000000000000000000000000000000000000000000000000000',
  },
  harness: {
    name: 'UNSET',
    version: 'UNSET',
    commandsDocumentedIn: 'BENCHMARK.md',
    fixtureMode: false,
  },
  corpus: {
    selectionRecordHash: '0000000000000000000000000000000000000000000000000000000000000000',
    selectionPinnedAt: 'UNSET',
    networkCorpusHash: '0000000000000000000000000000000000000000000000000000000000000000',
    networkOracleHash: '0000000000000000000000000000000000000000000000000000000000000000',
    networkCorpusLicense: 'UNSET',
    cosmeticCorpusHash: '0000000000000000000000000000000000000000000000000000000000000000',
    cosmeticOracleHash: '0000000000000000000000000000000000000000000000000000000000000000',
    cosmeticCorpusLicense: 'UNSET',
    fixtureCorpus: false,
  },
  attribution: {
    mode: 'user-triggered-activeTab-getMatchedRules',
    apiShapeAuditHash: '0000000000000000000000000000000000000000000000000000000000000000',
    matchedRuleReportHash: '0000000000000000000000000000000000000000000000000000000000000000',
    sourceMapHash: '0000000000000000000000000000000000000000000000000000000000000000',
    sourceMapKeyFormat: 'rulesetId:ruleId',
    sourceMapCoverageHash: '0000000000000000000000000000000000000000000000000000000000000000',
    usesRulesMatchedInfoArray: true,
    usesRequestIdFromGetMatchedRules: false,
    usesOnRuleMatchedDebugInPackedRelease: false,
    usesDeclarativeNetRequestFeedbackPermission: false,
    usesCustomDnrMatcher: false,
    usesBackgroundPolling: false,
    usesAttributionCache: false,
    claimsExactRequestAttribution: false,
    uiText: 'Rules recently matched on this tab',
  },
  publicClaim: {
    claimTextArtifactHash: '0000000000000000000000000000000000000000000000000000000000000000',
    releaseNotesArtifactHash: '0000000000000000000000000000000000000000000000000000000000000000',
    storeListingJustificationHash: '0000000000000000000000000000000000000000000000000000000000000000',
    allowedPattern: 'Superior to [pinned MV3 comparator] on [pinned corpus hash] under [browser/profile/hash], with unsupported syntax disclosed in [certificate hash].',
  },
};

export * as ReleaseProfileSchema from './release-profile-schema';
