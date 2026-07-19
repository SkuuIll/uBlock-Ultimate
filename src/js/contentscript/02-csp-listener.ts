/*******************************************************************************

    uBlock Ultimate - Content Script Module
    CSP Violation Listener

    Listens and reports CSP violations so that blocked resources through CSP
    are properly reported in the logger.

*******************************************************************************/

interface SecurityPolicyViolationEvent extends Event {
    isTrusted: boolean;
    disposition: string;
    blockedURL?: string;
    blockedURI?: string;
    originalPolicy: string;
    effectiveDirective?: string;
    violatedDirective?: string;
}

interface ShutdownCallbacks {
    add(callback: () => void): void;
    remove(callback: () => void): void;
}

interface VAPIMessaging {
    send(channel: string, message: object): Promise<unknown>;
}

interface VAPI {
    shutdown: ShutdownCallbacks;
    messaging: VAPIMessaging;
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

export function initCSPlistener(): void {
    const newEvents = new Set<string>();
    const allEvents = new Set<string>();
    let timer: number | undefined;

    const send = function(): void {
        if ( vAPI instanceof Object === false ) { return; }
        Promise.resolve(vAPI.messaging?.send?.('scriptlets', {
            what: 'securityPolicyViolation',
            type: 'net',
            docURL: document.location.href,
            violations: Array.from(newEvents),
        })).then(response => {
            if ( response === true ) { return; }
            stop();
        }).catch(e => {
            console.warn('[uBR] csp-listener: securityPolicyViolation send failed', e);
        });
        for ( const event of newEvents ) {
            allEvents.add(event);
        }
        newEvents.clear();
    };

    const sendAsync = function(): void {
        if ( timer !== undefined ) { return; }
        timer = self.requestIdleCallback(
            () => { timer = undefined; send(); },
            { timeout: 2063 }
        );
    };

    const listener = function(ev: Event): void {
        const cspEv = ev as SecurityPolicyViolationEvent;
        if ( cspEv.isTrusted !== true ) { return; }
        if ( cspEv.disposition !== 'enforce' ) { return; }
        const json = JSON.stringify({
            url: cspEv.blockedURL || cspEv.blockedURI,
            policy: cspEv.originalPolicy,
            directive: cspEv.effectiveDirective || cspEv.violatedDirective,
        });
        if ( allEvents.has(json) ) { return; }
        newEvents.add(json);
        sendAsync();
    };

    const stop = function(): void {
        newEvents.clear();
        allEvents.clear();
        if ( timer !== undefined ) {
            self.cancelIdleCallback(timer);
            timer = undefined;
        }
        document.removeEventListener('securitypolicyviolation', listener);
        if ( vAPI?.shutdown?.remove instanceof Function ) { vAPI.shutdown.remove(stop); }
    };

    document.addEventListener('securitypolicyviolation', listener);
    if ( vAPI?.shutdown?.add instanceof Function ) {
        vAPI.shutdown.add(stop);
    }

    sendAsync();
}

/******************************************************************************/
