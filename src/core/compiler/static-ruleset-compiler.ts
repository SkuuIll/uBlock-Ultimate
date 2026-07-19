/**
 * src/core/compiler/static-ruleset-compiler.ts
 *
 * End-to-end orchestrator for compiling a filter list into a
 * Rev15-compliant static DNR ruleset artifact.
 *
 * Pipeline:
 *   1. Split input text into `{ raw, line }` entries.
 *   2. Run `resolveBadfilters` to drop base filters cancelled
 *      by a matching `$badfilter` line.
 *   3. For each surviving entry: `classifyFilter` → `planLowering`
 *      → `compileSafeNetworkFilter`. Anything that is not
 *      `emit-safe-block` / `emit-safe-allow` is funneled into the
 *      unsupported-syntax report with a stable reason.
 *   4. Assign sequential, deterministic rule IDs per ruleset.
 *   5. Build a `StaticSourceMapBuilder` entry per emitted DNR
 *      rule.
 *   6. Build a `budget` report and a per-ruleset `unsupported`
 *      report.
 *
 * Pure module, no Chrome API calls, no I/O.
 */

import { classifyFilter, type ClassifiedFilter } from './filter-classifier';
import type { PlanAction } from './rule-lowering-planner';
import {
    compileStaticRemoveparamFilter,
    compileRedirectFilter,
    compileSafeNetworkFilter,
    type SafeDnrRule,
    type CompileOptions,
    type SupportedResourceType,
} from './safe-network-rule-compiler';
import { resolveBadfilters, type RawFilterEntry } from './badfilter-resolver';
import {
    StaticSourceMapBuilder,
    hashString,
} from './source-map-builder';
import {
    assertPriorityInBand,
    type DnrPriorityBandName,
} from '../../js/mv3/dnr-priority-policy';
import {
    createUnsupportedSyntaxReport,
    type UnsupportedSyntaxEntry,
} from './unsupported-syntax-report';

export interface StaticRulesetBudget {
  ruleCount: number;
  safeBlockCount: number;
  safeAllowCount: number;
  regexRuleCount: number;
  cosmeticCount: number;
  limitedSupportedCount: number;
  unsupportedCount: number;
  invalidCount: number;
  badfilterDroppedCount: number;
  badfilterOrphanCount: number;
  badfilterUnsupportedCount: number;
  priorityBand: DnrPriorityBandName;
  generatedAt: string;
}

export interface StaticRulesetUnsupportedEntry {
  line: number | null;
  raw: string;
  reason: string;
  lane: string;
  action: PlanAction | 'badfilter-dropped' | 'badfilter-orphan' | 'badfilter-unsupported';
}

export interface StaticRulesetUnsupportedReport {
  generatedAt: string;
  entries: StaticRulesetUnsupportedEntry[];
}

export interface StaticRulesetArtifact {
  rulesetId: string;
  sourceList: string;
  rules: SafeDnrRule[];
  budget: StaticRulesetBudget;
  unsupported: StaticRulesetUnsupportedReport;
  sourceMap: ReturnType<StaticSourceMapBuilder['entries_']>;
}

export interface StaticRulesetCompileOptions {
  rulesetId: string;
  /** Path or label of the source filter list, used in source-map entries. */
  sourceList: string;
  /** Raw filter-list text. Newlines separate filters. */
  text: string;
  /** Priority band. Default: 'packagedHighConfidenceBlock' for blocks, 'packagedAllow' for allows. */
  blockPriorityBand?: DnrPriorityBandName;
  allowPriorityBand?: DnrPriorityBandName;
  /** idStart for the first emitted rule. Default: 1. */
  idStart?: number;
  /** Override Date.now() for deterministic test output. */
  now?: () => Date;
}

const DEFAULT_BLOCK_BAND: DnrPriorityBandName = 'packagedHighConfidenceBlock';
const DEFAULT_ALLOW_BAND: DnrPriorityBandName = 'packagedAllow';
const DOMAIN_CONDITION_MAX_CHARS = 2048;

export class StaticRulesetCompiler {
    private readonly rulesetId: string;
    private readonly sourceList: string;
    private readonly text: string;
    private readonly blockBand: DnrPriorityBandName;
    private readonly allowBand: DnrPriorityBandName;
    private readonly idStart: number;
    private readonly now: () => Date;

    constructor(opts: StaticRulesetCompileOptions) {
        this.rulesetId = opts.rulesetId;
        this.sourceList = opts.sourceList;
        this.text = opts.text;
        this.blockBand = opts.blockPriorityBand ?? DEFAULT_BLOCK_BAND;
        this.allowBand = opts.allowPriorityBand ?? DEFAULT_ALLOW_BAND;
        this.idStart = Math.max(1, Math.floor(opts.idStart ?? 1));
        this.now = opts.now ?? (() => new Date());
    }

    compile(): StaticRulesetArtifact {
        const sourceMap = new StaticSourceMapBuilder({ rulesetId: this.rulesetId });
        const unsupported: StaticRulesetUnsupportedEntry[] = [];
        const rules: SafeDnrRule[] = [];

        let safeBlockCount = 0;
        let safeAllowCount = 0;
        let regexRuleCount = 0;
        const cosmeticCount = 0;
        let limitedSupportedCount = 0;
        let unsupportedCount = 0;
        let invalidCount = 0;

        const rawEntries = splitFilterText(this.sourceList, this.text);
        const resolved = resolveBadfilters(rawEntries);

        for (const dropped of resolved.dropped) {
      unsupported.push({
        line: dropped.line,
        raw: dropped.raw,
        reason: `dropped by badfilter: ${dropped.matchedBy}`,
        lane: 'safe-dnr-block-or-allow',
        action: 'badfilter-dropped',
      });
        }

        let nextId = this.idStart;

        for (const entry of resolved.kept) {
            const cls = classifyFilter(entry.raw);
            switch (cls.lane) {
            case 'invalid':
                invalidCount++;
          unsupported.push({
            line: entry.line,
            raw: entry.raw,
            reason: cls.reason,
            lane: cls.lane,
            action: 'skip-invalid',
          });
                continue;
            case 'limited-supported':
                {
                    const isImportant = hasImportantOption(cls.options ?? []);
                    const priorityBand = selectStaticPriorityBand(
                        false,
                        isImportant,
                        this.blockBand,
                    );
                    const defaultPriority = priorityBandDefault(priorityBand);
                    // Try $removeparam first, then $redirect
                    let compileResult = compileStaticRemoveparamFilter(cls.raw, {
              idStart: nextId,
              priority: defaultPriority,
                    });
                    if (!compileResult.ok || !compileResult.rule) {
                        compileResult = compileRedirectFilter(cls.raw, {
                idStart: nextId,
                priority: defaultPriority,
                        });
                    }
                    if (!compileResult.ok || !compileResult.rule) {
                        unsupportedCount++;
              unsupported.push({
                line: entry.line,
                raw: entry.raw,
                reason: compileResult.reason ?? 'compileStaticRemoveparamFilter returned no rule',
                lane: cls.lane,
                action: 'skip-unsupported',
              });
              continue;
                    }
                    const rule = compileResult.rule;
                    const bandCheck = assertPriorityInBand(rule.priority, priorityBand);
                    if (!bandCheck.ok) {
                        unsupportedCount++;
              unsupported.push({
                line: entry.line,
                raw: entry.raw,
                reason: bandCheck.reason,
                lane: cls.lane,
                action: 'skip-unsupported',
              });
              continue;
                    }
                    const expandedRules = splitRuleByDomainCondition(rule, nextId);
                    if (typeof expandedRules === 'string') {
                        unsupportedCount++;
              unsupported.push({
                line: entry.line,
                raw: entry.raw,
                reason: expandedRules,
                lane: cls.lane,
                action: 'skip-unsupported',
              });
              continue;
                    }
            for (const expandedRule of expandedRules) {
                rules.push(expandedRule);
                sourceMap.add({
                  ruleId: expandedRule.id,
                  sourceList: this.sourceList,
                  originalFilter: cls.raw,
                  compiledAction: expandedRule.action.type,
                  sourceLine: entry.line,
                  sourceTextHash: hashString(cls.raw),
                  lane: cls.lane,
                  loggerRegex:
                      loggerRegexFromCondition(expandedRule.condition),
                });
            }
            limitedSupportedCount += expandedRules.length;
            nextId += expandedRules.length;
                }
                continue;
            case 'unsupported-recognized':
                unsupportedCount++;
          unsupported.push({
            line: entry.line,
            raw: entry.raw,
            reason: cls.reason,
            lane: cls.lane,
            action: 'skip-unsupported',
          });
                continue;
            case 'safe-dnr-block':
            case 'safe-dnr-allow': {
                const isException = cls.lane === 'safe-dnr-allow';
                const isImportant = hasImportantOption(cls.options ?? []);
                const priorityBand = selectStaticPriorityBand(
                    isException,
                    isImportant,
                    isException ? this.allowBand : this.blockBand,
                );
                const defaultPriority = priorityBandDefault(priorityBand);
                const optionsFromClassification = parseClassifiedOptions(
                    cls.options ?? [],
                );
                const compileResult = compileSafeNetworkFilter(cls.raw, {
            idStart: nextId,
            priority: defaultPriority,
            ...optionsFromClassification,
                });
                if (!compileResult.ok || !compileResult.rule) {
                    unsupportedCount++;
            unsupported.push({
              line: entry.line,
              raw: entry.raw,
              reason: compileResult.reason ?? 'compileSafeNetworkFilter returned no rule',
              lane: cls.lane,
              action: 'skip-unsupported',
            });
            continue;
                }
                const rule = compileResult.rule;
                // Make sure the rule is in the band the orchestrator
                // claimed. Safe compiler defaults to the same band
                // midpoint so this is normally a no-op.
                const bandCheck = assertPriorityInBand(rule.priority, priorityBand);
                if (!bandCheck.ok) {
                    unsupportedCount++;
            unsupported.push({
              line: entry.line,
              raw: entry.raw,
              reason: bandCheck.reason,
              lane: cls.lane,
              action: 'skip-unsupported',
            });
            continue;
                }

          const expandedRules = splitRuleByDomainCondition(rule, nextId);
          if (typeof expandedRules === 'string') {
              unsupportedCount++;
            unsupported.push({
              line: entry.line,
              raw: entry.raw,
              reason: expandedRules,
              lane: cls.lane,
              action: 'skip-unsupported',
            });
            continue;
          }

          for (const expandedRule of expandedRules) {
              rules.push(expandedRule);
              sourceMap.add({
                ruleId: expandedRule.id,
                sourceList: this.sourceList,
                originalFilter: cls.raw,
                compiledAction: expandedRule.action.type,
                sourceLine: entry.line,
                sourceTextHash: hashString(cls.raw),
                lane: cls.lane,
                loggerRegex:
                    loggerRegexFromCondition(expandedRule.condition),
              });

              if (typeof expandedRule.condition === 'object' &&
                  expandedRule.condition !== null &&
                  'regexFilter' in expandedRule.condition &&
                  typeof (expandedRule.condition as { regexFilter?: unknown }).regexFilter === 'string') {
                  regexRuleCount++;
              }
          }

          if (isException) safeAllowCount += expandedRules.length;
          else safeBlockCount += expandedRules.length;
          nextId += expandedRules.length;
          break;
            }
            default: {
                // Defensive: an unknown lane from the classifier should
                // never happen, but record it for visibility.
                unsupportedCount++;
          unsupported.push({
            line: entry.line,
            raw: entry.raw,
            reason: `Unknown lane from classifier: ${(cls as ClassifiedFilter).lane}`,
            lane: (cls as ClassifiedFilter).lane,
            action: 'skip-unsupported',
          });
            }
            }
        }

        const now = this.now();
        const budget: StaticRulesetBudget = {
      ruleCount: rules.length,
      safeBlockCount,
      safeAllowCount,
      regexRuleCount,
      cosmeticCount,
      limitedSupportedCount,
      unsupportedCount,
      invalidCount,
      badfilterDroppedCount: resolved.dropped.length,
      badfilterOrphanCount: resolved.orphanBadfilterCount,
      badfilterUnsupportedCount: resolved.unsupportedBadfilterCount,
      priorityBand: this.blockBand,
      generatedAt: now.toISOString(),
        };

        const unsupportedReport: StaticRulesetUnsupportedReport = {
      generatedAt: now.toISOString(),
      entries: unsupported,
        };

        return {
      rulesetId: this.rulesetId,
      sourceList: this.sourceList,
      rules,
      budget,
      unsupported: unsupportedReport,
      sourceMap: sourceMap.entries_(),
        };
    }
}

export function compileStaticRuleset(
    opts: StaticRulesetCompileOptions,
): StaticRulesetArtifact {
    return new StaticRulesetCompiler(opts).compile();
}

/**
 * Lightweight wrapper around `createUnsupportedSyntaxReport` so
 * downstream consumers can ask the compiler for the static table
 * without re-importing from `./unsupported-syntax-report`.
 */
export function compileStaticKnownUnsupportedSyntax(): UnsupportedSyntaxEntry[] {
    return createUnsupportedSyntaxReport().entries;
}

/**
 * Split raw filter-list text into `{ raw, line }` entries. Lines
 * are 1-indexed to match user expectations. File-level comments
 * (lines starting with `!` or `[`) and blank lines are skipped
 * here so they do not pollute the classifier's "invalid" lane.
 */
export function splitFilterText(
    sourceList: string,
    text: string,
): RawFilterEntry[] {
    if (typeof text !== 'string' || text.length === 0) return [];
    const lines = text.split(/\r?\n/);
    const out: RawFilterEntry[] = [];
    for (let i = 0; i < lines.length; i++) {
        const raw = lines[i];
        if (typeof raw !== 'string') continue;
        const trimmed = raw.trim();
        if (trimmed.length === 0) continue;
        if (trimmed.startsWith('!') || trimmed.startsWith('[')) continue;
    out.push({ raw, line: i + 1 });
    }
    return out;
}

/**
 * Parse classified option strings into CompileOptions fields.
 * The classifier has already vetted these as supported; we just
 * need to convert string tokens to typed fields.
 */
function parseClassifiedOptions(
    options: string[],
): Partial<CompileOptions> {
    const out: Partial<CompileOptions> = {};
    for (const opt of options) {
        const lower = opt.toLowerCase();
        if (lower === 'third-party' || lower === '3p') {
            out.domainType = 'thirdParty';
        } else if (lower === '~third-party') {
            out.domainType = 'firstParty';
        } else if (lower === 'first-party' || lower === '1p') {
            out.domainType = 'firstParty';
        } else if (lower === 'match-case') {
            out.isCaseSensitive = true;
        } else if (lower === '~match-case') {
            out.isCaseSensitive = false;
        } else if (lower.startsWith('domain=') || lower.startsWith('from=')) {
            const parsed = parseOptionDomainList(
                lower.startsWith('domain=')
                    ? lower.slice('domain='.length)
                    : lower.slice('from='.length),
            );
            out.initiatorDomains = mergeUnique(out.initiatorDomains, parsed.include);
            out.excludedInitiatorDomains = mergeUnique(
                out.excludedInitiatorDomains,
                parsed.exclude,
            );
        } else if (lower.startsWith('to=')) {
            const parsed = parseOptionDomainList(lower.slice('to='.length));
            out.requestDomains = mergeUnique(out.requestDomains, parsed.include);
            out.excludedRequestDomains = mergeUnique(
                out.excludedRequestDomains,
                parsed.exclude,
            );
        } else if (resourceOptionToDnrType(lower) !== undefined) {
            out.resourceTypes = out.resourceTypes ?? [];
            out.resourceTypes.push(resourceOptionToDnrType(lower)!);
        } else if (lower.startsWith('~') && resourceOptionToDnrType(lower.slice(1)) !== undefined) {
            out.excludedResourceTypes = out.excludedResourceTypes ?? [];
            out.excludedResourceTypes.push(resourceOptionToDnrType(lower.slice(1))!);
        }
    }
    return out;
}

function hasImportantOption(options: string[]): boolean {
    return options.some(option => option.toLowerCase() === 'important');
}

function selectStaticPriorityBand(
    isException: boolean,
    isImportant: boolean,
    configuredBand: DnrPriorityBandName,
): DnrPriorityBandName {
    if (!isImportant) return configuredBand;
    if (!isException && configuredBand === DEFAULT_BLOCK_BAND) {
        return 'packagedImportantBlock';
    }
    if (isException && configuredBand === DEFAULT_ALLOW_BAND) {
        return 'packagedImportantAllow';
    }
    return configuredBand;
}

function parseOptionDomainList(value: string): {
    include: string[];
    exclude: string[];
} {
    const include: string[] = [];
    const exclude: string[] = [];

    for (const raw of value.split('|')) {
        const domain = raw.trim().toLowerCase();
        if (domain === '') continue;
        if (domain.startsWith('~')) {
            const excluded = domain.slice(1);
            if (excluded !== '') exclude.push(excluded);
        } else {
            include.push(domain);
        }
    }

    return { include, exclude };
}

function mergeUnique<T>(left: T[] | undefined, right: T[]): T[] | undefined {
    if (right.length === 0) return left;
    return Array.from(new Set([...(left ?? []), ...right]));
}

function splitRuleByDomainCondition(
    rule: SafeDnrRule,
    firstId: number,
): SafeDnrRule[] | string {
    let rules = [cloneRule(rule)];

    for (const key of ['initiatorDomains', 'requestDomains'] as const) {
        if (rules.every(item => domainConditionLength(item.condition) <= DOMAIN_CONDITION_MAX_CHARS)) {
            break;
        }

        const nextRules: SafeDnrRule[] = [];

        for (const item of rules) {
            if (domainConditionLength(item.condition) <= DOMAIN_CONDITION_MAX_CHARS) {
                nextRules.push(item);
                continue;
            }

            const split = splitRuleDomainArray(item, key);
            if (split === null) {
                return `Domain condition exceeds Chrome limit and cannot be split safely (${key}).`;
            }

            nextRules.push(...split);
        }

        rules = nextRules;
    }

    if (rules.some(item => domainConditionLength(item.condition) > DOMAIN_CONDITION_MAX_CHARS)) {
        return 'Domain condition exceeds Chrome limit after splitting.';
    }

    return rules.map((item, index) => ({
        ...item,
        id: firstId + index,
    }));
}

function splitRuleDomainArray(
    rule: SafeDnrRule,
    key: 'initiatorDomains' | 'requestDomains',
): SafeDnrRule[] | null {
    const domains = rule.condition[key];
    if (!Array.isArray(domains) || domains.length <= 1) {
        return null;
    }

    const baseCondition = cloneCondition(rule.condition);
    delete baseCondition[key];
    if (domainConditionLength(baseCondition) > DOMAIN_CONDITION_MAX_CHARS) {
        return null;
    }

    const chunks: string[][] = [];
    let current: string[] = [];

    for (const domain of domains) {
        const candidate = [...current, domain];
        const candidateCondition = {
            ...baseCondition,
            [key]: candidate,
        };

        if (domainConditionLength(candidateCondition) <= DOMAIN_CONDITION_MAX_CHARS) {
            current = candidate;
            continue;
        }

        if (current.length === 0) {
            return null;
        }

        chunks.push(current);
        current = [domain];
    }

    if (current.length !== 0) {
        chunks.push(current);
    }

    return chunks.map(chunk => ({
        ...cloneRule(rule),
        condition: {
            ...baseCondition,
            [key]: chunk,
        },
    }));
}

function domainConditionLength(condition: SafeDnrRule['condition']): number {
    const initiatorDomains = Array.isArray(condition.initiatorDomains)
        ? condition.initiatorDomains
        : [];
    const excludedInitiatorDomains = Array.isArray(condition.excludedInitiatorDomains)
        ? condition.excludedInitiatorDomains
        : [];
    const requestDomains = Array.isArray(condition.requestDomains)
        ? condition.requestDomains
        : [];
    const excludedRequestDomains = Array.isArray(condition.excludedRequestDomains)
        ? condition.excludedRequestDomains
        : [];

    return (
        JSON.stringify(initiatorDomains) +
        JSON.stringify(excludedInitiatorDomains) +
        JSON.stringify(requestDomains) +
        JSON.stringify(excludedRequestDomains)
    ).length;
}

function cloneRule(rule: SafeDnrRule): SafeDnrRule {
    return {
        ...rule,
        action: {
            ...rule.action,
            redirect: rule.action.redirect !== undefined
                ? { ...rule.action.redirect }
                : undefined,
        },
        condition: cloneCondition(rule.condition),
    };
}

function cloneCondition(
    condition: SafeDnrRule['condition'],
): SafeDnrRule['condition'] {
    return {
        ...condition,
        initiatorDomains: condition.initiatorDomains?.slice(),
        excludedInitiatorDomains: condition.excludedInitiatorDomains?.slice(),
        requestDomains: condition.requestDomains?.slice(),
        excludedRequestDomains: condition.excludedRequestDomains?.slice(),
        resourceTypes: condition.resourceTypes?.slice(),
        excludedResourceTypes: condition.excludedResourceTypes?.slice(),
    };
}

const escapeRegexLiteral = (value: string): string =>
    value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const loggerRegexFromCondition = (
    condition: SafeDnrRule['condition'],
): string | undefined => {
    if (
        typeof condition.regexFilter === 'string' &&
        condition.regexFilter !== ''
    ) {
        return condition.regexFilter;
    }

    if (
        typeof condition.urlFilter !== 'string' ||
        condition.urlFilter === ''
    ) {
        return undefined;
    }

    const normalized = condition.urlFilter
        .replace(/^\|\|?/, '')
        .replace(/\|$/, '');

    const literals = normalized
        .split(/[*^|]+/)
        .map(part => part.trim())
        .filter(part => part.length >= 2)
        .sort((a, b) => b.length - a.length);

    if (literals.length === 0) {
        return undefined;
    }

    return escapeRegexLiteral(literals[0]);
};

function resourceOptionToDnrType(option: string): SupportedResourceType | undefined {
    const aliases = new Map<string, SupportedResourceType>([
        ['script', 'script'],
        ['image', 'image'],
        ['stylesheet', 'stylesheet'],
        ['xhr', 'xmlhttprequest'],
        ['xmlhttprequest', 'xmlhttprequest'],
        ['document', 'main_frame'],
        ['main_frame', 'main_frame'],
        ['frame', 'sub_frame'],
        ['subdocument', 'sub_frame'],
        ['sub_frame', 'sub_frame'],
        ['font', 'font'],
        ['media', 'media'],
        ['websocket', 'websocket'],
        ['webtransport', 'webtransport'],
        ['webbundle', 'webbundle'],
        ['ping', 'ping'],
        ['csp_report', 'csp_report'],
        ['object', 'object'],
        ['other', 'other'],
    ]);

    return aliases.get(option);
}

function priorityBandDefault(band: DnrPriorityBandName): number {
    const defaults: Partial<Record<DnrPriorityBandName, number>> = {
        packagedHighConfidenceBlock: 420000,
        packagedAllow: 520000,
        packagedImportantBlock: 560000,
        packagedImportantAllow: 590000,
    };
    const defaultPriority = defaults[band];
    if (defaultPriority !== undefined) {
        return defaultPriority;
    }

    const ranges: Record<DnrPriorityBandName, readonly [number, number]> = {
    codeViewerDiagnostic: [2_500_000, 2_599_999],
    userEmergencyOverride: [2_400_000, 2_499_999],
    sessionTemporary: [2_300_001, 2_399_999],
    userPersistentSafeDynamic: [2_200_001, 2_300_000],
    userManagedReserved: [700000, 799999],
    userDisabledStaticReplacement: [600000, 699999],
    packagedImportantAllow: [580000, 599999],
    packagedImportantBlock: [550000, 579999],
    packagedAllow: [500000, 539999],
    packagedHighConfidenceBlock: [400000, 449999],
    packagedTrackerPrivacy: [300000, 399999],
    packagedAnnoyance: [200000, 299999],
    upgradeScheme: [100000, 199999],
    experimentalPackaged: [1, 99999],
    };
    const [lo, hi] = ranges[band];
    return Math.floor((lo + hi) / 2);
}
