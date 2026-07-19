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

import * as fc from  './filtering-context.js';
import * as sfp from './static-filtering-parser.js';
import {
    sessionFirewall,
    sessionSwitches,
    sessionURLFiltering,
} from './filtering-engines.js';
import htmlFilteringEngine from './html-filtering.js';
import httpheaderFilteringEngine from './httpheader-filtering.js';
import { isNetworkURI } from './uri-utils.js';
import logger from './logger.js';
import scriptletFilteringEngine from './scriptlet-filtering.js';
import staticNetFilteringEngine from './static-net-filtering.js';
import textEncode from './text-encode.js';
import µb from './background.js';

const webRequestAPI =
    typeof (self as any).browser !== 'undefined' ? (self as any).browser.webRequest : (self as any).chrome?.webRequest;

interface WebRequestDetails {
    tabId: number;
    frameId: number;
    parentFrameId: number;
    url: string;
    type: string;
    requestId: string;
    requestHeaders?: Array<{ name: string; value: string }>;
    responseHeaders?: Array<{ name: string; value: string }>;
    fromCache?: boolean;
    statusCode?: number;
    aliasURL?: string;
    originUrl?: string;
    frameAncestors?: Array<{ url: string }>;
}

interface RedirectResult {
    redirectUrl?: string;
    cancel?: boolean;
    responseHeaders?: Array<{ name: string; value: string }>;
}

interface LogData {
    engine: string;
    result: number;
    raw: string;
    reason?: string;
    regex?: string;
}

interface FilteringContext {
    itype: number;
    MAIN_FRAME: number;
    SUB_FRAME: number;
    CSP_REPORT: number;
    url: string;
    tabId: number;
    redirectURL?: string;
    filter?: LogData | Array<LogData>;
    type: string;
    method: number;
    ipaddress?: boolean;
    tabOrigin: string;
}

interface PageStore {
    filterRequest: (fctxt: FilteringContext) => number;
    journalAddRequest: (fctxt: FilteringContext, result: number) => void;
    journalAddRootFrame: (type: string, url: string) => void;
    setFrameURL: (details: WebRequestDetails) => void;
    bindTabToPageStore: (tabId: number, phase: string) => PageStore | null;
    pageStoreFromTabId: (tabId: number) => PageStore | null;
    redirectNonBlockedRequest: (fctxt: FilteringContext) => void;
    skipMainDocument: (fctxt: FilteringContext, skip: boolean) => void;
    filterOnHeaders: (fctxt: FilteringContext, responseHeaders: Array<{ name: string; value: string }>, requestHeaders?: Array<{ name: string; value: string }>) => number;
    getNetFilteringSwitch: (fctxt?: FilteringContext) => boolean;
    filterScripting: (fctxt: FilteringContext, state: boolean) => number;
    filterLargeMediaElement: (fctxt: FilteringContext, headers: OnDemandHeaders) => number;
    allowLargeMediaElementsUntil: number;
    tabHostname: string;
}

const isGecko = vAPI.webextFlavor.isGecko;

const patchLocalRedirectURL = (url: string): string => url.charCodeAt(0) === 0x2F
    ? vAPI.getURL(url)
    : url;

function onBeforeRequest(details: WebRequestDetails): RedirectResult | undefined {
    const fctxt = µb.filteringContext.fromWebrequestDetails(details);

    if ( fctxt.itype === (fctxt as any).MAIN_FRAME ) {
        return onBeforeRootFrameRequest(fctxt as FilteringContext);
    }

    const tabId = details.tabId;
    if ( tabId < 0 ) {
        return onBeforeBehindTheSceneRequest(fctxt as FilteringContext);
    }

    let pageStore = µb.pageStoreFromTabId(tabId);
    if ( pageStore === null ) {
        const tabContext = µb.tabContextManager.mustLookup(tabId);
        if ( (tabContext as any).tabId < 0 ) {
            return onBeforeBehindTheSceneRequest(fctxt as FilteringContext);
        }
        vAPI.tabs.onNavigation({ tabId, frameId: 0, url: (tabContext as any).rawURL });
        pageStore = µb.pageStoreFromTabId(tabId);
    }

    const result = (pageStore as PageStore).filterRequest(fctxt as FilteringContext);

    (pageStore as PageStore).journalAddRequest(fctxt as FilteringContext, result);

    if ( logger.enabled ) {
        (fctxt as any).setRealm('network').toLogger();
    }

    if ( (fctxt as any).redirectURL !== undefined ) {
        return { redirectUrl: patchLocalRedirectURL((fctxt as any).redirectURL) };
    }

    if ( result === 1 ) {
        return { cancel: true };
    }

    if (
        (fctxt as any).itype === (fctxt as any).SUB_FRAME &&
        details.parentFrameId !== -1 &&
        details.aliasURL === undefined
    ) {
        (pageStore as PageStore).setFrameURL(details);
    }

    if ( result === 2 ) {
        return { cancel: false };
    }
}

function onBeforeRootFrameRequest(fctxt: FilteringContext): RedirectResult | undefined {
    const requestURL = (fctxt as any).url;

    const requestHostname = (fctxt as any).getHostname();
    let result = 0;
    let logData: LogData | undefined;

    const trusted = µb.getNetFilteringSwitch(requestURL) === false;
    if ( trusted ) {
        result = 2;
        if ( logger.enabled ) {
            logData = { engine: 'u', result: 2, raw: 'whitelisted' };
        }
    }

    if (
        result === 0 &&
        sessionSwitches.evaluateZ('no-strict-blocking', requestHostname)
    ) {
        result = 2;
        if ( logger.enabled ) {
            logData = {
                engine: 'u',
                result: 2,
                raw: `no-strict-blocking: ${sessionSwitches.z} true`
            };
        }
    }

    if ( result === 0 && strictBlockBypasser.isBypassed(requestHostname) ) {
        result = 2;
        if ( logger.enabled ) {
            logData = {
                engine: 'u',
                result: 2,
                raw: 'no-strict-blocking: true (temporary)'
            };
        }
    }

    if ( result === 0 ) {
        const shouldStrictBlockResult = shouldStrictBlock(fctxt, logger.enabled);
        result = shouldStrictBlockResult.result;
        logData = shouldStrictBlockResult.logData;
    }

    const pageStore = µb.bindTabToPageStore((fctxt as any).tabId, 'beforeRequest');
    if ( pageStore !== null ) {
        (pageStore as PageStore).journalAddRootFrame('uncommitted', requestURL);
        (pageStore as PageStore).journalAddRequest(fctxt, result);
    }

    if ( logger.enabled ) {
        (fctxt as any).setRealm('network').setFilter(logData);
    }

    if ( trusted === false && pageStore !== null ) {
        if ( result !== 1 ) {
            (pageStore as PageStore).redirectNonBlockedRequest(fctxt);
        } else {
            (pageStore as PageStore).skipMainDocument(fctxt, true);
        }
    }

    if ( logger.enabled ) {
        (fctxt as any).toLogger();
    }

    if ( (fctxt as any).redirectURL !== undefined ) {
        return { redirectUrl: patchLocalRedirectURL((fctxt as any).redirectURL) };
    }

    if ( result !== 1 ) { return; }

    if ( logData === undefined  ) { return; }

    let reason = logData.reason;

    (pageStore as PageStore).skipMainDocument(fctxt, false);

    if ( reason === undefined && Array.isArray((fctxt as any).filter) ) {
        const filter = (fctxt as any).filter.find((a: LogData) => a.reason !== undefined);
        reason = filter?.reason;
    }

    const query: Record<string, string> = {
        url: requestURL,
        dn: (fctxt as any).getDomain() || requestHostname,
        fs: logData.raw,
        hn: requestHostname,
        to: (fctxt as any).redirectURL || '',
    };
    if ( reason ) {
        query.reason = reason;
    }

    vAPI.tabs.replace(
        (fctxt as any).tabId,
        `${vAPI.getURL('document-blocked.html?details=')}${encodeURIComponent(JSON.stringify(query))}`
    );

    return { cancel: true };
}

function shouldStrictBlock(fctxt: FilteringContext, loggerEnabled: boolean): { result: number; logData: LogData | undefined } {
    const snfe = staticNetFilteringEngine;

    const rs = snfe.matchRequest(fctxt, 0b0011);
    const is = rs === 1 && snfe.isBlockImportant();
    let lds: LogData | undefined;
    if ( rs !== 0 || loggerEnabled ) {
        lds = snfe.toLogData();
    }

    if ( rs === 1 && is ) {
        return { result: rs, logData: lds };
    }

    (fctxt as any).type = 'no_type';
    let rg = snfe.matchRequest(fctxt, 0b0011);
    (fctxt as any).type = 'main_frame';
    const ig = rg === 1 && snfe.isBlockImportant();
    let ldg: LogData | undefined;
    if ( rg !== 0 || loggerEnabled ) {
        ldg = snfe.toLogData();
        if ( rg === 1 && validateStrictBlock(fctxt, ldg) === false ) {
            rg = 0; ldg = undefined;
        }
    }

    if ( rs === 0 || (rg === 1 && ig) || (rg === 2 && rs !== 2) ) {
        return { result: rg, logData: ldg };
    }

    return { result: rs, logData: lds };
}

function validateStrictBlock(fctxt: FilteringContext, logData: LogData | undefined): boolean {
    if ( typeof (logData as LogData)?.regex !== 'string' ) { return false; }
    if ( typeof (logData as LogData)?.raw === 'string' && /\w/.test((logData as LogData).raw) === false ) {
        return false;
    }
    const url = (fctxt as any).url;
    const re = new RegExp((logData as LogData).regex, 'i');
    const match = re.exec(url.toLowerCase());
    if ( match === null ) { return false; }

    const hostname = (fctxt as any).getHostname();
    const hnpos = url.indexOf(hostname);
    const hnlen = hostname.length;
    const end = match.index + match[0].length - hnpos - hnlen;
    return end === 0 || end === 1 ||
           end === 2 && url.charCodeAt(hnpos + hnlen) === 0x2E;
}

function onBeforeBehindTheSceneRequest(fctxt: FilteringContext): RedirectResult | undefined {
    const pageStore = µb.pageStoreFromTabId((fctxt as any).tabId);
    if ( pageStore === null ) { return; }

    let result = 0;

    if (
        ((fctxt as any).tabOrigin.endsWith('-scheme') === false &&
         isNetworkURI((fctxt as any).tabOrigin)) ||
        µb.userSettings.advancedUserEnabled ||
        (fctxt as any).itype === (fctxt as any).CSP_REPORT
    ) {
        result = (pageStore as PageStore).filterRequest(fctxt);

        if (
            result === 1 &&
            µb.getNetFilteringSwitch((fctxt as any).tabOrigin) === false
        ) {
            result = 2;
            (fctxt as any).redirectURL = undefined;
            (fctxt as any).filter = { engine: 'u', result: 2, raw: 'whitelisted' };
        }
    }

    (onBeforeBehindTheSceneRequest as any).journalAddRequest(fctxt, result);

    if ( logger.enabled ) {
        (fctxt as any).setRealm('network').toLogger();
    }

    if ( (fctxt as any).redirectURL !== undefined ) {
        return { redirectUrl: patchLocalRedirectURL((fctxt as any).redirectURL) };
    }

    if ( result === 1 ) {
        return { cancel: true };
    }
}

interface OnDemandHeaders {
    headers: Array<{ name: string; value: string }>;
    contentLength: number;
    contentType: string;
    setHeaders: (headers: Array<{ name: string; value: string }>) => void;
    reset: () => void;
}

{
    const pageStores = new Set<PageStore>();
    let hostname = '';
    let pageStoresToken = 0;

    const reset = function(): void {
        hostname = '';
        pageStores.clear();
        pageStoresToken = 0;
    };

    const gc = (): void => {
        if ( pageStoresToken !== (µb as any).pageStoresToken ) { return reset(); }
        (gcTimer as any).on(30011);
    };

    const gcTimer = vAPI.defer.create(gc);

    (onBeforeBehindTheSceneRequest as any).journalAddRequest = (fctxt: FilteringContext, result: number): void => {
        const docHostname = (fctxt as any).getDocHostname();
        if (
            docHostname !== hostname ||
            pageStoresToken !== (µb as any).pageStoresToken
        ) {
            hostname = docHostname;
            pageStores.clear();
            for ( const pageStore of (µb as any).pageStores.values() ) {
                if ( pageStore.tabHostname !== docHostname ) { continue; }
                pageStores.add(pageStore);
            }
            pageStoresToken = (µb as any).pageStoresToken;
            (gcTimer as any).offon(30011);
        }
        for ( const pageStore of pageStores ) {
            pageStore.journalAddRequest(fctxt, result);
        }
    };
}

function onHeadersReceived(details: WebRequestDetails): RedirectResult | undefined {

    const fctxt = µb.filteringContext.fromWebrequestDetails(details);
    const isRootDoc = (fctxt as any).itype === (fctxt as any).MAIN_FRAME;

    let pageStore = µb.pageStoreFromTabId((fctxt as any).tabId);
    if ( pageStore === null ) {
        if ( isRootDoc === false ) { return; }
        pageStore = µb.bindTabToPageStore((fctxt as any).tabId, 'beforeRequest');
    }
    if ( (pageStore as PageStore).getNetFilteringSwitch(fctxt as FilteringContext) === false ) { return; }

    if ( isRootDoc && (fctxt as any).ipaddress ) {
        const r = onBeforeRootFrameRequest(fctxt as FilteringContext);
        if ( r ) { return r; }
    }

    if ( ((fctxt as any).itype & foilLargeMediaElement.TYPE_BITS) !== 0 ) {
        const result = foilLargeMediaElement(details, fctxt as FilteringContext, pageStore as PageStore);
        if ( result !== undefined ) { return result; }
    }

    const { responseHeaders } = details;
    if ( Array.isArray(responseHeaders) === false ) { return; }

    if ( isRootDoc === false ) {
        const result = (pageStore as PageStore).filterOnHeaders(fctxt as FilteringContext,
            responseHeaders,
            requestHeadersManager.lookup(details)
        );
        if ( result !== 0 ) {
            if ( logger.enabled ) {
                (fctxt as any).setRealm('network').toLogger();
            }
            if ( result === 1 ) {
                (pageStore as PageStore).journalAddRequest(fctxt as FilteringContext, 1);
                return { cancel: true };
            }
        }
    }

    const mime = mimeFromHeaders(responseHeaders);

    if ( isRootDoc ) {
        if ( reMediaContentTypes.test(mime) ) {
            (pageStore as PageStore).allowLargeMediaElementsUntil = 0;
        }
    }

    if ( (bodyFilterer as any).canFilter(fctxt as FilteringContext, details) ) {
        const jobs: Array<{ fn: (session: any, ...args: any[]) => void; args: any[] }> = [];
        const replaceDirectives =
            staticNetFilteringEngine.matchAndFetchModifiers(fctxt as FilteringContext, 'replace');
        if ( replaceDirectives ) {
            jobs.push({
                fn: textResponseFilterer,
                args: [ replaceDirectives ],
            });
        }
        if ( mime === 'text/html' || mime === 'application/xhtml+xml' ) {
            const selectors = htmlFilteringEngine.retrieve(fctxt as FilteringContext);
            if ( selectors ) {
                jobs.push({
                    fn: htmlResponseFilterer,
                    args: [ selectors ],
                });
            }
        }
        if ( jobs.length !== 0 ) {
            (bodyFilterer as any).doFilter(details.requestId, fctxt as FilteringContext, jobs);
        }
    }

    let modifiedHeaders = false;
    if ( httpheaderFilteringEngine.apply(fctxt as FilteringContext, responseHeaders) === true ) {
        modifiedHeaders = true;
    }

    if ( (fctxt as any).isDocument() ) {
        if ( injectCSP(fctxt as FilteringContext, pageStore as PageStore, responseHeaders) === true ) {
            modifiedHeaders = true;
        }
        if ( injectPP(fctxt as FilteringContext, pageStore as PageStore, responseHeaders) === true ) {
            modifiedHeaders = true;
        }
    }

    if ( modifiedHeaders && isGecko ) {
        const cacheControl = (µb as any).hiddenSettings.cacheControlForFirefox1376932;
        if ( cacheControl !== 'unset' ) {
            const i = headerIndexFromName('cache-control', responseHeaders);
            if ( i !== -1 ) {
                responseHeaders[i].value = cacheControl;
            } else {
                responseHeaders.push({ name: 'Cache-Control', value: cacheControl });
            }
            modifiedHeaders = true;
        }
    }

    if ( modifiedHeaders ) {
        return { responseHeaders };
    }
}

const reMediaContentTypes = /^(?:audio|image|video)\/|(?:\/ogg)$/;

const mimeFromHeaders = (headers: Array<{ name: string; value: string }>): string => {
    if ( Array.isArray(headers) === false ) { return ''; }
    return mimeFromContentType(headerValueFromName('content-type', headers));
};

const mimeFromContentType = (contentType: string): string => {
    const match = reContentTypeMime.exec(contentType);
    if ( match === null ) { return ''; }
    return match[0].toLowerCase();
};

const reContentTypeMime = /^[^;]+/i;

interface DirectiveRef {
    refs?: {
        $cache?: {
            jsonp?: {
                apply?: (obj: unknown) => unknown;
                toJSON?: (obj: unknown) => string;
            } | null;
        } | null;
    };
    result: number;
    value: string;
}

interface CacheData {
    type: string;
    jsonp?: {
        apply: (obj: unknown) => unknown;
        toJSON: (obj: unknown) => string;
    };
    re?: RegExp;
    replacement?: string;
}

function textResponseFilterer(session: any, directives: DirectiveRef[]): void {
    const applied: DirectiveRef[] = [];
    for ( const directive of directives ) {
        if ( directive.refs instanceof Object === false ) { continue; }
        if ( directive.result !== 1 ) {
            applied.push(directive);
            continue;
        }
        const { refs } = directive;
        if ( refs.$cache !== null ) {
            const { jsonp } = refs.$cache;
            if ( jsonp && jsonp.apply === undefined ) {
                refs.$cache = null;
            }
        }
        if ( refs.$cache === null ) {
            refs.$cache = sfp.parseReplaceValue(refs.value);
        }
        const cache = refs.$cache as CacheData | undefined;
        if ( cache === undefined ) { continue; }
        switch ( cache.type ) {
        case 'json': {
            const json = session.getString();
            let obj: unknown;
            try { obj = JSON.parse(json); } catch(e) { console.warn('[uBR] traffic: json JSON.parse failed', e); break; }
            const objAfter = cache.jsonp!.apply(obj);
            if ( objAfter === undefined ) { break; }
            session.setString(cache.jsonp!.toJSON(objAfter));
            applied.push(directive);
            break;
        }
        case 'jsonl': {
            const linesBefore = session.getString().split(/\n+/);
            const linesAfter: string[] = [];
            for ( const lineBefore of linesBefore ) {
                let obj: unknown;
                try { obj = JSON.parse(lineBefore); } catch (e) { console.warn('[uBR] traffic: jsonl JSON.parse failed', e); }
                if ( typeof obj !== 'object' || obj === null ) {
                    linesAfter.push(lineBefore);
                    continue;
                }
                const objAfter = cache.jsonp!.apply(obj);
                if ( objAfter === undefined ) {
                    linesAfter.push(lineBefore);
                    continue;
                }
                linesAfter.push(cache.jsonp!.toJSON(objAfter));
            }
            session.setString(linesAfter.join('\n'));
            break;
        }
        case 'text': {
            cache.re!.lastIndex = 0;
            if ( cache.re!.test(session.getString()) !== true ) { break; }
            cache.re!.lastIndex = 0;
            session.setString(session.getString().replace(
                cache.re!,
                cache.replacement!
            ));
            applied.push(directive);
            break;
        }
        default:
            break;
        }
    }
    if ( applied.length === 0 ) { return; }
    if ( logger.enabled !== true ) { return; }
    session.setRealm('network')
         .pushFilters(applied.map((a: DirectiveRef) => (a as any).logData()))
         .toLogger();
}

function htmlResponseFilterer(session: any, selectors: any): void {
    if ( (htmlResponseFilterer as any).domParser === null ) {
        (htmlResponseFilterer as any).domParser = new DOMParser();
        (htmlResponseFilterer as any).xmlSerializer = new XMLSerializer();
    }

    const doc = (htmlResponseFilterer as any).domParser.parseFromString(
        session.getString(),
        session.mime
    );

    if ( selectors === undefined ) { return; }
    if ( htmlFilteringEngine.apply(doc, session, selectors) !== true ) { return; }

    const doctypeStr = [
        doc.doctype instanceof Object ?
            `${(htmlResponseFilterer as any).xmlSerializer.serializeToString(doc.doctype)  }\n` :
            '',
        doc.documentElement.outerHTML,
    ].join('\n');
    session.setString(doctypeStr);
}
(htmlResponseFilterer as any).domParser = null;
(htmlResponseFilterer as any).xmlSerializer = null;

const bodyFilterer = (() => {
    const sessions = new Map<any, any>();
    const reContentTypeCharset = /charset=['"]?([^'" ]+)/i;
    const otherValidMimes = new Set([
        'application/dash+xml',
        'application/javascript',
        'application/json',
        'application/mpegurl',
        'application/vnd.api+json',
        'application/vnd.apple.mpegurl',
        'application/vnd.apple.mpegurl.audio',
        'application/x-javascript',
        'application/x-mpegurl',
        'application/xhtml+xml',
        'application/xml',
        'audio/mpegurl',
        'audio/x-mpegurl',
    ]);
    const BINARY_TYPES = fc.FONT | fc.IMAGE | fc.MEDIA | fc.WEBSOCKET;
    const MAX_RESPONSE_BUFFER_LENGTH = 10 * 1024 * 1024;

    let textDecoder: TextDecoder | undefined;
    let textEncoder: TextEncoder | undefined;
    let mime = '';
    let charset = '';

    const contentTypeFromDetails = (details: WebRequestDetails): string => {
        switch ( details.type ) {
        case 'script':
            return 'text/javascript; charset=utf-8';
        case 'stylesheet':
            return 'text/css';
        default:
            break;
        }
        return '';
    };

    const charsetFromContentType = (contentType: string): string | undefined => {
        const match = reContentTypeCharset.exec(contentType);
        if ( match === null ) { return; }
        return match[1].toLowerCase();
    };

    const charsetFromMime = (mimeVal: string): string | undefined => {
        switch ( mimeVal ) {
        case 'application/xml':
        case 'application/xhtml+xml':
        case 'text/html':
        case 'text/css':
            return;
        default:
            break;
        }
        return 'utf-8';
    };

    const charsetFromStream = (bytes: Uint8Array): string | undefined => {
        const len = bytes.length;
        if ( len < 3 ) { return; }
        if ( bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF ) {
            return 'utf-8';
        }
        const limit = Math.min(len - 7, 65536);
        let i = -1;
        while ( i < limit ) {
            i += 1;
            if ( bytes[i+0] !== 0x63 ) { continue; }
            if ( bytes[i+1] !== 0x68 ) { continue; }
            if ( bytes[i+2] !== 0x61 ) { continue; }
            if ( bytes[i+3] !== 0x72 ) { continue; }
            if ( bytes[i+4] !== 0x73 ) { continue; }
            if ( bytes[i+5] !== 0x65 ) { continue; }
            if ( bytes[i+6] !== 0x74 ) { continue; }
            break;
        }
        if ( i >= limit || (i + 48) > len ) { return; }
        i += 8;
        let j = -1;
        while ( j < 8 ) {
            j += 1;
            if ( i + j >= len ) { return; }
            const c = bytes[i+j];
            if ( c >= 0x41 && c <= 0x5A ) { break; }
            if ( c >= 0x61 && c <= 0x7A ) { break; }
        }
        if ( j === 8 ) { return; }
        i += j;
        const chars: number[] = [];
        j = 0;
        while ( j < 24 ) {
            if ( i + j >= len ) { break; }
            const c = bytes[i+j];
            if ( c < 0x2D ) { break; }
            if ( c > 0x2D && c < 0x30 ) { break; }
            if ( c > 0x39 && c < 0x41 ) { break; }
            if ( c > 0x5A && c < 0x61 ) { break; }
            if ( c > 0x7A ) { break; }
            chars.push(c);
            j += 1;
        }
        if ( j >= 20 ) { return; }
        return String.fromCharCode(...chars).toLowerCase();
    };

    const streamClose = (session: any, buffer?: Uint8Array): void => {
        if ( buffer !== undefined ) {
            session.stream.write(buffer);
        } else if ( session.buffer !== undefined ) {
            session.stream.write(session.buffer);
        }
        session.stream.close();
    };

    const onStreamData = function(this: any, ev: { data: ArrayBuffer }): void {
        const session = sessions.get(this);
        if ( session === undefined ) {
            this.write(ev.data);
            this.disconnect();
            return;
        }
        if ( this.status !== 'transferringdata' ) {
            if ( this.status !== 'finishedtransferringdata' ) {
                sessions.delete(this);
                this.disconnect();
                return;
            }
        }
        if ( session.buffer === null ) {
            session.buffer = new Uint8Array(ev.data);
            return;
        }
        const buffer = new Uint8Array(
            session.buffer.byteLength + ev.data.byteLength
        );
        buffer.set(session.buffer);
        buffer.set(new Uint8Array(ev.data), session.buffer.byteLength);
        session.buffer = buffer;
        if ( session.buffer.length >= MAX_RESPONSE_BUFFER_LENGTH ) {
            sessions.delete(this);
            this.write(session.buffer);
            this.disconnect();
        }
    };

    const onStreamStop = function(this: any): void {
        const session = sessions.get(this);
        sessions.delete(this);
        if ( session === undefined || session.buffer === null ) {
            this.close();
            return;
        }
        if ( this.status !== 'finishedtransferringdata' ) { return; }

        if ( session.charset === undefined ) {
            const charsetFound = charsetFromStream(session.buffer);
            if ( charsetFound !== undefined ) {
                const charsetUsed = textEncode.normalizeCharset(charsetFound);
                if ( charsetUsed === undefined ) { return streamClose(session); }
                session.charset = charsetUsed;
            } else {
                session.charset = 'utf-8';
            }
        }

        while ( session.jobs.length !== 0 ) {
            const job = session.jobs.shift();
            job.fn(session, ...job.args);
        }
        if ( session.modified !== true ) { return streamClose(session); }

        if ( textEncoder === undefined ) {
            textEncoder = new TextEncoder();
        }
        let encodedStream = textEncoder.encode(session.str);

        if ( session.charset !== 'utf-8' ) {
            encodedStream = textEncode.encode(session.charset, encodedStream);
        }

        streamClose(session, encodedStream);
    };

    const onStreamError = function(this: any): void {
        sessions.delete(this);
    };

    return class Session extends (µb as any).FilteringContext {
        stream: any;
        buffer: Uint8Array | null;
        mime: string;
        charset: string;
        str: string | null;
        modified: boolean;
        jobs: Array<{ fn: (session: any, ...args: any[]) => void; args: any[] }>;

        constructor(fctxt: FilteringContext, mimeVal: string, charsetVal: string, jobs: Array<{ fn: (session: any, ...args: any[]) => void; args: any[] }>) {
            super(fctxt);
            this.stream = null;
            this.buffer = null;
            this.mime = mimeVal;
            this.charset = charsetVal;
            this.str = null;
            this.modified = false;
            this.jobs = jobs;
        }
        getString(): string {
            if ( this.str !== null ) { return this.str; }
            if ( textDecoder !== undefined ) {
                if ( textDecoder.encoding !== this.charset ) {
                    textDecoder = undefined;
                }
            }
            if ( textDecoder === undefined ) {
                textDecoder = new TextDecoder(this.charset);
            }
            this.str = textDecoder.decode(this.buffer);
            return this.str;
        }
        setString(s: string): void {
            this.str = s;
            this.modified = true;
        }
        static doFilter(requestId: string, fctxt: FilteringContext, jobs: Array<{ fn: (session: any, ...args: any[]) => void; args: any[] }>): void {
            if ( jobs.length === 0 ) { return; }
            const session = new Session(fctxt, mime, charset, jobs);
            session.stream = webRequestAPI?.filterResponseData(requestId);
            session.stream.ondata = onStreamData;
            session.stream.onstop = onStreamStop;
            session.stream.onerror = onStreamError;
            sessions.set(session.stream, session);
        }
        static canFilter(fctxt: FilteringContext, details: WebRequestDetails): boolean | undefined {
            if ( (µb as any).canFilterResponseData !== true ) { return; }

            if ( ((fctxt as any).itype & BINARY_TYPES) !== 0 ) { return; }

            if ( (fctxt as any).method !== fc.METHOD_GET ) {
                if ( (fctxt as any).method !== fc.METHOD_POST ) {
                    return;
                }
            }

            const statusCode = details.statusCode || 0;
            if ( statusCode === 0 ) { return; }

            const hostname = (fctxt as any).getHostname();
            if ( hostname === '' ) { return; }

            const headers = details.responseHeaders;
            const disposition = headerValueFromName('content-disposition', headers);
            if ( disposition !== '' ) {
                if ( disposition.startsWith('inline') === false ) { return; }
            }

            mime = 'text/plain';
            charset = 'utf-8';
            const contentType = headerValueFromName('content-type', headers) ||
                contentTypeFromDetails(details);
            if ( contentType !== '' ) {
                mime = mimeFromContentType(contentType);
                if ( mime === '' ) { return; }
                if ( mime.startsWith('text/') === false ) {
                    if ( otherValidMimes.has(mime) === false ) { return; }
                }
                charset = charsetFromContentType(contentType);
                if ( charset !== undefined ) {
                    charset = textEncode.normalizeCharset(charset);
                    if ( charset === undefined ) { return; }
                } else {
                    charset = charsetFromMime(mime);
                }
            }

            return true;
        }
    };
})();

function injectCSP(fctxt: FilteringContext, pageStore: PageStore, responseHeaders: Array<{ name: string; value: string }>): boolean | undefined {
    const cspSubsets: string[] = [];
    const requestType = (fctxt as any).type;

    const builtinDirectives: string[] = [];

    if ( (pageStore as PageStore).filterScripting(fctxt, true) === 1 ) {
        builtinDirectives.push((µb as any).hiddenSettings.noScriptingCSP);
        if ( logger.enabled ) {
            (fctxt as any).setRealm('network').setType('scripting').toLogger();
        }
    }
    else {
        const fctxt2 = (fctxt as any).duplicate();
        fctxt2.type = 'inline-script';
        fctxt2.setDocOriginFromURL((fctxt as any).url);
        const result = (pageStore as PageStore).filterRequest(fctxt2);
        if ( result === 1 ) {
            builtinDirectives.push((µb as any).cspNoInlineScript);
        }
        if ( result === 2 && logger.enabled ) {
            fctxt2.setRealm('network').toLogger();
        }
    }

    try {
        (fctxt as any).type = 'inline-font';
        if ( (pageStore as PageStore).filterRequest(fctxt) === 1 ) {
            builtinDirectives.push((µb as any).cspNoInlineFont);
            if ( logger.enabled ) {
                (fctxt as any).setRealm('network').toLogger();
            }
        }
    } finally {
        (fctxt as any).type = requestType;
    }

    if ( builtinDirectives.length !== 0 ) {
        cspSubsets[0] = builtinDirectives.join(', ');
    }

    const staticDirectives = staticNetFilteringEngine.matchAndFetchModifiers(fctxt, 'csp');
    if ( staticDirectives !== undefined ) {
        for ( const directive of staticDirectives ) {
            if ( directive.result !== 1 ) { continue; }
            cspSubsets.push(directive.value);
        }
    }

    if (
        cspSubsets.length !== 0 &&
        sessionURLFiltering.evaluateZ(
            (fctxt as any).getTabHostname(),
            (fctxt as any).url,
            'csp'
        ) === 2
    ) {
        if ( logger.enabled ) {
            (fctxt as any).setRealm('network')
                 .setType('csp')
                 .setFilter(sessionURLFiltering.toLogData())
                 .toLogger();
        }
        return;
    }

    if (
        cspSubsets.length !== 0 &&
        (µb as any).userSettings.advancedUserEnabled &&
        sessionFirewall.evaluateCellZY(
            (fctxt as any).getTabHostname(),
            (fctxt as any).getTabHostname(),
            '*'
        ) === 2
    ) {
        if ( logger.enabled ) {
            (fctxt as any).setRealm('network')
                 .setType('csp')
                 .setFilter(sessionFirewall.toLogData())
                 .toLogger();
        }
        return;
    }

    if ( logger.enabled && staticDirectives !== undefined ) {
        (fctxt as any).setRealm('network')
             .pushFilters(staticDirectives.map((a: any) => a.logData()))
             .toLogger();
    }

    if ( cspSubsets.length === 0 ) { return; }

    µb.updateToolbarIcon((fctxt as any).tabId, 0b0010);

    responseHeaders.push({
        name: 'Content-Security-Policy',
        value: cspSubsets.join(', ')
    });

    return true;
}

function injectPP(fctxt: FilteringContext, pageStore: PageStore, responseHeaders: Array<{ name: string; value: string }>): boolean | undefined {
    const permissions: string[] = [];
    const directives = staticNetFilteringEngine.matchAndFetchModifiers(fctxt, 'permissions');
    if ( directives !== undefined ) {
        for ( const directive of directives ) {
            if ( directive.result !== 1 ) { continue; }
            permissions.push(directive.value.replace('|', ', '));
        }
    }

    if ( logger.enabled && directives !== undefined ) {
        (fctxt as any).setRealm('network')
             .pushFilters(directives.map((a: any) => a.logData()))
             .toLogger();
    }

    if ( permissions.length === 0 ) { return; }

    µb.updateToolbarIcon((fctxt as any).tabId, 0x02);

    responseHeaders.push({
        name: 'permissions-policy',
        value: permissions.join(', ')
    });

    return true;
}

function foilLargeMediaElement(details: WebRequestDetails, fctxt: FilteringContext, pageStore: PageStore): RedirectResult | undefined {
    if ( details.fromCache === true ) { return; }

    onDemandHeaders.setHeaders(details.responseHeaders || []);

    const result = (pageStore as PageStore).filterLargeMediaElement(fctxt, onDemandHeaders as OnDemandHeaders);

    onDemandHeaders.reset();

    if ( result === 0 ) { return; }

    if ( logger.enabled ) {
        (fctxt as any).setRealm('network').toLogger();
    }

    return { cancel: true };
}

foilLargeMediaElement.TYPE_BITS = fc.IMAGE | fc.MEDIA | fc.XMLHTTPREQUEST;

const headerIndexFromName = function(headerName: string, headers: Array<{ name: string; value: string }>): number {
    for ( let i = 0, n = headers.length; i < n; i++ ) {
        if ( headers[i].name.toLowerCase() === headerName ) { return i; }
    }
    return -1;
};

const headerValueFromName = function(headerName: string, headers: Array<{ name: string; value: string }>): string {
    const i = headerIndexFromName(headerName, headers);
    return i !== -1 ? headers[i].value : '';
};

const onDemandHeaders: OnDemandHeaders = {
    headers: [],
    get contentLength(): number {
        const contentLength = headerValueFromName('content-length', this.headers);
        if ( contentLength === '' ) { return Number.NaN; }
        return parseInt(contentLength, 10) || 0;
    },
    get contentType(): string {
        return headerValueFromName('content-type', this.headers);
    },
    setHeaders(headers: Array<{ name: string; value: string }>): void {
        this.headers = headers;
    },
    reset(): void {
        this.headers = [];
    }
};

const strictBlockBypasser = {
    hostnameToDeadlineMap: new Map<string, number>(),
    cleanupTimer: vAPI.defer.create(() => {
        strictBlockBypasser.cleanup();
    }),

    cleanup: function(): void {
        for ( const [ hostname, deadline ] of this.hostnameToDeadlineMap ) {
            if ( deadline <= Date.now() ) {
                this.hostnameToDeadlineMap.delete(hostname);
            }
        }
    },

    revokeTime: function(): number {
        return Date.now() + (µb as any).hiddenSettings.strictBlockingBypassDuration * 1000;
    },

    bypass: function(hostname: string): void {
        if ( typeof hostname !== 'string' || hostname === '' ) { return; }
        this.hostnameToDeadlineMap.set(hostname, this.revokeTime());
    },

    isBypassed: function(hostname: string): boolean {
        if ( this.hostnameToDeadlineMap.size === 0 ) { return false; }
        this.cleanupTimer.on({ sec: (µb as any).hiddenSettings.strictBlockingBypassDuration + 10 });
        for (;;) {
            const deadline = this.hostnameToDeadlineMap.get(hostname);
            if ( deadline !== undefined ) {
                if ( deadline > Date.now() ) {
                    this.hostnameToDeadlineMap.set(hostname, this.revokeTime());
                    return true;
                }
                this.hostnameToDeadlineMap.delete(hostname);
            }
            const pos = hostname.indexOf('.');
            if ( pos === -1 ) { break; }
            hostname = hostname.slice(pos + 1);
        }
        return false;
    }
};

function onResponseStarted(details: WebRequestDetails): void {
    if ( details.tabId === -1 ) { return; }
    const pageStore = µb.pageStoreFromTabId(details.tabId);
    if ( pageStore === null ) { return; }
    if ( (pageStore as PageStore).getNetFilteringSwitch() === false ) { return; }
    if ( isGecko === false && details.type === 'main_frame' ) {
        const fctxt = µb.filteringContext.fromWebrequestDetails(details);
        const r = onBeforeRootFrameRequest(fctxt as FilteringContext);
        if ( r?.cancel ) { return; }
    }
    details.ancestors = (pageStore as PageStore).getFrameAncestorDetails(details.frameId);
    scriptletFilteringEngine.injectNow(details);
}

onResponseStarted.start = function(): void {
    webRequestAPI?.onResponseStarted.addListener(onResponseStarted, {
        types: [ 'main_frame', 'sub_frame' ],
        urls: [ 'http://*/*', 'https://*/*' ]
    });
};

const requestHeadersManager = {
    requests: new Map<string, Array<{ name: string; value: string }>>(),
    start(): void {
        const extraInfoSpec = [ 'requestHeaders' ];
        if ( isGecko !== true ) {
            extraInfoSpec.push('extraHeaders');
        }
        webRequestAPI?.onSendHeaders.addListener((details: WebRequestDetails) => {
            this.requests.set(details.requestId, details.requestHeaders || []);
        }, {
            urls: [ 'http://*/*', 'https://*/*' ]
        }, extraInfoSpec);
        webRequestAPI?.onBeforeRedirect.addListener((details: WebRequestDetails) => {
            this.requests.delete(details.requestId);
        }, {
            urls: [ 'http://*/*', 'https://*/*' ]
        });
        webRequestAPI?.onCompleted.addListener((details: WebRequestDetails) => {
            this.requests.delete(details.requestId);
        }, {
            urls: [ 'http://*/*', 'https://*/*' ]
        });
        webRequestAPI?.onErrorOccurred.addListener((details: WebRequestDetails) => {
            this.requests.delete(details.requestId);
        }, {
            urls: [ 'http://*/*', 'https://*/*' ]
        });
    },
    lookup(details: WebRequestDetails): Array<{ name: string; value: string }> {
        return this.requests.get(details.requestId) || [];
    }
};

const webRequest = {
    onBeforeRequest,

    start: (() => {
        if ( typeof vAPI.Net !== 'function' ) {
            return () => {};
        }
        vAPI.net = new vAPI.Net();
        if ( vAPI.Net?.canSuspend?.() ) {
            vAPI.net.suspend();
        }

        return () => {
            vAPI.net.setSuspendableListener(onBeforeRequest);
            vAPI.net.addListener('onHeadersReceived', onHeadersReceived, {
                urls: [ 'http://*/*', 'https://*/*' ]
            }, [ 'blocking', 'responseHeaders' ]);
            onResponseStarted.start();
            requestHeadersManager.start();
            vAPI.defer.once({ sec: (µb as any).hiddenSettings.toolbarWarningTimeout }).then(() => {
                if ( vAPI.net.hasUnprocessedRequest() === false ) { return; }
                vAPI.net.removeUnprocessedRequest();
                return vAPI.tabs.getCurrent();
            }).then((tab: any) => {
                if ( tab instanceof Object === false ) { return; }
                µb.updateToolbarIcon(tab.id, 0b0110);
            });
            vAPI.net.unsuspend({ all: true });
        };
    })(),

    strictBlockBypass: (hostname: string): void => {
        strictBlockBypasser.bypass(hostname);
    },
};

export default webRequest;
