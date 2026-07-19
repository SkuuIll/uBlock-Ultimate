/**
 * src/core/user-rules/export-serializer.ts
 *
 * Serializes a `UserRuleLedger` to portable formats:
 *   - project-native-bundle: the canonical round-trip format
 *     (JSON with `version: 1` and `entries: [...]`)
 *   - plain-text: one rule per line, grouped by lane with
 *     section header comments
 *   - json-rule-package: a generic array shape that any
 *     import-compatible tool can consume
 *
 * Pure module: no chrome.*, no Date.now() (caller-injected
 * `now` for `generatedAt`).
 */

import type { UserRuleLedger, UserRuleLedgerEntry, UserRuleLane } from './local-rule-ledger';

export type ExportFormat = 'project-native-bundle' | 'plain-text' | 'json-rule-package';

export interface ExportOptions {
  /**
   * Whether to include disabled entries. Defaults to false;
   * disabled rules are typically excluded from exports so a
   * user can ship only their active ruleset.
   */
  includeDisabled?: boolean;
  /**
   * Clock for `generatedAt` timestamps. Defaults to `new Date()`.
   * Injectable for deterministic tests.
   */
  now?: () => Date;
}

export interface ExportResult {
  format: ExportFormat;
  ok: boolean;
  /**
   * Serialized text. For `project-native-bundle` and
   * `json-rule-package`, this is the JSON.stringify output.
   * For `plain-text`, this is the per-line text.
   */
  text: string;
  /**
   * Structured payload, present for `project-native-bundle` and
   * `json-rule-package` formats. Useful for callers that want
   * to embed the payload in another document without re-parsing.
   */
  json?: unknown;
  /** Count of exported entries per lane. */
  perLane: Record<UserRuleLane, number>;
}

const LANE_HEADER: Record<UserRuleLane, string> = {
  'persistent-safe-dynamic': '# persistent-safe-dynamic',
  'persistent-unsafe-dynamic': '# persistent-unsafe-dynamic',
  'temporary-session': '# temporary-session',
  'cosmetic-local': '# cosmetic-local',
};

const LANE_ORDER: readonly UserRuleLane[] = [
  'persistent-safe-dynamic',
  'persistent-unsafe-dynamic',
  'temporary-session',
  'cosmetic-local',
];

export function serializeUserRuleLedger(
    ledger: UserRuleLedger,
    format: ExportFormat,
    options: ExportOptions = {},
): ExportResult {
    if (!isValidLedger(ledger)) {
        return errorResult(format);
    }
    const includeDisabled = options.includeDisabled === true;
    const entries = ledger.entries.filter(e => includeDisabled || e.enabled);

    const perLane: Record<UserRuleLane, number> = {
    'persistent-safe-dynamic': 0,
    'persistent-unsafe-dynamic': 0,
    'temporary-session': 0,
    'cosmetic-local': 0,
    };
    for (const e of entries) {
        perLane[e.lane]++;
    }

    switch (format) {
    case 'project-native-bundle':
        return serializeProjectNativeBundle(entries, perLane, options);
    case 'plain-text':
        return serializePlainText(entries, perLane, options);
    case 'json-rule-package':
        return serializeJsonRulePackage(entries, perLane);
    }
}

function serializeProjectNativeBundle(
    entries: readonly UserRuleLedgerEntry[],
    perLane: Record<UserRuleLane, number>,
    options: ExportOptions,
): ExportResult {
    const generatedAt = (options.now ?? (() => new Date()))().toISOString();
    const payload = {
    format: 'project-native-bundle' as const,
    version: 1,
    generatedAt,
    entries: entries.map(e => ({ ...e })),
    };
    return {
    format: 'project-native-bundle',
    ok: true,
    text: JSON.stringify(payload, null, 2),
    json: payload,
    perLane,
    };
}

function serializePlainText(
    entries: readonly UserRuleLedgerEntry[],
    perLane: Record<UserRuleLane, number>,
    options: ExportOptions = {},
): ExportResult {
    const grouped = groupByLane(entries);
    const lines: string[] = [];
  lines.push(`# Exported uBlock Ultimate user rules`);
  lines.push(`# Generated: ${(options.now ?? (() => new Date()))().toISOString()}`);
  for (const lane of LANE_ORDER) {
      const group = grouped[lane];
      if (group.length === 0) continue;
    lines.push('');
    lines.push(LANE_HEADER[lane]);
    for (const e of group) {
        if (!e.enabled) {
        lines.push(`# disabled: ${e.originalText}`);
        } else {
        lines.push(e.originalText);
        }
    }
  }
  return {
    format: 'plain-text',
    ok: true,
    text: `${lines.join('\n')  }\n`,
    perLane,
  };
}

function serializeJsonRulePackage(
    entries: readonly UserRuleLedgerEntry[],
    perLane: Record<UserRuleLane, number>,
): ExportResult {
    const payload = {
    format: 'json-rule-package' as const,
    version: 1,
    rules: entries.map(e => ({
      raw: e.originalText,
      lane: e.lane,
      enabled: e.enabled,
      id: e.id,
    })),
    };
    return {
    format: 'json-rule-package',
    ok: true,
    text: JSON.stringify(payload, null, 2),
    json: payload,
    perLane,
    };
}

function groupByLane(entries: readonly UserRuleLedgerEntry[]): Record<UserRuleLane, UserRuleLedgerEntry[]> {
    const out: Record<UserRuleLane, UserRuleLedgerEntry[]> = {
    'persistent-safe-dynamic': [],
    'persistent-unsafe-dynamic': [],
    'temporary-session': [],
    'cosmetic-local': [],
    };
    for (const e of entries) out[e.lane].push(e);
    return out;
}

function isValidLedger(ledger: unknown): ledger is UserRuleLedger {
    if (typeof ledger !== 'object' || ledger === null) return false;
    const l = ledger as { version?: unknown; entries?: unknown };
    return l.version === 1 && Array.isArray(l.entries);
}

function errorResult(format: ExportFormat): ExportResult {
    return {
    format,
    ok: false,
    text: '',
    perLane: {
      'persistent-safe-dynamic': 0,
      'persistent-unsafe-dynamic': 0,
      'temporary-session': 0,
      'cosmetic-local': 0,
    },
    };
}
