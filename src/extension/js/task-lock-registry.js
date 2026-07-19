/**
 * platform/chromium/js/task-lock-registry.js
 *
 * Shared task-lock and retry primitive (P0.16).
 * Replaces ad-hoc boolean guards (contextMenuInstalled, syncInProgress, etc.)
 * with a registry-based lock that tracks state, supports retry, and prevents
 * concurrent duplicate execution.
 *
 * Usage:
 *   import { runOnce, runExclusive, resetTask, getTaskState } from "./task-lock-registry.js";
 *
 *   await runOnce("context-menu-install", () => chrome.contextMenus.create(...), { retry: 2 });
 *   await runExclusive("filter-list-sync", async () => { ... });
 *   const state = getTaskState("context-menu-install");
 *   resetTask("context-menu-install", "user-disabled");
 */

// ---------------------------------------------------------------------------
// Task states
// ---------------------------------------------------------------------------
const TASK_STATE = Object.freeze({
    IDLE: "idle",
    RUNNING: "running",
    SUCCEEDED: "succeeded",
    FAILED: "failed",
});

const _locks = new Map();

/**
 * @typedef {Object} TaskLock
 * @property {string} id
 * @property {string} owner (set via options.owner)
 * @property {"idle"|"running"|"succeeded"|"failed"} state
 * @property {number} [startedAt]
 * @property {number} [completedAt]
 * @property {string} [lastError]
 * @property {number} retryAfterMs
 * @property {number} _retryCount
 */

function _ensure(id) {
    if (!_locks.has(id)) {
        _locks.set(id, {
            id,
            owner: "",
            state: TASK_STATE.IDLE,
            retryAfterMs: 1000,
            _retryCount: 0,
        });
    }
    return _locks.get(id);
}

// ---------------------------------------------------------------------------
// Run once (idempotent — skips if already succeeded)
// ---------------------------------------------------------------------------
export async function runOnce(taskId, fn, options = {}) {
    const { retry = 0, retryDelayMs = 1000, owner = "" } = options;
    const lock = _ensure(taskId);
    if (lock.state === TASK_STATE.SUCCEEDED) return { ok: true, cached: true };
    if (lock.state === TASK_STATE.RUNNING) {
        // Wait for the in-flight execution
        await new Promise(resolve => {
            const check = () => {
                const cur = _locks.get(taskId);
                if (!cur || cur.state !== TASK_STATE.RUNNING) resolve();
                else setTimeout(check, 50);
            };
            check();
        });
        const cur = _locks.get(taskId);
        return { ok: cur?.state === TASK_STATE.SUCCEEDED, cached: true };
    }

    lock.owner = owner;
    lock.state = TASK_STATE.RUNNING;
    lock.startedAt = Date.now();
    lock.lastError = undefined;

    let lastErr;
    for (let attempt = 0; attempt <= retry + 1; attempt++) {
        try {
            await fn();
            lock.state = TASK_STATE.SUCCEEDED;
            lock.completedAt = Date.now();
            lock._retryCount = attempt;
            return { ok: true };
        } catch (err) {
            lastErr = String(err);
            if (attempt < retry) {
                await new Promise(r => setTimeout(r, retryDelayMs * (attempt + 1)));
            }
        }
    }

    lock.state = TASK_STATE.FAILED;
    lock.lastError = lastErr;
    lock.completedAt = Date.now();
    return { ok: false, error: lastErr };
}

// ---------------------------------------------------------------------------
// Run exclusive (prevents concurrent execution, allows re-run after completion)
// ---------------------------------------------------------------------------
export async function runExclusive(taskId, fn, options = {}) {
    const { owner = "" } = options;
    const lock = _ensure(taskId);
    if (lock.state === TASK_STATE.RUNNING) {
        return { ok: false, error: "already-running" };
    }

    lock.owner = owner;
    lock.state = TASK_STATE.RUNNING;
    lock.startedAt = Date.now();
    lock.lastError = undefined;

    try {
        await fn();
        lock.state = TASK_STATE.SUCCEEDED;
        lock.completedAt = Date.now();
        return { ok: true };
    } catch (err) {
        lock.state = TASK_STATE.FAILED;
        lock.lastError = String(err);
        lock.completedAt = Date.now();
        return { ok: false, error: String(err) };
    }
}

// ---------------------------------------------------------------------------
// Reset (allow re-run after failure, or explicit disable)
// ---------------------------------------------------------------------------
export function resetTask(taskId, reason) {
    const lock = _locks.get(taskId);
    if (!lock) return;
    lock.state = TASK_STATE.IDLE;
    lock.lastError = reason || "reset";
    lock.completedAt = Date.now();
}

export function getTaskState(taskId) {
    const lock = _locks.get(taskId);
    if (!lock) return { state: TASK_STATE.IDLE };
    return {
        id: lock.id,
        state: lock.state,
        owner: lock.owner,
        startedAt: lock.startedAt,
        completedAt: lock.completedAt,
        lastError: lock.lastError,
    };
}

export function resetAllTasks(reason) {
    for (const [id] of _locks) {
        resetTask(id, reason);
    }
}
