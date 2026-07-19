/*******************************************************************************

    uBlock Ultimate - Custom Filter Storage
    Handles storage of user cosmetic filters

******************************************************************************/

const pendingWrites: Array<Promise<void>> = [];

const storageAPI =
    typeof (globalThis as any).browser !== 'undefined' ? (globalThis as any).browser.storage : (globalThis as any).chrome?.storage;

async function flushWrites(): Promise<void> {
    while (pendingWrites.length !== 0) {
        const promises = pendingWrites.slice();
        pendingWrites.length = 0;
        await Promise.all(promises);
    }
}

async function readFromStorage(key: string): Promise<string[] | undefined> {
    await flushWrites();
    try {
        const result = await storageAPI?.local.get(key);
        return result[key] ?? undefined;
    } catch (e) {
        console.warn('[uBR] filter-storage: readFromStorage failed', key, e);
        return undefined;
    }
}

function writeToStorage(key: string, value: string[]): void {
    pendingWrites.push(
        storageAPI?.local.set({ [key]: value }).catch((e: unknown) => {
            console.warn('[uBR] filter-storage: writeToStorage failed', key, e);
        })
    );
}

function removeFromStorage(key: string): void {
    pendingWrites.push(
        storageAPI?.local.remove(key).catch((e: unknown) => {
            console.warn('[uBR] filter-storage: removeFromStorage failed', key, e);
        })
    );
}

async function keysFromStorage(): Promise<string[]> {
    await flushWrites();
    try {
        const result = await storageAPI?.local.get(null);
        return Object.keys(result);
    } catch (e) {
        console.warn('[uBR] filter-storage: keysFromStorage failed', e);
        return [];
    }
}

async function getAllCustomFilterKeys(): Promise<string[]> {
    const storageKeys = await keysFromStorage() || [];
    return storageKeys.filter(key => key.startsWith('site.'));
}

export async function customFiltersFromHostname(hostname: string): Promise<string[]> {
    const promises: Array<Promise<string[] | undefined>> = [];
    let hn = hostname;
    while (hn !== '') {
        promises.push(readFromStorage(`site.${hn}`));
        const pos = hn.indexOf('.');
        if (pos === -1) { break; }
        hn = hn.slice(pos + 1);
    }
    const results = await Promise.all(promises);
    const out: string[] = [];
    for (let i = 0; i < promises.length; i++) {
        const selectors = results[i];
        if (selectors === undefined) { continue; }
        for (const selector of selectors) {
            out.push(selector.startsWith('0') ? selector.slice(1) : selector);
        }
    }
    return out.sort();
}

export async function hasCustomFilters(hostname: string): Promise<boolean> {
    const selectors = await customFiltersFromHostname(hostname);
    return (selectors?.length ?? 0) > 0;
}

export async function getAllCustomFilters(): Promise<Array<[string, string[]]>> {
    const collect = async (key: string): Promise<[string, string[]]> => {
        const selectors = await readFromStorage(key);
        const filtered = (selectors || []).map(a => a.startsWith('0') ? a.slice(1) : a);
        return [key.slice(5), filtered];
    };
    const keys = await getAllCustomFilterKeys();
    const promises = keys.map(k => collect(k));
    return Promise.all(promises);
}

export async function addCustomFilters(
    hostname: string,
    toAdd: string[]
): Promise<boolean> {
    if (hostname === '') { return false; }
    const key = `site.${hostname}`;
    const selectors = (await readFromStorage(key)) || [];
    const countBefore = selectors.length;
    for (const selector of toAdd) {
        if (selectors.includes(selector)) { continue; }
        selectors.push(selector);
    }
    if (selectors.length === countBefore) { return false; }
    selectors.sort();
    writeToStorage(key, selectors);
    return true;
}

export async function removeAllCustomFilters(hostname: string): Promise<boolean> {
    if (hostname === '*') {
        const keys = await getAllCustomFilterKeys();
        if (keys.length === 0) { return false; }
        for (const key of keys) {
            removeFromStorage(key);
        }
        return true;
    }
    const key = `site.${hostname}`;
    const selectors = await readFromStorage(key) || [];
    removeFromStorage(key);
    return selectors.length !== 0;
}

async function removeCustomFiltersByKey(
    key: string,
    toRemove: string[]
): Promise<boolean> {
    const selectors = await readFromStorage(key);
    if (selectors === undefined) { return false; }
    const beforeCount = selectors.length;
    for (const selector of toRemove) {
        let i = selectors.indexOf(selector);
        if (i === -1) {
            i = selectors.indexOf(`0${selector}`);
            if (i === -1) { continue; }
        }
        selectors.splice(i, 1);
    }
    const afterCount = selectors.length;
    if (afterCount === beforeCount) { return false; }
    if (afterCount !== 0) {
        writeToStorage(key, selectors);
    } else {
        removeFromStorage(key);
    }
    return true;
}

export async function removeCustomFilters(
    hostname: string,
    selectors: string[]
): Promise<boolean> {
    const promises: Array<Promise<boolean>> = [];
    let hn = hostname;
    while (hn !== '') {
        promises.push(removeCustomFiltersByKey(`site.${hn}`, selectors));
        const pos = hn.indexOf('.');
        if (pos === -1) { break; }
        hn = hn.slice(pos + 1);
    }
    const results = await Promise.all(promises);
    return results.some(a => a);
}
