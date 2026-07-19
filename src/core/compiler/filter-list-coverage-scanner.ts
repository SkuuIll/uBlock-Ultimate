/**
 * src/core/compiler/filter-list-coverage-scanner.ts
 *
 * Scans a filter list (text) and produces a coverage report using
 * classifyFilter(). Reports a per-lane count, a percentage split
 * between supported / limited / unsupported / invalid, and a
 * summarized top-N list of the unsupported filters.
 */

import { classifyFilter, type FilterLane } from './filter-classifier';

export interface CoverageReport {
  total: number;
  counts: Record<FilterLane, number>;
  percentages: Record<FilterLane, number>;
  supported: number;
  limited: number;
  unsupported: number;
  invalid: number;
  topUnsupportedSamples: Array<{ line: number; raw: string; reason: string }>;
}

const SUPPORTED_LANES: ReadonlySet<FilterLane> = new Set([
  'safe-dnr-block',
  'safe-dnr-allow',
]);

const LIMITED_LANES: ReadonlySet<FilterLane> = new Set([
  'limited-supported',
]);

const UNSUPPORTED_LANES: ReadonlySet<FilterLane> = new Set([
  'unsupported-recognized',
]);

const INVALID_LANES: ReadonlySet<FilterLane> = new Set([
  'invalid',
]);

const ALL_LANES: FilterLane[] = [
  'safe-dnr-block',
  'safe-dnr-allow',
  'limited-supported',
  'unsupported-recognized',
  'invalid',
];

export function emptyCounts(): Record<FilterLane, number> {
    const out = {} as Record<FilterLane, number>;
    for (const lane of ALL_LANES) out[lane] = 0;
    return out;
}

function pct(n: number, d: number): number {
    if (d <= 0) return 0;
    return Math.round((n / d) * 10000) / 100;
}

export function scanFilterListCoverage(opts: {
  text: string;
  topUnsupportedN?: number;
}): CoverageReport {
    const counts = emptyCounts();
    const unsupported: Array<{ line: number; raw: string; reason: string }> = [];
    let total = 0;

    if (typeof opts.text !== 'string' || opts.text.length === 0) {
        const percentages = {} as Record<FilterLane, number>;
        for (const lane of ALL_LANES) percentages[lane] = 0;
        return {
      total: 0,
      counts,
      percentages,
      supported: 0,
      limited: 0,
      unsupported: 0,
      invalid: 0,
      topUnsupportedSamples: [],
        };
    }

    const lines = opts.text.split(/\r?\n/).filter(l => l.length > 0).slice(0, 1 << 20);
    // Trim trailing empty lines that come from a final \n. They
    // are not real filter lines.
    while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const cls = classifyFilter(line);
        counts[cls.lane]++;
        total++;
        if (UNSUPPORTED_LANES.has(cls.lane) || INVALID_LANES.has(cls.lane)) {
      unsupported.push({ line: i + 1, raw: cls.raw, reason: cls.reason });
        }
    }

    const supported =
    counts['safe-dnr-block'] +
    counts['safe-dnr-allow'];

    let limited = 0;
    for (const lane of LIMITED_LANES) limited += counts[lane];

    let unsupportedCount = 0;
    for (const lane of UNSUPPORTED_LANES) unsupportedCount += counts[lane];

    let invalid = 0;
    for (const lane of INVALID_LANES) invalid += counts[lane];

    const percentages = {} as Record<FilterLane, number>;
    for (const lane of ALL_LANES) percentages[lane] = pct(counts[lane], total);

    const topN = Math.max(0, opts.topUnsupportedN ?? 10);
    return {
    total,
    counts,
    percentages,
    supported,
    limited,
    unsupported: unsupportedCount,
    invalid,
    topUnsupportedSamples: unsupported.slice(0, topN),
    };
}

export function formatCoverageReport(report: CoverageReport): string {
    const lines: string[] = [];
  lines.push(`total: ${report.total}`);
  lines.push(`  supported:  ${report.supported}`);
  lines.push(`  limited:    ${report.limited}`);
  lines.push(`  unsupported:${report.unsupported}`);
  lines.push(`  invalid:    ${report.invalid}`);
  for (const lane of ALL_LANES) {
    lines.push(`  ${lane.padEnd(22)} ${report.counts[lane]} (${report.percentages[lane]}%)`);
  }
  if (report.topUnsupportedSamples.length > 0) {
    lines.push(`unsupported samples:`);
    for (const s of report.topUnsupportedSamples) {
        const trimmed = s.raw.length > 80 ? `${s.raw.slice(0, 77)  }...` : s.raw;
      lines.push(`  L${s.line}: ${trimmed}  (${s.reason})`);
    }
  }
  return lines.join('\n');
}
