/*******************************************************************************

    uBlock Ultimate - Universal Ad Interceptor for MV3 (MAIN world)
    
    Injected into the MAIN world so fetch/XHR patches affect page-level code.
    Uses a global symbol to guard against double activation.

*******************************************************************************/

const controllerKey = Symbol.for(
    "uBlockUltimate.universalInterceptor",
);

type InterceptorGlobal = typeof globalThis & {
    // Only `activate` is reachable from the page.  Deactivation/destruction are
    // intentionally absent here: they are reachable solely via a SW-originated
    // chrome.runtime.onMessage, so an ad-serving page cannot shut the
    // interceptor down.
    [controllerKey]?: {
        activate(): void;
    };
};

interface XHRWithMeta extends XMLHttpRequest {
    _ubor_url?: string;
    _ubor_score?: number;
    _ubor_shouldIntercept?: boolean;
    _ubor_epoch?: number;
    _ubor_cachedJSON?: unknown;
    _ubor_cachedJSONEpoch?: number;
}

const root = globalThis as InterceptorGlobal;

// Capture the capability enforcer at module load time (before page code can tamper).
// This is injected by the service worker as non-configurable, non-writable —
// page code CANNOT override it.
const _installedCapability = (globalThis as any).__ubrCapability;

// Helper to read current authorization from non-configurable properties
// that the SW sets at injection/re-injection time. These cannot be tampered
// by the page because they are non-configurable and non-writable.
function getCurrentAuth(): { authorized: boolean; actions: Record<string, boolean> } {
    const authorized = (globalThis as any).__ubrInterceptorAuthorized === true;
    const actions: Record<string, boolean> = (globalThis as any).__ubrInterceptorActions || {};
    return { authorized, actions };
}

const hostnameMatches = (hostname: string, domain: string): boolean =>
    hostname === domain || hostname.endsWith('.' + domain);

const parseRequestURL = (input: unknown): URL | null => {
    if ( input === undefined || input === null ) { return null; }
    try {
        if ( input instanceof Request ) { return new URL(input.url); }
        if ( input instanceof URL ) { return input; }
        if ( typeof input === 'string' ) {
            const base = document.baseURI || self.location.href;
            return new URL(input, base);
        }
        return null;
    } catch {
        return null;
    }
};

if (root[controllerKey] === undefined) {
    const CONFIG = {
        adHostnames: [
            'doubleclick.net', 'googlesyndication.com', 'googleadservices.com',
            'googleads.g.doubleclick.net', 'adsense.google.com',
            'adnxs.com', 'adnexus.net', 'adnxs.org',
            'amazon-adsystem.com', 'amazonadsystem.com',
            'advertising.com', 'adtech.com', 'adtechus.com',
            'adform.net', 'adform.com',
            'pubmatic.com', 'pubmatic.io',
            'rubiconproject.com', 'rubicon.com',
            'openx.net', 'openx.com',
            'indexexchange.com', 'indexexchange.io',
            'criteo.com', 'criteo.fr',
            'taboola.com', 'taboola.com.cn',
            'outbrain.com', 'outbrainimg.com',
            'mgid.com',
            'adsrvr.org', 'adsrvr.com',
            'adcolony.com', 'admob.com',
            'moatads.com', 'moat.com',
            'scorecardresearch.com', 'quantserve.com',
            'bidswitch.net', 'casalemedia.com',
            'contextweb.com', 'conversantmedia.com',
            'demdex.net', 'exelator.com',
            'eyeota.net', 'krxd.net',
            'lijit.com', 'liveramp.com',
            'mathtag.com', 'mediamath.com',
            'mxptint.net', 'nativo.com',
            'pardot.com', 'rfihub.com',
            'richrelevance.com', 'rlcdn.com',
            'sharethrough.com', 'simpli.fi',
            'sitescout.com', 'smartadserver.com',
            'spotxchange.com', 'stackadapt.com',
            'steelhousemedia.com', 'stickyadstv.com',
            'teads.tv', 'tribalfusion.com',
            'triplelift.com', 'turn.com',
            'undertone.com',
            'yieldmo.com', 'zeotap.com',
            'connect.facebook.net',
            'unityads.unity3d.com',
        ],
        strongEndpointRules: [
            { hostname: 'facebook.com', path: /^\/(?:tr|ads)(?:\/|$)/i },
            { hostname: 'linkedin.com', path: /^\/ads(?:\/|$)/i },
            { hostname: 'twitter.com', path: /^\/ads(?:\/|$)/i },
            { hostname: 'yahoo.com', path: /^\/ads(?:\/|$)/i },
            { hostname: 'unity3d.com', path: /^\/ads(?:\/|$)/i },
            { hostname: 'googlevideo.com', path: /^\/ad(?:\/|$)/i },
        ],
        genericStrongPatterns: [
            /ima3\.js/i,
            /\bvast\b/i,
            /vmgcp/i,
        ],
        weakAdUrlPatterns: [
            /\/ads\//i, /\/ad\//i, /\/advert/i, /\/adview/i,
            /\/adclick/i, /\/adframe/i, /\/adbanner/i,
            /\/sponsor/i, /\/promoted/i,
            /\/api\/ads/i, /\/api\/ad/i, /\/ads\/api/i,
            /\/adservice/i, /\/ad-serving/i,
            /\/adsense/i, /\/dfp\//i, /\/gpt\//i,
            /pagead/i, /\/pagead2\//i,
            /\/pubads\//i, /\/cmad/i,
            /bid/i, /\/bidder/i, /\/bids/i,
            /prebid/i, /rubicon/i,
            /\/vast\//i, /\/vmap\//i,
            /\/syndication\//i,
        ],
        adJSONKeys: [
            'adPlacements', 'playerAds', 'adSlots', 'adBreakHeartbeatParams',
            'adServerLogger', 'adSlotId', 'adUnitId',
            'ads', 'advertisements', 'advertising',
            'sponsored', 'sponsoredContent', 'sponsoredLinks',
            'promoted', 'promotedContent',
            'isAd', 'isAdvertisement', 'isSponsored',
            'adMetadata', 'adData', 'adContext',
            'adTracking', 'adImpressions',
            'googleAds', 'dfpAds', 'gptAds',
        ],
        whitelist: [
            'google.com', 'googleapis.com', 'googletagmanager.com',
            'facebook.com', 'facebook.net', 'connect.facebook.net',
            'twitter.com', 'linkedin.com', 'instagram.com',
            'github.com', 'github.io', 'githubusercontent.com',
            'cdn.jsdelivr.net', 'unpkg.com', 'raw.githubusercontent.com',
            'reddit.com', 'redditstatic.com',
            'wikipedia.org', 'wikimedia.org',
            'cloudflare.com', 'cloudfront.net',
        ],
    };

    const nativeResponseTextGetter = Object.getOwnPropertyDescriptor(
        XMLHttpRequest.prototype, 'responseText',
    )?.get;
    const nativeResponseGetter = Object.getOwnPropertyDescriptor(
        XMLHttpRequest.prototype, 'response',
    )?.get;

    const matchesStrongEndpoint = (parsed: URL): boolean =>
        CONFIG.strongEndpointRules.some(rule =>
            hostnameMatches(parsed.hostname.toLowerCase(), rule.hostname) &&
            rule.path.test(parsed.pathname),
        );

    const matchesGenericStrongResource = (parsed: URL): boolean => {
        const path = parsed.pathname.toLowerCase();
        return /(?:^|\/)ima3\.js$/.test(path) ||
            /(?:^|\/)vast(?:[._/-]|$)/.test(path) ||
            /(?:^|\/)vmgcp(?:[._/-]|$)/.test(path);
    };

    const adJSONKeySet = new Set(
        CONFIG.adJSONKeys.map(key => key.toLowerCase()),
    );

    let active = false;
    let observer: MutationObserver | undefined;
    let installed = false;
    let epoch = 0;

    // Per-action authorization flags, re-read from non-configurable properties
    // on each activation so the SW can change them by re-injecting the script.
    let _fetchWrapAllowed = false;
    let _mutateFetchResponseAllowed = false;
    let _xhrWrapAllowed = false;
    let _mutateXhrResponseAllowed = false;

    function readActionFlags(): void {
        const actions: Record<string, boolean> =
            (globalThis as any).__ubrInterceptorActions || {};
        _fetchWrapAllowed = actions["fetch-wrap"] === true;
        _mutateFetchResponseAllowed = actions["mutate-fetch-response"] === true;
        _xhrWrapAllowed = actions["xhr-wrap"] === true;
        _mutateXhrResponseAllowed = actions["mutate-xhr-response"] === true;
    }

    // Revocation state lives in closure-private variables so the page
    // (which shares the MAIN world) cannot read or clear it.  Only the
    // service worker, via chrome.scripting.executeScript, can flip these
    // by calling deactivate()/destroy() — the page cannot reach them.
    let revoked = false;

    let upstreamFetch: typeof globalThis.fetch;
    let upstreamOpen: typeof XMLHttpRequest.prototype.open;
    let upstreamSend: typeof XMLHttpRequest.prototype.send;
    let wrappedFetch: typeof globalThis.fetch;
    let wrappedOpen: typeof XMLHttpRequest.prototype.open;
    let wrappedSend: typeof XMLHttpRequest.prototype.send;

    const isExplicitAdURL = (input: unknown): boolean => {
        const parsed = parseRequestURL(input);
        if ( parsed === null ) { return false; }
        const hostname = parsed.hostname.toLowerCase();
        if ( CONFIG.adHostnames.some(domain => hostnameMatches(hostname, domain.toLowerCase())) ) {
            return true;
        }
        if ( matchesStrongEndpoint(parsed) ) { return true; }
        return matchesGenericStrongResource(parsed);
    };

    const scoreUrl = (input: unknown): number => {
        const parsed = parseRequestURL(input);
        if ( parsed === null ) { return 0; }
        const hostname = parsed.hostname.toLowerCase();
        const href = parsed.href;
        let score = 0;
        for ( const domain of CONFIG.adHostnames ) {
            const d = domain.toLowerCase();
            if ( hostname === d || hostname.endsWith('.' + d) ) {
                score += 0.5;
                break;
            }
        }
        if ( matchesStrongEndpoint(parsed) || matchesGenericStrongResource(parsed) ) {
            score += 0.5;
        } else if ( CONFIG.weakAdUrlPatterns.some(pattern => pattern.test(href)) ) {
            score += 0.3;
        }
        if ( /\d{4,}/.test(href) ) { score += 0.1; }
        if ( /[?&](ad|ads)=/.test(href) ) { score += 0.2; }
        return Math.min(score, 1.0);
    };

    const isWhitelisted = (input: unknown): boolean => {
        const parsed = parseRequestURL(input);
        if ( parsed === null ) { return false; }
        const hostname = parsed.hostname.toLowerCase();
        return CONFIG.whitelist.some(domain => {
            const d = domain.toLowerCase();
            return hostname === d || hostname.endsWith('.' + d);
        });
    };

    const shouldStripKey = (key: string): boolean =>
        adJSONKeySet.has(key.toLowerCase());

    const stripAdData = (obj: unknown): unknown => {
        if (obj === null || obj === undefined) return obj;
        if (typeof obj !== 'object') return obj;
        const isArray = Array.isArray(obj);
        const result: any = isArray ? [] : {};
        for (const key of Object.keys(obj as Record<string, unknown>)) {
            if (shouldStripKey(key)) continue;
            try { result[key] = stripAdData((obj as Record<string, unknown>)[key]); } catch { result[key] = (obj as Record<string, unknown>)[key]; }
        }
        return result;
    };

    const parseAndStrip = (text: string): string => {
        try { const json = JSON.parse(text); const stripped = stripAdData(json); return JSON.stringify(stripped); } catch { return text; }
    };

    const wrapTransformedResponse = (
        target: Response,
        original: Response,
    ): Response =>
        new Proxy(target, {
            get(responseTarget, prop) {
                if (prop === 'url') return original.url;
                if (prop === 'redirected') return original.redirected;
                if (prop === 'type') return original.type;
                if (prop === 'clone') {
                    return (): Response =>
                        wrapTransformedResponse(
                            responseTarget.clone(),
                            original,
                        );
                }
                const value = Reflect.get(responseTarget, prop, responseTarget);
                return typeof value === 'function' ? value.bind(responseTarget) : value;
            },
        });

    const installXHRResponseView = (xhr: XHRWithMeta): boolean => {
        if ( nativeResponseTextGetter === undefined || nativeResponseGetter === undefined ) { return false; }
        try {
            Object.defineProperty(xhr, 'responseText', {
                configurable: true,
                get(): string {
                    const raw = Reflect.apply(nativeResponseTextGetter!, xhr, []) as string;
                    if ( active === false || xhr._ubor_epoch !== epoch || xhr._ubor_shouldIntercept !== true || xhr.readyState !== XMLHttpRequest.DONE ) { return raw; }
                    return parseAndStrip(raw);
                },
            });
            Object.defineProperty(xhr, 'response', {
                configurable: true,
                get(): unknown {
                    const raw = Reflect.apply(nativeResponseGetter!, xhr, []);
                    if ( active === false || xhr._ubor_epoch !== epoch || xhr._ubor_shouldIntercept !== true || xhr.readyState !== XMLHttpRequest.DONE ) { return raw; }
                    if ( xhr.responseType === '' || xhr.responseType === 'text' ) { return parseAndStrip(String(raw)); }
                    if ( xhr.responseType === 'json' ) {
                        if ( xhr._ubor_cachedJSONEpoch !== epoch ) {
                            xhr._ubor_cachedJSON = stripAdData(raw);
                            xhr._ubor_cachedJSONEpoch = epoch;
                        }
                        return xhr._ubor_cachedJSON;
                    }
                    return raw;
                },
            });
            return true;
        } catch (error) {
            console.warn('[uBR] Unable to install XHR response view:', error);
            return false;
        }
    };

    const installWrappers = (): void => {
        if (installed) return;
        installed = true;

        if (_fetchWrapAllowed) {
            upstreamFetch = globalThis.fetch;
            wrappedFetch = function (this: any, ...args: Parameters<typeof fetch>): Promise<Response> {
                const requestEpoch = epoch;
                if (!active) {
                    return Reflect.apply(upstreamFetch, globalThis, args);
                }
                const [resource] = args;
                const parsedURL = parseRequestURL(resource);
                const url = parsedURL?.href;

                const explicitAd = parsedURL !== null && isExplicitAdURL(parsedURL);
                if ( parsedURL !== null && isWhitelisted(parsedURL) && !explicitAd ) {
                    return Reflect.apply(upstreamFetch, globalThis, args);
                }

                const shouldIntercept = parsedURL !== null && (
                    matchesStrongEndpoint(parsedURL) ||
                    isExplicitAdURL(parsedURL) ||
                    matchesGenericStrongResource(parsedURL)
                );

                return Reflect.apply(upstreamFetch, globalThis, args).then(async (response: Response) => {
                    if ( !active || epoch !== requestEpoch || !shouldIntercept || !response.ok ) { return response; }
                    if ( !_mutateFetchResponseAllowed ) { return response; }
                    try {
                        const mime = (response.headers.get('content-type') || '').split(';', 1)[0].trim().toLowerCase();
                        const isJSON = mime === 'application/json' || mime.endsWith('+json');
                        if ( !isJSON ) { return response; }
                        const contentLength = Number(response.headers.get('content-length'));
                        const MAX_MUTATION_BYTES = 1024 * 1024;
                        if ( Number.isFinite(contentLength) === false || contentLength < 0 || contentLength > MAX_MUTATION_BYTES ) { return response; }
                        const clone = response.clone();
                        const text = await clone.text();
                        if ( !active || epoch !== requestEpoch ) { return response; }
                        const stripped = parseAndStrip(text);
                        if (stripped !== text) {
                            const headers = new Headers(response.headers);
                            for ( const name of [ 'content-length', 'content-encoding', 'content-md5', 'digest', 'etag', 'content-range' ] ) {
                                headers.delete(name);
                            }
                            const transformed = new Response(stripped, {
                                status: response.status,
                                statusText: response.statusText,
                                headers,
                            });
                            return wrapTransformedResponse(transformed, response);
                        }
                    } catch { /* Use original response */ }
                    return response;
                });
            } as typeof globalThis.fetch;

            globalThis.fetch = wrappedFetch;
        }

        if (_xhrWrapAllowed) {
            upstreamOpen = XMLHttpRequest.prototype.open;
            upstreamSend = XMLHttpRequest.prototype.send;

            wrappedOpen = function (this: XHRWithMeta, ...args: any[]): void {
                this._ubor_url = undefined;
                this._ubor_score = 0;
                this._ubor_shouldIntercept = false;
                this._ubor_epoch = undefined;
                this._ubor_cachedJSON = undefined;
                this._ubor_cachedJSONEpoch = undefined;

                if (!active) {
                    return upstreamOpen.apply(this, args as any);
                }

                const parsedURL = parseRequestURL(args[1]);
                this._ubor_url = parsedURL?.href ?? null;

                if (parsedURL === null) {
                    return upstreamOpen.apply(this, args as any);
                }

                const explicitAd = isExplicitAdURL(parsedURL);
                if (isWhitelisted(parsedURL) && !explicitAd) {
                    return upstreamOpen.apply(this, args as any);
                }

                this._ubor_shouldIntercept =
                    matchesStrongEndpoint(parsedURL) ||
                    isExplicitAdURL(parsedURL) ||
                    matchesGenericStrongResource(parsedURL);
                this._ubor_epoch = epoch;
                return upstreamOpen.apply(this, args as any);
            } as typeof XMLHttpRequest.prototype.open;

            wrappedSend = function (this: XHRWithMeta, ...args: any[]): void {
                if ( _mutateXhrResponseAllowed && active && this._ubor_epoch === epoch && this._ubor_shouldIntercept === true ) {
                    installXHRResponseView(this);
                }
                return upstreamSend.apply(this, args);
            } as typeof XMLHttpRequest.prototype.send;

            XMLHttpRequest.prototype.open = wrappedOpen;
            XMLHttpRequest.prototype.send = wrappedSend;
        }
    };

    function applyActivation(): void {
        if (active) return;
        // Closure-private revocation flag: cannot be cleared by the page.
        if (revoked) return;
        // The per-action authorization flags are injected by the SW as
        // non-configurable, non-writable properties.  The page cannot set or
        // clear them, so this is a genuine SW-authoritative gate.  A page call
        // to activate() cannot bypass a SW-ordered revocation because `revoked`
        // is private and the SW-ordered deactivation set it.
        if ((globalThis as any).__ubrInterceptorAuthorized !== true) return;
        if ((globalThis as any).__ubrCapabilityTampered === true) return;
        readActionFlags();
        epoch += 1;
        active = true;
        installWrappers();
    }

    function deactivateInternal(): void {
        // Always invalidate, even while inactive, so a pending or future
        // activation request can never complete after revocation.
        revoked = true;
        if (!active) return;
        epoch += 1;
        active = false;
        if (observer) { observer.disconnect(); observer = undefined; }
    }

    function destroyInternal(): void {
        deactivateInternal();
        if ( _fetchWrapAllowed && globalThis.fetch === wrappedFetch ) { globalThis.fetch = upstreamFetch; }
        if ( _xhrWrapAllowed && XMLHttpRequest.prototype.open === wrappedOpen ) { XMLHttpRequest.prototype.open = upstreamOpen; }
        if ( _xhrWrapAllowed && XMLHttpRequest.prototype.send === wrappedSend ) { XMLHttpRequest.prototype.send = upstreamSend; }
        installed = false;
        delete (globalThis as any).__ubrHeuristicInterceptor;
        delete root[controllerKey];
        if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.onMessage) {
            chrome.runtime.onMessage.removeListener(controlListener);
        }
    }

    // Control channel for SW-ordered lifecycle changes.  The page shares this
    // global object, so deactivate/destroy are NOT exposed on the published
    // controller: an ad-serving page must not be able to shut the interceptor
    // down.  Only a genuinely SW-originated chrome.runtime.onMessage (which the
    // page cannot forge) reaches these internal routines.  `activate()` is the
    // only public method and is inert once `revoked`, so it cannot be abused to
    // re-enable interception after a SW revocation.
    const controlListener = (message: any, sender: any): boolean => {
        if (!sender || sender.id !== (typeof chrome !== "undefined" && chrome.runtime ? chrome.runtime.id : undefined)) {
            return false;
        }
        if (!message || message.channel !== "__ubrInterceptorCtl") return false;
        const kind = message.msg && message.msg.kind;
        if (kind === "deactivate") deactivateInternal();
        else if (kind === "destroy") destroyInternal();
        return false;
    };

    const controller = {
        // Public but harmless: once `revoked` is set by a SW-ordered
        // deactivation, activate() is a no-op and cannot re-enable interception.
        activate(): void {
            applyActivation();
        },
    };

    root[controllerKey] = controller;

    if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.onMessage) {
        chrome.runtime.onMessage.addListener(controlListener);
    }

    // Auto-activate on load.  The SW only injects this script when the
    // interceptor is enabled, having first set the non-configurable
    // __ubrInterceptorAuthorized flag; that flag — plus the closure-private
    // `revoked` state — is the entire authorization boundary.  Activation is
    // never triggered by a page-originated command.
    applyActivation();
}
