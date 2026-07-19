export interface CosmeticSafetyConfig {
  engine: string;
  documentStartInjection: boolean;
  mutationBatchLimitPerSecond: number;
  mutationSelectorRecheckLimit: number;
  hasSelectorsNativeOnly: boolean;
  hasDefaultPerDomain: number;
  hasDefaultTotal: number;
  hasUserAdjustableBudget: boolean;
  selectorTextLengthCap: number;
  prohibitedSelectorPatterns: string[];
  userSelectorUndo: boolean;
  foucMitigationPolicy: string;
  highRiskSitePolicy: string;
  longTaskPolicy: string;
  disableAdvancedCssToggle: boolean;
  noV1ScriptletInjection: boolean;
  noV1ProceduralSelectors: boolean;
}

export const DEFAULT_COSMETIC_SAFETY_CONFIG: CosmeticSafetyConfig = {
  engine: 'basic-css-injection',
  documentStartInjection: true,
  mutationBatchLimitPerSecond: 5,
  mutationSelectorRecheckLimit: 100,
  hasSelectorsNativeOnly: true,
  hasDefaultPerDomain: 5,
  hasDefaultTotal: 50,
  hasUserAdjustableBudget: true,
  selectorTextLengthCap: 2048,
  prohibitedSelectorPatterns: [
    'javascript:',
    'expression(',
    '-moz-binding',
    'behavior:',
    'url(javascript:',
  ],
  userSelectorUndo: true,
  foucMitigationPolicy: 'style-before-content-script',
  highRiskSitePolicy: 'reduce-observer-budget',
  longTaskPolicy: 'defer-after-50ms',
  disableAdvancedCssToggle: true,
  noV1ScriptletInjection: true,
  noV1ProceduralSelectors: true,
};

export function validateCosmeticSafetyConfig(config: CosmeticSafetyConfig): { ok: boolean; errors: string[] } {
    const errors: string[] = [];
    if (config.selectorTextLengthCap < 256) errors.push('selectorTextLengthCap too low');
    if (config.mutationBatchLimitPerSecond < 1) errors.push('mutationBatchLimitPerSecond too low');
    if (config.mutationSelectorRecheckLimit < 1) errors.push('mutationSelectorRecheckLimit too low');
    if (config.hasDefaultPerDomain < 1) errors.push('hasDefaultPerDomain too low');
    if (config.hasDefaultTotal < 1) errors.push('hasDefaultTotal too low');
    if (config.prohibitedSelectorPatterns.length === 0) errors.push('no prohibited selector patterns');
    return { ok: errors.length === 0, errors };
}

export function isSelectorLengthSafe(selector: string, cap: number = DEFAULT_COSMETIC_SAFETY_CONFIG.selectorTextLengthCap): boolean {
    return selector.length <= cap;
}

export function isSelectorProhibited(selector: string, patterns: string[] = DEFAULT_COSMETIC_SAFETY_CONFIG.prohibitedSelectorPatterns): boolean {
    const lower = selector.toLowerCase();
    return patterns.some(p => lower.includes(p));
}

export function sanitizeSelector(selector: string): string {
    if (isSelectorProhibited(selector)) return '';
    if (!isSelectorLengthSafe(selector)) return selector.slice(0, DEFAULT_COSMETIC_SAFETY_CONFIG.selectorTextLengthCap);
    return selector;
}
