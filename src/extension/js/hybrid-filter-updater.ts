export type RemoteListMode = 'packaged' | 'dynamic';
export type UpdateStatus = 'idle' | 'checking' | 'current' | 'updated' | 'failed';

export interface RemoteListDescriptor {
    id: string;
    title: string;
    urls: readonly string[];
    allowedHosts: readonly string[];
    license: string;
    supportUrl: string;
    maxBytes: number;
    mode: RemoteListMode;
}

export interface FilterUpdateState {
    schemaVersion: 2;
    listId: string;
    lastAttemptAt: number;
    lastSuccessAt?: number;
    contentHash?: string;
    etag?: string;
    lastModified?: string;
    status: UpdateStatus;
    error?: string;
    ruleCount: number;
}

interface DnrRule {
    id: number;
    priority: number;
    action: { type: 'block' | 'allow' };
    condition: { urlFilter: string };
}

interface UpdaterApi {
    storage: {
        local: {
            get(keys?: string | string[]): Promise<Record<string, unknown>>;
            set(values: Record<string, unknown>): Promise<void>;
        };
    };
    declarativeNetRequest: {
        MAX_NUMBER_OF_DYNAMIC_RULES?: number;
        getDynamicRules(): Promise<DnrRule[]>;
        updateDynamicRules(change: {
            removeRuleIds?: number[];
            addRules?: DnrRule[];
        }): Promise<void>;
    };
}

interface UpdateDependencies {
    api: UpdaterApi;
    fetchImpl: typeof fetch;
    now: () => number;
}

const STATE_KEY = 'filterUpdateStateV2';
const RULE_ID_MIN = 28_000_000;
const RULE_ID_MAX = 28_004_999;
const REQUEST_TIMEOUT_MS = 15_000;

export const QUICK_FIXES_LIST: RemoteListDescriptor = {
    id: 'ublock-quick-fixes',
    title: 'uBlock filters – Quick fixes',
    urls: [
        'https://ublockorigin.github.io/uAssets/filters/quick-fixes.txt',
        'https://ublockorigin.pages.dev/filters/quick-fixes.txt',
    ],
    allowedHosts: [
        'ublockorigin.github.io',
        'ublockorigin.pages.dev',
    ],
    license: 'GPL-3.0',
    supportUrl: 'https://github.com/uBlockOrigin/uAssets',
    maxBytes: 10 * 1024 * 1024,
    mode: 'dynamic',
};

function isIgnoredFilter(line: string): boolean {
    return line === '' ||
        line.startsWith('!') ||
        line.startsWith('[') ||
        line.includes('##') ||
        line.includes('#@#') ||
        line.includes('#?#') ||
        line.includes('##+js');
}

export function compileSupplementalList(text: string): DnrRule[] {
    const rules: DnrRule[] = [];
    const seen = new Set<string>();

    for (const rawLine of text.replaceAll('\r', '').split('\n')) {
        const line = rawLine.trim();
        if (isIgnoredFilter(line)) continue;

        const allow = line.startsWith('@@');
        const filter = allow ? line.slice(2) : line;
        const match = /^\|\|([a-z0-9](?:[a-z0-9.-]*[a-z0-9])?)\^(?:\$[a-z,-]+)?$/i.exec(filter);
        if (!match) {
            throw new Error(`Unsupported supplemental network filter: ${line.slice(0, 120)}`);
        }

        const urlFilter = `||${match[1].toLowerCase()}^`;
        const key = `${allow ? 'allow' : 'block'}:${urlFilter}`;
        if (seen.has(key)) continue;
        seen.add(key);
        if (rules.length > RULE_ID_MAX - RULE_ID_MIN) {
            throw new Error('Supplemental list exceeds its complete dynamic-rule lane');
        }
        rules.push({
            id: RULE_ID_MIN + rules.length,
            priority: allow ? 2 : 1,
            action: { type: allow ? 'allow' : 'block' },
            condition: { urlFilter },
        });
    }

    if (rules.length === 0) throw new Error('Supplemental list contains no supported network rules');
    return rules;
}

async function sha256(text: string): Promise<string> {
    const bytes = new TextEncoder().encode(text);
    const hash = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
}

async function fetchList(
    descriptor: RemoteListDescriptor,
    previous: FilterUpdateState | undefined,
    fetchImpl: typeof fetch,
): Promise<Response> {
    const headers = new Headers();
    if (previous?.etag) headers.set('If-None-Match', previous.etag);
    if (previous?.lastModified) headers.set('If-Modified-Since', previous.lastModified);

    let lastError: unknown;
    for (const candidate of descriptor.urls) {
        const url = new URL(candidate);
        if (url.protocol !== 'https:' || !descriptor.allowedHosts.includes(url.hostname)) {
            lastError = new Error(`Untrusted filter-list URL: ${candidate}`);
            continue;
        }
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
        try {
            const response = await fetchImpl(url, {
                headers,
                redirect: 'error',
                signal: controller.signal,
                cache: 'no-store',
            });
            if (response.status === 304 || response.ok) return response;
            lastError = new Error(`Filter-list HTTP ${response.status}`);
        } catch (error) {
            lastError = error;
        } finally {
            clearTimeout(timeout);
        }
    }
    throw lastError instanceof Error ? lastError : new Error('All filter-list sources failed');
}

export async function updateSupplementalList(
    descriptor: RemoteListDescriptor,
    dependencies: UpdateDependencies,
): Promise<FilterUpdateState> {
    if (descriptor.mode !== 'dynamic') throw new Error('Only dynamic descriptors update at runtime');
    const { api, fetchImpl, now } = dependencies;
    const stored = await api.storage.local.get(STATE_KEY);
    const previousStates = (stored[STATE_KEY] ?? {}) as Record<string, FilterUpdateState>;
    const previous = previousStates[descriptor.id];
    const attemptAt = now();

    const persist = async (state: FilterUpdateState) => {
        await api.storage.local.set({
            [STATE_KEY]: { ...previousStates, [descriptor.id]: state },
        });
        return state;
    };
    await persist({
        ...previous,
        schemaVersion: 2,
        listId: descriptor.id,
        lastAttemptAt: attemptAt,
        status: 'checking',
        ruleCount: previous?.ruleCount ?? 0,
    });

    try {
        const response = await fetchList(descriptor, previous, fetchImpl);
        if (response.status === 304) {
            return persist({
                ...previous,
                schemaVersion: 2,
                listId: descriptor.id,
                lastAttemptAt: attemptAt,
                lastSuccessAt: attemptAt,
                status: 'current',
                ruleCount: previous?.ruleCount ?? 0,
            });
        }

        const declaredLength = Number(response.headers.get('content-length') ?? 0);
        if (declaredLength > descriptor.maxBytes) throw new Error('Filter list exceeds size limit');
        const text = await response.text();
        if (new TextEncoder().encode(text).byteLength > descriptor.maxBytes) {
            throw new Error('Filter list exceeds size limit');
        }

        const rules = compileSupplementalList(text);
        const existing = await api.declarativeNetRequest.getDynamicRules();
        const lane = existing.filter(rule => rule.id >= RULE_ID_MIN && rule.id <= RULE_ID_MAX);
        const outsideLaneCount = existing.length - lane.length;
        const quota = api.declarativeNetRequest.MAX_NUMBER_OF_DYNAMIC_RULES ?? 30_000;
        if (outsideLaneCount + rules.length > quota) {
            throw new Error('Dynamic-rule quota cannot fit the complete supplemental list');
        }

        await api.declarativeNetRequest.updateDynamicRules({
            removeRuleIds: lane.map(rule => rule.id),
            addRules: rules,
        });

        return persist({
            schemaVersion: 2,
            listId: descriptor.id,
            lastAttemptAt: attemptAt,
            lastSuccessAt: attemptAt,
            contentHash: await sha256(text),
            etag: response.headers.get('etag') ?? undefined,
            lastModified: response.headers.get('last-modified') ?? undefined,
            status: 'updated',
            ruleCount: rules.length,
        });
    } catch (error) {
        return persist({
            ...previous,
            schemaVersion: 2,
            listId: descriptor.id,
            lastAttemptAt: attemptAt,
            status: 'failed',
            error: error instanceof Error ? error.message : String(error),
            ruleCount: previous?.ruleCount ?? 0,
        });
    }
}

export function registerHybridUpdates(api: UpdaterApi = chrome as unknown as UpdaterApi): void {
    const run = () => {
        void updateSupplementalList(QUICK_FIXES_LIST, {
            api,
            fetchImpl: fetch,
            now: Date.now,
        }).catch(error => console.warn('[uBlock Ultimate] Supplemental update failed', error));
    };
    chrome.runtime.onStartup.addListener(run);
    chrome.runtime.onInstalled.addListener(run);
}
