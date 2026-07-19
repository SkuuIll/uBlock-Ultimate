export type LoggerFilterSource =
    | 'static'
    | 'dynamicHost'
    | 'dynamicUrl'
    | 'switch'
    | 'redirect';

export type LoggerFilter = {
    source: LoggerFilterSource;
    raw: string;
    result: 0 | 1 | 2 | 3;
    regex?: string;
    rule?: string[];
    modifier?: boolean;
};

export type LoggerEntry = {
    tstamp: number;
    realm: 'network' | 'extended' | 'message';
    tabId: number;
    frameId?: number;
    documentId?: string;
    method?: string;
    type?: string;
    url?: string;
    tabHostname?: string;
    tabDomain?: string;
    docHostname?: string;
    docDomain?: string;
    domain?: string;
    hostname?: string;
    filter?: LoggerFilter;
    aliasURL?: string;
    text?: string;
    keywords?: string[];
};

type RequestLike = {
    requestId?: string | number;
    tabId?: number;
    frameId?: number;
    parentFrameId?: number;
    documentId?: string;
    method?: string;
    type?: string;
    url?: string;
    documentUrl?: string;
    initiator?: string;
    timeStamp?: number;
    error?: string;
};

type MatchedRuleInfoLike = {
    request?: RequestLike;
    rule?: {
        ruleId?: number;
        rulesetId?: string;
        action?: {
            type?: string;
        };
    };
};

export type LoggerRuleSource = {
    rawFilter?: string;
    assetKey?: string;
    title?: string;
    supportURL?: string;
    sourceList?: string;
    sourceLine?: number;
    rulesetId?: string;
    ruleId?: number;
    source?: LoggerFilterSource;
    regex?: string;
    rule?: string[];
    modifier?: boolean;
};

export type LoggerDecision = {
    action:
        | 'block'
        | 'allow'
        | 'allowAllRequests'
        | 'redirect'
        | 'upgradeScheme'
        | 'modifyHeaders'
        | 'unknown';
    rulesetId: string;
    ruleId: number;
    rawFilter: string;
    sourceList: string;
    sourceLine?: number;
    assetKey: string;
    title: string;
    supportURL: string;
    source: LoggerFilterSource;
    regex?: string;
    rule?: string[];
    modifier?: boolean;
};

export type PendingLoggerRequest = {
    requestId: string;
    tabId: number;
    frameId: number;
    parentFrameId: number;
    documentId?: string;
    startedAt: number;
    method: string;
    type: string;
    url: string;
    tabURL: string;
    tabHostname: string;
    tabDomain: string;
    docURL: string;
    docHostname: string;
    docDomain: string;
    requestHostname: string;
    requestDomain: string;
    terminal?: 'allowed' | 'blocked' | 'failed';
    error?: string;
    decision?: LoggerDecision;
};

export type FrameContext = {
    url: string;
    hostname: string;
    domain: string;
    documentId?: string;
    parentFrameId: number;
    committedAt: number;
};

type StorageAreaLike = {
    get(keys: string | string[]): Promise<Record<string, unknown>>;
    set(items: Record<string, unknown>): Promise<void>;
    remove?(keys: string | string[]): Promise<void>;
};

export type LoggerRuntimeDeps = {
    now?: () => number;
    hostnameFromURL?: (url: string) => string;
    domainFromHostname?: (hostname: string) => string;
    lookupRule?: (
        rulesetId: string,
        ruleId: number,
    ) => LoggerRuleSource | null | undefined;
    storage?: StorageAreaLike;
    storageKey?: string;
    loggerObsoleteAfterMs?: number;
    finalizationGraceMs?: number;
    pendingTimeoutMs?: number;
    recentlyFinalizedMs?: number;
    maxRows?: number;
    maxPending?: number;
};

type RecentFinalized = {
    finalizedAt: number;
    entry: LoggerEntry;
    bufferIndex: number;
    terminal: PendingLoggerRequest['terminal'];
};

type SerializedFrameContexts = Array<[
    number,
    Array<[number, FrameContext]>,
]>;

const DEFAULT_STORAGE_KEY = 'ubrLoggerRuntimeState';
const DEFAULT_LOGGER_OBSOLETE_AFTER_MS = 30_000;
const DEFAULT_FINALIZATION_GRACE_MS = 75;
const DEFAULT_PENDING_TIMEOUT_MS = 60_000;
const DEFAULT_RECENTLY_FINALIZED_MS = 10_000;
const DEFAULT_MAX_ROWS = 5_000;
const DEFAULT_MAX_PENDING = 2_000;

const reBlockedError =
    /(?:ERR_BLOCKED_BY_CLIENT|NS_ERROR_BLOCKED|BLOCKED_BY_CLIENT|blocked by client)/i;

const normalizeHostname = (hostname: string): string =>
    String(hostname || '').trim().toLowerCase().replace(/\.$/, '');

const defaultHostnameFromURL = (url: string): string => {
    try {
        return normalizeHostname(new URL(String(url || '')).hostname);
    } catch (_) {
        return '';
    }
};

const defaultDomainFromHostname = (hostname: string): string => {
    const hn = normalizeHostname(hostname);
    if (hn === '' || hn === 'localhost') return hn;
    if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(hn)) return hn;
    if (/^\[[0-9a-f:]+\]$/i.test(hn)) return hn;
    const parts = hn.split('.').filter(Boolean);
    return parts.length <= 2 ? hn : parts.slice(-2).join('.');
};

const numericTabId = (tabId: unknown): number =>
    Number.isInteger(tabId) ? Number(tabId) : -1;

const numericFrameId = (frameId: unknown): number =>
    Number.isInteger(frameId) ? Number(frameId) : 0;

const requestKeyFromDetails = (details: RequestLike | undefined): string => {
    const requestId = details?.requestId;
    if (requestId === undefined || requestId === null) return '';
    return String(requestId);
};

const safeURLHostname = (
    hostnameFromURL: (url: string) => string,
    url: string,
): string => normalizeHostname(hostnameFromURL(url));

export class LoggerRuntime {
    private readonly now: () => number;
    private readonly hostnameFromURL: (url: string) => string;
    private readonly domainFromHostname: (hostname: string) => string;
    private readonly lookupRule?: LoggerRuntimeDeps['lookupRule'];
    private readonly storage?: StorageAreaLike;
    private readonly storageKey: string;
    private readonly loggerObsoleteAfterMs: number;
    private readonly finalizationGraceMs: number;
    private readonly pendingTimeoutMs: number;
    private readonly recentlyFinalizedMs: number;
    private readonly maxRows: number;
    private readonly maxPending: number;

    private ownerId: number | undefined;
    private buffer: string[] | null = null;
    private pending = new Map<string, PendingLoggerRequest>();
    private recentlyFinalized = new Map<string, RecentFinalized>();
    private finalizeTimers = new Map<string, ReturnType<typeof setTimeout>>();
    private frameContexts = new Map<number, Map<number, FrameContext>>();
    private lastReadTime = 0;
    private janitorTimer: ReturnType<typeof setTimeout> | undefined;
    private persistTimer: ReturnType<typeof setTimeout> | undefined;
    private hydrated = false;
    private hydratePromise: Promise<void> | null = null;
    private lastSerialized = '';

    constructor(deps: LoggerRuntimeDeps = {}) {
        this.now = deps.now || (() => Date.now());
        this.hostnameFromURL = deps.hostnameFromURL || defaultHostnameFromURL;
        this.domainFromHostname =
            deps.domainFromHostname || defaultDomainFromHostname;
        this.lookupRule = deps.lookupRule;
        this.storage = deps.storage;
        this.storageKey = deps.storageKey || DEFAULT_STORAGE_KEY;
        this.loggerObsoleteAfterMs =
            deps.loggerObsoleteAfterMs || DEFAULT_LOGGER_OBSOLETE_AFTER_MS;
        this.finalizationGraceMs =
            deps.finalizationGraceMs || DEFAULT_FINALIZATION_GRACE_MS;
        this.pendingTimeoutMs =
            deps.pendingTimeoutMs || DEFAULT_PENDING_TIMEOUT_MS;
        this.recentlyFinalizedMs =
            deps.recentlyFinalizedMs || DEFAULT_RECENTLY_FINALIZED_MS;
        this.maxRows = deps.maxRows || DEFAULT_MAX_ROWS;
        this.maxPending = deps.maxPending || DEFAULT_MAX_PENDING;
    }

    get enabled(): boolean {
        this.expireOwnerIfNeeded();
        return this.buffer !== null && this.ownerId !== undefined;
    }

    async hydrate(): Promise<void> {
        if (this.hydrated) return;
        if (this.hydratePromise !== null) {
            await this.hydratePromise;
            return;
        }
        this.hydratePromise = this.hydrateFromSession();
        await this.hydratePromise;
    }

    claim(ownerId: number): void {
        this.expireOwnerIfNeeded();
        if (!Number.isFinite(ownerId)) return;
        if (this.ownerId !== undefined && this.ownerId !== ownerId) return;
        this.ownerId = ownerId;
        if (this.buffer === null) {
            this.buffer = [];
        }
        this.lastReadTime = this.now();
        this.startJanitor();
        this.schedulePersist();
    }

    private resetLoggerState(): void {
        this.ownerId = undefined;
        this.buffer = null;
        this.lastSerialized = '';
        this.clearFinalizeTimers();
        this.pending.clear();
        this.recentlyFinalized.clear();
        this.schedulePersist();
    }

    release(ownerId: number): void {
        if (this.ownerId !== ownerId) return;
        this.resetLoggerState();
    }

    forceRelease(): void {
        this.resetLoggerState();
    }

    read(ownerId: number): string[] | { unavailable: true } {
        this.claim(ownerId);
        if (this.ownerId !== ownerId || this.buffer === null) {
            return { unavailable: true };
        }
        const entries = this.buffer.slice(0, this.maxRows);
        this.buffer.length = 0;
        this.lastSerialized = '';
        this.lastReadTime = this.now();
        this.startJanitor();
        this.schedulePersist();
        return entries;
    }

    recordBeforeRequest(details: RequestLike): void {
        if (!this.enabled) return;
        if (this.isExtensionURL(details?.url)) return;
        this.cleanupExpiredState();

        const requestId = requestKeyFromDetails(details);
        if (requestId === '') return;

        const pending = this.createPendingRequest(details, requestId);
        this.clearFinalizeTimer(requestId);
        this.recentlyFinalized.delete(requestId);
        this.pending.set(requestId, pending);
        this.boundPending();
        this.schedulePersist();
    }

    recordCompleted(details: RequestLike): void {
        this.markTerminal(details, 'allowed');
    }

    recordError(details: RequestLike): void {
        const terminal = reBlockedError.test(String(details?.error || ''))
            ? 'blocked'
            : 'failed';
        this.markTerminal(details, terminal);
    }

    recordRuleMatch(info: MatchedRuleInfoLike): void {
        if (!this.enabled) return;

        const details = info?.request;
        const requestId = requestKeyFromDetails(details);
        const ruleId = info?.rule?.ruleId;
        if (requestId === '' || typeof ruleId !== 'number') return;

        const rulesetId = info?.rule?.rulesetId || '_dynamic';
        const action = this.normalizeAction(info?.rule?.action?.type);
        const source = this.lookupRule?.(rulesetId, ruleId) || null;
        const rawFilter =
            source?.rawFilter ||
            (action === 'unknown'
                ? '<matched declarative rule>'
                : `<${action} by declarative rule>`);

        const decision: LoggerDecision = {
            action,
            rulesetId,
            ruleId,
            rawFilter,
            sourceList: source?.sourceList || '',
            sourceLine: source?.sourceLine,
            assetKey: source?.assetKey || rulesetId,
            title: source?.title || rulesetId,
            supportURL: source?.supportURL || '',
            source:
                source?.source ||
                this.filterSourceForRule(rulesetId, action),
            regex: source?.regex,
            rule: source?.rule,
            modifier:
                source?.modifier === true ||
                action === 'redirect' ||
                action === 'upgradeScheme' ||
                action === 'modifyHeaders',
        };

        const pending = this.pending.get(requestId);
        if (pending !== undefined) {
            pending.decision = decision;
            if (pending.terminal !== undefined) {
                this.scheduleFinalize(requestId);
            } else if (
                decision.action === 'block' ||
                decision.action === 'allow' ||
                decision.action === 'allowAllRequests'
            ) {
                pending.terminal = decision.action === 'block' ? 'blocked' : 'allowed';
                this.scheduleFinalize(requestId);
            }
            this.schedulePersist();
            return;
        }

        const recent = this.recentlyFinalized.get(requestId);
        if (recent === undefined) return;
        const currentFilter = recent.entry.filter;
        if (
            this.now() - recent.finalizedAt > this.recentlyFinalizedMs ||
            (
                currentFilter !== undefined &&
                currentFilter.raw !== '<blocked by declarative rule>'
            )
        ) {
            // If the entry had no fallback filter (e.g. allowed request without
            // decision), we still want to update it once the async rule lookup
            // arrives — so only return when a non-fallback filter is already set.
            if (currentFilter !== undefined) return;
        }

        recent.entry.filter = this.filterFromDecision(
            decision,
            recent.entry.filter,
            recent.terminal,
        );
        this.replaceBufferedEntry(recent);
    }

    recordNavigation(details: RequestLike): void {
        const tabId = numericTabId(details?.tabId);
        if (tabId < 0) return;
        const frameId = numericFrameId(details?.frameId);
        const url = String(details?.url || '');
        const hostname = safeURLHostname(this.hostnameFromURL, url);
        const domain = this.domainFromHostname(hostname);
        let frames = this.frameContexts.get(tabId);
        if (frames === undefined || frameId === 0) {
            frames = new Map();
            this.frameContexts.set(tabId, frames);
        }
        frames.set(frameId, {
            url,
            hostname,
            domain,
            documentId: details?.documentId,
            parentFrameId: numericFrameId(details?.parentFrameId),
            committedAt: this.now(),
        });
        this.schedulePersist();
    }

    removeTab(tabId: number): void {
        if (!Number.isInteger(tabId)) return;
        this.frameContexts.delete(tabId);
        for (const [requestId, pending] of this.pending) {
            if (pending.tabId !== tabId) continue;
            this.clearFinalizeTimer(requestId);
            this.pending.delete(requestId);
        }
        for (const [requestId, recent] of this.recentlyFinalized) {
            if (recent.entry.tabId === tabId) {
                this.recentlyFinalized.delete(requestId);
            }
        }
        this.schedulePersist();
    }

    writeExtended(entry: LoggerEntry): void {
        this.writeEntry({ ...entry, realm: 'extended' });
    }

    writeMessage(entry: LoggerEntry): void {
        this.writeEntry({ ...entry, realm: 'message' });
    }

    private async hydrateFromSession(): Promise<void> {
        if (this.storage === undefined) {
            this.hydrated = true;
            return;
        }
        try {
            const stored = await this.storage.get(this.storageKey);
            const state = stored?.[this.storageKey] as Record<string, unknown>;
            if (state instanceof Object === false) {
                this.hydrated = true;
                return;
            }
            const ownerId = Number(state.ownerId);
            const lastReadTime = Number(state.lastReadTime) || 0;
            if (
                Number.isFinite(ownerId) &&
                this.now() - lastReadTime <= this.loggerObsoleteAfterMs
            ) {
                this.ownerId = ownerId;
                this.buffer = Array.isArray(state.buffer)
                    ? state.buffer
                        .filter(value => typeof value === 'string')
                        .slice(-this.maxRows)
                    : [];
                this.lastReadTime = lastReadTime;
                this.startJanitor();
            }
            if (Array.isArray(state.pending)) {
                for (const value of state.pending) {
                    const pending = value as PendingLoggerRequest;
                    if (
                        pending instanceof Object === false ||
                        typeof pending.requestId !== 'string'
                    ) {
                        continue;
                    }
                    this.pending.set(pending.requestId, pending);
                    if (pending.terminal !== undefined) {
                        this.scheduleFinalize(pending.requestId);
                    }
                }
                this.boundPending();
            }
            this.frameContexts =
                this.deserializeFrameContexts(state.frameContexts);
            this.hydrated = true;
        } catch (error) {
            console.warn('[uBR] Failed to hydrate logger runtime:', error);
            this.hydrated = true;
            this.hydratePromise = null;
        }
    }

    private createPendingRequest(
        details: RequestLike,
        requestId: string,
    ): PendingLoggerRequest {
        const tabId = numericTabId(details.tabId);
        const frameId = numericFrameId(details.frameId);
        const parentFrameId = numericFrameId(details.parentFrameId);
        const type = String(details.type || 'other');
        const url = String(details.url || '');
        const requestHostname = safeURLHostname(this.hostnameFromURL, url);
        const requestDomain = this.domainFromHostname(requestHostname);
        const rootFrame = this.frameContexts.get(tabId)?.get(0);
        const requestFrame = this.frameContexts.get(tabId)?.get(frameId);

        let tabURL = rootFrame?.url || '';
        if (type === 'main_frame') {
            tabURL = url;
        }
        if (tabURL === '') {
            tabURL = String(details.initiator || details.documentUrl || '');
        }

        let docURL = '';
        if (type === 'main_frame') {
            docURL = url;
        } else {
            docURL =
                String(details.documentUrl || '') ||
                requestFrame?.url ||
                String(details.initiator || '') ||
                tabURL;
        }

        let tabHostname = safeURLHostname(this.hostnameFromURL, tabURL);
        let docHostname = safeURLHostname(this.hostnameFromURL, docURL);
        if (tabHostname === '' && type === 'main_frame') {
            tabHostname = requestHostname;
        }
        if (docHostname === '' && requestFrame?.hostname) {
            docHostname = requestFrame.hostname;
        }
        if (docHostname === '' && tabHostname !== '') {
            docHostname = tabHostname;
        }

        return {
            requestId,
            tabId,
            frameId,
            parentFrameId,
            documentId: details.documentId || requestFrame?.documentId,
            startedAt: Number(details.timeStamp) || this.now(),
            method: String(details.method || ''),
            type,
            url,
            tabURL,
            tabHostname,
            tabDomain: this.domainFromHostname(tabHostname),
            docURL,
            docHostname,
            docDomain: this.domainFromHostname(docHostname),
            requestHostname,
            requestDomain,
        };
    }

    private markTerminal(
        details: RequestLike,
        terminal: PendingLoggerRequest['terminal'],
    ): void {
        if (!this.enabled) return;
        if (this.isExtensionURL(details?.url)) return;

        const requestId = requestKeyFromDetails(details);
        if (requestId === '') return;

        let pending = this.pending.get(requestId);
        if (pending === undefined) {
            pending = this.createPendingRequest(details, requestId);
            this.pending.set(requestId, pending);
        }
        if (pending.terminal !== undefined) return;

        pending.terminal = terminal;
        pending.error = details?.error;
        this.scheduleFinalize(requestId);
        this.schedulePersist();
    }

    private scheduleFinalize(requestId: string): void {
        this.clearFinalizeTimer(requestId);
        const timer = setTimeout(() => {
            this.finalize(requestId);
        }, this.finalizationGraceMs);
        this.finalizeTimers.set(requestId, timer);
    }

    private finalize(requestId: string): void {
        this.clearFinalizeTimer(requestId);
        const pending = this.pending.get(requestId);
        if (pending === undefined || pending.terminal === undefined) return;
        this.pending.delete(requestId);

        const entry = this.entryFromPending(pending);
        const bufferIndex = this.writeEntry(entry);
        this.recentlyFinalized.set(requestId, {
            finalizedAt: this.now(),
            entry,
            bufferIndex,
            terminal: pending.terminal,
        });
        this.cleanupExpiredState();
        this.schedulePersist();
    }

    private entryFromPending(pending: PendingLoggerRequest): LoggerEntry {
        const fallbackFilter =
            pending.terminal === 'blocked'
                ? {
                    source: 'static' as const,
                    raw: '<blocked by declarative rule>',
                    result: 1 as const,
                }
                : undefined;

        const filter = pending.decision !== undefined
            ? this.filterFromDecision(
                pending.decision,
                fallbackFilter,
                pending.terminal,
            )
            : fallbackFilter;

        return {
            tstamp: pending.startedAt / 1000,
            realm: 'network',
            tabId: pending.tabId,
            frameId: pending.frameId,
            documentId: pending.documentId,
            method: pending.method,
            type: pending.type,
            url: pending.url,
            tabHostname: pending.tabHostname,
            tabDomain: pending.tabDomain,
            docHostname: pending.docHostname,
            docDomain: pending.docDomain,
            hostname: pending.requestHostname,
            domain: pending.requestDomain,
            filter,
        };
    }

    private filterFromDecision(
        decision: LoggerDecision,
        fallback: LoggerFilter | undefined,
        terminal: PendingLoggerRequest['terminal'],
    ): LoggerFilter | undefined {
        if (decision.action === 'block') {
            return {
                source: decision.source,
                raw: decision.rawFilter,
                result: 1,
                regex: decision.regex,
                rule: decision.rule,
                modifier: decision.modifier === true,
            };
        }
        if (
            decision.action === 'allow' ||
            decision.action === 'allowAllRequests'
        ) {
            return {
                source: decision.source,
                raw: decision.rawFilter,
                result: 2,
                regex: decision.regex,
                rule: decision.rule,
                modifier: decision.modifier === true,
            };
        }
        if (decision.action === 'redirect') {
            return {
                source: 'redirect',
                raw: decision.rawFilter,
                result: 0,
                regex: decision.regex,
                rule: decision.rule,
                modifier: true,
            };
        }
        if (
            decision.action === 'modifyHeaders' ||
            decision.action === 'upgradeScheme'
        ) {
            return {
                source: decision.source,
                raw: decision.rawFilter,
                result: 0,
                regex: decision.regex,
                rule: decision.rule,
                modifier: true,
            };
        }
        if (terminal === 'blocked') return fallback;
        return undefined;
    }

    private writeEntry(entry: LoggerEntry): number {
        if (this.buffer === null) return -1;
        const completeEntry = {
            ...entry,
            tstamp: Number(entry.tstamp) || this.now() / 1000,
        };
        const serialized = JSON.stringify(completeEntry);
        if (serialized === this.lastSerialized) {
            return this.buffer.length - 1;
        }
        this.buffer.push(serialized);
        if (this.buffer.length > this.maxRows) {
            this.buffer.splice(0, this.buffer.length - this.maxRows);
        }
        this.lastSerialized = serialized;
        this.schedulePersist();
        return this.buffer.length - 1;
    }

    private replaceBufferedEntry(recent: RecentFinalized): void {
        if (
            this.buffer === null ||
            recent.bufferIndex < 0 ||
            recent.bufferIndex >= this.buffer.length
        ) {
            return;
        }
        this.buffer[recent.bufferIndex] = JSON.stringify(recent.entry);
        this.schedulePersist();
    }

    private normalizeAction(action: unknown): LoggerDecision['action'] {
        switch (action) {
        case 'block':
        case 'allow':
        case 'allowAllRequests':
        case 'redirect':
        case 'upgradeScheme':
        case 'modifyHeaders':
            return action;
        default:
            return 'unknown';
        }
    }

    private filterSourceForRule(
        rulesetId: string,
        action: LoggerDecision['action'],
    ): LoggerFilterSource {
        if (action === 'redirect') return 'redirect';
        if (rulesetId === '_session' || rulesetId === '_dynamic') {
            return 'dynamicHost';
        }
        return 'static';
    }

    private cleanupExpiredState(): void {
        const now = this.now();
        for (const [requestId, pending] of this.pending) {
            if (now - pending.startedAt <= this.pendingTimeoutMs) continue;
            this.clearFinalizeTimer(requestId);
            this.pending.delete(requestId);
        }
        for (const [requestId, recent] of this.recentlyFinalized) {
            if (now - recent.finalizedAt <= this.recentlyFinalizedMs) continue;
            this.recentlyFinalized.delete(requestId);
        }
    }

    private boundPending(): void {
        if (this.pending.size <= this.maxPending) return;
        const entries = Array.from(this.pending.entries())
            .sort((a, b) => a[1].startedAt - b[1].startedAt);
        const removeCount = this.pending.size - this.maxPending;
        for (const [requestId] of entries.slice(0, removeCount)) {
            this.clearFinalizeTimer(requestId);
            this.pending.delete(requestId);
        }
    }

    private clearFinalizeTimer(requestId: string): void {
        const timer = this.finalizeTimers.get(requestId);
        if (timer !== undefined) {
            clearTimeout(timer);
            this.finalizeTimers.delete(requestId);
        }
    }

    private clearFinalizeTimers(): void {
        for (const timer of this.finalizeTimers.values()) {
            clearTimeout(timer);
        }
        this.finalizeTimers.clear();
    }

    private expireOwnerIfNeeded(): void {
        if (
            this.ownerId === undefined ||
            this.lastReadTime === 0 ||
            this.now() - this.lastReadTime <= this.loggerObsoleteAfterMs
        ) {
            return;
        }
        this.ownerId = undefined;
        this.buffer = null;
        this.clearFinalizeTimers();
        this.pending.clear();
        this.recentlyFinalized.clear();
        this.schedulePersist();
    }

    private startJanitor(): void {
        if (this.janitorTimer !== undefined) {
            clearTimeout(this.janitorTimer);
        }
        this.janitorTimer = setTimeout(() => {
            this.expireOwnerIfNeeded();
            if (this.enabled) this.startJanitor();
        }, this.loggerObsoleteAfterMs);
    }

    private schedulePersist(): void {
        if (this.storage === undefined) return;
        if (this.persistTimer !== undefined) {
            clearTimeout(this.persistTimer);
        }
        this.persistTimer = setTimeout(() => {
            this.persistTimer = undefined;
            this.persist().catch(error => {
                console.warn('[uBR] Failed to persist logger runtime:', error);
            });
        }, 150);
    }

    private async persist(): Promise<void> {
        if (this.storage === undefined) return;
        if (this.buffer === null && this.ownerId === undefined) {
            await this.storage.remove?.(this.storageKey);
            return;
        }
        await this.storage.set({
            [this.storageKey]: {
                ownerId: this.ownerId,
                lastReadTime: this.lastReadTime,
                buffer: this.buffer || [],
                pending: Array.from(this.pending.values()),
                frameContexts: this.serializeFrameContexts(),
            },
        });
    }

    private serializeFrameContexts(): SerializedFrameContexts {
        return Array.from(this.frameContexts.entries()).map(([tabId, frames]) => [
            tabId,
            Array.from(frames.entries()),
        ]);
    }

    private deserializeFrameContexts(value: unknown): Map<number, Map<number, FrameContext>> {
        const out = new Map<number, Map<number, FrameContext>>();
        if (Array.isArray(value) === false) return out;
        for (const tabEntry of value as SerializedFrameContexts) {
            if (Array.isArray(tabEntry) === false) continue;
            const tabId = Number(tabEntry[0]);
            if (Number.isInteger(tabId) === false || Array.isArray(tabEntry[1]) === false) {
                continue;
            }
            const frames = new Map<number, FrameContext>();
            for (const frameEntry of tabEntry[1]) {
                if (Array.isArray(frameEntry) === false) continue;
                const frameId = Number(frameEntry[0]);
                const context = frameEntry[1] as FrameContext;
                if (
                    Number.isInteger(frameId) &&
                    context instanceof Object &&
                    typeof context.url === 'string'
                ) {
                    frames.set(frameId, context);
                }
            }
            out.set(tabId, frames);
        }
        return out;
    }

    private isExtensionURL(url: unknown): boolean {
        const value = String(url || '');
        return value.startsWith('chrome-extension://') ||
            value.startsWith('moz-extension://');
    }
}
