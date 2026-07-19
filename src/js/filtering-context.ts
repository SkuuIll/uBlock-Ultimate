/*******************************************************************************

    uBlock Ultimate - a comprehensive, efficient content blocker
    Copyright (C) 2018-present Raymond Hill

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

import {
    domainFromHostname,
    hostnameFromURI,
    originFromURI,
} from './uri-utils.js';

/******************************************************************************/

// https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/webRequest/ResourceType

// Long term, convert code wherever possible to work with integer-based type
// values -- the assumption being that integer operations are faster than
// string operations.

export const enum ResourceType {
    NO_TYPE = 0,
    BEACON = 1 << 0,
    CSP_REPORT = 1 << 1,
    FONT = 1 << 2,
    IMAGE = 1 << 4,
    IMAGESET = 1 << 4,
    MAIN_FRAME = 1 << 5,
    MEDIA = 1 << 6,
    OBJECT = 1 << 7,
    OBJECT_SUBREQUEST = 1 << 7,
    PING = 1 << 8,
    SCRIPT = 1 << 9,
    STYLESHEET = 1 << 10,
    SUB_FRAME = 1 << 11,
    WEBSOCKET = 1 << 12,
    XMLHTTPREQUEST = 1 << 13,
    INLINE_FONT = 1 << 14,
    INLINE_SCRIPT = 1 << 15,
    OTHER = 1 << 16,
}

export const FRAME_ANY = ResourceType.MAIN_FRAME | ResourceType.SUB_FRAME | ResourceType.OBJECT;
export const FONT_ANY = ResourceType.FONT | ResourceType.INLINE_FONT;
export const INLINE_ANY = ResourceType.INLINE_FONT | ResourceType.INLINE_SCRIPT;
export const PING_ANY = ResourceType.BEACON | ResourceType.CSP_REPORT | ResourceType.PING;
export const SCRIPT_ANY = ResourceType.SCRIPT | ResourceType.INLINE_SCRIPT;

export const FONT = ResourceType.FONT;
export const IMAGE = ResourceType.IMAGE;
export const MEDIA = ResourceType.MEDIA;
export const WEBSOCKET = ResourceType.WEBSOCKET;
export const XMLHTTPREQUEST = ResourceType.XMLHTTPREQUEST;
export const METHOD_GET = 1 << 3;
export const METHOD_POST = 1 << 7;

const typeStrToIntMap: Record<string, ResourceType> = {
    'no_type': ResourceType.NO_TYPE,
    'beacon': ResourceType.BEACON,
    'csp_report': ResourceType.CSP_REPORT,
    'font': ResourceType.FONT,
    'image': ResourceType.IMAGE,
    'imageset': ResourceType.IMAGESET,
    'main_frame': ResourceType.MAIN_FRAME,
    'media': ResourceType.MEDIA,
    'object': ResourceType.OBJECT,
    'object_subrequest': ResourceType.OBJECT_SUBREQUEST,
    'ping': ResourceType.PING,
    'script': ResourceType.SCRIPT,
    'stylesheet': ResourceType.STYLESHEET,
    'sub_frame': ResourceType.SUB_FRAME,
    'websocket': ResourceType.WEBSOCKET,
    'xmlhttprequest': ResourceType.XMLHTTPREQUEST,
    'inline-font': ResourceType.INLINE_FONT,
    'inline-script': ResourceType.INLINE_SCRIPT,
    'other': ResourceType.OTHER,
};

export const enum HttpMethod {
    NONE = 0,
    CONNECT = 1 << 1,
    DELETE = 1 << 2,
    GET = 1 << 3,
    HEAD = 1 << 4,
    OPTIONS = 1 << 5,
    PATCH = 1 << 6,
    POST = 1 << 7,
    PUT = 1 << 8,
}

const methodStrToBitMap: Record<string, HttpMethod> = {
    '': HttpMethod.NONE,
    'connect': HttpMethod.CONNECT,
    'delete': HttpMethod.DELETE,
    'get': HttpMethod.GET,
    'head': HttpMethod.HEAD,
    'options': HttpMethod.OPTIONS,
    'patch': HttpMethod.PATCH,
    'post': HttpMethod.POST,
    'put': HttpMethod.PUT,
    'CONNECT': HttpMethod.CONNECT,
    'DELETE': HttpMethod.DELETE,
    'GET': HttpMethod.GET,
    'HEAD': HttpMethod.HEAD,
    'OPTIONS': HttpMethod.OPTIONS,
    'PATCH': HttpMethod.PATCH,
    'POST': HttpMethod.POST,
    'PUT': HttpMethod.PUT,
};

const methodBitToStrMap = new Map<HttpMethod, string>([
    [ HttpMethod.NONE, '' ],
    [ HttpMethod.CONNECT, 'connect' ],
    [ HttpMethod.DELETE, 'delete' ],
    [ HttpMethod.GET, 'get' ],
    [ HttpMethod.HEAD, 'head' ],
    [ HttpMethod.OPTIONS, 'options' ],
    [ HttpMethod.PATCH, 'patch' ],
    [ HttpMethod.POST, 'post' ],
    [ HttpMethod.PUT, 'put' ],
]);

const reIPv4 = /^\d+\.\d+\.\d+\.\d+$/;

/******************************************************************************/

interface FilteringContextDetails {
    originURL?: string;
    url?: string;
    type?: string;
}

type Filter = unknown;

export class FilteringContext {
    tstamp: number = 0;
    realm: string = '';
    method: HttpMethod = 0;
    itype: ResourceType = ResourceType.NO_TYPE;
    stype: string | undefined = undefined;
    url: string | undefined = undefined;
    aliasURL: string | undefined = undefined;
    hostname: string | undefined = undefined;
    domain: string | undefined = undefined;
    ipaddress: string | undefined = undefined;
    docId: number = -1;
    frameId: number = -1;
    docOrigin: string | undefined = undefined;
    docHostname: string | undefined = undefined;
    docDomain: string | undefined = undefined;
    tabId: number | undefined = undefined;
    tabOrigin: string | undefined = undefined;
    tabHostname: string | undefined = undefined;
    tabDomain: string | undefined = undefined;
    redirectURL: string | undefined = undefined;
    filter: Filter | undefined = undefined;

    constructor(other?: FilteringContext) {
        if ( other instanceof FilteringContext ) {
            return this.fromFilteringContext(other);
        }
        this.tstamp = 0;
        this.realm = '';
        this.method = 0;
        this.itype = ResourceType.NO_TYPE;
        this.stype = undefined;
        this.url = undefined;
        this.aliasURL = undefined;
        this.hostname = undefined;
        this.domain = undefined;
        this.ipaddress = undefined;
        this.docId = -1;
        this.frameId = -1;
        this.docOrigin = undefined;
        this.docHostname = undefined;
        this.docDomain = undefined;
        this.tabId = undefined;
        this.tabOrigin = undefined;
        this.tabHostname = undefined;
        this.tabDomain = undefined;
        this.redirectURL = undefined;
        this.filter = undefined;
    }

    get type(): string | undefined {
        return this.stype;
    }

    set type(a: string) {
        this.itype = typeStrToIntMap[a] || ResourceType.NO_TYPE;
        this.stype = a;
    }

    isRootDocument(): boolean {
        return (this.itype & ResourceType.MAIN_FRAME) !== 0;
    }

    isDocument(): boolean {
        return (this.itype & FRAME_ANY) !== 0;
    }

    isFont(): boolean {
        return (this.itype & FONT_ANY) !== 0;
    }

    fromFilteringContext(other: FilteringContext): this {
        this.realm = other.realm;
        this.type = other.type;
        this.method = other.method;
        this.url = other.url;
        this.hostname = other.hostname;
        this.domain = other.domain;
        this.ipaddress = other.ipaddress;
        this.docId = other.docId;
        this.frameId = other.frameId;
        this.docOrigin = other.docOrigin;
        this.docHostname = other.docHostname;
        this.docDomain = other.docDomain;
        this.tabId = other.tabId;
        this.tabOrigin = other.tabOrigin;
        this.tabHostname = other.tabHostname;
        this.tabDomain = other.tabDomain;
        this.redirectURL = other.redirectURL;
        this.aliasURL = other.aliasURL;
        this.filter = undefined;
        return this;
    }

    fromDetails({ originURL, url, type }: FilteringContextDetails): this {
        this.setDocOriginFromURL(originURL)
            .setURL(url)
            .setType(type);
        return this;
    }

    duplicate(): FilteringContext {
        return new FilteringContext(this);
    }

    setRealm(a: string): this {
        this.realm = a;
        return this;
    }

    setType(a: string): this {
        this.type = a;
        return this;
    }

    setURL(a: string): this {
        if ( a !== this.url ) {
            this.hostname = this.domain = this.ipaddress = undefined;
            this.url = a;
        }
        return this;
    }

    getHostname(): string {
        if ( this.hostname === undefined ) {
            this.hostname = hostnameFromURI(this.url);
        }
        return this.hostname as string;
    }

    setHostname(a: string): this {
        if ( a !== this.hostname ) {
            this.domain = undefined;
            this.hostname = a;
        }
        return this;
    }

    getDomain(): string {
        if ( this.domain === undefined ) {
            this.domain = domainFromHostname(this.getHostname());
        }
        return this.domain as string;
    }

    setDomain(a: string): this {
        this.domain = a;
        return this;
    }

    getIPAddress(): string {
        if ( this.ipaddress !== undefined ) {
            return this.ipaddress;
        }
        const ipaddr = this.getHostname();
        const c0 = ipaddr.charCodeAt(0);
        if ( c0 === 0x5B /* [ */ ) {
            return (this.ipaddress = ipaddr.slice(1, -1));
        } else if ( c0 <= 0x39 && c0 >= 0x30 ) {
            if ( reIPv4.test(ipaddr) ) {
                return (this.ipaddress = ipaddr);
            }
        }
        return (this.ipaddress = '');
    }

    setIPAddress(ipaddr: string | undefined): this {
        this.ipaddress = ipaddr || undefined;
        return this;
    }

    getDocOrigin(): string {
        if ( this.docOrigin === undefined ) {
            this.docOrigin = this.tabOrigin ?? '';
        }
        return this.docOrigin;
    }

    setDocOrigin(a: string): this {
        if ( a !== this.docOrigin ) {
            this.docHostname = this.docDomain = undefined;
            this.docOrigin = a;
        }
        return this;
    }

    setDocOriginFromURL(a: string): this {
        return this.setDocOrigin(originFromURI(a));
    }

    getDocHostname(): string {
        if ( this.docHostname === undefined ) {
            this.docHostname = hostnameFromURI(this.getDocOrigin());
        }
        return this.docHostname as string;
    }

    setDocHostname(a: string): this {
        if ( a !== this.docHostname ) {
            this.docDomain = undefined;
            this.docHostname = a;
        }
        return this;
    }

    getDocDomain(): string {
        if ( this.docDomain === undefined ) {
            this.docDomain = domainFromHostname(this.getDocHostname());
        }
        return this.docDomain as string;
    }

    setDocDomain(a: string): this {
        this.docDomain = a;
        return this;
    }

    is3rdPartyToDoc(): boolean {
        let docDomain = this.getDocDomain();
        if ( docDomain === '' ) { docDomain = this.docHostname; }
        if ( this.domain !== undefined && this.domain !== '' ) {
            return this.domain !== docDomain;
        }
        const hostname = this.getHostname();
        if ( hostname.endsWith(docDomain) === false ) { return true; }
        const i = hostname.length - docDomain.length;
        if ( i === 0 ) { return false; }
        return hostname.charCodeAt(i - 1) !== 0x2E /* '.' */;
    }

    setTabId(a: number): this {
        this.tabId = a;
        return this;
    }

    getTabOrigin(): string | undefined {
        return this.tabOrigin;
    }

    setTabOrigin(a: string): this {
        if ( a !== this.tabOrigin ) {
            this.tabHostname = this.tabDomain = undefined;
            this.tabOrigin = a;
        }
        return this;
    }

    setTabOriginFromURL(a: string): this {
        return this.setTabOrigin(originFromURI(a));
    }

    getTabHostname(): string {
        if ( this.tabHostname === undefined ) {
            this.tabHostname = hostnameFromURI(this.getTabOrigin());
        }
        return this.tabHostname as string;
    }

    setTabHostname(a: string): this {
        if ( a !== this.tabHostname ) {
            this.tabDomain = undefined;
            this.tabHostname = a;
        }
        return this;
    }

    getTabDomain(): string {
        if ( this.tabDomain === undefined ) {
            this.tabDomain = domainFromHostname(this.getTabHostname());
        }
        return this.tabDomain as string;
    }

    setTabDomain(a: string): this {
        this.tabDomain = a;
        return this;
    }

    is3rdPartyToTab(): boolean {
        let tabDomain = this.getTabDomain();
        if ( tabDomain === '' ) { tabDomain = this.tabHostname; }
        if ( this.domain !== undefined && this.domain !== '' ) {
            return this.domain !== tabDomain;
        }
        const hostname = this.getHostname();
        if ( hostname.endsWith(tabDomain) === false ) { return true; }
        const i = hostname.length - tabDomain.length;
        if ( i === 0 ) { return false; }
        return hostname.charCodeAt(i - 1) !== 0x2E /* '.' */;
    }

    setFilter(a: Filter): this {
        this.filter = a;
        return this;
    }

    pushFilter(a: Filter): this {
        if ( this.filter === undefined ) {
            return this.setFilter(a);
        }
        if ( Array.isArray(this.filter) ) {
            this.filter.push(a);
        } else {
            this.filter = [ this.filter, a ];
        }
        return this;
    }

    pushFilters(a: Filter[]): this {
        if ( this.filter === undefined ) {
            return this.setFilter(a);
        }
        if ( Array.isArray(this.filter) ) {
            this.filter.push(...a);
        } else {
            this.filter = [ this.filter, ...a ];
        }
        return this;
    }

    setMethod(a: string): this {
        this.method = methodStrToBitMap[a] || 0;
        return this;
    }

    getMethodName(): string {
        return FilteringContext.getMethodName(this.method);
    }

    static get(a: string): HttpMethod {
        return methodStrToBitMap[a] || 0;
    }

    static getMethod(a: string): HttpMethod {
        return methodStrToBitMap[a] || 0;
    }

    static getMethodName(a: HttpMethod): string {
        return methodBitToStrMap.get(a) || '';
    }

    readonly BEACON = ResourceType.BEACON;
    readonly CSP_REPORT = ResourceType.CSP_REPORT;
    readonly FONT = ResourceType.FONT;
    readonly IMAGE = ResourceType.IMAGE;
    readonly IMAGESET = ResourceType.IMAGESET;
    readonly MAIN_FRAME = ResourceType.MAIN_FRAME;
    readonly MEDIA = ResourceType.MEDIA;
    readonly OBJECT = ResourceType.OBJECT;
    readonly OBJECT_SUBREQUEST = ResourceType.OBJECT_SUBREQUEST;
    readonly PING = ResourceType.PING;
    readonly SCRIPT = ResourceType.SCRIPT;
    readonly STYLESHEET = ResourceType.STYLESHEET;
    readonly SUB_FRAME = ResourceType.SUB_FRAME;
    readonly WEBSOCKET = ResourceType.WEBSOCKET;
    readonly XMLHTTPREQUEST = ResourceType.XMLHTTPREQUEST;
    readonly INLINE_FONT = ResourceType.INLINE_FONT;
    readonly INLINE_SCRIPT = ResourceType.INLINE_SCRIPT;
    readonly OTHER = ResourceType.OTHER;
    readonly FRAME_ANY = FRAME_ANY;
    readonly FONT_ANY = FONT_ANY;
    readonly INLINE_ANY = INLINE_ANY;
    readonly PING_ANY = PING_ANY;
    readonly SCRIPT_ANY = SCRIPT_ANY;
    readonly METHOD_NONE = HttpMethod.NONE;
    readonly METHOD_CONNECT = HttpMethod.CONNECT;
    readonly METHOD_DELETE = HttpMethod.DELETE;
    readonly METHOD_GET = HttpMethod.GET;
    readonly METHOD_HEAD = HttpMethod.HEAD;
    readonly METHOD_OPTIONS = HttpMethod.OPTIONS;
    readonly METHOD_PATCH = HttpMethod.PATCH;
    readonly METHOD_POST = HttpMethod.POST;
    readonly METHOD_PUT = HttpMethod.PUT;

    static readonly BEACON = ResourceType.BEACON;
    static readonly CSP_REPORT = ResourceType.CSP_REPORT;
    static readonly FONT = ResourceType.FONT;
    static readonly IMAGE = ResourceType.IMAGE;
    static readonly IMAGESET = ResourceType.IMAGESET;
    static readonly MAIN_FRAME = ResourceType.MAIN_FRAME;
    static readonly MEDIA = ResourceType.MEDIA;
    static readonly OBJECT = ResourceType.OBJECT;
    static readonly OBJECT_SUBREQUEST = ResourceType.OBJECT_SUBREQUEST;
    static readonly PING = ResourceType.PING;
    static readonly SCRIPT = ResourceType.SCRIPT;
    static readonly STYLESHEET = ResourceType.STYLESHEET;
    static readonly SUB_FRAME = ResourceType.SUB_FRAME;
    static readonly WEBSOCKET = ResourceType.WEBSOCKET;
    static readonly XMLHTTPREQUEST = ResourceType.XMLHTTPREQUEST;
    static readonly INLINE_FONT = ResourceType.INLINE_FONT;
    static readonly INLINE_SCRIPT = ResourceType.INLINE_SCRIPT;
    static readonly OTHER = ResourceType.OTHER;
    static readonly FRAME_ANY = FRAME_ANY;
    static readonly FONT_ANY = FONT_ANY;
    static readonly INLINE_ANY = INLINE_ANY;
    static readonly PING_ANY = PING_ANY;
    static readonly SCRIPT_ANY = SCRIPT_ANY;
    static readonly METHOD_NONE = HttpMethod.NONE;
    static readonly METHOD_CONNECT = HttpMethod.CONNECT;
    static readonly METHOD_DELETE = HttpMethod.DELETE;
    static readonly METHOD_GET = HttpMethod.GET;
    static readonly METHOD_HEAD = HttpMethod.HEAD;
    static readonly METHOD_OPTIONS = HttpMethod.OPTIONS;
    static readonly METHOD_PATCH = HttpMethod.PATCH;
    static readonly METHOD_POST = HttpMethod.POST;
    static readonly METHOD_PUT = HttpMethod.PUT;
}

/******************************************************************************/