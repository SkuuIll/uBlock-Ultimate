import { describe, expect, it, vi } from 'vitest';
import {
    STORAGE_SCHEMA_KEY,
    migrateStorageToV2,
} from '../../src/extension/js/storage-schema-v2.ts';

describe('storage schema v2', () => {
    it('migrates legacy aliases without losing user data', async () => {
        let data: Record<string, unknown> = {
            netWhitelist: 'example.com',
            'user-filters': '||ads.example^',
        };
        const storage = {
            get: vi.fn(async () => ({ ...data })),
            set: vi.fn(async values => { data = { ...data, ...values }; }),
        };
        const result = await migrateStorageToV2(storage);
        expect(result).toEqual({ from: 1, to: 2, changed: true });
        expect(data).toMatchObject({
            [STORAGE_SCHEMA_KEY]: 2,
            whitelist: 'example.com',
            netWhitelist: 'example.com',
            userFilters: '||ads.example^',
            'user-filters': '||ads.example^',
        });
    });

    it('is idempotent once schema v2 is installed', async () => {
        const storage = {
            get: vi.fn(async () => ({ [STORAGE_SCHEMA_KEY]: 2 })),
            set: vi.fn(),
        };
        await expect(migrateStorageToV2(storage)).resolves.toEqual({
            from: 2,
            to: 2,
            changed: false,
        });
        expect(storage.set).not.toHaveBeenCalled();
    });
});
