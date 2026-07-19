/*******************************************************************************

    uBlock Ultimate - Content Script Module
    DOM Collapser

    Enforces the collapsing of DOM elements for which a corresponding
    resource was blocked through network filtering.

*******************************************************************************/

interface Messaging {
    send(channel: string, message: object): Promise<unknown>;
}

interface DOMWatcher {
    addListener(listener: DOMListener): void;
    removeListener(listener: DOMListener): void;
}

interface ShutdownCallbacks {
    add(callback: () => void): void;
    remove(callback: () => void): void;
}

interface VAPI {
    messaging: Messaging;
    domWatcher: DOMWatcher | null;
    shutdown: ShutdownCallbacks;
    randomToken(): string;
    setTimeout(callback: () => void, ms: number): number;
    userStylesheet: {
        add(cssText: string, now?: boolean): void;
    };
    domCollapser: { start(): void } | null;
    contentScript?: boolean;
    sanitizeCosmeticCSSForPage?(css: string): string;
    DOMFilterer?: new () => {
        addCSS(css: string, options?: { mustInject?: boolean }): void;
        addProceduralSelectors(selectors: string[]): void;
        exceptCSSRules(selectors: string[]): void;
        commitNow(): void;
        exceptions: string[];
        toggle?(state: boolean, filterer?: unknown): void;
    };
    pickerURL?: string;
    zap?: boolean;
    eprom?: { eprom?: unknown; [key: string]: unknown };
    getURL?(path: string): string;
    localStorage?: {
        getItemAsync(key: string): Promise<unknown>;
        setItemAsync(key: string, value: unknown): Promise<void>;
    };
    tabs?: {
        query(queryInfo: Record<string, unknown>): Promise<Array<{ id?: number; url?: string; [key: string]: unknown }>>;
        open(details: { url: string; [key: string]: unknown }): void;
        getCurrent(): Promise<{ id?: number; url?: string; [key: string]: unknown }>;
        insertCSS(tabId: number, details: { file?: string; css?: string; [key: string]: unknown }): Promise<void>;
    };
    closePopup(): void;
    hideStyle?: string;
    createProceduralFilter?: (o: unknown) => { exec(): Element[]; };
}

declare const vAPI: VAPI;

interface DOMListener {
    onDOMCreated(): void;
    onDOMChanged(addedNodes: Node[], removedNodes: boolean): void;
}

interface ProcessedResponse {
    id: number;
    hash?: number;
    blockedResources?: string[];
    netSelectorCacheCountMax?: number;
}

export function initDOMCollapser(): void {
    const messaging = vAPI.messaging;
    const toCollapse = new Map<number, Element[]>();
    const src1stProps: Record<string, string> = {
        audio: 'currentSrc',
        embed: 'src',
        iframe: 'src',
        img: 'currentSrc',
        object: 'data',
        video: 'currentSrc',
    };
    const src2ndProps: Record<string, string> = {
        audio: 'src',
        img: 'src',
        video: 'src',
    };
    const tagToTypeMap: Record<string, string> = {
        audio: 'media',
        embed: 'object',
        iframe: 'sub_frame',
        img: 'image',
        object: 'object',
        video: 'media',
    };
    let requestIdGenerator = 1;
    let processTimer: number | undefined;
    let cachedBlockedSet: Set<string> | undefined;
    let cachedBlockedSetHash: number | undefined;
    let cachedBlockedSetTimer: number | undefined;
    let toProcess: Element[] = [];
    let toFilter: { type: string; url: string }[] = [];
    let netSelectorCacheCount = 0;

    const cachedBlockedSetClear = function(): void {
        cachedBlockedSet = undefined;
        cachedBlockedSetHash = undefined;
        cachedBlockedSetTimer = undefined;
    };

    let collapseToken: string | undefined;

    const getCollapseToken = (): string => {
        if ( collapseToken === undefined ) {
            collapseToken = vAPI.randomToken();
            vAPI.userStylesheet.add(
                `[${collapseToken}]\n{display:none!important;}`,
                true
            );
        }
        return collapseToken;
    };

    const onProcessed = function(response: unknown): void {
        if ( response instanceof Object === false ) {
            toCollapse.clear();
            return;
        }

        const res = response as ProcessedResponse;
        const targets = toCollapse.get(res.id);
        if ( targets === undefined ) { return; }

        toCollapse.delete(res.id);
        if ( cachedBlockedSetHash !== res.hash ) {
            cachedBlockedSet = new Set(res.blockedResources);
            cachedBlockedSetHash = res.hash;
            if ( cachedBlockedSetTimer !== undefined ) {
                clearTimeout(cachedBlockedSetTimer);
            }
            cachedBlockedSetTimer = vAPI.setTimeout(cachedBlockedSetClear, 30000);
        }
        if ( cachedBlockedSet === undefined || cachedBlockedSet.size === 0 ) {
            return;
        }

        const selectors: string[] = [];
        const netSelectorCacheCountMax = (response as ProcessedResponse).netSelectorCacheCountMax ?? Infinity;

        for ( const target of targets ) {
            const tag = target.localName;
            if (tag === undefined) continue;
            let prop = src1stProps[tag];
            if ( prop === undefined ) { continue; }
            let src = (target as HTMLElement & Record<string, unknown>)[prop] as string;
            if ( typeof src !== 'string' || src.length === 0 ) {
                prop = src2ndProps[tag];
                if ( prop === undefined ) { continue; }
                src = (target as HTMLElement & Record<string, unknown>)[prop] as string;
                if ( typeof src !== 'string' || src.length === 0 ) { continue; }
            }
            if ( cachedBlockedSet.has(`${tagToTypeMap[tag]  } ${  src}`) === false ) {
                continue;
            }
            target.setAttribute(getCollapseToken(), '');
            if ( netSelectorCacheCount > netSelectorCacheCountMax ) { continue; }
            const value = target.getAttribute(prop);
            if ( value ) {
                selectors.push(`${tag}[${prop}="${CSS.escape(value)}"]`);
                netSelectorCacheCount += 1;
            }
        }

        if ( selectors.length === 0 ) { return; }
        messaging.send('contentscript', {
            what: 'cosmeticFiltersInjected',
            type: 'net',
            hostname: window.location.hostname,
            selectors,
        });
    };

    const send = function(): void {
        processTimer = undefined;
        const requestId = requestIdGenerator;
        toCollapse.set(requestId, toProcess);
        messaging.send('contentscript', {
            what: 'getCollapsibleBlockedRequests',
            id: requestId,
            frameURL: window.location.href,
            resources: toFilter,
            hash: cachedBlockedSetHash,
        }).then(response => {
            onProcessed(response);
        }).catch(() => {
            toCollapse.delete(requestId);
        });
        toProcess = [];
        toFilter = [];
        requestIdGenerator += 1;
    };

    const process = function(delay?: number): void {
        if ( toProcess.length === 0 ) { return; }
        if ( delay === 0 ) {
            if ( processTimer !== undefined ) {
                clearTimeout(processTimer);
            }
            send();
        } else if ( processTimer === undefined ) {
            processTimer = vAPI.setTimeout(send, delay || 20);
        }
    };

    const add = function(target: Element): void {
        toProcess[toProcess.length] = target;
    };

    const addMany = function(targets: HTMLCollectionOf<Element> | Element[]): void {
        for ( const target of targets ) {
            add(target);
        }
    };

    const iframeSourceModified = function(mutations: MutationRecord[]): void {
        for ( const mutation of mutations ) {
            addIFrame(mutation.target as HTMLIFrameElement, true);
        }
        process();
    };
    const iframeSourceObserver = new MutationObserver(iframeSourceModified);
    const iframeSourceObserverOptions: MutationObserverInit = {
        attributes: true,
        attributeFilter: [ 'src' ]
    };

    const addIFrame = function(iframe: HTMLIFrameElement, dontObserve?: boolean): void {
        if ( dontObserve !== true ) {
            iframeSourceObserver.observe(iframe, iframeSourceObserverOptions);
        }
        const src = iframe.src;
        if ( typeof src !== 'string' || src === '' ) { return; }
        if ( src.startsWith('http') === false ) { return; }
        toFilter.push({ type: 'sub_frame', url: iframe.src });
        add(iframe);
    };

    const addIFrames = function(iframes: HTMLCollectionOf<HTMLIFrameElement>): void {
        for ( const iframe of iframes ) {
            addIFrame(iframe);
        }
    };

    const onResourceFailed = function(ev: Event): void {
        const target = ev.target as Element;
        if ( target && tagToTypeMap[target.localName as string] !== undefined ) {
            add(target);
            process();
        }
    };

    const stop = function(): void {
        document.removeEventListener('error', onResourceFailed, true);
        if ( processTimer !== undefined ) {
            clearTimeout(processTimer);
        }
        iframeSourceObserver.disconnect();
        if ( vAPI.domWatcher instanceof Object ) {
            vAPI.domWatcher.removeListener(domWatcherInterface);
        }
        vAPI.shutdown.remove(stop);
        vAPI.domCollapser = null;
    };

    const start = function(): void {
        if ( vAPI.domWatcher instanceof Object ) {
            vAPI.domWatcher.addListener(domWatcherInterface);
        }
    };

    const domWatcherInterface: DOMListener = {
        onDOMCreated(): void {
            if ( vAPI instanceof Object === false ) { return; }
            if ( vAPI.domCollapser instanceof Object === false ) {
                if ( vAPI.domWatcher instanceof Object ) {
                    vAPI.domWatcher.removeListener(domWatcherInterface);
                }
                return;
            }
            const elems = document.images ||
                          document.getElementsByTagName('img');
            for ( const elem of elems ) {
                if ( elem.complete ) {
                    add(elem);
                }
            }
            const embeds = document.embeds || document.getElementsByTagName('embed');
            addMany(Array.from(embeds));
            addMany(Array.from(document.getElementsByTagName('object')));
            addIFrames(document.getElementsByTagName('iframe'));
            process(0);

            document.addEventListener('error', onResourceFailed, true);

            vAPI.shutdown.add(stop);
        },
        onDOMChanged(addedNodes: Node[]): void {
            if ( addedNodes.length === 0 ) { return; }
            for ( const node of addedNodes ) {
                const elem = node as Element;
                if ( elem.localName === 'iframe' ) {
                    addIFrame(elem as HTMLIFrameElement);
                }
                if ( elem.firstElementChild === null ) { continue; }
                const iframes = elem.getElementsByTagName('iframe');
                if ( iframes.length !== 0 ) {
                    addIFrames(iframes);
                }
            }
            process();
        }
    };

    vAPI.domCollapser = { start };
}

/******************************************************************************/
