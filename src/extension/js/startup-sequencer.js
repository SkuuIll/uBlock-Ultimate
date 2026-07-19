/**
 * platform/chromium/js/startup-sequencer.js
 *
 * Service-worker startup sequencer.
 *
 * Coordinates startup-phase execution so capabilities run in dependency
 * order and no capability executes twice. Each capability declares its
 * phase, dependencies, optional verify/rollback hooks, and whether it
 * should run once or every cold start.
 *
 * Usage:
 *   import { StartupSequencer } from "./startup-sequencer.js";
 *   StartupSequencer.define("policy-profiles", { phase: "policy", run: ... });
 *   await StartupSequencer.boot();
 */

const PHASES = Object.freeze([
    "critical",
    "policy",
    "network",
    "ui",
    "instrumentation",
]);

const _capabilities = new Map();
let _booted = false;
let _phaseIndex = 0;
const _ran = new Set();
const _errors = [];

function _phaseRank(p) {
    const i = PHASES.indexOf(p);
    return i !== -1 ? i : PHASES.length;
}

export const StartupSequencer = Object.freeze({
    /**
     * Register a startup capability.
     * @param {string} id
     * @param {{
     *   phase: "critical"|"policy"|"network"|"ui"|"instrumentation",
     *   once?: boolean,
     *   dependsOn?: string[],
     *   run: () => Promise<void>,
     *   verify?: () => Promise<boolean>,
     *   rollback?: (reason: string) => Promise<void>,
     * }} spec
     */
    define(id, spec) {
        if (_booted) throw new Error(`Startup already booted: cannot define ${id}`);
        if (_capabilities.has(id)) throw new Error(`Duplicate capability: ${id}`);
        const { phase, once = true, dependsOn = [], run, verify, rollback } = spec;
        _capabilities.set(id, { id, phase, once, dependsOn, run, verify, rollback, ran: false });
    },

    /**
     * Run all registered capabilities in phase order, respecting dependency
     * ordering within each phase. Returns { ok, errors } summary.
     */
    async boot() {
        if (_booted) return { ok: true, errors: [] };
        _booted = true;

        const all = [..._capabilities.values()].sort((a, b) => {
            const d = _phaseRank(a.phase) - _phaseRank(b.phase);
            if (d !== 0) return d;
            if (b.dependsOn.includes(a.id)) return -1;
            if (a.dependsOn.includes(b.id)) return 1;
            return 0;
        });

        for (const cap of all) {
            if (cap.once && _ran.has(cap.id)) continue;

            const missing = cap.dependsOn.filter(d => !_ran.has(d));
            if (missing.length > 0) {
                _errors.push({ id: cap.id, reason: `missing-dependencies: ${missing.join(",")}` });
                continue;
            }

            try {
                await cap.run();
                _ran.add(cap.id);

                if (cap.verify) {
                    const ok = await cap.verify();
                    if (!ok) {
                        if (cap.rollback) await cap.rollback("verify-failed");
                        _errors.push({ id: cap.id, reason: "verify-failed" });
                    }
                }
            } catch (err) {
                if (cap.rollback) {
                    try { await cap.rollback(err.message || String(err)); } catch (_) { }
                }
                _errors.push({ id: cap.id, reason: err.message || String(err) });
            }
        }

        return { ok: _errors.length === 0, errors: _errors };
    },

    /** True if all capabilities in the given phase have run. */
    isPhaseReady(phase) {
        const rank = _phaseRank(phase);
        for (const cap of _capabilities.values()) {
            if (_phaseRank(cap.phase) <= rank && !_ran.has(cap.id)) return false;
        }
        return true;
    },

    get ran() { return new Set(_ran); },
    get errors() { return [..._errors]; },
    get booted() { return _booted; },
});
