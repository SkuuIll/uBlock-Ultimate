/*******************************************************************************

    uBlock Ultimate - Content Script Module
    DOM Watcher

    Watches for changes in the DOM and notifies other components about these
    changes.

    Interface:
    - vAPI.domWatcher.start()
    - vAPI.domWatcher.addListener(listener)
    - vAPI.domWatcher.removeListener(listener)

    Listener interface:
    - listener.onDOMCreated() - called when DOM is ready
    - listener.onDOMChanged(addedNodes, removedNodes) - called on DOM mutations

*******************************************************************************/

import { initCSPlistener } from './02-csp-listener.js';

interface DOMListener {
    onDOMCreated(): void;
    onDOMChanged(addedNodes: Node[], removedNodes: boolean): void;
}

interface ShutdownCallbacks {
    add(callback: () => void): void;
    remove(callback: () => void): void;
}

interface SafeAnimationFrame {
    start(delay?: number): void;
    clear(): void;
    tid: number | undefined;
    fid: number | undefined;
}

interface VAPI {
    domMutationTime: number;
    shutdown: ShutdownCallbacks;
    SafeAnimationFrame: new (callback: () => void) => SafeAnimationFrame;
    domWatcher: {
        start(): void;
        addListener(listener: DOMListener): void;
        removeListener(listener: DOMListener): void;
    };
    randomToken(): string;
    contentScript?: boolean;
    userStylesheet?: {
        added: Set<string>;
        removed: Set<string>;
        installed: Set<string>;
        desired: Set<string>;
        add(cssText: string, now?: boolean): void;
        remove(cssText: string, now?: boolean): void;
        apply(callback?: () => void): void | Promise<void>;
    };
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
    setTimeout?(fn: () => void, delay: number): number;
    createProceduralFilter?: (o: unknown) => { exec(): Element[]; };
}

declare const vAPI: VAPI;

export function initDOMWatcher(afterInit?: () => void): void {
    vAPI.domMutationTime = Date.now();

    const addedNodeLists: NodeList[] = [];
    const removedNodeLists: NodeList[] = [];
    const addedNodes: Node[] = [];
    const ignoreTags = new Set([ 'br', 'head', 'link', 'meta', 'script', 'style' ]);
    const listeners: DOMListener[] = [];

    let domLayoutObserver: MutationObserver | undefined;
    let listenerIterator: DOMListener[] = [];
    let listenerIteratorDirty = false;
    let removedNodes = false;
    let safeObserverHandlerTimer: SafeAnimationFrame | undefined;

    const safeObserverHandler = function(): void {
        let i = addedNodeLists.length;
        while ( i-- ) {
            const nodeList = addedNodeLists[i];
            let iNode = nodeList.length;
            while ( iNode-- ) {
                const node = nodeList[iNode];
                if ( node.nodeType !== 1 ) { continue; }
                if ( ignoreTags.has((node as Element).localName) ) { continue; }
                if ( node.parentElement === null ) { continue; }
                addedNodes.push(node);
            }
        }
        addedNodeLists.length = 0;
        i = removedNodeLists.length;
        while ( i-- && removedNodes === false ) {
            const nodeList = removedNodeLists[i];
            let iNode = nodeList.length;
            while ( iNode-- ) {
                if ( nodeList[iNode].nodeType !== 1 ) { continue; }
                removedNodes = true;
                break;
            }
        }
        removedNodeLists.length = 0;
        if ( addedNodes.length === 0 && removedNodes === false ) { return; }
        for ( const listener of getListenerIterator() ) {
            try { listener.onDOMChanged(addedNodes, removedNodes); }
            catch (e) { console.warn('[uBR] dom-watcher: onDOMChanged listener failed', e); }
        }
        addedNodes.length = 0;
        removedNodes = false;
        vAPI.domMutationTime = Date.now();
    };

    const observerHandler = function(mutations: MutationRecord[]): void {
        let i = mutations.length;
        while ( i-- ) {
            const mutation = mutations[i];
            if ( mutation.addedNodes.length !== 0 ) {
                addedNodeLists.push(mutation.addedNodes);
            }
            if ( mutation.removedNodes.length !== 0 ) {
                removedNodeLists.push(mutation.removedNodes);
            }
        }
        if ( addedNodeLists.length !== 0 || removedNodeLists.length !== 0 ) {
            safeObserverHandlerTimer!.start(
                addedNodeLists.length < 100 ? 1 : undefined
            );
        }
    };

    const startMutationObserver = function(): void {
        if ( domLayoutObserver !== undefined ) { return; }
        domLayoutObserver = new MutationObserver(observerHandler);
        domLayoutObserver.observe(document, {
            childList: true,
            subtree: true
        });
        safeObserverHandlerTimer = new vAPI.SafeAnimationFrame(safeObserverHandler);
        if ( vAPI?.shutdown?.add instanceof Function ) {
            vAPI.shutdown.add(cleanup);
        }
    };

    const stopMutationObserver = function(): void {
        if ( domLayoutObserver === undefined ) { return; }
        cleanup();
        if ( vAPI?.shutdown?.remove instanceof Function ) {
            vAPI.shutdown.remove(cleanup);
        }
    };

    const getListenerIterator = function(): DOMListener[] {
        if ( listenerIteratorDirty ) {
            listenerIterator = listeners.slice();
            listenerIteratorDirty = false;
        }
        return listenerIterator;
    };

    const addListener = function(listener: DOMListener): void {
        if ( listeners.indexOf(listener) !== -1 ) { return; }
        listeners.push(listener);
        listenerIteratorDirty = true;
        if ( domLayoutObserver === undefined ) { return; }
        try { listener.onDOMCreated(); }
        catch (e) { console.warn('[uBR] dom-watcher: addListener onDOMCreated failed', e); }
        startMutationObserver();
    };

    const removeListener = function(listener: DOMListener): void {
        const pos = listeners.indexOf(listener);
        if ( pos === -1 ) { return; }
        listeners.splice(pos, 1);
        listenerIteratorDirty = true;
        if ( listeners.length === 0 ) {
            stopMutationObserver();
        }
    };

    const cleanup = function(): void {
        if ( domLayoutObserver !== undefined ) {
            domLayoutObserver.disconnect();
            domLayoutObserver = undefined;
        }
        if ( safeObserverHandlerTimer !== undefined ) {
            safeObserverHandlerTimer.clear();
            safeObserverHandlerTimer = undefined;
        }
    };

    const start = function(): void {
        for ( const listener of getListenerIterator() ) {
            try { listener.onDOMCreated(); }
            catch (e) { console.warn('[uBR] dom-watcher: start onDOMCreated failed', e); }
        }
        startMutationObserver();
    };

    initCSPlistener();

    vAPI.domWatcher = { start, addListener, removeListener };

    if ( typeof afterInit === 'function' ) {
        afterInit();
    }
}

/******************************************************************************/
