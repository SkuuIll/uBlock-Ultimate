/**
 * Network differential corpus — pure validator.
 *
 * The network corpus is a 50-URL fixture that exercises the cosmetic
 * engine on a wider set of hostnames than the local 1-URL corpus
 * (Phase 2). For each entry, the harness:
 *   1. Loads the entry's rules into a `CosmeticSelectorStore`.
 *   2. Asks the harness's "is-hidden" function (a DOM stub) whether
 *      each expected selector is hidden.
 *   3. Compares against `expectedHidden` / `expectedVisible`.
 *
 * The "differential" terminology refers to the methodology: future
 * versions of this validator will compare our engine's selector choice
 * against a uBlock Origin reference (per-entry `referenceHidden`).
 * For V1, only self-consistency is checked.
 *
 * Per Rev15 §15.5 (Release 1.0):
 *   "Silver means all required gates pass but the corpus is
 *    network-only or has not yet been executed"
 *
 * The 50-URL corpus is a Silver-tier artifact. A passing network corpus
 * + Gold-tier local corpus = a fully benchmarked build.
 */

export interface NetworkCorpusEntry {
    hostname: string;
    rules: string[];
    expectedHidden: string[];
    expectedVisible: string[];
    /** Optional reference (uBlock Origin or similar) for differential check (V2). */
    referenceHidden?: string[];
    description?: string;
}

export interface NetworkCorpusFixture {
    version: 1;
    name: string;
    entries: NetworkCorpusEntry[];
}

export type EntryVerdict = 'pass' | 'fail' | 'incomplete';

export interface NetworkAssertion {
    selector: string;
    verdict: EntryVerdict;
    reason: string;
    observed: boolean;
    expected: boolean;
}

export interface NetworkCorpusResult {
    hostname: string;
    totalAssertions: number;
    passed: number;
    failed: number;
    ok: boolean;
    assertions: NetworkAssertion[];
}

export interface NetworkCorpusSummary {
    schemaVersion: 1;
    generatedAt: string;
    name: string;
    totalUrls: number;
    totalAssertions: number;
    passed: number;
    failed: number;
    hash: string;
    results: NetworkCorpusResult[];
    ok: boolean;
}

/**
 * Per-entry assertion result from the harness.
 * `observed` is the actual hiding decision; `expected` is the fixture's claim.
 */
export interface NetworkCorpusObservation {
    hostname: string;
    observations: { selector: string; observed: boolean }[];
}

/**
 * Validate a list of per-entry observations against the fixture's
 * expected hidden/visible selectors. Pure: no I/O, no DOM.
 */
export function validateNetworkCorpus(
    fixture: NetworkCorpusFixture,
    observations: NetworkCorpusObservation[],
): NetworkCorpusSummary {
    if (fixture.version !== 1) {
        throw new Error(`unsupported network corpus version: ${fixture.version}`);
    }
    const obsByHost = new Map<string, NetworkCorpusObservation>();
    for (const o of observations) {
        obsByHost.set(o.hostname, o);
    }

    const results: NetworkCorpusResult[] = [];
    let totalAssertions = 0;
    let totalPassed = 0;
    let totalFailed = 0;

    for (const entry of fixture.entries) {
        const obs = obsByHost.get(entry.hostname);
        const assertions: NetworkAssertion[] = [];
        let passed = 0;
        let failed = 0;

        if (!obs) {
            // No observation = incomplete
            assertions.push({
                selector: '*',
                verdict: 'incomplete',
                reason: 'no observation recorded for this hostname',
                observed: false,
                expected: false,
            });
            failed++;
        } else {
            const obsMap = new Map(obs.observations.map(o => [o.selector, o.observed]));

            for (const sel of entry.expectedHidden) {
                const observed = obsMap.get(sel);
                if (observed === undefined) {
                    assertions.push({
                        selector: sel,
                        verdict: 'incomplete',
                        reason: 'selector not observed by harness',
                        observed: false,
                        expected: true,
                    });
                    failed++;
                } else if (observed === true) {
                    assertions.push({
                        selector: sel,
                        verdict: 'pass',
                        reason: 'hidden as expected',
                        observed: true,
                        expected: true,
                    });
                    passed++;
                } else {
                    assertions.push({
                        selector: sel,
                        verdict: 'fail',
                        reason: 'expected to be hidden but was visible',
                        observed: false,
                        expected: true,
                    });
                    failed++;
                }
            }

            for (const sel of entry.expectedVisible) {
                const observed = obsMap.get(sel);
                if (observed === undefined) {
                    assertions.push({
                        selector: sel,
                        verdict: 'incomplete',
                        reason: 'selector not observed by harness',
                        observed: false,
                        expected: false,
                    });
                    failed++;
                } else if (observed === false) {
                    assertions.push({
                        selector: sel,
                        verdict: 'pass',
                        reason: 'visible as expected',
                        observed: false,
                        expected: false,
                    });
                    passed++;
                } else {
                    assertions.push({
                        selector: sel,
                        verdict: 'fail',
                        reason: 'expected to be visible but was hidden',
                        observed: true,
                        expected: false,
                    });
                    failed++;
                }
            }
        }

        results.push({
            hostname: entry.hostname,
            totalAssertions: assertions.length,
            passed,
            failed,
            ok: failed === 0,
            assertions,
        });

        totalAssertions += assertions.length;
        totalPassed += passed;
        totalFailed += failed;
    }

    const hash = computeNetworkCorpusHash(results);
    const generatedAt = new Date().toISOString();

    return {
        schemaVersion: 1,
        generatedAt,
        name: fixture.name,
        totalUrls: fixture.entries.length,
        totalAssertions,
        passed: totalPassed,
        failed: totalFailed,
        hash,
        results,
        ok: totalFailed === 0,
    };
}

function computeNetworkCorpusHash(results: NetworkCorpusResult[]): string {
    let h1 = 0xdeadbeef;
    let h2 = 0x41c6ce57;
    const text = results
        .map(r => `${r.hostname}:${r.passed}/${r.totalAssertions}`)
        .sort()
        .join('|');
    for (let i = 0; i < text.length; i++) {
        const ch = text.charCodeAt(i);
        h1 = Math.imul(h1 ^ ch, 2654435761);
        h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
    return (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0');
}

/**
 * Convenience: build a fixture from a list of entries, validating the shape.
 */
export function makeNetworkCorpusFixture(
    name: string,
    entries: NetworkCorpusEntry[],
): NetworkCorpusFixture {
    for (const e of entries) {
        if (!e.hostname || typeof e.hostname !== 'string') {
            throw new Error('every entry needs a hostname string');
        }
        if (!Array.isArray(e.rules) || !Array.isArray(e.expectedHidden) || !Array.isArray(e.expectedVisible)) {
            throw new Error(`entry ${e.hostname}: rules/expectedHidden/expectedVisible must be arrays`);
        }
    }
    return { version: 1, name, entries };
}
