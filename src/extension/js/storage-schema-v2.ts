export const STORAGE_SCHEMA_VERSION = 2;
export const STORAGE_SCHEMA_KEY = 'storageSchemaVersion';

export interface StorageArea {
    get(keys?: string | string[] | Record<string, unknown>): Promise<Record<string, unknown>>;
    set(values: Record<string, unknown>): Promise<void>;
}

export interface StorageMigrationResult {
    from: number;
    to: number;
    changed: boolean;
}

export async function migrateStorageToV2(
    storage: StorageArea,
): Promise<StorageMigrationResult> {
    const current = await storage.get([
        STORAGE_SCHEMA_KEY,
        'whitelist',
        'netWhitelist',
        'userFilters',
        'user-filters',
    ]);
    const from = Number(current[STORAGE_SCHEMA_KEY] ?? 1);
    if (from >= STORAGE_SCHEMA_VERSION) {
        return { from, to: from, changed: false };
    }

    const whitelist = typeof current.whitelist === 'string'
        ? current.whitelist
        : typeof current.netWhitelist === 'string'
            ? current.netWhitelist
            : '';
    const userFilters = typeof current.userFilters === 'string'
        ? current.userFilters
        : typeof current['user-filters'] === 'string'
            ? current['user-filters']
            : '';

    await storage.set({
        [STORAGE_SCHEMA_KEY]: STORAGE_SCHEMA_VERSION,
        whitelist,
        netWhitelist: whitelist,
        userFilters,
        'user-filters': userFilters,
    });
    return { from, to: STORAGE_SCHEMA_VERSION, changed: true };
}
