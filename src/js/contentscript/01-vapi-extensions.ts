/*******************************************************************************

    uBlock Ultimate - Content Script Module
    vAPI Extensions - userStylesheet, SafeAnimationFrame

    These extensions are shared across all content script modules.

*******************************************************************************/

/******************************************************************************/

interface VAPI {
    effectiveSelf: Window;
    messaging: {
        send(channel: string, message: object): Promise<unknown>;
    };
    setTimeout(callback: () => void, ms: number): number;
    SafeAnimationFrame: new (callback: () => void) => { start(delay?: number): void; clear(): void };
    randomToken(): string;
    contentScript?: boolean;
    userStylesheet?: {
        installed: Set<string>;
        desired: Set<string>;
        add(cssText: string, now?: boolean): void;
        remove(cssText: string, now?: boolean): void;
        apply(callback?: () => void): Promise<void>;
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
    createProceduralFilter?: (o: unknown) => { exec(): Element[]; };
}


if ( typeof vAPI !== 'undefined' ) {

/******************************************************************************/

{
    let context = self as unknown as Window;
    try {
        while (
            context !== self.top &&
            (context.location.href.startsWith('about:blank') || context.location.href === 'about:srcdoc') &&
            context.parent.location.href
        ) {
            context = context.parent as Window;
        }
    } catch (_) {
        // Cross-origin parent — stay at current context
    }
    vAPI.effectiveSelf = context;
}

/******************************************************************************/

let _applyTail: Promise<void> | undefined;

type CSSOperationResponse = {
    ok?: boolean;
    added?: unknown;
    removed?: unknown;
    error?: unknown;
};

const _toCSSOpResponse = (value: unknown): CSSOperationResponse | null => {
    if ( value === null || typeof value !== 'object' ) { return null; }
    return value as CSSOperationResponse;
};

const _stringArrayOrEmpty = (value: unknown): string[] => {
    if ( !Array.isArray(value) ) { return []; }
    return value.filter((v): v is string => typeof v === 'string');
};

const _applyCSSDifference = async (
    ss: NonNullable<VAPI['userStylesheet']>,
    add: string[],
    remove: string[],
): Promise<void> => {
    const response = await vAPI.messaging.send('vapi', {
        what: 'userCSS',
        add,
        remove,
    });
    const result = _toCSSOpResponse(response);
    if ( result === null ) {
        throw new Error('Invalid CSS operation response');
    }
    if ( result.ok !== true ) {
        throw new Error(
            typeof result.error === 'string'
                ? result.error
                : 'CSS operation failed',
        );
    }
    const confirmedAdded = _stringArrayOrEmpty(result.added);
    const confirmedRemoved = _stringArrayOrEmpty(result.removed);
    for ( const css of confirmedAdded ) {
        ss.installed.add(css);
    }
    for ( const css of confirmedRemoved ) {
        ss.installed.delete(css);
    }
    const allAddConfirmed = add.every(css => confirmedAdded.includes(css));
    const allRemoveConfirmed = remove.every(css => confirmedRemoved.includes(css));
    if ( !allAddConfirmed || !allRemoveConfirmed ) {
        throw new Error('CSS operation response omitted completed operations');
    }
};

vAPI.userStylesheet = {
    installed: new Set<string>(),
    desired: new Set<string>(),
    async apply(callback?: () => void): Promise<void> {
        const previous = _applyTail;
        const ss = (vAPI as VAPI).userStylesheet!;
        const work = (async (): Promise<void> => {
            if ( previous !== undefined ) {
                try {
                    await previous;
                } catch {
                    // swallow so a prior failure does not poison the chain
                }
            }
            const add = Array.from(ss.desired)
                .filter(css => ss.installed.has(css) === false);
            const remove = Array.from(ss.installed)
                .filter(css => ss.desired.has(css) === false);
            if ( add.length === 0 && remove.length === 0 ) { return; }
            await _applyCSSDifference(ss, add, remove);
        })();
        _applyTail = work;
        try {
            await work;
        } finally {
            if ( _applyTail === work ) {
                _applyTail = undefined;
            }
            callback?.();
        }
    },
    add(cssText: string, now?: boolean): void {
        if ( cssText === '' ) { return; }
        this.desired.add(cssText);
        if ( now ) { void this.apply().catch((error: unknown) => { console.warn('[uBR] Immediate stylesheet apply failed', error); }); }
    },
    remove(cssText: string, now?: boolean): void {
        if ( cssText === '' ) { return; }
        this.desired.delete(cssText);
        if ( now ) { void this.apply().catch((error: unknown) => { console.warn('[uBR] Immediate stylesheet apply failed', error); }); }
    }
};

/******************************************************************************/

vAPI.SafeAnimationFrame = class SafeAnimationFrame {
    private fid: number | undefined;
    private tid: number | undefined;
    private callback: () => void;

    constructor(callback: () => void) {
        this.fid = undefined;
        this.tid = undefined;
        this.callback = callback;
    }

    start(delay?: number): void {
        if ( vAPI instanceof Object === false ) { return; }
        if ( delay === undefined ) {
            if ( this.fid === undefined ) {
                this.fid = requestAnimationFrame(() => { this.onRAF(); });
            }
            if ( this.tid === undefined ) {
                this.tid = vAPI.setTimeout(() => { this.onSTO(); }, 20000);
            }
            return;
        }
        if ( this.fid === undefined && this.tid === undefined ) {
            this.tid = vAPI.setTimeout(() => { this.macroToMicro(); }, delay);
        }
    }

    clear(): void {
        if ( this.fid !== undefined ) {
            cancelAnimationFrame(this.fid);
            this.fid = undefined;
        }
        if ( this.tid !== undefined ) {
            clearTimeout(this.tid);
            this.tid = undefined;
        }
    }

    private macroToMicro(): void {
        this.tid = undefined;
        this.start();
    }

    private onRAF(): void {
        if ( this.tid !== undefined ) {
            clearTimeout(this.tid);
            this.tid = undefined;
        }
        this.fid = undefined;
        this.callback();
    }

    private onSTO(): void {
        if ( this.fid !== undefined ) {
            cancelAnimationFrame(this.fid);
            this.fid = undefined;
        }
        this.tid = undefined;
        this.callback();
    }
};

/******************************************************************************/

} // end if (typeof vAPI !== 'undefined')
