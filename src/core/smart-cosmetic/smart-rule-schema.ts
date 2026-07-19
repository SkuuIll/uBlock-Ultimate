export type SmartRuleType = 'hide-exact' | 'hide-similar' | 'smart-hide' | 'smart-allow'

export type TargetForm = 'host' | 'domain' | 'entity' | 'regex'

export interface TargetEntry {
  form: TargetForm
  value: string
}

export type PathForm = 'exact' | 'glob' | 'regex'

export interface PathEntry {
  form: PathForm
  value: string
}

export interface Boundary {
  mode: BoundaryMode
  maxDepth?: number
  selector?: string
  depth?: number
  stopAtScope?: boolean
  allowCrossScope?: boolean
  allowScopeRoot?: boolean
  includeSelf?: boolean
  allowPageRoot?: boolean
}

export type BoundaryMode =
  | 'exact'
  | 'nearest-card'
  | 'repeated-card'
  | 'semantic-block'
  | 'visual-block'
  | 'ancestor-depth'
  | 'selector'

export type MatchMode = 'none' | 'exact' | 'similar' | 'structural'

export type MatchReference = 'picked' | 'none'

export type ReferenceSelectionMode = 'error' | 'first'

export type WeightProfile = 'default-card' | 'structural-heavy' | 'content-heavy'

export interface MatchBlock {
  mode: MatchMode
  reference?: MatchReference | string
  referenceSelection?: ReferenceSelectionMode
  threshold?: number
  weights?: WeightProfile
}

export interface LogicOptions {
  stopAtScopeForAncestor?: boolean
}

export type RuleAction = 'hide' | 'collapse' | 'remove' | 'mark' | 'unhide'

export interface ActionOptions {
  important?: boolean
}

export type ActionExpression =
  | { action: 'hide'; options?: ActionOptions }
  | { action: 'collapse'; options?: ActionOptions }
  | { action: 'remove'; options?: ActionOptions }
  | { action: 'mark'; options?: ActionOptions }
  | { action: 'unhide'; options?: ActionOptions }
  | { action: 'style'; style: string; options?: ActionOptions }

export type PreviewRequirement = 'required' | 'recommended' | 'optional' | 'skip'

export interface SafetyBlock {
  preview?: PreviewRequirement
  maxMatches?: number
  maxPagePercent?: number
  maxViewportAreaPercent?: number
  minFeatures?: number
  minLogicMatches?: number
  allowPartialApply?: boolean
  maxConsecutivePartial?: number
  partialCycleCount?: number
  warnIfScopeIsBody?: boolean
  warnIfNoWhereLogic?: boolean
  warnIfActionRemove?: boolean
  confirmPageRoot?: boolean
  warnIfWeakExactReference?: boolean
  allowGlobal?: boolean
}

export interface PerformanceBlock {
  maxCandidates?: number
  maxEvaluationsPerCycle?: number
  maxAddedNodesPerCycle?: number
  maxRegexMsPerRuleCycle?: number
  maxRegexPatternLength?: number
  maxTextRegexInputChars?: number
  debounceMs?: number
  dependencyDepth?: number
  dependencyPrefilter?: boolean
  preferCssPrefilter?: boolean
  metrics?: MetricsMode
  sampleRate?: number
}

export type FrameMode = 'top-only' | 'same-origin' | 'accessible'
export type FrameAccounting = 'per-frame' | 'aggregate'

export interface FramesBlock {
  mode: FrameMode
  accounting?: FrameAccounting
  maxTotalMatches?: number
}

export type ShadowMode = 'none' | 'open' | 'open-recursive'

export interface ShadowBlock {
  mode: ShadowMode
  observeMutations?: boolean
  observeRecursive?: boolean
  allowHostAncestor?: boolean
  maxRootsPerCycle?: number
}

export type ReEvaluateOnPathChange = 'never' | 'always' | 'smart'
export type ErrorRecovery = 'continue' | 'fail-safe'
export type OnBudgetExceeded = 'stop-cycle' | 'warn' | 'pause-rule'
export type MetricsMode = 'none' | 'collect'

export interface RuntimeBlock {
  observePathChanges?: boolean
  pathChangeDebounceMs?: number
  reEvaluateOnPathChange?: ReEvaluateOnPathChange
  observeSubtree?: boolean
  observeAttributes?: 'auto' | true | false
  errorRecovery?: ErrorRecovery
  onBudgetExceeded?: OnBudgetExceeded
  maxConsecutivePartialCycles?: number
}

export type CacheScope = 'per-rule' | 'per-page'
export type EvictionPolicy = 'LRU'

export interface CacheBlock {
  maxEntries?: number
  maxAgeMs?: number
  evictionPolicy?: EvictionPolicy
  scope?: CacheScope
}

export interface RuleProvenance {
  source?: string
  originalRuleId?: string
  importTimestamp?: string
  createdBy?: string
  createdFromHost?: string
  createdFromPath?: string
  originalRuleText?: string
  originalSource?: string
}

export type RuleSource =
  | 'picker'
  | 'manual'
  | 'import'
  | 'converter'
  | 'migration'
  | 'enterprise'

export interface RuleMetadata {
  createdAt: string
  updatedAt?: string
  source?: RuleSource
  scope?: 'test-only' | 'production'
  provenance?: RuleProvenance
  title?: string
  description?: string
  createdBy?: string
  history?: RuleHistoryEntry[]
  originalSyntax?: string
  originalId?: string
}

export interface RuleHistoryEntry {
  version: number
  changedAt: string
  reason?: string
  changedBy?: string
}

export interface FingerprintMetadata {
  storedAt?: string
  featureCount?: number
  source?: string
  ttlMs?: number
}

export interface FingerprintGCMetadata {
  lastGC?: string
  maxFingerprints?: number
}

export type AggregatedExportLoss =
  | 'lossless'
  | 'partial'
  | 'approximate'
  | 'not-possible'

export interface ExportLossMetadata {
  code: AggregatedExportLoss
  reason: string
  affectedRuleIds?: string[]
}

export type RuleState = 'draft' | 'needs-preview' | 'previewed' | 'active' | 'disabled' | 'paused' | 'error' | 'awaiting-scope' | 'partial'
export type PreviewStatus =
  | 'none'
  | 'required'
  | 'previewed'
  | 'confirmed'
  | 'stale'
  | 'forced-by-policy'

export interface PreviewState {
  status: PreviewStatus
  confirmationHash?: string
  confirmedAt?: string
  relaxedCapsUsed?: boolean
}

export interface SmartRuleIdentity {
  id: string
  syntaxVersion: number
  astNormalisationVersion?: number
  schemaVersion?: number
  state: RuleState
  priority?: number
  metadata: RuleMetadata
  preview?: PreviewState
  collectionId?: string
}

const STATE_TRANSITIONS: Record<RuleState, RuleState[]> = {
  draft: ['needs-preview', 'previewed', 'disabled'],
  'needs-preview': ['previewed', 'disabled', 'error'],
  previewed: ['active', 'needs-preview', 'disabled', 'error', 'partial'],
  active: ['disabled', 'paused', 'needs-preview', 'previewed', 'partial', 'awaiting-scope'],
  disabled: ['draft', 'active', 'previewed'],
  paused: ['active', 'disabled'],
  error: ['draft', 'disabled'],
  'awaiting-scope': ['active', 'disabled'],
  partial: ['active', 'disabled', 'needs-preview'],
}

export const STATE_ALIASES: Record<string, RuleState> = {
  enabled: 'active',
}

export function normalizeRuleState(state: string): RuleState {
    return STATE_ALIASES[state] ?? (state as RuleState)
}

const ACTIVE_BLOCKED_PREVIEW_STATUSES = new Set<PreviewStatus>(['required', 'previewed', 'stale', 'forced-by-policy'])

export function isValidStateTransition(from: RuleState, to: RuleState, rule?: { preview?: { status: PreviewStatus } }): boolean {
    if (!STATE_TRANSITIONS[from].includes(to)) return false
    if (to === 'active' && rule?.preview?.status && ACTIVE_BLOCKED_PREVIEW_STATUSES.has(rule.preview.status)) return false
    return true
}

export type NormalizedOutput = {
  type: 'rule'
  rule: SmartCosmeticRule
  warnings: string[]
} | {
  type: 'error'
  message: string
  code: string
}

export type SmartCosmeticRule =
  | HideExactRule
  | HideSimilarRule
  | SmartHideRule
  | SmartAllowRule

export interface HideExactRule extends SmartRuleIdentity {
  type: 'hide-exact'
  targets: TargetEntry[]
  paths?: PathEntry[]
  scope?: string[]
  selector: string
  action: ActionExpression
  safety?: SafetyBlock
  performance?: PerformanceBlock
  frames?: FramesBlock
  shadow?: ShadowBlock
  runtime?: RuntimeBlock
  cache?: CacheBlock
}

export interface HideSimilarRule extends SmartRuleIdentity {
  type: 'hide-similar'
  targets: TargetEntry[]
  paths?: PathEntry[]
  scope?: string[]
  candidates?: string[]
  boundary: Boundary
  match: MatchBlock & { mode: 'similar' | 'structural' | 'exact' }
  where?: LogicExpression
  except?: LogicExpression
  action: ActionExpression
  safety?: SafetyBlock
  performance?: PerformanceBlock
  frames?: FramesBlock
  shadow?: ShadowBlock
  runtime?: RuntimeBlock
  cache?: CacheBlock
}

export interface SmartHideRule extends SmartRuleIdentity {
  type: 'smart-hide'
  targets: TargetEntry[]
  paths?: PathEntry[]
  scope?: string[]
  candidates: string[]
  boundary: Boundary
  match?: MatchBlock
  where?: LogicExpression
  except?: LogicExpression
  keywords?: KeywordBlock
  keywordMerge?: boolean
  action: ActionExpression
  safety?: SafetyBlock
  performance?: PerformanceBlock
  frames?: FramesBlock
  shadow?: ShadowBlock
  runtime?: RuntimeBlock
  cache?: CacheBlock
}

export interface SmartAllowRule extends SmartRuleIdentity {
  type: 'smart-allow'
  targets: TargetEntry[]
  paths?: PathEntry[]
  scope?: string[]
  candidates?: string[]
  boundary?: Boundary
  match?: MatchBlock & { mode: 'none' | 'exact' }
  where?: LogicExpression
  except?: LogicExpression
  keywords?: KeywordBlock
  keywordMerge?: boolean
  allowBroad?: boolean
  logicOptions?: LogicOptions
  action: ActionExpression & { action: 'unhide' }
  safety?: SafetyBlock
  performance?: PerformanceBlock
  frames?: FramesBlock
  shadow?: ShadowBlock
  runtime?: RuntimeBlock
  cache?: CacheBlock
}

export type LogicOperator =
  | 'equals'
  | 'not-equals'
  | 'contains'
  | 'regex'
  | 'regex-like'
  | 'starts-with'
  | 'ends-with'
  | 'exists'
  | 'not-exists'
  | 'selector-matches'
  | 'has-descendant'
  | 'has-ancestor'
  | 'count'
  | 'density'

export type LogicField =
  | 'text'
  | 'all-text'
  | 'own-text'
  | 'semantic-text'
  | 'aria-label'
  | 'alt'
  | 'href'
  | 'role'
  | 'tag'
  | 'text-length'
  | 'link-count'
  | 'link-density'
  | 'child-count'

export interface AttributeCondition {
  attrName: string
  family?: 'data' | 'aria'
}

export interface SimpleCondition {
  field: string
  operator: 'equals' | 'not-equals' | 'contains' | 'starts-with' | 'ends-with'
  value: string
  caseSensitive?: boolean
}

export interface RegexCondition {
  field: string
  operator: 'regex'
  pattern: string
  flags?: string
}

export interface ExistenceCondition {
  field: string
  operator: 'exists' | 'not-exists'
}

export interface SelectorMatchCondition {
  operator: 'selector-matches'
  selector: string
}

export interface HasDescendantCondition {
  operator: 'has-descendant'
  selector: string
}

export interface HasAncestorCondition {
  operator: 'has-ancestor'
  selector: string
}

export interface NumericCondition {
  field: 'text-length' | 'link-count' | 'link-density' | 'child-count'
  operator: '>=' | '<=' | '>' | '<' | '=='
  value: number
}

export interface AttributeFamilyCondition {
  attrFamily: 'data-*' | 'aria-*'
  operator: 'equals' | 'contains' | 'regex'
  pattern: string
}

export type LogicCondition =
  | SimpleCondition
  | RegexCondition
  | ExistenceCondition
  | SelectorMatchCondition
  | HasDescendantCondition
  | HasAncestorCondition
  | NumericCondition
  | AttributeCondition
  | AttributeFamilyCondition

export interface LogicGroup {
  all?: LogicExpression[]
  any?: LogicExpression[]
  none?: LogicExpression[]
}

export interface LogicExpressionItem {
  condition: LogicCondition
  label?: string
}

export type LogicExpression = LogicGroup | LogicExpressionItem

export type KeywordMatchMode = 'phrase' | 'word' | 'regex'

export interface KeywordBlock {
  matchMode?: KeywordMatchMode
  includeAny?: string[]
  includeAll?: string[]
  excludeAny?: string[]
  excludeAll?: string[]
  fields?: string[]
  caseSensitive?: boolean
  wordBoundary?: boolean
}

export type SmartRuleLane = 'smart-cosmetic'

export interface SmartRuleListMetadata {
  syntaxVersion: number
  listId: string
  title?: string
  description?: string
  updatedAt?: string
  sourceEtag?: string
  author?: string
  tags?: string[]
}

export interface SmartRuleCollection {
  id: string
  sourceUrl?: string
  metadata?: SmartRuleListMetadata
  rules?: SmartCosmeticRule[]
  lastUpdateCheck?: number
  lastUpdateSuccess?: number
  updateError?: string
}

export const DEFAULT_BOUNDARY: Readonly<Boundary> = Object.freeze({
  mode: 'repeated-card',
  maxDepth: 8,
  stopAtScope: true,
  allowCrossScope: false,
  allowScopeRoot: false,
  includeSelf: false,
  allowPageRoot: false,
})

export const DEFAULT_SAFETY: Readonly<SafetyBlock> = Object.freeze({
  preview: 'required',
  maxMatches: 100,
  maxPagePercent: 25,
  maxViewportAreaPercent: 40,
  minFeatures: 3,
  minLogicMatches: 1,
  allowPartialApply: false,
  warnIfScopeIsBody: true,
  warnIfNoWhereLogic: true,
  warnIfActionRemove: true,
  warnIfWeakExactReference: true,
  confirmPageRoot: false,
})

export const DEFAULT_PERFORMANCE: Readonly<PerformanceBlock> = Object.freeze({
  maxCandidates: 150,
  maxEvaluationsPerCycle: 150,
  maxAddedNodesPerCycle: 300,
  maxRegexMsPerRuleCycle: 10,
  maxRegexPatternLength: 256,
  maxTextRegexInputChars: 4096,
  debounceMs: 100,
  dependencyDepth: 3,
  dependencyPrefilter: true,
  preferCssPrefilter: true,
  metrics: 'collect',
  sampleRate: 1.0,
})

export const DEFAULT_FRAMES: Readonly<FramesBlock> = Object.freeze({
  mode: 'top-only',
  accounting: 'per-frame',
  maxTotalMatches: 150,
})

export const DEFAULT_SHADOW: Readonly<ShadowBlock> = Object.freeze({
  mode: 'none',
  observeMutations: true,
  observeRecursive: false,
  allowHostAncestor: false,
  maxRootsPerCycle: 20,
})

export const DEFAULT_RUNTIME: Readonly<RuntimeBlock> = Object.freeze({
  observePathChanges: true,
  pathChangeDebounceMs: 200,
  reEvaluateOnPathChange: 'smart',
  observeSubtree: true,
  observeAttributes: 'auto',
  errorRecovery: 'continue',
  onBudgetExceeded: 'stop-cycle',
  maxConsecutivePartialCycles: 3,
})

export const DEFAULT_CACHE: Readonly<CacheBlock> = Object.freeze({
  maxEntries: 1000,
  maxAgeMs: 60000,
  evictionPolicy: 'LRU',
  scope: 'per-rule',
})

export const DEFAULT_LOGIC_OPTIONS: Readonly<LogicOptions> = Object.freeze({
  stopAtScopeForAncestor: true,
})

export const RULE_ID_PREFIX = 'ubr:smart:'

export const STRONG_WHERE_OPERATORS = new Set([
  'equals', 'contains', 'starts-with', 'ends-with', 'regex',
])

export const SAFE_STYLE_PROPERTIES = new Set([
  'display', 'visibility', 'opacity',
  'outline', 'outline-color', 'outline-style', 'outline-width', 'outline-offset',
  'border', 'border-color', 'border-style', 'border-width',
  'background-color', 'color',
  'filter', 'pointer-events',
])

export const ALLOWED_DISPLAY_VALUES = new Set([
  'none', 'block', 'inline', 'inline-block', 'flex', 'grid', 'revert',
])

export const ALLOWED_VISIBILITY_VALUES = new Set([
  'hidden', 'visible', 'collapse',
])

export const DEFAULT_THRESHOLDS: Readonly<Record<string, number>> = Object.freeze({
  'hide-similar:similar:default-card': 0.82,
  'hide-similar:similar:': 0.82,
  'hide-similar:structural': 0.80,
  'smart-hide:similar:strong-logic': 0.74,
  'smart-hide:structural:strong-logic': 0.76,
  'smart-hide:similar:': 0.82,
  'smart-hide:similar:content-heavy': 0.78,
})

export const DEFAULT_WEIGHT_PROFILES: Readonly<Record<string, Record<string, number>>> = Object.freeze({
  'default-card': Object.freeze({
    roleTag: 1.0,
    textTokens: 1.5,
    semanticText: 1.5,
    href: 2.0,
    dataAttrs: 1.5,
    aria: 1.2,
    structure: 2.0,
    visualBox: 1.0,
    classes: 0.25,
    nthChild: 0.5,
  }),
  'structural-heavy': Object.freeze({
    structure: 4.0,
    roleTag: 1.5,
    classes: 0.25,
    visualBox: 1.5,
    textTokens: 0.5,
    semanticText: 0.8,
    href: 1.0,
    dataAttrs: 1.5,
    aria: 0.8,
    nthChild: 0.8,
  }),
  'content-heavy': Object.freeze({
    textTokens: 3.0,
    semanticText: 3.0,
    href: 2.0,
    roleTag: 0.7,
    dataAttrs: 1.5,
    aria: 1.8,
    structure: 1.0,
    classes: 0.1,
    visualBox: 0.5,
    nthChild: 0.2,
  }),
})
