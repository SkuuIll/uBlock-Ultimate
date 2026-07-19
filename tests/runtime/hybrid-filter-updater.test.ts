import { describe, expect, it, vi } from 'vitest';
import {
    QUICK_FIXES_LIST,
    compileSupplementalList,
    updateSupplementalList,
} from '../../src/extension/js/hybrid-filter-updater.ts';

function createApi(
    initialRules: Array<Record<string, any>> = [],
    initialStorage: Record<string, unknown> = {},
) {
    let rules = structuredClone(initialRules);
    let storage = structuredClone(initialStorage);
    const updateDynamicRules = vi.fn(async change => {
        const removed = new Set(change.removeRuleIds ?? []);
        rules = rules.filter(rule => !removed.has(rule.id));
        rules.push(...structuredClone(change.addRules ?? []));
    });
    return {
        api: {
            storage: {
                local: {
                    get: vi.fn(async () => structuredClone(storage)),
                    set: vi.fn(async values => {
                        storage = { ...storage, ...structuredClone(values) };
                    }),
                },
            },
            declarativeNetRequest: {
                MAX_NUMBER_OF_DYNAMIC_RULES: 30_000,
                getDynamicRules: vi.fn(async () => structuredClone(rules)),
                updateDynamicRules,
            },
        },
        getRules: () => rules,
        getStorage: () => storage,
        updateDynamicRules,
    };
}

describe('compileSupplementalList', () => {
    it('normalizes and deduplicates complete host rules', () => {
        const rules = compileSupplementalList(`
            ! title
            ||Ads.Example.com^
            ||ads.example.com^
            @@||allowed.example^
            example.com##.advert
        `);
        expect(rules).toHaveLength(2);
        expect(rules[0]).toMatchObject({
            id: 28_000_000,
            action: { type: 'block' },
            condition: { urlFilter: '||ads.example.com^' },
        });
        expect(rules[1].action.type).toBe('allow');
    });

    it('rejects unsupported network syntax instead of truncating silently', () => {
        expect(() => compileSupplementalList('/advert-[0-9]+/$script')).toThrow(
            'Unsupported supplemental network filter',
        );
    });
});

describe('updateSupplementalList', () => {
    it('installs a complete update atomically and stores provenance', async () => {
        const fixture = createApi([{ id: 42, action: { type: 'block' }, condition: { urlFilter: 'old' } }]);
        const response = new Response('||ads.example^\n@@||safe.example^', {
            status: 200,
            headers: { etag: '"v2"', 'last-modified': 'today' },
        });
        const state = await updateSupplementalList(QUICK_FIXES_LIST, {
            api: fixture.api,
            fetchImpl: vi.fn(async () => response),
            now: () => 1234,
        });

        expect(state.status).toBe('updated');
        expect(state.ruleCount).toBe(2);
        expect(state.contentHash).toMatch(/^[a-f0-9]{64}$/);
        expect(fixture.updateDynamicRules).toHaveBeenCalledOnce();
        expect(fixture.getRules().some(rule => rule.id === 42)).toBe(true);
    });

    it('uses conditional requests and keeps the last good rules on 304', async () => {
        const previous = {
            schemaVersion: 2,
            listId: QUICK_FIXES_LIST.id,
            lastAttemptAt: 1,
            lastSuccessAt: 1,
            etag: '"v1"',
            status: 'updated',
            ruleCount: 4,
        };
        const fixture = createApi([], {
            filterUpdateStateV2: { [QUICK_FIXES_LIST.id]: previous },
        });
        const fetchImpl = vi.fn(async (_url: URL, init?: RequestInit) => {
            expect(new Headers(init?.headers).get('If-None-Match')).toBe('"v1"');
            return new Response(null, { status: 304 });
        });
        const state = await updateSupplementalList(QUICK_FIXES_LIST, {
            api: fixture.api,
            fetchImpl,
            now: () => 2,
        });
        expect(state.status).toBe('current');
        expect(state.ruleCount).toBe(4);
        expect(fixture.updateDynamicRules).not.toHaveBeenCalled();
    });

    it('preserves installed rules when validation fails', async () => {
        const installed = [{
            id: 28_000_000,
            priority: 1,
            action: { type: 'block' },
            condition: { urlFilter: '||last-good.example^' },
        }];
        const fixture = createApi(installed);
        const state = await updateSupplementalList(QUICK_FIXES_LIST, {
            api: fixture.api,
            fetchImpl: vi.fn(async () => new Response('/unsupported.*regex/')),
            now: () => 3,
        });
        expect(state.status).toBe('failed');
        expect(fixture.getRules()).toEqual(installed);
        expect(fixture.updateDynamicRules).not.toHaveBeenCalled();
    });

    it('rejects an update that cannot fit in the remaining DNR quota', async () => {
        const fixture = createApi([]);
        fixture.api.declarativeNetRequest.MAX_NUMBER_OF_DYNAMIC_RULES = 1;
        const state = await updateSupplementalList(QUICK_FIXES_LIST, {
            api: fixture.api,
            fetchImpl: vi.fn(async () => new Response('||one.example^\n||two.example^')),
            now: () => 4,
        });
        expect(state.status).toBe('failed');
        expect(state.error).toContain('quota');
        expect(fixture.updateDynamicRules).not.toHaveBeenCalled();
    });
});
