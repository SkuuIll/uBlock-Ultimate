/**
 * platform/chromium/js/scheduler-registry.js
 *
 * Timer, interval, idle-callback, and scheduler ownership registry.
 *
 * Every scheduled task in the extension should be registered here so
 * that lifecycle events (tab close, frame detach, policy invalidation,
 * extension update) can cancel stale work and prevent duplicate timers.
 *
 * Usage:
 *   import { schedulerRegistry } from "./scheduler-registry.js";
 *   const id = schedulerRegistry.setTimeout("badge-refresh", "popup", () => { ... }, 5000);
 *   schedulerRegistry.clearTimeout(id);
 *   schedulerRegistry.cancelByOwner("popup");
 */

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

let _taskIdCounter = 0;
const _tasks = new Map();  // taskId → ScheduledTask
const _timeoutIds = new Map();  // taskId → native timeout/interval ID
const _intervalIds = new Map();
const _nativeSetTimeout = typeof setTimeout !== "undefined" ? setTimeout : null;
const _nativeClearTimeout = typeof clearTimeout !== "undefined" ? clearTimeout : null;
const _nativeSetInterval = typeof setInterval !== "undefined" ? setInterval : null;
const _nativeClearInterval = typeof clearInterval !== "undefined" ? clearInterval : null;
const _nativeRequestIdleCallback = typeof requestIdleCallback !== "undefined" ? requestIdleCallback : null;

// ---------------------------------------------------------------------------
// ScheduledTask class
// ---------------------------------------------------------------------------

class ScheduledTask {
    constructor(owner, kind, fn, opts = {}) {
        this.id = ++_taskIdCounter;
        this.owner = owner;
        this.kind = kind;
        this.fn = fn;
        this.policyRevision = opts.policyRevision;
        this.documentKey = opts.documentKey;
        this.maxRuns = opts.maxRuns || Infinity;
        this.cancelOn = opts.cancelOn || [];
        this._runCount = 0;
        this._cancelled = false;
        this._createdAt = Date.now();
    }

    get isActive() {
        return !this._cancelled && this._runCount < this.maxRuns;
    }

    invoke() {
        if (this._cancelled) return;
        this._runCount++;
        try { this.fn(); } catch (e) { /* errors are handled by caller */ }
        if (this._runCount >= this.maxRuns) {
            this.cancel();
        }
    }

    cancel() {
        this._cancelled = true;
        const nativeId = _timeoutIds.get(this.id);
        if (nativeId !== undefined) {
            if (this.kind === "interval" && _nativeClearInterval) {
                _nativeClearInterval(nativeId);
            } else if (_nativeClearTimeout) {
                _nativeClearTimeout(nativeId);
            }
            _timeoutIds.delete(this.id);
            _intervalIds.delete(this.id);
        }
        _tasks.delete(this.id);
    }

    getSnapshot() {
        return {
            id: this.id,
            owner: this.owner,
            kind: this.kind,
            policyRevision: this.policyRevision,
            documentKey: this.documentKey,
            maxRuns: this.maxRuns,
            runCount: this._runCount,
            cancelled: this._cancelled,
            age: Date.now() - this._createdAt,
        };
    }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export const schedulerRegistry = {
    /**
     * Schedule a one-time timeout.
     *
     * @param {string} name - logical name for diagnostics
     * @param {string} owner - who owns this timer (e.g. "popup", "badge")
     * @param {Function} fn
     * @param {number} delayMs
     * @param {object} [opts]
     * @returns {number} task id (can be passed to clearTimeout)
     */
    setTimeout(name, owner, fn, delayMs, opts = {}) {
        const task = new ScheduledTask(owner, "timeout", fn, opts);
        _tasks.set(task.id, task);

        const nativeId = _nativeSetTimeout(() => {
            task.invoke();
            _timeoutIds.delete(task.id);
            _tasks.delete(task.id);
        }, delayMs);

        _timeoutIds.set(task.id, nativeId);
        return task.id;
    },

    /**
     * Schedule a repeating interval.
     *
     * @param {string} name - logical name
     * @param {string} owner
     * @param {Function} fn
     * @param {number} intervalMs
     * @param {object} [opts]
     * @param {number} [opts.maxRuns] - stop after this many runs
     * @returns {number} task id
     */
    setInterval(name, owner, fn, intervalMs, opts = {}) {
        const task = new ScheduledTask(owner, "interval", fn, opts);
        _tasks.set(task.id, task);

        const nativeId = _nativeSetInterval(() => {
            if (!task.isActive) {
                schedulerRegistry.clearInterval(task.id);
                return;
            }
            task.invoke();
        }, intervalMs);

        _intervalIds.set(task.id, nativeId);
        return task.id;
    },

    /**
     * Schedule an idle callback.
     */
    requestIdleCallback(name, owner, fn, opts = {}) {
        if (!_nativeRequestIdleCallback) {
            // Fallback: run as a short timeout
            return schedulerRegistry.setTimeout(name, owner, fn, 0, opts);
        }
        const task = new ScheduledTask(owner, "idle", fn, opts);
        _tasks.set(task.id, task);

        _nativeRequestIdleCallback(() => {
            task.invoke();
            _tasks.delete(task.id);
        });

        return task.id;
    },

    /**
     * Cancel a timeout by task id.
     */
    clearTimeout(taskId) {
        const task = _tasks.get(taskId);
        if (task) task.cancel();
    },

    /**
     * Cancel an interval by task id.
     */
    clearInterval(taskId) {
        const task = _tasks.get(taskId);
        if (task) task.cancel();
    },

    /**
     * Cancel all tasks owned by a specific owner.
     */
    cancelByOwner(owner) {
        for (const [id, task] of _tasks) {
            if (task.owner === owner) {
                task.cancel();
            }
        }
    },

    /**
     * Cancel all tasks that have a specific cancelOn trigger.
     */
    cancelByTrigger(trigger) {
        for (const [id, task] of _tasks) {
            if (task.cancelOn.includes(trigger)) {
                task.cancel();
            }
        }
    },

    /**
     * Cancel all tasks for a specific document key.
     */
    cancelByDocumentKey(documentKey) {
        for (const [id, task] of _tasks) {
            if (task.documentKey === documentKey) {
                task.cancel();
            }
        }
    },

    /**
     * Cancel all tasks.
     */
    cancelAll() {
        for (const [, task] of _tasks) {
            task.cancel();
        }
    },

    /**
     * Return diagnostic snapshot.
     */
    getSnapshot() {
        const tasks = [];
        for (const [, task] of _tasks) {
            tasks.push(task.getSnapshot());
        }
        return tasks;
    },
};
