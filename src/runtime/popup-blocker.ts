/**
 * Popup blocker.
 *
 * Tracks user actions on popups (block / allow / dismiss) and provides
 * a small policy for blocking future popups from the same origin. The
 * storage layer is injected via the `Storage` interface so this module
 * remains pure (no chrome.storage dependency in tests).
 *
 * State model:
 *   - actions[]: in-memory + persisted, FIFO up to maxActions
 *   - For each hostname, the latest action wins (block > dismiss > allow)
 *   - A "block" action for a hostname means: future requests to that
 *     hostname that look like popups are blocked automatically
 *
 * The rule generation is conservative: we generate a DNR-compatible
 * `||hostname^` network filter, which can be merged into the user's
 * custom filter list. We do NOT generate `$popup` syntax (uBO-only).
 *
 * Privacy:
 *   - Only hostname is stored, never the full URL.
 *   - The action log is bounded (default 1000 entries).
 *   - No telemetry is sent off-device.
 */

export type PopupActionType = 'block' | 'allow' | 'dismiss';

export interface PopupAction {
    timestamp: number;
    url: string;        // original URL (for rule generation, not stored on disk)
    hostname: string;   // for grouping
    action: PopupActionType;
    rule?: string;      // generated DNR filter, if action === 'block'
}

export interface PopupStorage {
    actions: PopupAction[];
    updatedAt: number;
}

export interface PopupBlockerConfig {
    maxActions: number;        // default 1000
    storageKey: string;        // default 'popup_actions'
    maxRuleLength: number;     // default 512
    maxHostnameLength: number; // default 253
}

export const DEFAULT_POPUP_CONFIG: Readonly<PopupBlockerConfig> = Object.freeze({
    maxActions: 1000,
    storageKey: 'popup_actions',
    maxRuleLength: 512,
    maxHostnameLength: 253,
});

/**
 * Minimal storage adapter. The default in-memory implementation is used
 * in tests; the production SW supplies a chrome.storage.local-backed
 * adapter.
 */
export interface PopupStorageAdapter {
    read(): Promise<PopupStorage | null>;
    write(_state: PopupStorage): Promise<void>;
}

export class InMemoryPopupStorage implements PopupStorageAdapter {
    private state: PopupStorage | null = null;
    async read(): Promise<PopupStorage | null> {
        return this.state;
    }
    async write(state: PopupStorage): Promise<void> {
        this.state = state;
    }

    setForTest(state: PopupStorage | null): void {
        this.state = state;
    }
}

export class PopupBlocker {
    private readonly config: PopupBlockerConfig;
    private readonly storage: PopupStorageAdapter;
    private actions: PopupAction[] = [];
    private loaded = false;
    private loadPromise: Promise<void> | null = null;

    constructor(opts: { config?: Partial<PopupBlockerConfig>; storage?: PopupStorageAdapter } = {}) {
        this.config = { ...DEFAULT_POPUP_CONFIG, ...(opts.config ?? {}) };
        this.storage = opts.storage ?? new InMemoryPopupStorage();
    }

    getConfig(): Readonly<PopupBlockerConfig> {
        return { ...this.config };
    }

    /**
     * Load persisted state. Idempotent.
     */
    async load(): Promise<void> {
        if (this.loaded) return;
        if (this.loadPromise) return this.loadPromise;
        this.loadPromise = this._doLoad();
        await this.loadPromise;
    }

    private async _doLoad(): Promise<void> {
        if (this.loaded) return;
        const state = await this.storage.read();
        if (state && Array.isArray(state.actions)) {
            this.actions = state.actions.slice(0, this.config.maxActions);
        }
        this.loaded = true;
        this.loadPromise = null;
    }

    /**
     * Record a user action. Persists asynchronously.
     */
    async recordAction(action: PopupAction): Promise<void> {
        await this.load();
        if (typeof action.hostname !== 'string' || action.hostname.length === 0) return;
        if (action.hostname.length > this.config.maxHostnameLength) return;
        if (typeof action.timestamp !== 'number' || !Number.isFinite(action.timestamp)) return;
        if (!['block', 'allow', 'dismiss'].includes(action.action)) return;

        let rule = action.rule;
        if (action.action === 'block') {
            if (!rule) {
                rule = generateBlockRule(action.hostname);
            }
            if (rule.length > this.config.maxRuleLength) {
                rule = rule.slice(0, this.config.maxRuleLength);
            }
            action = { ...action, rule };
        }

        this.actions.push(action);
        if (this.actions.length > this.config.maxActions) {
            this.actions = this.actions.slice(this.actions.length - this.config.maxActions);
        }
        await this.persist();
    }

    /**
     * Latest action for the given hostname, or null.
     */
    async getLatestAction(hostname: string): Promise<PopupAction | null> {
        await this.load();
        for (let i = this.actions.length - 1; i >= 0; i--) {
            if (this.actions[i].hostname === hostname) return this.actions[i];
        }
        return null;
    }

    /**
     * Snapshot of all actions, in chronological order.
     */
    async getActions(): Promise<PopupAction[]> {
        await this.load();
        return [...this.actions];
    }

    /**
     * Number of stored actions.
     */
    async size(): Promise<number> {
        await this.load();
        return this.actions.length;
    }

    /**
     * Clear all stored actions.
     */
    async clear(): Promise<void> {
        this.actions = [];
        this.loaded = false;
        this.loadPromise = null;
        await this.persist();
    }

    /**
     * Whether the given hostname has an active "block" decision.
     */
    async isBlocked(hostname: string): Promise<boolean> {
        const a = await this.getLatestAction(hostname);
        return a?.action === 'block';
    }

    /**
     * Get the generated rule for a hostname (if blocked).
     */
    async getBlockRule(hostname: string): Promise<string | null> {
        const a = await this.getLatestAction(hostname);
        if (a?.action !== 'block') return null;
        return a.rule ?? generateBlockRule(hostname);
    }

    /**
     * Aggregate counts by action type.
     */
    async counts(): Promise<{ block: number; allow: number; dismiss: number }> {
        await this.load();
        const out = { block: 0, allow: 0, dismiss: 0 };
        for (const a of this.actions) {
            if (a.action in out) {
                out[a.action as keyof typeof out]++;
            }
        }
        return out;
    }

    private async persist(): Promise<void> {
        const state: PopupStorage = {
            actions: this.actions.slice(),
            updatedAt: Date.now(),
        };
        await this.storage.write(state);
    }
}

/**
 * Generate a DNR-compatible network filter for blocking a hostname.
 * The result is `||hostname^` which blocks all requests to that host
 * at the network level. Hostname is lowercased and trimmed.
 */
export function generateBlockRule(hostname: string): string {
    const h = hostname.trim().toLowerCase();
    if (h.length === 0) return '';
    return `||${h}^`;
}

/**
 * Validate a hostname. Returns true if it is a syntactically valid
 * DNS hostname or IP address.
 */
export function isValidHostname(host: string): boolean {
    if (typeof host !== 'string' || host.length === 0) return false;
    if (host.length > 253) return false;
    if (/^[0-9a-fA-F]*:[0-9a-fA-F:]*$/.test(host)) return true;
    const labels = host.split('.');
    for (const label of labels) {
        if (label.length === 0 || label.length > 63) return false;
        if (!/^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?$/.test(label)) return false;
    }
    return true;
}
