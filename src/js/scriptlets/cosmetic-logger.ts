/*******************************************************************************

    uBlock Ultimate - a comprehensive, efficient content blocker
    Copyright (C) 2015-present Raymond Hill

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

/******************************************************************************/

(( ) => {
// >>>>>>>> start of private namespace

/******************************************************************************/

const runtimeApi = (typeof browser !== 'undefined' ? browser : chrome)?.runtime;

// Duplicate-injection guard
if (
    typeof vAPI === 'object' &&
    vAPI !== null &&
    (vAPI as any).cosmeticLoggerActive === true
) {
    return;
}
if (typeof vAPI === 'object' && vAPI !== null) {
    (vAPI as any).cosmeticLoggerActive = true;
}

interface vAPI {
    domWatcher: {
        addListener: (handlers: object) => void;
        removeListener: (handlers: object) => void;
    } | null;
    domFilterer: {
        getAllSelectors: () => {
            declarative?: string[];
            procedural?: Array<{ raw: string; hit?: boolean; exec: () => Element[] }>;
            exceptions?: string[];
        } | null;
        createProceduralFilter: (details: unknown) => {
            test: () => boolean;
            exec: () => Element[];
            raw: string;
        };
        addListener: (handlers: object) => void;
        removeListener: (handlers: object) => void;
        toggle: (state: boolean, callback?: () => void) => void;
    } | null;
    messaging: {
        send: (channel: string, msg: object) => void;
    };
    effectiveSelf: { location: { href: string; hostname: string } };
    SafeAnimationFrame: new (callback: () => void) => {
        start: (delay?: number) => void;
        clear: () => void;
    };
}

interface ProceduralFilter {
    raw: string;
    hit?: boolean;
    converted?: boolean;
    selector?: string;
    exec: () => Element[];
    test: () => boolean;
}

interface AllSelectors {
    declarative?: string[];
    procedural?: ProceduralFilter[];
    exceptions?: string[];
}

type CosmeticLoggerRecord = {
    raw: string;
    type: 'dom' | 'scriptlet';
    result: 1 | 2;
};

const blockRecord = (raw: string): CosmeticLoggerRecord => {
    const normalized = /^#@?#/.test(raw) ? raw : `##${raw}`;
    return {
        raw: normalized,
        type: /^#@?#\+js\(/.test(normalized) ? 'scriptlet' : 'dom',
        result: 1,
    };
};

const exceptionRecord = (raw: string): CosmeticLoggerRecord => {
    let normalized = raw;
    if (normalized.startsWith('##')) {
        normalized = `#@#${normalized.slice(2)}`;
    } else if (!normalized.startsWith('#@#')) {
        normalized = `#@#${normalized}`;
    }
    return {
        raw: normalized,
        type: /^#@#\+js\(/.test(normalized) ? 'scriptlet' : 'dom',
        result: 2,
    };
};

if ( typeof vAPI !== 'object' ) { return; }
if ( vAPI.domWatcher instanceof Object === false ) { return; }

const reHasCSSCombinators = /[ >+~]/;
const simpleDeclarativeSet = new Set<string>();
let simpleDeclarativeStr: string | undefined;
const complexDeclarativeSet = new Set<string>();
let complexDeclarativeStr: string | undefined;
const proceduralDict = new Map<string, ProceduralFilter>();
const exceptionDict = new Map<string, string>();
let exceptionStr: string | undefined;
const proceduralExceptionDict = new Map<string, ReturnType<vAPI['domFilterer']['createProceduralFilter']>>();
const nodesToProcess = new Set<Element | Document>();
const loggedSelectors = new Set<string>();

/******************************************************************************/

const rePseudoElements = /:(?::?after|:?before|:[a-z-]+)$/;

function hasSelector(selector: string, context: Document | Element = document): boolean {
    try {
        return context.querySelector(selector) !== null;
    }
    catch (e) {
        console.warn('[uBR] cosmetic-logger: hasSelector failed', e);
    }
    return false;
}

function safeMatchSelector(selector: string, context: Document | Element): boolean {
    const safeSelector = rePseudoElements.test(selector)
        ? selector.replace(rePseudoElements, '')
        : selector;
    try {
        return context.matches(safeSelector);
    }
    catch (e) {
        console.warn('[uBR] cosmetic-logger: safeMatchSelector failed', e);
    }
    return false;
}

function safeQuerySelector(selector: string, context: Document | Element = document): Element | null {
    const safeSelector = rePseudoElements.test(selector)
        ? selector.replace(rePseudoElements, '')
        : selector;
    try {
        return context.querySelector(safeSelector);
    }
    catch (e) {
        console.warn('[uBR] cosmetic-logger: safeQuerySelector failed', e);
    }
    return null;
}

function safeGroupSelectors(selectors: string[] | Iterable<string>): string {
    const arr = Array.isArray(selectors)
        ? selectors
        : Array.from(selectors);
    return arr.map(s => {
        return rePseudoElements.test(s)
            ? s.replace(rePseudoElements, '')
            : s;
    }).join(',\n');
}

/******************************************************************************/

function processDeclarativeSimple(node: Element | Document, out: CosmeticLoggerRecord[]) {
    if ( simpleDeclarativeSet.size === 0 ) { return; }
    if ( simpleDeclarativeStr === undefined ) {
        simpleDeclarativeStr = safeGroupSelectors(simpleDeclarativeSet);
    }
    if (
        (node === document || node.matches(simpleDeclarativeStr) === false) &&
        (hasSelector(simpleDeclarativeStr, node) === false)
    ) {
        return;
    }
    for ( const selector of simpleDeclarativeSet ) {
        if (
            (node === document || safeMatchSelector(selector, node) === false) &&
            (safeQuerySelector(selector, node) === null)
        ) {
            continue;
        }
        out.push(blockRecord(selector));
        simpleDeclarativeSet.delete(selector);
        simpleDeclarativeStr = undefined;
        loggedSelectors.add(selector);
    }
}

/******************************************************************************/

function processDeclarativeComplex(out: CosmeticLoggerRecord[]) {
    if ( complexDeclarativeSet.size === 0 ) { return; }
    if ( complexDeclarativeStr === undefined ) {
        complexDeclarativeStr = safeGroupSelectors(complexDeclarativeSet);
    }
    if ( hasSelector(complexDeclarativeStr) === false ) { return; }
    for ( const selector of complexDeclarativeSet ) {
        if ( safeQuerySelector(selector) === null ) { continue; }
        out.push(blockRecord(selector));
        complexDeclarativeSet.delete(selector);
        complexDeclarativeStr = undefined;
        loggedSelectors.add(selector);
    }
}

/******************************************************************************/

function processProcedural(out: CosmeticLoggerRecord[]) {
    if ( proceduralDict.size === 0 ) { return; }
    for ( const [ raw, pselector ] of proceduralDict ) {
        if ( pselector.converted ) {
            if ( safeQuerySelector(pselector.selector) === null ) { continue; }
        } else if ( pselector.hit === false && pselector.exec().length === 0 ) {
            continue;
        }
        out.push(blockRecord(raw));
        proceduralDict.delete(raw);
    }
}

/******************************************************************************/

function processExceptions(out: CosmeticLoggerRecord[]) {
    if ( exceptionDict.size === 0 ) { return; }
    if ( exceptionStr === undefined ) {
        exceptionStr = safeGroupSelectors(exceptionDict.keys());
    }
    if ( hasSelector(exceptionStr) === false ) { return; }
    for ( const [ selector, raw ] of exceptionDict ) {
        if ( safeQuerySelector(selector) === null ) { continue; }
        out.push(exceptionRecord(raw));
        exceptionDict.delete(selector);
        exceptionStr = undefined;
        loggedSelectors.add(raw);
    }
}

/******************************************************************************/

function processProceduralExceptions(out: CosmeticLoggerRecord[]) {
    if ( proceduralExceptionDict.size === 0 ) { return; }
    for ( const exception of proceduralExceptionDict.values() ) {
        if ( exception.test() === false ) { continue; }
        out.push(exceptionRecord(exception.raw));
        proceduralExceptionDict.delete(exception.raw);
    }
}

/******************************************************************************/

const processTimer = new vAPI.SafeAnimationFrame(( ) => {
    processTimer.clear();
    if ( nodesToProcess.size === 0 ) { return; }

    if ( nodesToProcess.size !== 1 && nodesToProcess.has(document) ) {
        nodesToProcess.clear();
        nodesToProcess.add(document);
    }

    const toLog: CosmeticLoggerRecord[] = [];
    if ( simpleDeclarativeSet.size !== 0 ) {
        for ( const node of nodesToProcess ) {
            processDeclarativeSimple(node, toLog);
        }
    }

    processDeclarativeComplex(toLog);
    processProcedural(toLog);
    processExceptions(toLog);
    processProceduralExceptions(toLog);

    nodesToProcess.clear();

    if ( toLog.length === 0 ) { return; }

    const location = vAPI.effectiveSelf.location;

    vAPI.messaging.send('scriptlets', {
        what: 'logCosmeticFilteringData',
        frameURL: location.href,
        frameHostname: location.hostname,
        entries: toLog,
    });
});

/******************************************************************************/

const attributeObserver = new MutationObserver(mutations => {
    if ( nodesToProcess.has(document) ) { return; }
    for ( const mutation of mutations ) {
        const node = mutation.target;
        if ( node.nodeType !== 1 ) { continue; }
        nodesToProcess.add(node as Element);
    }
    if ( nodesToProcess.size !== 0 ) {
        processTimer.start(100);
    }
});

/******************************************************************************/

interface Handlers {
    onFiltersetChanged: (changes: AllSelectors) => void;
    onDOMCreated: () => void;
    onDOMChanged: (addedNodes: Element[]) => void;
}

const handlers: Handlers = {
    onFiltersetChanged: function(changes: AllSelectors) {
        for ( const block of (changes.declarative || []) ) {
            for ( const selector of block.split(',\n') ) {
                if ( loggedSelectors.has(selector) ) { continue; }
                if ( reHasCSSCombinators.test(selector) ) {
                    complexDeclarativeSet.add(selector);
                    complexDeclarativeStr = undefined;
                } else {
                    simpleDeclarativeSet.add(selector);
                    simpleDeclarativeStr = undefined;
                }
            }
        }
        if (
            Array.isArray(changes.procedural) &&
            changes.procedural.length !== 0
        ) {
            for ( const selector of changes.procedural ) {
                proceduralDict.set(selector.raw, selector as ProceduralFilter);
            }
        }
        if ( Array.isArray(changes.exceptions) ) {
            for ( const selector of changes.exceptions ) {
                if ( loggedSelectors.has(selector) ) { continue; }
                if ( selector.charCodeAt(0) !== 0x7B /* '{' */ ) {
                    exceptionDict.set(selector, selector);
                    continue;
                }
                let details;
                try {
                    details = JSON.parse(selector);
                } catch {
                    exceptionDict.set(selector, selector);
                    continue;
                }
                if (
                    details.action !== undefined &&
                    details.tasks === undefined &&
                    details.action[0] === 'style'
                ) {
                    exceptionDict.set(details.selector, details.raw);
                    continue;
                }
                proceduralExceptionDict.set(
                    details.raw,
                    vAPI.domFilterer!.createProceduralFilter(details)
                );
            }
            exceptionStr = undefined;
        }
        nodesToProcess.clear();
        nodesToProcess.add(document);
        processTimer.start(1);
    },

    onDOMCreated: function() {
        if ( vAPI.domFilterer instanceof Object === false ) {
            return shutdown();
        }
        handlers.onFiltersetChanged(vAPI.domFilterer.getAllSelectors());
        vAPI.domFilterer.addListener(handlers);
        attributeObserver.observe(document.body, {
            attributes: true,
            subtree: true
        });
    },

    onDOMChanged: function(addedNodes: Element[]) {
        if ( nodesToProcess.has(document) ) { return; }
        for ( const node of addedNodes ) {
            if ( node.parentNode === null ) { continue; }
            nodesToProcess.add(node);
        }
        if ( nodesToProcess.size !== 0 ) {
            processTimer.start(100);
        }
    }
};

vAPI.domWatcher.addListener(handlers);

/******************************************************************************/

const broadcastHandler = (msg: { what: string }) => {
    if ( msg.what === 'loggerDisabled' ) {
        shutdown();
    }
};

runtimeApi?.onMessage?.addListener(broadcastHandler);

/******************************************************************************/

function shutdown() {
    if (typeof vAPI === 'object' && vAPI !== null) {
        (vAPI as any).cosmeticLoggerActive = false;
    }
    runtimeApi?.onMessage?.removeListener(broadcastHandler);
    processTimer.clear();
    attributeObserver.disconnect();
    if ( typeof vAPI !== 'object' ) { return; }
    if ( vAPI.domFilterer instanceof Object ) {
        vAPI.domFilterer.removeListener(handlers);
    }
    if ( vAPI.domWatcher instanceof Object ) {
        vAPI.domWatcher.removeListener(handlers);
    }
}

/******************************************************************************/

// <<<<<<<< end of private namespace
})();

/*******************************************************************************

    DO NOT:
    - Remove the following code
    - Add code beyond the following code
    Reason:
    - https://github.com/gorhill/uBlock/pull/3721
    - uBR never uses the return value from injected content scripts

**/

void 0;
