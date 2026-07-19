/**
 * src/core/user-rules/import-validator.ts
 *
 * Validates a multi-rule import block (plain text, JSON rule
 * package, or project-native bundle) and produces per-line
 * classifications plus an aggregated budget impact.
 *
 * Per Rev15 §5.6, the workflow is:
 *   - validate syntax
 *   - classify rule type
 *   - lower into DNR/cosmetic/unsupported lane
 *   - show generated output preview
 *   - show budget impact
 *   - warn for overbroad rules
 *   - warn for high-risk site impact
 *   - require confirmation for dangerous rules
 *   - write to local ledger
 *   - apply atomically when possible
 *
 * This module is steps 1-3 and 5-7. Step 4 (preview) is produced
 * indirectly via the classification's `lane` and `notes`. Steps
 * 8-10 (confirmation, ledger write, apply) live in
 * `custom-filter-editor-model.ts` and the dynamic-rule bridge.
 */

import {
    classifyUserRule,
    type ClassifyUserRuleOptions,
    type UserRuleClassification,
} from './rule-classifier';

export type ImportFormat = 'plain-text' | 'json-rule-package' | 'project-native-bundle';

export interface ImportLineResult {
  /** 1-indexed line number in the original input. */
  lineNumber: number;
  raw: string;
  classification: UserRuleClassification;
  /**
   * True if the rule can be installed as-is. False when the line
   * is invalid, when the underlying syntax is unsupported, or
   * when the dangerous flag is set and the user has not yet
   * confirmed the rule.
   */
  accepted: boolean;
  /**
   * Human-readable reason when `accepted === false`. Not
   * displayed to the user verbatim; the editor's UI is the
   * authoritative surface.
   */
  reason?: string;
}

export interface ImportBudgetImpact {
  safeDelta: number;
  unsafeDelta: number;
  sessionDelta: number;
}

export interface ImportCounts {
  accepted: number;
  rejected: number;
  overbroad: number;
  highRisk: number;
  dangerous: number;
}

export interface ImportValidation {
  format: ImportFormat;
  ok: boolean;
  perLine: ImportLineResult[];
  counts: ImportCounts;
  budgetImpact: ImportBudgetImpact;
  /**
   * Map from 1-indexed line number to the line's original text.
   * Convenience for editor UI that wants to render accepted lines
   * without re-parsing.
   */
  linesByNumber: Record<number, string>;
}

export interface ValidateImportOptions extends ClassifyUserRuleOptions {
  /**
   * Per-line accepted-state override. Map from 1-indexed line
   * number to true. Used by the editor's `acceptDangerous` flow:
   * the validator pre-classifies the line as `accepted: false`
   * with reason `requires explicit confirmation`, and the
   * editor then flips the override to mark it accepted.
   */
  dangerousAcceptedByLine?: ReadonlySet<number>;
  /**
   * Safety cap on the number of lines the validator will
   * process. Defaults to 100_000.
   */
  maxLines?: number;
  /**
   * Force a particular format. If omitted, the format is
   * auto-detected from the input.
   */
  format?: ImportFormat;
}

const DEFAULT_MAX_LINES = 100_000;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function validateImport(
    input: string,
    options: ValidateImportOptions = {},
): ImportValidation {
    if (typeof input !== 'string') {
        return emptyResult('plain-text');
    }

    const maxLines = options.maxLines ?? DEFAULT_MAX_LINES;
    const format = options.format ?? detectFormat(input);
    const dangerousAccepted = options.dangerousAcceptedByLine ?? new Set<number>();

    const lines = extractLines(input, format, maxLines);
    const perLine: ImportLineResult[] = [];
    const linesByNumber: Record<number, string> = {};
    const counts: ImportCounts = {
    accepted: 0,
    rejected: 0,
    overbroad: 0,
    highRisk: 0,
    dangerous: 0,
    };
    const budget: ImportBudgetImpact = {
    safeDelta: 0,
    unsafeDelta: 0,
    sessionDelta: 0,
    };

    for (let i = 0; i < lines.length; i++) {
        const lineNumber = i + 1;
        const raw = lines[i];
        linesByNumber[lineNumber] = raw;
        const classification = classifyUserRule(raw, options);
        const { accepted, reason } = evaluateAcceptance(
            classification,
      dangerousAccepted.has(lineNumber),
        );
    perLine.push({ lineNumber, raw, classification, accepted, reason });

    if (accepted) {
        counts.accepted++;
        budget.safeDelta += classification.estimatedBudgetImpact.safe;
        budget.unsafeDelta += classification.estimatedBudgetImpact.unsafe;
        budget.sessionDelta += classification.estimatedBudgetImpact.session;
    } else {
        counts.rejected++;
    }
    if (classification.warnings.overbroad) counts.overbroad++;
    if (classification.warnings.highRiskSite) counts.highRisk++;
    if (classification.warnings.dangerous) counts.dangerous++;
    }

    return {
    format,
    ok: counts.rejected === 0,
    perLine,
    counts,
    budgetImpact: budget,
    linesByNumber,
    };
}

export function detectFormat(input: string): ImportFormat {
    // Trim to find the first non-blank line.
    const first = firstNonBlankLine(input);
    if (first === null) return 'plain-text';
    const trimmed = first.trim();
    // A JSON rule package or a project-native bundle both start
    // with `{` and parse as a JSON object. Distinguish by shape:
    //   - project-native bundle has top-level `version: 1` and
    //     `entries: []`
    //   - JSON rule package has top-level `rules: []` or `format`
    if (trimmed.startsWith('{')) {
        try {
            const obj = JSON.parse(input);
            if (isPlainObject(obj)) {
                if (obj.version === 1 && Array.isArray(obj.entries)) {
                    return 'project-native-bundle';
                }
                if (Array.isArray(obj.rules) || typeof obj.format === 'string') {
                    return 'json-rule-package';
                }
            }
        } catch (e) {
      console.warn('[uBR] import-validator: JSON parse failed in detectFormat', e);
        }
    }
    return 'plain-text';
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function emptyResult(format: ImportFormat): ImportValidation {
    return {
    format,
    ok: true,
    perLine: [],
    counts: { accepted: 0, rejected: 0, overbroad: 0, highRisk: 0, dangerous: 0 },
    budgetImpact: { safeDelta: 0, unsafeDelta: 0, sessionDelta: 0 },
    linesByNumber: {},
    };
}

function firstNonBlankLine(input: string): string | null {
    const lines = input.split(/\r?\n/);
    for (const line of lines) {
        if (line.trim().length > 0) return line;
    }
    return null;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
    return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function extractLines(input: string, format: ImportFormat, maxLines: number): string[] {
    switch (format) {
    case 'plain-text':
        return extractPlainTextLines(input, maxLines);
    case 'json-rule-package':
        return extractJsonRulePackageLines(input, maxLines);
    case 'project-native-bundle':
        return extractProjectNativeBundleLines(input, maxLines);
    }
}

function extractPlainTextLines(input: string, maxLines: number): string[] {
    // Skip empty lines: they are not user input. This keeps
    // `validateImport('')` from counting a phantom rejection and
    // lets the editor round-trip whitespace in the textarea
    // without inflating the perLine count.
    const out: string[] = [];
    for (const line of input.split(/\r?\n/)) {
        if (out.length >= maxLines) break;
        if (line.trim().length === 0) continue;
    out.push(line);
    }
    return out;
}

interface JsonRulePackageShape {
  rules?: Array<{ raw?: unknown; text?: unknown; filter?: unknown; line?: unknown }>;
}

function extractJsonRulePackageLines(input: string, maxLines: number): string[] {
    let parsed: unknown;
    try {
        parsed = JSON.parse(input);
    } catch (e) {
    console.warn('[uBR] import-validator: JSON parse failed in extractJsonRulePackageLines', e);
    return [];
    }
    if (!isPlainObject(parsed)) return [];
    const pkg = parsed as JsonRulePackageShape;
    if (!Array.isArray(pkg.rules)) return [];
    const out: string[] = [];
    for (const entry of pkg.rules) {
        if (out.length >= maxLines) break;
        if (!isPlainObject(entry)) continue;
        const raw = entry.raw ?? entry.text ?? entry.filter;
        if (typeof raw === 'string' && raw.length > 0) {
      out.push(raw);
        }
    }
    return out;
}

interface ProjectNativeBundleShape {
  entries?: Array<{ originalText?: unknown; raw?: unknown; text?: unknown }>;
}

function extractProjectNativeBundleLines(input: string, maxLines: number): string[] {
    let parsed: unknown;
    try {
        parsed = JSON.parse(input);
    } catch (e) {
    console.warn('[uBR] import-validator: JSON parse failed in extractProjectNativeBundleLines', e);
    return [];
    }
    if (!isPlainObject(parsed)) return [];
    const bundle = parsed as ProjectNativeBundleShape;
    if (!Array.isArray(bundle.entries)) return [];
    const out: string[] = [];
    for (const entry of bundle.entries) {
        if (out.length >= maxLines) break;
        if (!isPlainObject(entry)) continue;
        const raw = entry.originalText ?? entry.raw ?? entry.text;
        if (typeof raw === 'string' && raw.length > 0) {
      out.push(raw);
        }
    }
    return out;
}

function evaluateAcceptance(
    classification: UserRuleClassification,
    dangerousAccepted: boolean,
): { accepted: boolean; reason?: string } {
    // Invalid / empty / comment lines are never accepted.
    if (classification.underlyingFilterLane === 'invalid') {
        return { accepted: false, reason: 'Invalid or non-rule line.' };
    }
    // Dangerous rules (overbroad or high-risk) require explicit
    // confirmation. This check runs before the unsupported check
    // so a user who wrote a wide network rule like `*$third-party`
    // sees the more specific "needs confirmation" reason instead
    // of a generic "unsupported" message.
    if (classification.warnings.dangerous && !dangerousAccepted) {
        return { accepted: false, reason: 'Requires explicit confirmation.' };
    }
    // Unsupported-recognized lines are not installable as normal
    // persistent rules. The exception is when isUnsafeAllowed is
    // true and the rule was placed in the unsafe dynamic lane
    // (e.g. $replace, $csp). Otherwise reject the line.
    if (classification.underlyingFilterLane === 'unsupported-recognized') {
        if (classification.lane === 'persistent-unsafe-dynamic') {
            return { accepted: true };
        }
        return { accepted: false, reason: 'Syntax not supported in current profile.' };
    }
    return { accepted: true };
}
