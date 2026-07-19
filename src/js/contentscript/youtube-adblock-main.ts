/*
 * YouTube player-response ad blocker.
 *
 * This script intentionally runs in the page's MAIN world. An isolated-world
 * content script can observe the DOM, but cannot intercept the fetch/XHR
 * objects used by YouTube's player application.
 */

export const YOUTUBE_PLAYER_ENDPOINTS = [
    '/youtubei/v1/player',
    '/youtubei/v1/next',
    '/youtubei/v1/browse',
    '/youtubei/v1/reel',
] as const;

const adResponseKeys = new Set([
    'adbreakheartbeatparams',
    'adbreakparams',
    'adbreaks',
    'ad3module',
    'adclient',
    'adimpression',
    'adinfo',
    'adloggingdata',
    'adplacements',
    'adparams',
    'adpreview',
    'adsignalsinfo',
    'adslotmetadata',
    'adslots',
    'adtag',
    'adtagparameters',
    'adtagurl',
    'adurl',
    'advideoid',
    'companionads',
    'companionslots',
    'displayadrenderer',
    'infeedadlayoutrenderer',
    'playerads',
    'promoteditemsectionrenderer',
    'promotedsparkleswebrenderer',
    'promotedvideorenderer',
]);

const embeddedJSONKeys = new Set([
    'initialplayerresponse',
    'playerresponse',
    'rawplayerresponse',
]);

type JSONRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is JSONRecord =>
    typeof value === 'object' && value !== null && Array.isArray(value) === false;

const nativeFunctionSources = new WeakMap<Function, string>();
const nativeFunctionToString = Function.prototype.toString;
let nativeToStringGuardInstalled = false;
let youtubeAdblockInstalled = false;

const installNativeToStringGuard = (): void => {
    if ( nativeToStringGuardInstalled ) { return; }
    nativeToStringGuardInstalled = true;

    const toStringGuard = {
        toString(this: Function): string {
            const nativeSource = nativeFunctionSources.get(this);
            if ( nativeSource !== undefined ) { return nativeSource; }
            return nativeFunctionToString.call(this);
        },
    }.toString;
    nativeFunctionSources.set(toStringGuard, nativeFunctionToString.call(nativeFunctionToString));

    try {
        Object.defineProperty(Function.prototype, 'toString', {
            configurable: true,
            writable: true,
            value: toStringGuard,
        });
    } catch (_) {
        nativeToStringGuardInstalled = false;
    }
};

const cloakNativeFunction = <T extends Function>(wrapper: T, native: Function): T => {
    installNativeToStringGuard();
    nativeFunctionSources.set(wrapper, nativeFunctionToString.call(native));
    for (const property of [ 'name', 'length' ] as const) {
        const descriptor = Object.getOwnPropertyDescriptor(native, property);
        if ( descriptor?.configurable !== true ) { continue; }
        try { Object.defineProperty(wrapper, property, descriptor); } catch (_) { /* ignore */ }
    }
    return wrapper;
};

const playerResponseShapeKeys = new Set([
    'playabilitystatus',
    'streamingdata',
    'videodetails',
]);

/**
 * The generic JSON.parse fallback has no endpoint provenance. Limit it to a
 * compact, stable player-response shape so unrelated YouTube JSON is left
 * untouched. Network and known-global paths have stronger provenance and do
 * not need this extra gate.
 */
export const hasYouTubePlayerPayloadShape = (value: unknown, depth = 0): boolean => {
    if ( isRecord(value) === false ) { return false; }
    const keys = Object.keys(value).map(key => key.toLowerCase().replace(/[^a-z0-9]/g, ''));
    if ( keys.some(key => playerResponseShapeKeys.has(key)) ) { return true; }
    if ( depth >= 3 ) { return false; }
    return Object.values(value).some(child => hasYouTubePlayerPayloadShape(child, depth + 1));
};

/** Mutates a YouTube API payload and returns whether ad data was removed. */
export const sanitizeYouTubeAdPayload = (
    payload: unknown,
    seen = new WeakSet<object>(),
): boolean => {
    if ( payload === null || typeof payload !== 'object' ) { return false; }
    if ( seen.has(payload) ) { return false; }
    seen.add(payload);

    let changed = false;
    if ( Array.isArray(payload) ) {
        for (const item of payload) {
            changed = sanitizeYouTubeAdPayload(item, seen) || changed;
        }
        return changed;
    }

    for (const key of Object.keys(payload)) {
        // Player configuration uses both camelCase and underscore names, e.g.
        // `adPlacements` and `ad_placements`, depending on the transport.
        const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, '');
        if ( adResponseKeys.has(normalizedKey) ) {
            delete payload[key];
            changed = true;
            continue;
        }

        const value = payload[key];
        if ( embeddedJSONKeys.has(normalizedKey) && typeof value === 'string' ) {
            const sanitized = sanitizeYouTubeAdJSON(value);
            if ( sanitized.changed ) {
                payload[key] = sanitized.text;
                changed = true;
            }
            continue;
        }
        changed = sanitizeYouTubeAdPayload(value, seen) || changed;
    }
    return changed;
};

export const sanitizeYouTubeAdJSON = (text: string): { text: string; changed: boolean } => {
    try {
        // YouTube commonly prefixes API responses with `)]}'\n` to prevent
        // JSON hijacking. Preserve it after sanitizing the JSON payload.
        const xssiPrefix = /^(?:\)\]\}'|for\s*\(;;\);|while\s*\(1\);)(?:\r?\n)?/.exec(text)?.[0] || '';
        const payload: unknown = JSON.parse(text.slice(xssiPrefix.length));
        if ( sanitizeYouTubeAdPayload(payload) === false ) {
            return { text, changed: false };
        }
        return { text: `${xssiPrefix}${JSON.stringify(payload)}`, changed: true };
    } catch (_) {
        return { text, changed: false };
    }
};

const mayContainYouTubeAdPayload = (text: string): boolean =>
    text.includes('adPlacements') ||
    text.includes('ad_placements') ||
    text.includes('playerAds') ||
    text.includes('player_ads') ||
    text.includes('ad3_module') ||
    text.includes('adSlots') ||
    text.includes('adBreak');

/*
 * Request hooks can be bypassed when a page captures or replaces fetch early.
 * YouTube still parses its player payload through JSON.parse; pruning at that
 * object boundary covers those alternate transport paths. The payload-shape
 * gate keeps unrelated YouTube JSON untouched.
 */
const installJSONParseGuard = (): void => {
    const originalJSONParse = JSON.parse;
    const parseWrapper = {
        parse(text: string, reviver?: (this: unknown, key: string, value: unknown) => unknown): unknown {
            const payload = originalJSONParse.call(JSON, text, reviver);
            if ( typeof text === 'string' &&
                mayContainYouTubeAdPayload(text) &&
                hasYouTubePlayerPayloadShape(payload) ) {
                sanitizeYouTubeAdPayload(payload);
            }
            return payload;
        },
    }.parse;
    JSON.parse = cloakNativeFunction(parseWrapper, originalJSONParse) as typeof JSON.parse;
};

export const isYouTubePlayerRequest = (url: string, baseURL: string): boolean => {
    try {
        const target = new URL(url, baseURL);
        const hostname = target.hostname;
        const isYouTubeHost =
            hostname === 'youtube.com' ||
            hostname.endsWith('.youtube.com') ||
            hostname === 'youtube-nocookie.com' ||
            hostname.endsWith('.youtube-nocookie.com');
        return isYouTubeHost && YOUTUBE_PLAYER_ENDPOINTS.some(path => target.pathname === path);
    } catch (_) {
        return false;
    }
};

const requestURL = (input: RequestInfo | URL): string => {
    if ( typeof input === 'string' ) { return input; }
    if ( input instanceof URL ) { return input.href; }
    return input.url;
};

const nativeResponseText = typeof Response === 'function'
    ? Response.prototype.text
    : undefined;

const sanitizeResponse = async (response: Response): Promise<Response> => {
    const contentType = response.headers.get('content-type') || '';
    if ( nativeResponseText === undefined ||
        response.type === 'opaque' ||
        contentType.includes('json') === false ) {
        return response;
    }
    try {
        const sanitized = sanitizeYouTubeAdJSON(await nativeResponseText.call(response.clone()));
        if ( sanitized.changed === false ) { return response; }
        const headers = new Headers(response.headers);
        headers.delete('content-length');
        return new Response(sanitized.text, {
            status: response.status,
            statusText: response.statusText,
            headers,
        });
    } catch (_) {
        return response;
    }
};

const installFetchGuard = (): void => {
    const originalFetch = window.fetch;
    const fetchWrapper = {
        async fetch(
            this: WindowOrWorkerGlobalScope,
            input: RequestInfo | URL,
            init?: RequestInit,
        ): Promise<Response> {
            const response = await originalFetch.call(this, input, init);
            if ( isYouTubePlayerRequest(requestURL(input), location.href) === false ) {
                return response;
            }
            return sanitizeResponse(response);
        },
    }.fetch;
    window.fetch = cloakNativeFunction(fetchWrapper, originalFetch) as typeof window.fetch;
};

/*
 * YouTube player API responses are pruned at the response-consumption boundary.
 * This still covers early references to fetch captured by the page.
 */
const installResponseConsumptionGuard = (): void => {
    const originalJSON = Response.prototype.json;
    const jsonWrapper = {
        async json(this: Response): Promise<unknown> {
            const payload = await originalJSON.call(this);
            if ( isYouTubePlayerRequest(this.url, location.href) ) {
                sanitizeYouTubeAdPayload(payload);
            }
            return payload;
        },
    }.json;
    Response.prototype.json = cloakNativeFunction(jsonWrapper, originalJSON) as typeof Response.prototype.json;

    const originalText = Response.prototype.text;
    const textWrapper = {
        async text(this: Response): Promise<string> {
            const text = await originalText.call(this);
            if ( isYouTubePlayerRequest(this.url, location.href) === false ) {
                return text;
            }
            return sanitizeYouTubeAdJSON(text).text;
        },
    }.text;
    Response.prototype.text = cloakNativeFunction(textWrapper, originalText) as typeof Response.prototype.text;
};

const installXHRGuard = (): void => {
    const requestURLs = new WeakMap<XMLHttpRequest, string>();
    const originalOpen = XMLHttpRequest.prototype.open;
    const openWrapper = {
        open(
            this: XMLHttpRequest,
            method: string,
            url: string | URL,
            async: boolean = true,
            username?: string | null,
            password?: string | null,
        ): void {
            requestURLs.set(this, String(url));
            originalOpen.call(this, method, url, async, username, password);
        },
    }.open;
    XMLHttpRequest.prototype.open = cloakNativeFunction(openWrapper, originalOpen) as typeof XMLHttpRequest.prototype.open;

    const sanitizeXHRValue = (xhr: XMLHttpRequest, value: unknown): unknown => {
        if ( isYouTubePlayerRequest(requestURLs.get(xhr) || '', location.href) === false ) {
            return value;
        }
        if ( typeof value === 'string' ) {
            return sanitizeYouTubeAdJSON(value).text;
        }
        sanitizeYouTubeAdPayload(value);
        return value;
    };

    for (const property of [ 'response', 'responseText' ] as const) {
        const descriptor = Object.getOwnPropertyDescriptor(XMLHttpRequest.prototype, property);
        if ( descriptor?.get === undefined || descriptor.configurable === false ) { continue; }
        const getter = cloakNativeFunction({
            value(this: XMLHttpRequest): unknown {
                return sanitizeXHRValue(this, descriptor.get!.call(this));
            },
        }.value, descriptor.get);
        Object.defineProperty(XMLHttpRequest.prototype, property, {
            ...descriptor,
            get: getter,
        });
    }
};

type YouTubePlayer = HTMLElement & {
    getVideoData?: () => { isAd?: boolean } | undefined;
    skipAd?: () => void;
};

const playerSkipButtonSelector = [
    '.ytp-ad-skip-button',
    '.ytp-ad-skip-button-modern',
    '.ytp-ad-skip-button-container button',
    '.ytp-ad-skip-button-slot button',
    '.videoAdUiSkipButton',
].join(',');

const playerIsShowingAd = (player: YouTubePlayer): boolean => {
    if ( player.classList.contains('ad-showing') || player.classList.contains('ad-interrupting') ) {
        return true;
    }
    try {
        return player.getVideoData?.().isAd === true;
    } catch (_) {
        return false;
    }
};

/*
 * Player responses are the preferred prevention path. This is the fallback
 * for an ad already in progress: it is deliberately gated on YouTube's own
 * confirmed player state so regular video playback is never sought or muted.
 */
const skipActivePlayerAd = (
    player: YouTubePlayer | null,
    skipAttemptedPlayer: { value: YouTubePlayer | null },
    skipControlClickedPlayer: { value: YouTubePlayer | null },
): boolean => {
    if ( player === null || playerIsShowingAd(player) === false ) {
        // The player uses the same element for every ad break. Resetting
        // these markers when content resumes lets a later ad break be handled
        // independently, without repeatedly prodding the active player.
        skipAttemptedPlayer.value = null;
        skipControlClickedPlayer.value = null;
        return false;
    }

    if ( skipAttemptedPlayer.value !== player ) {
        skipAttemptedPlayer.value = player;
        try { player.skipAd?.(); } catch (_) { /* ignore */ }
    }
    if ( skipControlClickedPlayer.value === player ) { return true; }
    const buttons = player.querySelectorAll<HTMLElement>(playerSkipButtonSelector);
    if ( buttons.length === 0 ) { return true; }
    for (const button of buttons) {
        try { button.click(); } catch (_) { /* ignore */ }
    }
    skipControlClickedPlayer.value = player;
    return true;
};

const installPlayerAdSkipper = (): void => {
    const skipAttemptedPlayer: { value: YouTubePlayer | null } = { value: null };
    const skipControlClickedPlayer: { value: YouTubePlayer | null } = { value: null };
    let activePlayer: YouTubePlayer | null = null;
    let playerObserver: MutationObserver | undefined;
    let playerDiscoveryObserver: MutationObserver | undefined;
    let skipControlObserver: MutationObserver | undefined;

    const stopWatchingSkipControl = (): void => {
        skipControlObserver?.disconnect();
        skipControlObserver = undefined;
    };

    const nodeContainsSkipControl = (node: Node): boolean => {
        if ( node.nodeType !== Node.ELEMENT_NODE ) { return false; }
        const element = node as Element;
        return element.matches(playerSkipButtonSelector) ||
            element.querySelector(playerSkipButtonSelector) !== null;
    };

    const mutationMayRevealSkipControl = (mutation: MutationRecord): boolean => {
        if ( mutation.type === 'childList' ) {
            return Array.from(mutation.addedNodes).some(nodeContainsSkipControl);
        }
        const target = mutation.target as Element;
        return target.matches(playerSkipButtonSelector) ||
            target.closest(playerSkipButtonSelector) !== null;
    };

    const watchForSkipControl = (): void => {
        if ( activePlayer === null ||
            skipControlClickedPlayer.value === activePlayer ||
            skipControlObserver !== undefined ) {
            return;
        }
        skipControlObserver = new MutationObserver(records => {
            if ( records.some(mutationMayRevealSkipControl) === false ) { return; }
            skipActivePlayerAd(activePlayer, skipAttemptedPlayer, skipControlClickedPlayer);
            if ( skipControlClickedPlayer.value === activePlayer ) {
                stopWatchingSkipControl();
            }
        });
        // This observer is active only for a confirmed ad break, and only
        // reacts to the skip button appearing or becoming enabled.
        skipControlObserver.observe(activePlayer, {
            subtree: true,
            childList: true,
            attributes: true,
            attributeFilter: [ 'class', 'disabled', 'aria-hidden' ],
        });
    };

    const observePlayer = (): void => {
        if ( skipActivePlayerAd(
            activePlayer,
            skipAttemptedPlayer,
            skipControlClickedPlayer,
        ) === false ) {
            stopWatchingSkipControl();
            return;
        }
        if ( skipControlClickedPlayer.value === activePlayer ) {
            stopWatchingSkipControl();
            return;
        }
        watchForSkipControl();
    };

    const attachPlayerObserver = (): void => {
        const player = document.querySelector<YouTubePlayer>('#movie_player');
        if ( player === activePlayer ) {
            observePlayer();
            return;
        }

        playerObserver?.disconnect();
        stopWatchingSkipControl();
        activePlayer = player;
        skipAttemptedPlayer.value = null;
        skipControlClickedPlayer.value = null;
        if ( player === null ) {
            watchForPlayer();
            return;
        }

        playerDiscoveryObserver?.disconnect();
        playerDiscoveryObserver = undefined;

        // Watching the whole YouTube document is expensive: its virtual DOM
        // changes continuously while a video plays. Only the player's own
        // class changes identify the start/end of an actual ad break.
        playerObserver = new MutationObserver(observePlayer);
        playerObserver.observe(player, {
            attributes: true,
            attributeFilter: [ 'class' ],
        });
        observePlayer();
    };

    const nodeContainsPlayer = (node: Node): boolean => {
        if ( node.nodeType !== Node.ELEMENT_NODE ) { return false; }
        const element = node as Element;
        return element.id === 'movie_player' || element.querySelector('#movie_player') !== null;
    };

    // This observer only exists until YouTube has created its player. Its
    // callback examines added nodes, never the complete document, then it is
    // immediately disconnected. The long-lived observer above is scoped to
    // the player itself.
    const watchForPlayer = (): void => {
        if ( playerDiscoveryObserver !== undefined ) { return; }
        playerDiscoveryObserver = new MutationObserver(records => {
            if ( records.some(record =>
                Array.from(record.addedNodes).some(nodeContainsPlayer),
            ) ) {
                attachPlayerObserver();
            }
        });
        playerDiscoveryObserver.observe(document, {
            childList: true,
            subtree: true,
        });
    };

    const timers = [ 0, 50, 250, 1000, 3000 ].map(delay =>
        window.setTimeout(attachPlayerObserver, delay),
    );
    document.addEventListener('yt-navigate-finish', attachPlayerObserver, true);
    document.addEventListener('yt-page-data-updated', attachPlayerObserver, true);
    window.addEventListener('pagehide', () => {
        playerObserver?.disconnect();
        playerDiscoveryObserver?.disconnect();
        stopWatchingSkipControl();
        for (const timer of timers) {
            window.clearTimeout(timer);
        }
    }, { once: true });
    attachPlayerObserver();
};

const sanitizeGlobalPlayerState = (): void => {
    const pageWindow = window as Window & {
        ytInitialData?: unknown;
        ytInitialPlayerResponse?: unknown;
        ytplayer?: { config?: { args?: JSONRecord } };
        ytcfg?: unknown;
    };

    sanitizeYouTubeAdPayload(pageWindow.ytInitialPlayerResponse);
    sanitizeYouTubeAdPayload(pageWindow.ytInitialData);
    sanitizeYouTubeAdPayload(pageWindow.ytplayer);
    sanitizeYouTubeAdPayload(pageWindow.ytcfg);

    const args = pageWindow.ytplayer?.config?.args;
    if ( args === undefined ) { return; }
    sanitizeYouTubeAdPayload(args);
};

const hookGlobalPayload = (
    name: 'ytInitialData' | 'ytInitialPlayerResponse' | 'ytplayer' | 'ytcfg',
): void => {
    const descriptor = Object.getOwnPropertyDescriptor(window, name);
    if ( descriptor?.configurable === false ) { return; }

    let value = descriptor?.get?.call(window) ?? descriptor?.value;
    sanitizeYouTubeAdPayload(value);
    Object.defineProperty(window, name, {
        configurable: true,
        enumerable: descriptor?.enumerable ?? true,
        get(): unknown {
            return descriptor?.get?.call(window) ?? value;
        },
        set(nextValue: unknown): void {
            sanitizeYouTubeAdPayload(nextValue);
            if ( descriptor?.set !== undefined ) {
                descriptor.set.call(window, nextValue);
            } else {
                value = nextValue;
            }
        },
    });
};

export const installYouTubeAdblock = (): void => {
    if ( youtubeAdblockInstalled ) { return; }
    youtubeAdblockInstalled = true;

    hookGlobalPayload('ytInitialData');
    hookGlobalPayload('ytInitialPlayerResponse');
    hookGlobalPayload('ytplayer');
    hookGlobalPayload('ytcfg');
    installJSONParseGuard();
    installFetchGuard();
    installResponseConsumptionGuard();
    installXHRGuard();
    installPlayerAdSkipper();

    sanitizeGlobalPlayerState();
    for (const delay of [ 0, 50, 250, 1000, 3000 ]) {
        window.setTimeout(sanitizeGlobalPlayerState, delay);
    }
    document.addEventListener('yt-navigate-finish', sanitizeGlobalPlayerState, true);
    document.addEventListener('yt-page-data-updated', sanitizeGlobalPlayerState, true);
};

if ( typeof window === 'object' && typeof document === 'object' ) {
    const hostname = location.hostname;
    if (
        hostname === 'youtube.com' ||
        hostname.endsWith('.youtube.com') ||
        hostname === 'youtube-nocookie.com' ||
        hostname.endsWith('.youtube-nocookie.com')
    ) {
        installYouTubeAdblock();
    }
}
