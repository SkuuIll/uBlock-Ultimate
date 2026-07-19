// @ts-nocheck
/*******************************************************************************

    uBlock Ultimate - a comprehensive, efficient content blocker
    Copyright (C) 2014-present Raymond Hill

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU General Public License for more details.

    You should have received a copy of the GNU General Public License
    along with this program.  If not, see {http://www.gnu.org/licenses/}.

    Home: https://github.com/gorhill/uBlock
*/

import * as sfp from './static-filtering-parser.js';

import { broadcast } from './broadcast.js';
import cacheStorage from './cachestorage.js';
import { i18n$ } from './i18n.js';
import logger from './logger.js';
import { orphanizeString } from './text-utils.js';
import { ubolog } from './console.js';
import µb from './background.js';

/******************************************************************************/

const reIsExternalPath = /^(?:[a-z-]+):\/\//;
const reIsUserAsset = /^user-/;
const errorCantConnectTo = i18n$('errorCantConnectTo');
const MS_PER_HOUR = 60 * 60 * 1000;
const MS_PER_DAY = 24 * MS_PER_HOUR;
const MINUTES_PER_DAY = 24 * 60;
const EXPIRES_DEFAULT = 7;

interface AssetMetadata {
    lastModified?: number;
    expires?: number;
    diffExpires?: number;
    diffPath?: string;
    diffName?: string;
    [key: string]: unknown;
}

interface AssetSourceEntry {
    content?: string;
    contentURL?: string | string[];
    cdnURLs?: string[];
    patchURLs?: string[];
    hasLocalURL?: boolean;
    hasRemoteURL?: boolean;
    submitter?: string;
    submitTime?: number;
    updateAfter?: number;
    birthtime?: number;
    error?: { time: number; error: string } | undefined;
    off?: boolean;
    external?: boolean;
}

interface AssetCacheEntry {
    writeTime?: number;
    readTime?: number;
    resourceTime?: number;
    remoteURL?: string;
    diffPath?: string;
    diffName?: string;
    diffExpires?: number;
    diffUpdated?: boolean;
    lastModified?: number;
}

interface GetContentURLsOptions {
    favorLocal?: boolean;
    favorOrigin?: boolean;
}

interface FetchOptions {
    responseType?: XMLHttpRequestResponseType;
}

interface FetchResult {
    url: string;
    content: string;
    statusCode?: number;
    statusText?: string;
    error?: string;
    resourceTime?: number;
}

interface AssetGetOptions {
    favorLocal?: boolean;
    needSourceURL?: boolean;
    dontCache?: boolean;
    silent?: boolean;
}

interface AssetGetResult {
    assetKey: string;
    content: string;
    sourceURL?: string;
    error?: string;
    lastError?: string;
}

interface AssetPutOptions {
    url?: string;
    resourceTime?: number;
    silent?: boolean;
}

interface UpdateConditions {
    [content: string]: string[];
}

interface AssetDiffDetails {
    assetKey: string;
    patchPath?: string;
    diffName?: string;
    diffExpires?: number;
    lastModified?: number;
    writeTime?: number;
    cdnURLs?: string[];
    patchURLs?: string[];
    fetch?: boolean;
    what?: string;
}

interface ObserverCallback {
    (topic: string, details: unknown): unknown;
}

const assets: {
    extractMetadataFromList: (content: string, fields: string[]) => AssetMetadata;
    addObserver: (observer: ObserverCallback) => void;
    removeObserver: (observer: ObserverCallback) => void;
    fetch: (url: string, options?: FetchOptions) => Promise<FetchResult>;
    fetchText: (url: string) => Promise<FetchResult>;
    fetchFilterList: (mainlistURL: string) => Promise<{ url: string; content: string; resourceTime?: number; error?: string }>;
    registerAssetSource: (assetKey: string, details: unknown) => Promise<void>;
    unregisterAssetSource: (assetKey: string) => Promise<void>;
    get: (assetKey: string, options?: AssetGetOptions) => Promise<AssetGetResult>;
    put: (assetKey: string, content: string) => Promise<{ assetKey: string; content: string }>;
    toCache: (assetKey: string, content: string) => Promise<{ assetKey: string; content: string }>;
    fromCache: (assetKey: string) => Promise<string | null>;
    metadata: () => Promise<Record<string, unknown>>;
    purge: (pattern: string | RegExp, exclude?: string | RegExp | string[]) => Promise<void>;
    remove: (...args: unknown[]) => Promise<void>;
    rmrf: () => Promise<void>;
    getUpdateAges: (conditions?: UpdateConditions) => Promise<{ assetKey: string; age: number; ageNormalized: number }[]>;
    updateStart: (details: { fetchDelay?: number; auto?: boolean }) => void;
    updateStop: () => void;
    isUpdating: () => boolean;
} = {};

let remoteServerFriendly = false;

/******************************************************************************/

const stringIsNotEmpty = (s: unknown): s is string => typeof s === 'string' && s !== '';

const parseExpires = (s: string): number | undefined => {
    const matches = s.match(/(\d+)\s*([wdhm]?)/i);
    if ( matches === null ) { return; }
    let updateAfter = parseInt(matches[1], 10);
    if ( updateAfter === 0 ) { return; }
    if ( matches[2] === 'w' ) {
        updateAfter *= 7;
    } else if ( matches[2] === 'h' ) {
        updateAfter = Math.max(updateAfter, 4) / 24;
    } else if ( matches[2] === 'm' ) {
        updateAfter = Math.max(updateAfter, 240) / 1440;
    }
    return updateAfter;
};

const extractMetadataFromList = (content: string, fields: string[]): AssetMetadata => {
    const out: AssetMetadata = {};
    const head = content.slice(0, 1024);
    for ( const field of fields ) {
        const normalizedField = field.replace(/\s+/g, '-');
        const re = new RegExp(`^(?:! *|# +)${normalizedField.replace(/-/g, '(?: +|-)')}: *(.+)$`, 'im');
        const match = re.exec(head);
        let value = match && match[1].trim() || undefined;
        if ( value !== undefined && value.startsWith('%') ) {
            value = undefined;
        }
        const lowerField = field.toLowerCase().replace(
            /-[a-z]/g, (s: string) => s.charAt(1).toUpperCase()
        );
        out[lowerField] = value !== undefined ? orphanizeString(value) : undefined;
    }
    if ( out.lastModified !== undefined ) {
        out.lastModified = (new Date(out.lastModified as number)).getTime() || 0;
    }
    if ( out.expires !== undefined ) {
        out.expires = parseExpires(out.expires as string);
    }
    if ( out.diffExpires !== undefined ) {
        out.diffExpires = parseExpires(out.diffExpires as string);
    }
    return out;
};
assets.extractMetadataFromList = extractMetadataFromList;

const resourceTimeFromXhr = (xhr: XMLHttpRequest): number => {
    if ( typeof xhr.response !== 'string' ) {  return 0; }
    const metadata = extractMetadataFromList(xhr.response, [
        'Last-Modified'
    ]);
    return metadata.lastModified || 0;
};

const resourceTimeFromParts = (parts: unknown[], time: number): number => {
    const goodParts = parts.filter((part): part is Record<string, unknown> => typeof part === 'object');
    return goodParts.reduce(
        (acc, part) => ((part.resourceTime as number || 0) > acc ? part.resourceTime as number : acc),
        time
    );
};

const resourceIsStale = (networkDetails: { url: string; resourceTime?: number }, cacheDetails: { remoteURL?: string; resourceTime?: number }): boolean => {
    if ( typeof networkDetails.resourceTime !== 'number' ) { return false; }
    if ( networkDetails.resourceTime === 0 ) { return false; }
    if ( typeof cacheDetails.resourceTime !== 'number' ) { return false; }
    if ( cacheDetails.resourceTime === 0 ) { return false; }
    if ( networkDetails.resourceTime < cacheDetails.resourceTime ) {
        ubolog(`Skip ${networkDetails.url}\n\tolder than ${cacheDetails.remoteURL}`);
        return true;
    }
    return false;
};

const getUpdateAfterTime = (assetKey: string, diff = false): number => {
    const entry = assetCacheRegistry[assetKey];
    if ( entry ) {
        if ( diff && typeof entry.diffExpires === 'number' ) {
            return entry.diffExpires * MS_PER_DAY;
        }
        if ( typeof entry.expires === 'number' ) {
            return entry.expires * MS_PER_DAY;
        }
    }
    if ( assetSourceRegistry ) {
        const srcEntry = assetSourceRegistry[assetKey];
        if ( srcEntry && typeof srcEntry.updateAfter === 'number' ) {
            return srcEntry.updateAfter * MS_PER_DAY;
        }
    }
    return EXPIRES_DEFAULT * MS_PER_DAY;
};

const getWriteTime = (assetKey: string): number => {
    const entry = assetCacheRegistry[assetKey];
    if ( entry ) { return entry.writeTime || 0; }
    return 0;
};

const isDiffUpdatableAsset = (content: string): boolean => {
    if ( typeof content !== 'string' ) { return false; }
    const data = extractMetadataFromList(content, [
        'Diff-Path',
    ]);
    return typeof data.diffPath === 'string' &&
        data.diffPath.startsWith('%') === false;
};

const computedPatchUpdateTime = (assetKey: string): number => {
    const entry = assetCacheRegistry[assetKey];
    if ( entry === undefined ) { return 0; }
    if ( typeof entry.diffPath !== 'string' ) { return 0; }
    if ( typeof entry.diffExpires !== 'number' ) { return 0; }
    const match = /(\d+)\.(\d+)\.(\d+)\.(\d+)/.exec(entry.diffPath);
    if ( match === null ) { return getWriteTime(assetKey); }
    const date = new Date();
    date.setUTCFullYear(
        parseInt(match[1], 10),
        parseInt(match[2], 10) - 1,
        parseInt(match[3], 10)
    );
    date.setUTCHours(0, parseInt(match[4], 10) + entry.diffExpires * MINUTES_PER_DAY, 0, 0);
    return date.getTime();
};

/******************************************************************************/

const getContentURLs = (assetKey: string, options: GetContentURLsOptions = {}): string[] => {
    const contentURLs: string[] = [];
    const entry = assetSourceRegistry[assetKey];
    if ( entry instanceof Object === false ) { return contentURLs; }
    if ( typeof entry.contentURL === 'string' ) {
        contentURLs.push(entry.contentURL);
    } else if ( Array.isArray(entry.contentURL) ) {
        contentURLs.push(...entry.contentURL);
    } else if ( reIsExternalPath.test(assetKey) ) {
        contentURLs.push(assetKey);
    }
    if ( options.favorLocal ) {
        contentURLs.sort((a, b) => {
            if ( reIsExternalPath.test(a) ) { return 1; }
            if ( reIsExternalPath.test(b) ) { return -1; }
            return 0;
        });
    }
    if ( options.favorOrigin !== true && Array.isArray(entry.cdnURLs) ) {
        const cdnURLs = entry.cdnURLs.slice();
        for ( let i = 0, n = cdnURLs.length; i < n; i++ ) {
            const j = Math.floor(Math.random() * n);
            if ( j === i ) { continue; }
            [ cdnURLs[j], cdnURLs[i] ] = [ cdnURLs[i], cdnURLs[j] ];
        }
        if ( options.favorLocal ) {
            contentURLs.push(...cdnURLs);
        } else {
            contentURLs.unshift(...cdnURLs);
        }
    }
    return contentURLs;
};

/******************************************************************************/

const observers: ObserverCallback[] = [];

assets.addObserver = function(observer: ObserverCallback): void {
    if ( observers.indexOf(observer) === -1 ) {
        observers.push(observer);
    }
};

assets.removeObserver = function(observer: ObserverCallback): void {
    let pos: number;
    while ( (pos = observers.indexOf(observer)) !== -1 ) {
        observers.splice(pos, 1);
    }
};

const fireNotification = function(topic: string, details: unknown): unknown {
    let result: unknown;
    for ( const observer of observers ) {
        const r = observer(topic, details);
        if ( r !== undefined ) { result = r; }
    }
    return result;
};

/******************************************************************************/

assets.fetch = function(url: string, options: FetchOptions = {}): Promise<FetchResult> {
    return new Promise((resolve, reject) => {
    // Start of executor

        const timeoutAfter = µb.hiddenSettings.assetFetchTimeout || 30;
        const xhr = new XMLHttpRequest();
        let contentLoaded = 0;

        const cleanup = function(): void {
        xhr.removeEventListener('load', onLoadEvent);
        xhr.removeEventListener('error', onErrorEvent);
        xhr.removeEventListener('abort', onErrorEvent);
        xhr.removeEventListener('progress', onProgressEvent);
        timeoutTimer.off();
        };

        const fail = function(details: FetchResult, msg: string): void {
        logger.writeOne({
            realm: 'message',
            type: 'error',
            text: msg,
        });
        details.content = '';
        details.error = msg;
        reject(details);
        };

        // https://github.com/gorhill/uMatrix/issues/15
        const onLoadEvent = function(this: XMLHttpRequest): void {
            cleanup();
            const details: FetchResult = {
            url,
            statusCode: this.status || 200,
            statusText: this.statusText || ''
            };
            if ( details.statusCode < 200 || details.statusCode >= 300 ) {
                return fail(details, `${url}: ${details.statusCode} ${details.statusText}`);
            }
            details.content = this.response;
            details.resourceTime = resourceTimeFromXhr(this);
            resolve(details);
        };

        const onErrorEvent = function(): void {
            cleanup();
            fail({ url }, errorCantConnectTo.replace('{{msg}}', url));
        };

        const onTimeout = function(): void {
        xhr.abort();
        };

        // https://github.com/gorhill/uBlock/issues/2526
        // - Timeout only when there is no progress.
        const onProgressEvent = function(ev: ProgressEvent): void {
            if ( ev.loaded === contentLoaded ) { return; }
            contentLoaded = ev.loaded;
        timeoutTimer.offon({ sec: timeoutAfter });
        };

        const timeoutTimer = vAPI.defer.create(onTimeout);

        // Be ready for thrown exceptions:
        // I am pretty sure it used to work, but now using a URL such as
        // `file:///` on Chromium 40 results in an exception being thrown.
        try {
        xhr.open('get', url, true);
        xhr.addEventListener('load', onLoadEvent);
        xhr.addEventListener('error', onErrorEvent);
        xhr.addEventListener('abort', onErrorEvent);
        xhr.addEventListener('progress', onProgressEvent);
        xhr.responseType = options.responseType || 'text';
        xhr.send();
        timeoutTimer.on({ sec: timeoutAfter });
        } catch(e) {
        console.warn('[uBR] assets: xhr send/open failed', url, e);
        onErrorEvent.call(xhr);
        }

    // End of executor
    });
};

/******************************************************************************/

assets.fetchText = async function(url: string): Promise<FetchResult> {
    const isExternal = reIsExternalPath.test(url);
    let actualUrl = isExternal ? url : vAPI.getURL(url);

    // https://github.com/gorhill/uBlock/issues/2592
    //   Force browser cache to be bypassed, but only for resources which have
    //   been fetched more than one hour ago.
    // https://github.com/uBlockOrigin/uBlock-issues/issues/682#issuecomment-515197130
    //   Provide filter list authors a way to completely bypass
    //   the browser cache.
    // https://github.com/gorhill/uBlock/commit/048bfd251c9b#r37972005
    //   Use modulo prime numbers to avoid generating the same token at the
    //   same time across different days.
    // Do not bypass browser cache if we are asked to be gentle on remote
    // servers.
    if ( isExternal && remoteServerFriendly !== true ) {
        const cacheBypassToken =
            µb.hiddenSettings.updateAssetBypassBrowserCache
                ? Math.floor(Date.now() /    1000) % 86413
                : Math.floor(Date.now() / 3600000) %    13;
        const queryValue = `_=${cacheBypassToken}`;
        if ( actualUrl.indexOf('?') === -1 ) {
            actualUrl += '?';
        } else {
            actualUrl += '&';
        }
        actualUrl += queryValue;
    }

    let details: FetchResult = { content: '', url };
    try {
        details = await assets.fetch(actualUrl);

        // Consider an empty result to be an error
        if ( stringIsNotEmpty(details.content) === false ) {
            details.content = '';
        }

        // We never download anything else than plain text: discard if
        // response appears to be a HTML document: could happen when server
        // serves some kind of error page for example.
        const text = details.content.trim();
        if ( text.startsWith('<') && text.endsWith('>') ) {
            details.content = '';
            details.error = 'assets.fetchText(): Not a text file';
        }
    } catch(ex) {
        details = ex as FetchResult;
    }

    // We want to return the caller's URL, not our internal one which may
    // differ from the caller's one.
    details.url = url;

    return details;
};

/******************************************************************************/

// https://github.com/gorhill/uBlock/issues/3331
//   Support the seamless loading of sublists.

assets.fetchFilterList = async function(mainlistURL: string): Promise<{ url: string; content: string; resourceTime?: number; error?: string }> {
    const toParsedURL = (url: string): URL | undefined => {
        try {
            return new URL(url.trim());
        } catch (e) {
            console.warn('[uBR] assets: toParsedURL URL parse failed', url, e);
        }
    };

    // https://github.com/NanoAdblocker/NanoCore/issues/239
    //   Anything under URL's root directory is allowed to be fetched. The
    //   URL of a sublist will always be relative to the URL of the parent
    //   list (instead of the URL of the root list).
    let rootDirectoryURL = toParsedURL(
        reIsExternalPath.test(mainlistURL)
            ? mainlistURL
            : vAPI.getURL(mainlistURL)
    );
    if ( rootDirectoryURL !== undefined ) {
        const pos = rootDirectoryURL.pathname.lastIndexOf('/');
        if ( pos !== -1 ) {
            rootDirectoryURL.pathname =
                rootDirectoryURL.pathname.slice(0, pos + 1);
        } else {
            rootDirectoryURL = undefined;
        }
    }

    const sublistURLs = new Set<string>();

    // https://github.com/uBlockOrigin/uBlock-issues/issues/1113
    //   Process only `!#include` directives which are not excluded by an
    //   `!#if` directive.
    const processIncludeDirectives = function(results: unknown[]): (string | Promise<FetchResult>)[] {
        const out: (string | Promise<FetchResult>)[] = [];
        const reInclude = /^!#include +(\S+)[^\n\r]*(?:[\n\r]+|$)/gm;
        for ( const result of results ) {
            if ( typeof result === 'string' ) {
                out.push(result);
                continue;
            }
            if ( result instanceof Object === false ) { continue; }
            const rawContent = (result as { content?: unknown }).content;
            if ( typeof rawContent !== 'string' ) { continue; }
            const content = `${rawContent.trimEnd()  }\n`;
            const slices = sfp.utils.preparser.splitter(
                content,
                vAPI.webextFlavor.env
            );
            for ( let i = 0, n = slices.length - 1; i < n; i++ ) {
                const slice = content.slice(slices[i+0], slices[i+1]);
                if ( (i & 1) !== 0 ) {
                    out.push(slice);
                    continue;
                }
                let lastIndex = 0;
                for (;;) {
                    if ( rootDirectoryURL === undefined ) { break; }
                    const match = reInclude.exec(slice);
                    if ( match === null ) { break; }
                    if ( toParsedURL(match[1]) !== undefined ) { continue; }
                    if ( match[1].indexOf('..') !== -1 ) { continue; }
                    // Compute nested list path relative to parent list path
                    const pos = (result as { url: string }).url.lastIndexOf('/');
                    if ( pos === -1 ) { continue; }
                    const subURL = (result as { url: string }).url.slice(0, pos + 1) + match[1].trim();
                    if ( sublistURLs.has(subURL) ) { continue; }
                    sublistURLs.add(subURL);
                    out.push(
                        slice.slice(lastIndex, match.index + match[0].length),
                        `! >>>>>>>> ${subURL}\n`,
                        assets.fetchText(subURL),
                        `! <<<<<<<< ${subURL}\n`
                    );
                    lastIndex = reInclude.lastIndex;
                }
                out.push(lastIndex === 0 ? slice : slice.slice(lastIndex));
            }
        }
        return out;
    };

    // https://github.com/AdguardTeam/FiltersRegistry/issues/82
    //   Not checking for `errored` status was causing repeated notifications
    //   to the caller. This can happen when more than one out of multiple
    //   sublists can't be fetched.

    let allParts: (string | FetchResult)[] = [
        this.fetchText(mainlistURL)
    ];
    // Abort processing `include` directives if at least one included sublist
    // can't be fetched.
    let resourceTime = 0;
    do {
        allParts = await Promise.all(allParts);
        const part = allParts
            .find((part): part is FetchResult => typeof part === 'object' && (part as FetchResult).error !== undefined);
        if ( part !== undefined ) {
            return { url: mainlistURL, content: '', error: part.error };
        }
        resourceTime = resourceTimeFromParts(allParts, resourceTime);
        // Skip pre-parser directives for diff-updatable assets
        if ( allParts.length === 1 && allParts[0] instanceof Object ) {
            if ( isDiffUpdatableAsset((allParts[0] as FetchResult).content) ) {
                allParts[0] = (allParts[0] as FetchResult).content;
                break;
            }
        }
        allParts = processIncludeDirectives(allParts);
    } while ( allParts.some(part => typeof part !== 'string') );
    // If we reach this point, this means all fetches were successful.
    return {
        url: mainlistURL,
        resourceTime,
        content: allParts.length === 1
            ? allParts[0] as string
            : allParts.join('')
    };
};

/*******************************************************************************

    The purpose of the asset source registry is to keep key detail information
    about an asset:
    - Where to load it from: this may consist of one or more URLs, either local
      or remote.
    - After how many days an asset should be deemed obsolete -- i.e. in need of
      an update.
    - The origin and type of an asset.
    - The last time an asset was registered.

**/

let assetSourceRegistryPromise: Promise<Record<string, AssetSourceEntry>> | undefined;
let assetSourceRegistry: Record<string, AssetSourceEntry> = Object.create(null);

function getAssetSourceRegistry(): Promise<Record<string, AssetSourceEntry>> {
    if ( assetSourceRegistryPromise === undefined ) {
        assetSourceRegistryPromise = cacheStorage.get(
            'assetSourceRegistry'
        ).then((bin: unknown) => {
            if ( bin instanceof Object ) {
                if ( (bin as { assetSourceRegistry: unknown }).assetSourceRegistry instanceof Object ) {
                    assetSourceRegistry = (bin as { assetSourceRegistry: Record<string, AssetSourceEntry> }).assetSourceRegistry;
                    ubolog('Loaded assetSourceRegistry');
                    return assetSourceRegistry;
                }
            }
            return assets.fetchText(
                µb.assetsBootstrapLocation || µb.assetsJsonPath
            ).then(details => {
                return details.content !== ''
                    ? details
                    : assets.fetchText(µb.assetsJsonPath);
            }).then(details => {
                updateAssetSourceRegistry(details.content, true);
                ubolog('Loaded assetSourceRegistry');
                return assetSourceRegistry;
            });
        });
    }

    return assetSourceRegistryPromise;
}

function registerAssetSource(assetKey: string, newDict: unknown): void {
    const currentDict = assetSourceRegistry[assetKey] || {};
    for ( const [ k, v ] of Object.entries(newDict as Record<string, unknown>) ) {
        if ( v === undefined || v === null ) {
            delete currentDict[k as keyof AssetSourceEntry];
        } else {
            (currentDict as Record<string, unknown>)[k] = v;
        }
    }
    let contentURL = (newDict as { contentURL?: string | string[] }).contentURL;
    if ( contentURL !== undefined ) {
        if ( typeof contentURL === 'string' ) {
            contentURL = currentDict.contentURL = [ contentURL ];
        } else if ( Array.isArray(contentURL) === false ) {
            contentURL = currentDict.contentURL = [];
        }
        let remoteURLCount = 0;
        for ( let i = 0; i < (contentURL as string[]).length; i++ ) {
            if ( reIsExternalPath.test(contentURL[i]) ) {
                remoteURLCount += 1;
            }
        }
        currentDict.hasLocalURL = remoteURLCount !== (contentURL as string[]).length;
        currentDict.hasRemoteURL = remoteURLCount !== 0;
    } else if ( currentDict.contentURL === undefined ) {
        currentDict.contentURL = [];
    }
    if ( currentDict.submitter ) {
        currentDict.submitTime = Date.now();
    }
    assetSourceRegistry[assetKey] = currentDict;
}

function unregisterAssetSource(assetKey: string): void {
    assetCacheRemove(assetKey);
    delete assetSourceRegistry[assetKey];
}

const saveAssetSourceRegistry = (( ) => {
    const save = ( ): void => {
        timer.off();
        cacheStorage.set({ assetSourceRegistry });
    };
    const timer = vAPI.defer.create(save);
    return function(lazily: boolean): void {
        if ( lazily ) {
            timer.offon(500);
        } else {
            save();
        }
    };
})();

async function assetSourceGetDetails(assetKey: string): Promise<AssetSourceEntry | undefined> {
    await getAssetSourceRegistry();
    const entry = assetSourceRegistry[assetKey];
    if ( entry === undefined ) { return; }
    return entry;
}

function updateAssetSourceRegistry(json: string, silent = false): void {
    let newDict: unknown;
    try {
        newDict = JSON.parse(json);
        (newDict as { 'assets.json'?: { defaultListset?: string[] } })['assets.json'].defaultListset =
            Array.from(Object.entries(newDict as Record<string, unknown>))
                .filter(a => a[1] && (a[1] as { content?: string }).content === 'filters' && (a[1] as { off?: unknown }).off === undefined)
                .map(a => a[0]);
    } catch (e) {
        console.warn('[uBR] assets: updateAssetSourceRegistry JSON parse failed', e);
    }
    if ( newDict instanceof Object === false ) { return; }

    const oldDict = assetSourceRegistry;

    fireNotification('assets.json-updated', { newDict, oldDict });

    // Remove obsolete entries (only those which were built-in).
    for ( const assetKey in oldDict ) {
        if (
            (newDict as Record<string, unknown>)[assetKey] === undefined &&
            (oldDict[assetKey] as { submitter?: unknown }).submitter === undefined
        ) {
            unregisterAssetSource(assetKey);
        }
    }
    // Add/update existing entries. Notify of new asset sources.
    for ( const assetKey in newDict as Record<string, unknown> ) {
        if ( oldDict[assetKey] === undefined && !silent ) {
            fireNotification(
                'builtin-asset-source-added',
                { assetKey: assetKey, entry: (newDict as Record<string, unknown>)[assetKey] }
            );
        }
        registerAssetSource(assetKey, (newDict as Record<string, unknown>)[assetKey]);
    }
    saveAssetSourceRegistry();
}

assets.registerAssetSource = async function(assetKey: string, details: unknown): Promise<void> {
    await getAssetSourceRegistry();
    registerAssetSource(assetKey, details);
    saveAssetSourceRegistry(true);
};

assets.unregisterAssetSource = async function(assetKey: string): Promise<void> {
    await getAssetSourceRegistry();
    unregisterAssetSource(assetKey);
    saveAssetSourceRegistry(true);
};

/*******************************************************************************

    The purpose of the asset cache registry is to keep track of all assets
    which have been persisted into the local cache.

**/

const assetCacheRegistryStartTime = Date.now();
let assetCacheRegistryPromise: Promise<Record<string, AssetCacheEntry>> | undefined;
let assetCacheRegistry: Record<string, AssetCacheEntry> = {};

function getAssetCacheRegistry(): Promise<Record<string, AssetCacheEntry> | undefined> {
    if ( assetCacheRegistryPromise !== undefined ) {
        return assetCacheRegistryPromise;
    }
    assetCacheRegistryPromise = cacheStorage.get(
        'assetCacheRegistry'
    ).then((bin: unknown) => {
        if ( bin instanceof Object === false ) { return; }
        if ( (bin as { assetCacheRegistry: unknown }).assetCacheRegistry instanceof Object === false ) { return; }
        if ( Object.keys(assetCacheRegistry).length !== 0 ) {
            return console.error('getAssetCacheRegistry(): assetCacheRegistry reassigned!');
        }
        ubolog('Loaded assetCacheRegistry');
        assetCacheRegistry = (bin as { assetCacheRegistry: Record<string, AssetCacheEntry> }).assetCacheRegistry;
    }).then(( ) =>
        assetCacheRegistry
    );
    return assetCacheRegistryPromise;
}

const saveAssetCacheRegistry = (( ) => {
    const save = ( ): Promise<void> => {
        timer.off();
        return cacheStorage.set({ assetCacheRegistry });
    };
    const timer = vAPI.defer.create(save);
    return (throttle = 0): Promise<void> | void => {
        if ( throttle === 0 ) {
            return save();
        }
        timer.offon({ sec: throttle });
    };
})();

async function assetCacheRead(assetKey: string, updateReadTime = false): Promise<FetchResult> {
    const t0 = Date.now();
    const internalKey = `cache/${assetKey}`;

    const reportBack = function(content: unknown): FetchResult {
        if ( content instanceof Blob ) { content = ''; }
        const details: FetchResult = { assetKey, content: content as string };
        if ( content === '' || content === undefined ) {
            details.error = 'ENOTFOUND';
        }
        return details;
    };

    const [ , bin ] = await Promise.all([
        getAssetCacheRegistry(),
        cacheStorage.get(internalKey),
    ]);

    if ( bin instanceof Object === false ) { return reportBack(''); }
    if ( Object.hasOwn(bin as object, internalKey) === false ) { return reportBack(''); }

    const entry = assetCacheRegistry[assetKey];
    if ( entry === undefined ) { return reportBack(''); }

    entry.readTime = Date.now();
    if ( updateReadTime ) {
        saveAssetCacheRegistry(23);
    }

    return reportBack((bin as Record<string, unknown>)[internalKey]);
}

async function assetCacheWrite(assetKey: string, content: string, options: AssetPutOptions = {}): Promise<{ assetKey: string; content: string }> {
    if ( content === '' || content === undefined ) {
        await assetCacheRemove(assetKey);
        return { assetKey, content: '' };
    }

    const cacheDict = await getAssetCacheRegistry();

    const { resourceTime, url } = options;
    const entry = cacheDict[assetKey] || {};
    entry.writeTime = entry.readTime = Date.now();
    entry.resourceTime = resourceTime || 0;
    if ( typeof url === 'string' ) {
        entry.remoteURL = url;
    }
    cacheDict[assetKey] = entry;

    await cacheStorage.set({ [`cache/${assetKey}`]: content });

    saveAssetCacheRegistry(3);

    const result = { assetKey, content };
    // https://github.com/uBlockOrigin/uBlock-issues/issues/248
    if ( options.silent !== true ) {
        fireNotification('after-asset-updated', result);
    }
    return result;
}

async function assetCacheRemove(pattern: string | RegExp, options: { janitor?: boolean } = {}): Promise<{ assetKey: string }[]> {
    const cacheDict = await getAssetCacheRegistry();
    const removedEntries: string[] = [];
    const removedContent: string[] = [];
    for ( const assetKey in cacheDict ) {
        if ( pattern instanceof RegExp ) {
            if ( pattern.test(assetKey) === false ) { continue; }
        } else if ( typeof pattern === 'string' ) {
            if ( assetKey !== pattern ) { continue; }
        }
        removedEntries.push(assetKey);
        removedContent.push(`cache/${assetKey}`);
        delete cacheDict[assetKey];
    }
    if ( options.janitor && pattern instanceof RegExp ) {
        const re = new RegExp(
            pattern.source.replace(/^\^/, '^cache\\/'),
            pattern.flags
        );
        const keys = await cacheStorage.keys(re);
        for ( const key of keys ) {
            removedContent.push(key);
            ubolog(`Removing stray ${key}`);
        }
    }
    if ( removedContent.length !== 0 ) {
        await Promise.all([
            cacheStorage.remove(removedContent),
            cacheStorage.set({ assetCacheRegistry }),
        ]);
    }
    for ( let i = 0; i < removedEntries.length; i++ ) {
        fireNotification('after-asset-updated', {
            assetKey: removedEntries[i]
        });
    }
    return removedEntries.map(assetKey => ({ assetKey }));
}

async function assetCacheGetDetails(assetKey: string): Promise<AssetCacheEntry | undefined> {
    const cacheDict = await getAssetCacheRegistry();
    const entry = cacheDict[assetKey];
    if ( entry === undefined ) { return; }
    return entry;
}

async function assetCacheSetDetails(assetKey: string, details: Partial<AssetCacheEntry>): Promise<void> {
    const cacheDict = await getAssetCacheRegistry();
    const entry = cacheDict[assetKey];
    if ( entry === undefined ) { return; }
    let modified = false;
    for ( const [ k, v ] of Object.entries(details) ) {
        if ( v === undefined ) {
            if ( entry[k as keyof AssetCacheEntry] !== undefined ) {
                delete entry[k as keyof AssetCacheEntry];
                modified = true;
                continue;
            }
        }
        if ( v !== entry[k as keyof AssetCacheEntry] ) {
            (entry as Record<string, unknown>)[k] = v;
            modified = true;
        }
    }
    if ( modified ) {
        saveAssetCacheRegistry(3);
    }
}

async function assetCacheMarkAsDirty(pattern: string | RegExp | string[], exclude?: string | RegExp | string[]): Promise<void> {
    const cacheDict = await getAssetCacheRegistry();
    let mustSave = false;
    for ( const assetKey in cacheDict ) {
        if ( pattern instanceof RegExp ) {
            if ( pattern.test(assetKey) === false ) { continue; }
        } else if ( typeof pattern === 'string' ) {
            if ( assetKey !== pattern ) { continue; }
        } else if ( Array.isArray(pattern) ) {
            if ( pattern.indexOf(assetKey) === -1 ) { continue; }
        }
        if ( exclude instanceof RegExp ) {
            if ( exclude.test(assetKey) ) { continue; }
        } else if ( typeof exclude === 'string' ) {
            if ( assetKey === exclude ) { continue; }
        } else if ( Array.isArray(exclude) ) {
            if ( exclude.indexOf(assetKey) !== -1 ) { continue; }
        }
        const cacheEntry = cacheDict[assetKey];
        if ( !cacheEntry.writeTime ) { continue; }
        cacheDict[assetKey].writeTime = 0;
        mustSave = true;
    }
    if ( mustSave ) {
        cacheStorage.set({ assetCacheRegistry });
    }
}

/*******************************************************************************

    User assets are NOT persisted in the cache storage. User assets are
    recognized by the asset key which always starts with 'user-'.

    TODO(seamless migration):
    Can remove instances of old user asset keys when I am confident all users
    are using uBR v1.11 and beyond.

**/

/*******************************************************************************

    User assets are NOT persisted in the cache storage. User assets are
    recognized by the asset key which always starts with 'user-'.

**/

const readUserAsset = async function(assetKey: string): Promise<{ assetKey: string; content: string }> {
    const bin = await vAPI.storage.get(assetKey);
    const content =
        bin instanceof Object && typeof bin[assetKey] === 'string'
            ? bin[assetKey]
            : '';
    return { assetKey, content };
};

const saveUserAsset = function(assetKey: string, content: string): Promise<{ assetKey: string; content: string }> {
    return vAPI.storage.set({ [assetKey]: content }).then(( ) => {
        return { assetKey, content };
    });
};

/******************************************************************************/

assets.get = async function(assetKey: string, options: AssetGetOptions = {}): Promise<AssetGetResult> {
    if ( assetKey === µb.userFiltersPath ) {
        return readUserAsset(assetKey);
    }

    // https://github.com/uBlockOrigin/uBlock-issues/issues/3761
    if ( µb.readyToFilter !== true ) {
        if ( options.favorLocal === undefined ) {
            options.favorLocal = true;
        }
    }

    let assetDetails: { lastError?: string } = {};

    const reportBack = (content: string, url = '', err?: string): AssetGetResult => {
        const details: AssetGetResult = { assetKey, content };
        if ( err !== undefined ) {
            details.error = assetDetails.lastError = err;
        } else {
            assetDetails.lastError = undefined;
        }
        if ( options.needSourceURL ) {
            if (
                url === '' &&
                assetCacheRegistry instanceof Object &&
                assetCacheRegistry[assetKey] instanceof Object
            ) {
                details.sourceURL = assetCacheRegistry[assetKey].remoteURL;
            }
            if ( reIsExternalPath.test(url) ) {
                details.sourceURL = url;
            }
        }
        return details;
    };

    // Skip read-time property for non-updatable assets: the property is
    // completely unused for such assets and thus there is no point incurring
    // storage write overhead at launch when reading compiled or selfie assets.
    const updateReadTime = /^(?:compiled|selfie)\//.test(assetKey) === false;

    const details = await assetCacheRead(assetKey, updateReadTime);
    if ( details.content !== '' ) {
        return reportBack(details.content);
    }

    const assetRegistry = await getAssetSourceRegistry();

    assetDetails = assetRegistry[assetKey] || {};

    const contentURLs = getContentURLs(assetKey, options);
    if ( contentURLs.length === 0 && reIsExternalPath.test(assetKey) ) {
        assetDetails.content = 'filters';
        contentURLs.push(assetKey);
    }

    let error = 'ENOTFOUND';
    for ( const contentURL of contentURLs ) {
        ubolog(`Fetching ${contentURL} from remote server `);
        const details = assetDetails.content === 'filters'
            ? await assets.fetchFilterList(contentURL)
            : await assets.fetchText(contentURL);
        if ( details.error !== undefined ) {
            error = details.error;
        }
        if ( details.content === '' ) { continue; }
        if ( reIsExternalPath.test(contentURL) && options.dontCache !== true ) {
            assetCacheWrite(assetKey, details.content, {
                url: contentURL,
                silent: options.silent === true,
            });
            registerAssetSource(assetKey, { error: undefined });
            if ( assetDetails.content === 'filters' ) {
                const metadata = extractMetadataFromList(details.content, [
                    'Last-Modified',
                    'Expires',
                    'Diff-Name',
                    'Diff-Path',
                    'Diff-Expires',
                ]);
                metadata.diffUpdated = undefined;
                assetCacheSetDetails(assetKey, metadata);
            }
        }
        return reportBack(details.content, contentURL);
    }
    if ( assetRegistry[assetKey] !== undefined ) {
        registerAssetSource(assetKey, {
            error: { time: Date.now(), error }
        });
    }
    return reportBack('', '', error);
};

/******************************************************************************/

async function getRemote(assetKey: string, options: GetContentURLsOptions = {}): Promise<FetchResult> {
    const [
        assetDetails = {},
        cacheDetails = {},
    ] = await Promise.all([
        assetSourceGetDetails(assetKey),
        assetCacheGetDetails(assetKey),
    ]);

    let error: string | undefined;
    let stale = false;

    const reportBack = function(content: string, url = '', err = ''): FetchResult {
        const details: FetchResult = { assetKey, content, url };
        if ( err !== '' ) {
            details.error = (assetDetails as { lastError?: string }).lastError = err;
        } else {
            (assetDetails as { lastError?: string }).lastError = undefined;
        }
        return details;
    };

    for ( const contentURL of getContentURLs(assetKey, options) ) {
        if ( reIsExternalPath.test(contentURL) === false ) { continue; }

        const result = (assetDetails as AssetSourceEntry).content === 'filters'
            ? await assets.fetchFilterList(contentURL)
            : await assets.fetchText(contentURL);

        // Failure
        if ( stringIsNotEmpty(result.content) === false ) {
            error = result.statusText;
            if ( result.statusCode === 0 ) {
                error = 'network error';
            }
            continue;
        }

        error = undefined;

        // If fetched resource is older than cached one, ignore
        if ( options.favorOrigin !== true ) {
            stale = resourceIsStale(result, cacheDetails as { url: string; resourceTime?: number });
            if ( stale ) { continue; }
        }

        // Success
        assetCacheWrite(assetKey, result.content, {
            url: contentURL,
            resourceTime: result.resourceTime || 0,
        });

        if ( (assetDetails as AssetSourceEntry).content === 'filters' ) {
            const metadata = extractMetadataFromList(result.content, [
                'Last-Modified',
                'Expires',
                'Diff-Name',
                'Diff-Path',
                'Diff-Expires',
            ]);
            metadata.diffUpdated = undefined;
            assetCacheSetDetails(assetKey, metadata);
        }

        registerAssetSource(assetKey, { birthtime: undefined, error: undefined });
        return reportBack(result.content, contentURL);
    }

    if ( error !== undefined ) {
        registerAssetSource(assetKey, { error: { time: Date.now(), error } });
        return reportBack('', '', 'ENOTFOUND');
    }

    if ( stale ) {
        assetCacheSetDetails(assetKey, { writeTime: cacheDetails.resourceTime });
    }

    return reportBack('');
}

/******************************************************************************/

assets.put = async function(assetKey: string, content: string): Promise<{ assetKey: string; content: string }> {
    return reIsUserAsset.test(assetKey)
        ? await saveUserAsset(assetKey, content)
        : await assetCacheWrite(assetKey, content);
};

/******************************************************************************/

assets.toCache = async function(assetKey: string, content: string): Promise<{ assetKey: string; content: string }> {
    return assetCacheWrite(assetKey, content);
};

assets.fromCache = async function(assetKey: string): Promise<string | null> {
    const details = await assetCacheRead(assetKey);
    return details && details.content;
};

/******************************************************************************/

assets.metadata = async function(): Promise<Record<string, unknown>> {
    await Promise.all([
        getAssetSourceRegistry(),
        getAssetCacheRegistry(),
    ]);

    const assetDict = JSON.parse(JSON.stringify(assetSourceRegistry)) as Record<string, AssetSourceEntry>;
    const cacheDict = assetCacheRegistry;
    const now = Date.now();
    for ( const assetKey in assetDict ) {
        const assetEntry = assetDict[assetKey];
        const cacheEntry = cacheDict[assetKey];
        if (
            assetEntry.content === 'filters' &&
            assetEntry.external !== true
        ) {
            assetEntry.isDefault =
                assetEntry.off === undefined ||
                assetEntry.off === true &&
                    µb.listMatchesEnvironment(assetEntry);
        }
        if ( cacheEntry ) {
            assetEntry.cached = true;
            assetEntry.writeTime = cacheEntry.writeTime;
            const obsoleteAfter = cacheEntry.writeTime + getUpdateAfterTime(assetKey);
            assetEntry.obsolete = obsoleteAfter < now;
            assetEntry.remoteURL = cacheEntry.remoteURL;
            if ( cacheEntry.diffUpdated ) {
                assetEntry.diffUpdated = cacheEntry.diffUpdated;
            }
        } else if (
            assetEntry.contentURL &&
            assetEntry.contentURL.length !== 0
        ) {
            assetEntry.writeTime = 0;
            assetEntry.obsolete = true;
        }
    }

    return assetDict;
};

/******************************************************************************/

assets.purge = assetCacheMarkAsDirty;

assets.remove = function(...args: unknown[]): Promise<{ assetKey: string }[]> {
    return assetCacheRemove(...args as [string | RegExp, { janitor?: boolean }?]);
};

assets.rmrf = function(): Promise<{ assetKey: string }[]> {
    return assetCacheRemove(/./);
};

/******************************************************************************/

assets.getUpdateAges = async function(conditions: UpdateConditions = {}): Promise<{ assetKey: string; age: number; ageNormalized: number }[]> {
    const assetDict = await assets.metadata() as Record<string, AssetSourceEntry & { hasRemoteURL?: boolean; writeTime?: number }>;
    const now = Date.now();
    const out: { assetKey: string; age: number; ageNormalized: number }[] = [];
    for ( const [ assetKey, asset ] of Object.entries(assetDict) ) {
        if ( asset.hasRemoteURL !== true ) { continue; }
        const tokens = conditions[asset.content as string];
        if ( Array.isArray(tokens) === false ) { continue; }
        if ( tokens.includes('*') === false ) {
            if ( tokens.includes(assetKey) === false ) { continue; }
        }
        const age = now  - (asset.writeTime || 0);
        out.push({
            assetKey,
            age,
            ageNormalized: age / Math.max(1, getUpdateAfterTime(assetKey)),
        });
    }
    return out;
};

/******************************************************************************/

// Asset updater area.
const updaterAssetDelayDefault = 120000;
const updaterUpdated: string[] = [];
const updaterFetched = new Set<string>();

let updaterStatus: string | undefined;
let updaterAssetDelay = updaterAssetDelayDefault;
let updaterAuto = false;

const getAssetDiffDetails = (assetKey: string): AssetDiffDetails | undefined => {
    const out: AssetDiffDetails = { assetKey };
    const cacheEntry = assetCacheRegistry[assetKey];
    if ( cacheEntry === undefined ) { return; }
    out.patchPath = cacheEntry.diffPath;
    if ( out.patchPath === undefined ) { return; }
    const match = /#.+$/.exec(out.patchPath);
    if ( match !== null ) {
        out.diffName = match[0].slice(1);
    } else {
        out.diffName = cacheEntry.diffName;
    }
    if ( out.diffName === undefined ) { return; }
    out.diffExpires = getUpdateAfterTime(assetKey, true);
    out.lastModified = cacheEntry.lastModified;
    out.writeTime = cacheEntry.writeTime;
    const assetEntry = assetSourceRegistry[assetKey];
    if ( assetEntry === undefined ) { return; }
    if ( assetEntry.content !== 'filters' ) { return; }
    if ( Array.isArray(assetEntry.cdnURLs) ) {
        out.cdnURLs = assetEntry.cdnURLs.slice();
    } else if ( reIsExternalPath.test(assetKey) ) {
        out.cdnURLs = [ assetKey ];
    } else if ( typeof assetEntry.contentURL === 'string' ) {
        out.cdnURLs = [ assetEntry.contentURL ];
    } else if ( Array.isArray(assetEntry.contentURL) ) {
        out.cdnURLs = assetEntry.contentURL.slice(0).filter(url =>
            reIsExternalPath.test(url)
        );
    }
    if ( Array.isArray(out.cdnURLs) === false ) { return; }
    if ( out.cdnURLs.length === 0 ) { return; }
    if ( Array.isArray(assetEntry.patchURLs) ) {
        out.patchURLs = assetEntry.patchURLs.slice();
    }
    return out;
};

async function diffUpdater(): Promise<void> {
    return;
    if ( updaterAuto === false ) { return; }
    if ( µb.hiddenSettings.differentialUpdate === false ) { return; }
    const toUpdate = await getUpdateCandidates();
    const now = Date.now();
    const toHardUpdate: AssetDiffDetails[] = [];
    const toSoftUpdate: AssetDiffDetails[] = [];
    while ( toUpdate.length !== 0 ) {
        const assetKey = toUpdate.shift();
        const assetDetails = getAssetDiffDetails(assetKey);
        if ( assetDetails === undefined ) { continue; }
        assetDetails.what = 'update';
        const computedUpdateTime = computedPatchUpdateTime(assetKey);
        if ( computedUpdateTime !== 0 && computedUpdateTime <= now ) {
            assetDetails.fetch = true;
            toHardUpdate.push(assetDetails);
        } else {
            assetDetails.fetch = false;
            toSoftUpdate.push(assetDetails);
        }
    }
    if ( toHardUpdate.length === 0 ) { return; }
    ubolog('Diff updater: cycle start');
    return new Promise(resolve => {
        let pendingOps = 0;
        const terminate = (error?: string): void => {
            worker.terminate();
            resolve();
            if ( typeof error !== 'string' ) { return; }
            ubolog(`Diff updater: terminate because ${error}`);
        };
        const checkAndCorrectDiffPath = (data: { assetKey: string; text?: string; patchPath?: string }): void => {
            if ( typeof data.text !== 'string' ) { return; }
            if ( data.text === '' ) { return; }
            const metadata = extractMetadataFromList(data.text, [ 'Diff-Path' ]);
            if ( metadata instanceof Object === false ) { return; }
            if ( metadata.diffPath === data.patchPath ) { return; }
            assetCacheSetDetails(data.assetKey, metadata);
        };
        const worker = null as any;
        worker.onmessage = (ev: MessageEvent) => {
            const data = ev.data || {};
            if ( data.what === 'ready' ) {
                ubolog('Diff updater: hard updating', toHardUpdate.map(v => v.assetKey).join());
                while ( toHardUpdate.length !== 0 ) {
                    const assetDetails = toHardUpdate.shift();
                    assetDetails.fetch = true;
                    worker.postMessage(assetDetails);
                    pendingOps += 1;
                }
                return;
            }
            if ( data.what === 'broken' ) {
                terminate(data.error);
                return;
            }
            if ( data.status === 'needtext' ) {
                ubolog('Diff updater: need text for', data.assetKey);
                assetCacheRead(data.assetKey).then(result => {
                    // https://bugzilla.mozilla.org/show_bug.cgi?id=1929326#c9
                    //   Must never be set to undefined!
                    data.text = result.content || '';
                    data.status = undefined;
                    checkAndCorrectDiffPath(data);
                    worker.postMessage(data);
                });
                return;
            }
            if ( data.status === 'updated' ) {
                ubolog(`Diff updater: successfully patched ${data.assetKey} using ${data.patchURL} (${data.patchSize})`);
                const metadata = extractMetadataFromList(data.text, [
                    'Last-Modified',
                    'Expires',
                    'Diff-Name',
                    'Diff-Path',
                    'Diff-Expires',
                ]);
                assetCacheWrite(data.assetKey, data.text, {
                    resourceTime: metadata.lastModified || 0,
                });
                metadata.diffUpdated = true;
                assetCacheSetDetails(data.assetKey, metadata);
                updaterUpdated.push(data.assetKey);
            } else if ( data.error ) {
                ubolog(`Diff updater: failed to update ${data.assetKey} using ${data.patchPath}\n\treason: ${data.error}`);
            } else if ( data.status === 'nopatch-yet' || data.status === 'nodiff' ) {
                ubolog(`Diff updater: skip update of ${data.assetKey} using ${data.patchPath}\n\treason: ${data.status}`);
                assetCacheSetDetails(data.assetKey, { writeTime: data.writeTime });
                broadcast({
                    what: 'assetUpdated',
                    key: data.assetKey,
                    cached: true,
                });
            } else {
                ubolog(`Diff updater: ${data.assetKey} / ${data.patchPath} / ${data.status}`);
            }
            pendingOps -= 1;
            if ( pendingOps === 0 && toSoftUpdate.length !== 0 ) {
                ubolog('Diff updater: soft updating', toSoftUpdate.map(v => v.assetKey).join());
                while ( toSoftUpdate.length !== 0 ) {
                    worker.postMessage(toSoftUpdate.shift());
                    pendingOps += 1;
                }
            }
            if ( pendingOps !== 0 ) { return; }
            ubolog('Diff updater: cycle complete');
            terminate();
        };
    }).catch(reason => {
        console.warn(`[uBR] assets: Diff updater: ${reason}`);
    });
}

function updateFirst(): void {
    ubolog('Updater: cycle start');
    ubolog('Updater: prefer', updaterAuto ? 'CDNs' : 'origin');
    updaterStatus = 'updating';
    updaterFetched.clear();
    updaterUpdated.length = 0;
    diffUpdater().catch(reason => {
        console.warn('[uBR] assets: diffUpdater failed', reason);
    }).finally(( ) => {
        updateNext();
    });
}

async function getUpdateCandidates(): Promise<string[]> {
    const [ assetDict, cacheDict ] = await Promise.all([
        getAssetSourceRegistry(),
        getAssetCacheRegistry(),
    ]);
    const toUpdate: string[] = [];
    for ( const assetKey in assetDict ) {
        const assetEntry = assetDict[assetKey];
        if ( assetEntry.hasRemoteURL !== true ) { continue; }
        if ( updaterFetched.has(assetKey) ) { continue; }
        const cacheEntry = cacheDict[assetKey];
        if (
            fireNotification('before-asset-updated', {
                assetKey,
                type: assetEntry.content
            }) === true
        ) {
            toUpdate.push(assetKey);
            continue;
        }
        // This will remove a cached asset when it's no longer in use.
        if ( cacheEntry && cacheEntry.readTime < assetCacheRegistryStartTime ) {
            await assetCacheRemove(assetKey);
        }
    }
    // https://github.com/uBlockOrigin/uBlock-issues/issues/1165
    //   Update most obsolete asset first.
    toUpdate.sort((a, b) => {
        const ta = cacheDict[a] !== undefined ? cacheDict[a].writeTime : 0;
        const tb = cacheDict[b] !== undefined ? cacheDict[b].writeTime : 0;
        return ta - tb;
    });
    return toUpdate;
}

async function updateNext(): Promise<void> {
    const toUpdate = await getUpdateCandidates();
    const now = Date.now();
    const toHardUpdate: string[] = [];

    while ( toUpdate.length !== 0 ) {
        const assetKey = toUpdate.shift();
        const writeTime = getWriteTime(assetKey);
        const updateDelay = getUpdateAfterTime(assetKey);
        if ( (writeTime + updateDelay) > now ) { continue; }
        toHardUpdate.push(assetKey);
    }
    if ( toHardUpdate.length === 0 ) {
        return updateDone();
    }

    const assetKey = toHardUpdate.pop();
    updaterFetched.add(assetKey);

    // In auto-update context, be gentle on remote servers.
    remoteServerFriendly = updaterAuto;

    let result: FetchResult;
    if ( assetKey !== 'assets.json' || µb.hiddenSettings.debugAssetsJson !== true ) {
        result = await getRemote(assetKey, { favorOrigin: updaterAuto === false });
    } else {
        result = await assets.fetchText(µb.assetsJsonPath);
        result.assetKey = 'assets.json';
    }

    remoteServerFriendly = false;

    if ( result.error ) {
        ubolog(`Full updater: failed to update ${assetKey}`);
        fireNotification('asset-update-failed', { assetKey: result.assetKey });
    } else {
        ubolog(`Full updater: successfully updated ${assetKey}`);
        updaterUpdated.push(result.assetKey);
        if ( result.assetKey === 'assets.json' && result.content !== '' ) {
            updateAssetSourceRegistry(result.content);
        }
    }

    updaterTimer.on(updaterAssetDelay);
}

const updaterTimer = vAPI.defer.create(updateNext);

function updateDone(): void {
    const assetKeys = updaterUpdated.slice(0);
    updaterFetched.clear();
    updaterUpdated.length = 0;
    updaterStatus = undefined;
    updaterAuto = false;
    updaterAssetDelay = updaterAssetDelayDefault;
    ubolog('Updater: cycle end');
    if ( assetKeys.length ) {
        ubolog(`Updater: ${assetKeys.join()} were updated`);
    }
    fireNotification('after-assets-updated', { assetKeys });
}

assets.updateStart = function(details: { fetchDelay?: number; auto?: boolean }): void {
    if ( typeof details.fetchDelay === 'number' ) {
        updaterAssetDelay = details.fetchDelay;
    }
    if ( details.auto === true ) {
        updaterAuto = true;
    }
    if ( updaterStatus !== undefined ) { return; }
    updateFirst();
};

assets.updateStop = function(): void {
    updaterTimer.off();
    if ( updaterStatus !== undefined ) {
        updateDone();
    }
};

assets.isUpdating = function(): boolean {
    return updaterStatus === 'updating' &&
            updaterAssetDelay <= µb.hiddenSettings.manualUpdateAssetFetchPeriod;
};

/******************************************************************************/

export default assets;

/******************************************************************************/
