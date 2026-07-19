/**
 * src/mv3/source-map-loader.ts
 *
 * Runtime bridge that loads every `<rulesetId>.source-map.json`
 * file from the extension package at SW startup. In the SW,
 * the loader uses `fetch(chrome.runtime.getURL(...))` to read
 * the static artifacts that `static-ruleset-packager.ts` emits.
 *
 * Pure mode: takes a custom `FileSystem` (testable). In-Chrome
 * mode: composes `chrome.runtime.getURL` and `fetch`.
 *
 * 404 / malformed JSON are logged and skipped — never crash
 * startup. The store may end up empty; the attribution
 * handlers fall back to "rule ID unknown" gracefully.
 *
 * UBR_ALLOW_FETCH_NON_RULE_DATA: this file calls `fetch()` but
 * only to read bundled local source-map artifacts via
 * `chrome.runtime.getURL(...)`. It does NOT perform remote
 * rule/config fetching.
 */

import { SourceMapStore, type SourceMapFileSystem } from '../attribution/source-map-store';

export interface SourceMapLoadLog {
  loaded: number;
  skipped: number;
  errors: string[];
}

export interface SourceMapLoadResult {
  store: SourceMapStore;
  log: SourceMapLoadLog;
}

export type Logger = (_message: string) => void;

const noopLogger: Logger = () => {};

export interface RuntimeFetchLike {
  fetch: (_url: string) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;
}

export interface RuntimeUrlResolverLike {
  resolve: (_relative: string) => string;
}

export interface InChromeLoaderOptions {
  rootDir: string;
  runtimeUrl: RuntimeUrlResolverLike;
  fetcher: RuntimeFetchLike;
  logger?: Logger;
}

export interface PureLoaderOptions {
  rootDir: string;
  fs: SourceMapFileSystem;
  logger?: Logger;
}

export function loadSourceMapStoreViaFetch(
    opts: InChromeLoaderOptions,
): SourceMapLoadResult {
    const logger = opts.logger ?? noopLogger;
    const store = new SourceMapStore();
    const log: SourceMapLoadLog = { loaded: 0, skipped: 0, errors: [] };
    return loadRecursive(opts.rootDir, '', store, log, async dir => {
        return listFilesInRuntime(dir, opts.runtimeUrl, opts.fetcher);
    }, async url => {
        return fetchOne(url, opts.runtimeUrl, opts.fetcher);
    }).then(() => {
        logger(
            `source-map-store (in-chrome): loaded=${log.loaded} skipped=${log.skipped} errors=${log.errors.length}`,
        );
        return { store, log };
    });
}

export function loadSourceMapStorePure(opts: PureLoaderOptions): SourceMapLoadResult {
    const store = new SourceMapStore();
    const log: SourceMapLoadLog = { loaded: 0, skipped: 0, errors: [] };
    if (!opts.fs.exists(opts.rootDir)) {
        return { store, log };
    }
    const { store: s, result } = SourceMapStore.loadFromDisk(opts.rootDir, opts.fs);
    // Copy into a fresh store so callers can call setRuntimeEntry
    for (const e of s.entries_()) {
    store.setRuntimeEntry(e);
    }
    log.loaded = result.loaded;
    log.skipped = result.skipped;
    log.errors = result.errors;
    (opts.logger ?? noopLogger)(
        `source-map-store: loaded=${log.loaded} skipped=${log.skipped} errors=${log.errors.length}`,
    );
    return { store, log };
}

async function loadRecursive(
    rootDir: string,
    _relative: string,
    store: SourceMapStore,
    log: SourceMapLoadLog,
    list: (_dir: string) => Promise<string[]>,
    fetchOne_: (_relative: string) => Promise<{ ok: boolean; status: number; text: string }>,
): Promise<void> {
    const dir = _relative ? `${rootDir}/${_relative}` : rootDir;
    let names: string[];
    try {
        names = await list(dir);
    } catch (err) {
    console.warn('[uBR] source-map-loader: list failed for dir', dir, err);
    log.errors.push(`list failed for ${dir}: ${(err as Error).message}`);
    return;
    }
    for (const name of names) {
        if (name.endsWith('.source-map.json')) {
            const fetchRelative = _relative ? `${rootDir}/${_relative}/${name}` : `${rootDir}/${name}`;
            await loadOne(fetchRelative, store, log, fetchOne_);
        }
    }
}

async function loadOne(
    _relative: string,
    store: SourceMapStore,
    log: SourceMapLoadLog,
    fetchOne_: (_relative: string) => Promise<{ ok: boolean; status: number; text: string }>,
): Promise<void> {
    let res: { ok: boolean; status: number; text: string };
    try {
        res = await fetchOne_(_relative);
    } catch (err) {
    console.warn('[uBR] source-map-loader: fetch failed for', _relative, err);
    log.skipped++;
    log.errors.push(`fetch failed for ${_relative}: ${(err as Error).message}`);
    return;
    }
    if (!res.ok) {
        log.skipped++;
    log.errors.push(`http ${res.status} for ${_relative}`);
    return;
    }
    let payload: unknown;
    try {
        payload = JSON.parse(res.text);
    } catch (err) {
    console.warn('[uBR] source-map-loader: JSON parse failed for', _relative, err);
    log.skipped++;
    log.errors.push(`json parse failed for ${_relative}: ${(err as Error).message}`);
    return;
    }
    const candidate = (payload as { entries?: unknown })?.entries;
    if (!Array.isArray(candidate)) {
        log.skipped++;
    log.errors.push(`unrecognized payload shape in ${_relative}`);
    return;
    }
    for (const raw of candidate) {
        if (!isEntry(raw)) {
            log.skipped++;
      log.errors.push(`invalid entry in ${_relative}`);
      continue;
        }
        try {
      store.setRuntimeEntry(raw);
      log.loaded++;
        } catch (err) {
      console.warn('[uBR] source-map-loader: setRuntimeEntry failed for entry in', _relative, err);
      log.skipped++;
      log.errors.push(`validation failed in ${_relative}: ${(err as Error).message}`);
        }
    }
}

async function fetchOne(
    relative: string,
    runtimeUrl: RuntimeUrlResolverLike,
    fetcher: RuntimeFetchLike,
): Promise<{ ok: boolean; status: number; text: string }> {
    const url = runtimeUrl.resolve(relative);
    const res = await fetcher.fetch(url);
    return {
    ok: res.ok,
    status: res.status,
    text: res.ok ? await res.text() : '',
    };
}

async function listFilesInRuntime(
    dir: string,
    _runtimeUrl: RuntimeUrlResolverLike,
    _fetcher: RuntimeFetchLike,
): Promise<string[]> {
    // In a real SW we don't have a directory listing API for
    // chrome-extension:// URLs. The bundler is expected to embed
    // a manifest of source-map filenames (a sibling
    // .source-map.index.json) that lists the ruleset ids.
    // If the index is missing, return [].
    const indexUrl = `${dir}/.source-map.index.json`;
    try {
        const res = await _fetcher.fetch(_runtimeUrl.resolve(indexUrl));
        if (!res.ok) return [];
        const json = JSON.parse(await res.text());
        if (!json || !Array.isArray((json as { files?: unknown }).files)) return [];
        return (json as { files: string[] }).files;
    } catch (e) {
    console.warn('[uBR] source-map-loader: fetchFileIndex failed', e);
    return [];
    }
}

function isEntry(v: unknown): boolean {
    if (!v || typeof v !== 'object') return false;
    const e = v as Record<string, unknown>;
    return (
        typeof e.rulesetId === 'string' &&
    e.rulesetId.length > 0 &&
    typeof e.ruleId === 'number' &&
    Number.isInteger(e.ruleId) &&
    e.ruleId > 0 &&
    typeof e.sourceList === 'string' &&
    e.sourceList.length > 0 &&
    typeof e.sourceTextHash === 'string' &&
    e.sourceTextHash.length > 0 &&
    typeof e.originalFilter === 'string' &&
    e.originalFilter.length > 0 &&
    typeof e.compiledAction === 'string' &&
    e.compiledAction.length > 0
    );
}
