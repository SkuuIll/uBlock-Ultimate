/**
 * Public benchmark harness manifest.
 *
 * This module is the canonical public entry point for the benchmark
 * suite. The plan calls for "benchmark harness publicly available"
 * (§15.5); this module provides:
 *
 *   - `BENCHMARK_HARNESS_VERSION` — the harness schema version
 *   - `BENCHMARK_CORPORA` — list of available corpora (name, source,
 *     entry count, gate)
 *   - `BENCHMARK_COMMANDS` — the npm scripts anyone can run
 *   - `formatBenchmarkReport(corpus, summary)` — render a markdown
 *     table for a corpus result
 *
 * The harness is exposed as pure functions so it can be embedded in
 * BENCHMARK.md, the README, or any external documentation without
 * needing to import the full pipeline.
 */

export interface BenchmarkCorpus {
    name: string;
    description: string;
    source: string;
    entryCount: number;
    gateCommand: string;
    artifact: string;
}

export interface BenchmarkCommand {
    name: string;
    command: string;
    description: string;
}

export const BENCHMARK_HARNESS_VERSION = '1.0.0';

export const BENCHMARK_CORPORA: BenchmarkCorpus[] = [
    {
        name: 'cosmetic-corpus-9',
        description:
            'Local cosmetic corpus: 1 URL (fixture.example) with 10 cosmetic rules and 9 visibility assertions. Tests the runtime CosmeticSelectorStore against a hand-rolled DOM stub.',
        source: 'tests/corpus/cosmetic/',
        entryCount: 1,
        gateCommand: 'npm run check:cosmetic-corpus',
        artifact: 'dist/build/certificate/cosmetic-corpus.json',
    },
    {
        name: 'network-differential-50',
        description:
            'Network differential corpus: 50 unique hostnames with a deterministic mix of host-scoped and global cosmetic rules. Each entry has 2-5 expected hidden selectors and 2-3 expected visible selectors. The corpus is generated (not hand-written) for reproducibility; see tools/build-network-corpus-fixture.mjs.',
        source: 'tests/corpus/network/network-corpus.json',
        entryCount: 50,
        gateCommand: 'npm run check:network-corpus',
        artifact: 'dist/build/certificate/network-corpus.json',
    },
];

export const BENCHMARK_COMMANDS: BenchmarkCommand[] = [
    {
        name: 'all',
        command: 'npm run check:all',
        description: 'Run every gate in dependency order (manifest, no-remote-fetch, static, user-rules, attribution, cosmetic, cosmetic-corpus, network-corpus, store-compliance, certificate-aggregation).',
    },
    {
        name: 'cosmetic',
        command: 'npm run check:cosmetic-corpus',
        description: 'Run the local cosmetic corpus (1 URL, 9 assertions).',
    },
    {
        name: 'network',
        command: 'npm run check:network-corpus',
        description: 'Run the network differential corpus (50 URLs, ~267 assertions).',
    },
    {
        name: 'store',
        command: 'npm run check:store-compliance',
        description: 'Run the Chrome Web Store compliance report (13 checks).',
    },
    {
        name: 'certificate',
        command: 'npm run check:certificate-aggregation',
        description: 'Aggregate all gate outputs into a release certificate and compute the Gold/Silver/Bronze/None badge.',
    },
];

/**
 * Render a one-line corpus result suitable for inclusion in BENCHMARK.md.
 * Format: `  corpus: 9/9 pass (hash 5ba57d7197f7c444)`
 */
export function formatCorpusResultLine(
    corpusName: string,
    passed: number,
    total: number,
    hash: string,
): string {
    const tag = passed === total ? 'pass' : 'fail';
    return `  ${corpusName}: ${passed}/${total} ${tag} (hash ${hash})`;
}

/**
 * Render a markdown table of all corpora with their pass counts.
 * Returns the table as a string (with trailing newline).
 */
export function formatCorpusTable(
    rows: { name: string; passed: number; total: number; hash: string }[],
): string {
    if (rows.length === 0) return '';
    const lines: string[] = [];
    lines.push('| Corpus | Passed | Total | Hash |');
    lines.push('| --- | ---: | ---: | --- |');
    for (const r of rows) {
        const ok = r.passed === r.total ? 'OK' : 'FAIL';
        lines.push(`| ${r.name} | ${r.passed} | ${r.total} | \`${r.hash}\` (${ok}) |`);
    }
    return `${lines.join('\n')  }\n`;
}

/**
 * Return the full benchmark report as a markdown string.
 * Embeds the corpus table, the commands, and the harness version.
 */
export function renderBenchmarkReport(
    corpusResults: { name: string; passed: number; total: number; hash: string }[],
    badge: { level: string; label: string; description: string },
): string {
    const lines: string[] = [];
    lines.push(`# uBlock Ultimate — Benchmark Report`);
    lines.push('');
    lines.push(`Harness version: \`${BENCHMARK_HARNESS_VERSION}\``);
    lines.push('');
    lines.push(`## Badge: ${badge.label}`);
    lines.push('');
    lines.push(badge.description);
    lines.push('');
    lines.push('## Corpus results');
    lines.push('');
    lines.push(formatCorpusTable(corpusResults));
    lines.push('## Available commands');
    lines.push('');
    for (const c of BENCHMARK_COMMANDS) {
        lines.push(`- \`${c.command}\` — ${c.description}`);
    }
    lines.push('');
    return lines.join('\n');
}
