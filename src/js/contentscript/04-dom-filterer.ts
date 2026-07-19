/*******************************************************************************

    uBlock Ultimate - Content Script Module
    DOM Filterer

    The DOM filterer is the heart of uBR's cosmetic filtering.

    DOMFilterer: adds procedural cosmetic filtering

*******************************************************************************/

interface SafeAnimationFrame {
    start(delay?: number): void;
    clear(): void;
    tid: number | undefined;
    fid: number | undefined;
}

interface UserStylesheet {
    desired: Set<string>;
    apply(callback?: () => void): Promise<void>;
    add(cssText: string, now?: boolean): void;
    remove(cssText: string, now?: boolean): void;
}

interface VAPI {
    hideStyle: string;
    DOMFilterer: new () => DOMFilterer;
    DOMProceduralFilterer: new (filterer: DOMFilterer) => DOMProceduralFilterer;
    SafeAnimationFrame: new (callback: () => void) => SafeAnimationFrame;
    userStylesheet: UserStylesheet;
    sanitizeProceduralSelectorsForPage?: (selectors: unknown[]) => unknown[];
    randomToken(): string;
    contentScript?: boolean;
    sanitizeCosmeticCSSForPage?(css: string): string;
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
    setTimeout?(fn: () => void, delay: number): number;
    createProceduralFilter?: (o: unknown) => { exec(): Element[]; };
}

declare const vAPI: VAPI;

interface DOMProceduralFilterer {
    commitNow(): void;
    masterToken: string;
    selectors: Map<string, unknown>;
    addProceduralSelectors(selectors: object[]): void;
    createProceduralFilter(o: object): object;
}

interface DOMFiltererListener {
    onFiltersetChanged(changes: {
        declarative?: string[];
        exceptions?: string[];
        procedural?: unknown[];
    }): void;
}

interface CSSDetails {
    mustInject?: boolean;
    silent?: boolean;
}

interface FilterSelectorOptions {
    bits?: number;
}

interface FilterSelectorResult {
    declarative: string[];
    exceptions: string[];
    procedural?: unknown[];
}

interface ProceduralSelectorObject {
    raw?: string;
    selector: string;
    tasks?: unknown[];
    [key: string]: unknown;
}

const proceduralOperatorNames = [
    'has-text',
    'upward',
    'has',
    'if-not',
    'if',
    'not',
    'min-text-length',
];

const rawSelectorFromProceduralInput = (input: unknown): string => {
    if ( typeof input === 'string' ) { return input; }
    if (
        input !== null &&
        typeof input === 'object' &&
        typeof (input as { selector?: unknown }).selector === 'string'
    ) {
        return (input as { selector: string }).selector;
    }
    return '';
};

const findProceduralArgumentEnd = (value: string, start: number): number => {
    let depth = 1;
    let quote = '';
    let inRegex = false;
    let escaped = false;

    for ( let i = start; i < value.length; i++ ) {
        const ch = value[i];
        if ( escaped ) {
            escaped = false;
            continue;
        }
        if ( ch === '\\' ) {
            escaped = true;
            continue;
        }
        if ( quote !== '' ) {
            if ( ch === quote ) { quote = ''; }
            continue;
        }
        if ( inRegex ) {
            if ( ch === '/' ) { inRegex = false; }
            continue;
        }
        if ( ch === '"' || ch === "'" ) {
            quote = ch;
            continue;
        }
        if ( ch === '/' ) {
            inRegex = true;
            continue;
        }
        if ( ch === '(' ) {
            depth += 1;
        } else if ( ch === ')' ) {
            depth -= 1;
            if ( depth === 0 ) { return i; }
        }
    }
    return -1;
};

const proceduralOperatorAt = (value: string, offset: number): string => {
    if ( value[offset] !== ':' ) { return ''; }
    for ( const name of proceduralOperatorNames ) {
        if ( value.startsWith(`${name}(`, offset + 1) ) {
            return name;
        }
    }
    return '';
};

const compileProceduralSelector = (raw: string): ProceduralSelectorObject | null => {
    raw = raw.trim();
    if ( raw === '' ) { return null; }
    if ( raw.startsWith('{') ) {
        try {
            const parsed = JSON.parse(raw);
            if (
                parsed !== null &&
                typeof parsed === 'object' &&
                typeof parsed.selector === 'string'
            ) {
                return parsed;
            }
        } catch {
        }
        return null;
    }

    let selector = '';
    const tasks: unknown[] = [];
    for ( let i = 0; i < raw.length; i++ ) {
        const operator = proceduralOperatorAt(raw, i);
        if ( operator === '' ) {
            selector += raw[i];
            continue;
        }
        const argStart = i + operator.length + 2;
        const argEnd = findProceduralArgumentEnd(raw, argStart);
        if ( argEnd === -1 ) {
            return null;
        }
        const arg = raw.slice(argStart, argEnd).trim();
        if ( operator === 'upward' ) {
            tasks.push([ operator, /^\d+$/.test(arg) ? parseInt(arg, 10) : arg ]);
        } else if ( operator === 'has' || operator === 'if' || operator === 'if-not' || operator === 'not' ) {
            const nested = compileProceduralSelector(arg);
            if ( nested === null ) { return null; }
            tasks.push([ operator, nested ]);
        } else if ( operator === 'min-text-length' ) {
            tasks.push([ operator, parseInt(arg, 10) || 0 ]);
        } else {
            tasks.push([ operator, arg ]);
        }
        i = argEnd;
    }

    if ( tasks.length === 0 ) { return null; }
    return {
        raw,
        selector: selector.trim(),
        tasks,
    };
};

const compileProceduralSelectorInput = (input: unknown): ProceduralSelectorObject | null => {
    if (
        input !== null &&
        typeof input === 'object' &&
        typeof (input as { selector?: unknown }).selector === 'string' &&
        Array.isArray((input as { tasks?: unknown }).tasks)
    ) {
        return input as ProceduralSelectorObject;
    }
    return compileProceduralSelector(rawSelectorFromProceduralInput(input));
};

class DOMFilterer {
    commitTimer: SafeAnimationFrame;
    disabled: boolean;
    listeners: DOMFiltererListener[];
    stylesheets: string[];
    exceptedCSSRules: string[];
    exceptions: string[];
    convertedProceduralFilters: object[];
    pendingProceduralSelectors: object[];
    proceduralFilterer: DOMProceduralFilterer | null;

    constructor() {
        this.commitTimer = new vAPI.SafeAnimationFrame(
            () => { this.commitNow(); }
        );
        this.disabled = false;
        this.listeners = [];
        this.stylesheets = [];
        this.exceptedCSSRules = [];
        this.exceptions = [];
        this.convertedProceduralFilters = [];
        this.pendingProceduralSelectors = [];
        this.proceduralFilterer = null;
    }

    explodeCSS(css: string): string[] {
        const out: string[] = [];
        const cssHide = `{${vAPI.hideStyle}}`;
        const blocks = css.trim().split(/\n\n+/);
        for ( const block of blocks ) {
            if ( block.endsWith(cssHide) === false ) { continue; }
            out.push(block.slice(0, -cssHide.length).trim());
        }
        return out;
    }

    addCSS(css: string, details: CSSDetails = {}): void {
        if ( typeof css !== 'string' || css.length === 0 ) { return; }
        if ( this.stylesheets.includes(css) ) { return; }
        this.stylesheets.push(css);
        if ( details.mustInject && this.disabled === false ) {
            vAPI.userStylesheet.add(css);
        }
        if ( this.hasListeners() === false ) { return; }
        if ( details.silent ) { return; }
        this.triggerListeners({ declarative: this.explodeCSS(css) });
    }

    exceptCSSRules(exceptions: string[]): void {
        if ( exceptions.length === 0 ) { return; }
        this.exceptedCSSRules.push(...exceptions);
        if ( this.hasListeners() ) {
            this.triggerListeners({ exceptions });
        }
    }

    addListener(listener: DOMFiltererListener): void {
        if ( this.listeners.indexOf(listener) !== -1 ) { return; }
        this.listeners.push(listener);
    }

    removeListener(listener: DOMFiltererListener): void {
        const pos = this.listeners.indexOf(listener);
        if ( pos === -1 ) { return; }
        this.listeners.splice(pos, 1);
    }

    hasListeners(): boolean {
        return this.listeners.length !== 0;
    }

    triggerListeners(changes: {
        declarative?: string[];
        exceptions?: string[];
        procedural?: unknown[];
    }): void {
        for ( const listener of this.listeners ) {
            listener.onFiltersetChanged(changes);
        }
    }

    async toggle(state?: boolean, callback?: () => void): Promise<void> {
        if ( state === undefined ) { state = this.disabled; }
        if ( state !== this.disabled ) { return; }
        this.disabled = !state;
        const uss = vAPI.userStylesheet;
        for ( const css of this.stylesheets ) {
            if ( this.disabled ) {
                uss.remove(css);
            } else {
                uss.add(css);
            }
        }
        await uss.apply();
        if ( typeof callback === 'function' ) { callback(); }
    }

    commitNow(): void {
        this.commitTimer.clear();
        if ( vAPI instanceof Object === false ) { return; }
        void vAPI.userStylesheet.apply().catch((error: unknown) => {
            console.warn('[uBR] DOMFilterer stylesheet commit failed', error);
        });
        const pfilterer = this.proceduralFiltererInstance();
        if ( pfilterer instanceof Object ) {
            pfilterer.commitNow();
        }
    }

    commit(commitNow: boolean): void {
        if ( commitNow ) {
            this.commitTimer.clear();
            this.commitNow();
        } else {
            this.commitTimer.start();
        }
    }

    proceduralFiltererInstance(): DOMProceduralFilterer | null {
        if ( this.proceduralFilterer instanceof Object === false ) {
            if ( vAPI.DOMProceduralFilterer instanceof Object === false ) {
                return null;
            }
            this.proceduralFilterer = new vAPI.DOMProceduralFilterer(this);
            this.flushPendingProceduralSelectors(this.proceduralFilterer);
        }
        return this.proceduralFilterer;
    }

    flushPendingProceduralSelectors(pfilterer: DOMProceduralFilterer): void {
        if ( this.pendingProceduralSelectors.length === 0 ) { return; }
        const selectors = this.pendingProceduralSelectors;
        this.pendingProceduralSelectors = [];
        pfilterer.addProceduralSelectors(selectors);
    }

    addProceduralSelectors(selectors: unknown[]): void {
        const procedurals: object[] = [];
        const sanitized = typeof vAPI.sanitizeProceduralSelectorsForPage === 'function'
            ? vAPI.sanitizeProceduralSelectorsForPage(selectors)
            : selectors;
        for ( const raw of sanitized ) {
            const compiled = compileProceduralSelectorInput(raw);
            if ( compiled !== null ) {
                procedurals.push(compiled);
            }
        }
        if ( procedurals.length === 0 ) { return; }
        const pfilterer = this.proceduralFiltererInstance();
        if ( pfilterer === null ) {
            this.pendingProceduralSelectors.push(...procedurals);
            return;
        }
        pfilterer.addProceduralSelectors(procedurals);
    }

    createProceduralFilter(o: object | string): object | undefined {
        const pfilterer = this.proceduralFiltererInstance();
        if ( pfilterer === null ) { return; }
        const compiled = compileProceduralSelectorInput(o);
        if ( compiled === null ) { return; }
        return pfilterer.createProceduralFilter(compiled);
    }

    getAllSelectors(bits: number = 0): FilterSelectorResult {
        const out: FilterSelectorResult = {
            declarative: [],
            exceptions: this.exceptedCSSRules,
        };
        const hasProcedural = this.proceduralFilterer instanceof Object;
        const includePrivateSelectors = (bits & 0b01) !== 0;
        const masterToken = hasProcedural
            ? `[${(this.proceduralFilterer as DOMProceduralFilterer).masterToken}]`
            : undefined;
        for ( const css of this.stylesheets ) {
            for ( const block of this.explodeCSS(css) ) {
                if (
                    includePrivateSelectors === false &&
                    masterToken !== undefined &&
                    block.startsWith(masterToken)
                ) {
                    continue;
                }
                out.declarative.push(block);
            }
        }
        const excludeProcedurals = (bits & 0b10) !== 0;
        if ( excludeProcedurals === false ) {
            out.procedural = [];
            if ( hasProcedural ) {
                out.procedural.push(
                    ...(this.proceduralFilterer as DOMProceduralFilterer).selectors.values()
                );
            }
            const proceduralFilterer = this.proceduralFiltererInstance();
            if ( proceduralFilterer !== null ) {
                for ( const json of this.convertedProceduralFilters ) {
                    const pfilter = proceduralFilterer.createProceduralFilter(json);
                    (pfilter as { converted?: boolean }).converted = true;
                    out.procedural!.push(pfilter);
                }
            }
        }
        return out;
    }

    getAllExceptionSelectors(): string {
        return this.exceptions.join(',\n');
    }
}

export function initDOMFilterer(): typeof DOMFilterer {
    vAPI.hideStyle = 'display:none!important;';

    vAPI.DOMFilterer = DOMFilterer;

    return vAPI.DOMFilterer;
}

/******************************************************************************/
