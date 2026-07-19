import { dom, qs$ } from '../dom.js';
import { i18n$ } from '../i18n.js';

declare const self: globalThis;
declare const vAPI: {
    defer: {
        create: (callback: () => void) => {
            offon: (ms: number) => void;
            off: () => void;
        };
    };
};

declare global {
    interface Window {
        CodeMirror: CodeMirrorEditor;
    }
}

interface CodeMirrorPos {
    line: number;
    ch: number;
}

interface CodeMirrorChange {
    text: string[];
    removed: string[];
    from: CodeMirrorPos;
    to: CodeMirrorPos;
}

interface CodeMirrorLineHandle {
    lineNo(): number;
    gutterMarkers: Record<string, HTMLElement> | null;
}

interface CodeMirrorState {
    search?: SearchState;
}

interface CodeMirrorEditor {
    (elem: HTMLElement | string, options?: object): CodeMirrorEditor;
    Pos: new (line: number, ch?: number) => CodeMirrorPos;
    defineOption: (name: string, defaultValue: unknown, callback: (cm: CodeMirrorEditor, value: unknown) => void) => void;
    defineInitHook: (callback: (cm: CodeMirrorEditor) => void) => void;
    keyName: (event: KeyboardEvent) => string | null;
    lookupKey: (name: string, keyMap: object, handler: (command: string) => void) => void;
    commands: Record<string, (cm: CodeMirrorEditor) => void>;
    getWrapperElement: () => HTMLElement | null;
    getOption: <T>(name: string) => T;
    getSearchCursor: (query: RegExp, pos: CodeMirrorPos, options: { caseFold: boolean; multiline: boolean }) => SearchCursor;
    addOverlay: (overlay: object) => void;
    removeOverlay: (overlay: object) => void;
    getValue: () => string;
    getCursor: (hint?: string) => CodeMirrorPos;
    setSelection: (from: CodeMirrorPos, to: CodeMirrorPos) => void;
    getScrollInfo: () => { clientHeight: number };
    scrollIntoView: (pos: CodeMirrorPos | { from: CodeMirrorPos; to: CodeMirrorPos }, margin?: number) => void;
    getDoc: () => CodeMirrorDoc;
    lastLine: () => number;
    firstLine: () => number;
    on: (event: string, handler: (cm: CodeMirrorEditor, ...args: unknown[]) => void) => void;
    addPanel: (node: HTMLElement) => { clear: () => void };
    getSelection: () => string;
    findWordAt: (pos: CodeMirrorPos) => { anchor: CodeMirrorPos; head: CodeMirrorPos };
    getRange: (from: CodeMirrorPos, to: CodeMirrorPos) => string;
    setCursor: (pos: CodeMirrorPos) => void;
    operation: <T>(fn: () => T) => T;
    annotateScrollbar: (className: string) => {
        update: (annotations: Array<{ from: CodeMirrorPos; to: CodeMirrorPos }>) => void;
        clear: () => void;
    };
    state: CodeMirrorState;
}

interface SearchCursor {
    find: (backward: boolean) => boolean;
    from: () => CodeMirrorPos;
    to: () => CodeMirrorPos;
}

interface CodeMirrorDoc {
    eachLine: (start: number, end: number, callback: (line: CodeMirrorLineHandle) => void | boolean) => void;
    lineCount: () => number;
    setCursor: (pos: CodeMirrorPos) => void;
}

interface SearchState {
    query: RegExp | null;
    queryText: string;
    panel: { clear: () => void } | null;
    widget: HTMLElement;
    dirty: boolean;
    lines: number[];
    overlay: object | undefined;
    annotate: { clear: () => void } | undefined;
    queryTimer: {
        offon: (ms: number) => void;
        off: () => void;
    };
}

interface SearchThread {
    needHaystack: () => boolean;
    setHaystack: (value: string) => void;
    search: (query: RegExp) => Promise<number[]>;
}

declare const searchThread: SearchThread;

{
    const CodeMirror = self.CodeMirror;

    CodeMirror.defineOption('maximizable', true, (cm, maximizable) => {
        if ( typeof maximizable !== 'boolean' ) { return; }
        const wrapper = cm.getWrapperElement();
        if ( wrapper === null ) { return; }
        const container = wrapper.closest('.codeMirrorContainer');
        if ( container === null ) { return; }
        container.dataset.maximizable = `${maximizable}`;
    });

    const searchOverlay = function(query: RegExp | string, caseInsensitive: boolean) {
        if ( typeof query === 'string' )
            query = new RegExp(
                query.replace(/[-[\]/{}()*+?.\\^$|]/g, '\\$&'),
                caseInsensitive ? 'gi' : 'g'
            );
        else if ( !query.global )
            query = new RegExp(query.source, query.ignoreCase ? 'gi' : 'g');

        return {
            token: function(stream: { pos: number; string: string; skipToEnd: () => void }) {
                query.lastIndex = stream.pos;
                const match = query.exec(stream.string);
                if ( match && match.index === stream.pos ) {
                    stream.pos += match[0].length || 1;
                    return 'searching';
                } else if ( match ) {
                    stream.pos = match.index;
                } else {
                    stream.skipToEnd();
                }
            }
        };
    };

    const searchWidgetKeydownHandler = function(cm: CodeMirrorEditor, ev: KeyboardEvent) {
        const keyName = CodeMirror.keyName(ev);
        if ( !keyName ) { return; }
        CodeMirror.lookupKey(
            keyName,
            cm.getOption('keyMap'),
            (command: string) => {
                if ( widgetCommandHandler(cm, command) ) {
                    ev.preventDefault();
                    ev.stopPropagation();
                }
            }
        );
    };

    const searchWidgetInputHandler = function(cm: CodeMirrorEditor, ev: Event) {
        const state = getSearchState(cm);
        if ( (ev as InputEvent).isTrusted !== true ) {
            if ( state.queryText === '' ) {
                clearSearch(cm);
            } else {
                cm.operation(() => {
                    startSearch(cm, state);
                });
            }
            return;
        }
        if ( queryTextFromSearchWidget(cm) === state.queryText ) { return; }
        state.queryTimer.offon(350);
    };

    const searchWidgetClickHandler = (ev: MouseEvent, cm: CodeMirrorEditor) => {
        if ( ev.button !== 0 ) { return; }
        const target = ev.target as HTMLElement;
        const tcl = target.classList;
        if ( tcl.contains('cm-search-widget-up') ) {
            findNext(cm, -1);
        } else if ( tcl.contains('cm-search-widget-down') ) {
            findNext(cm, 1);
        } else if ( tcl.contains('cm-linter-widget-up') ) {
            findNextError(cm, -1);
        } else if ( tcl.contains('cm-linter-widget-down') ) {
            findNextError(cm, 1);
        } else if ( tcl.contains('cm-maximize') ) {
            const container = target.closest('.codeMirrorContainer');
            if ( container !== null ) {
                container.classList.toggle('cm-maximized');
            }
        }
        if ( target.localName !== 'input' ) {
            cm.focus();
        }
    };

    const queryTextFromSearchWidget = function(cm: CodeMirrorEditor): string {
        return getSearchState(cm).widget.querySelector('input[type="search"]')!.value;
    };

    const queryTextToSearchWidget = function(cm: CodeMirrorEditor, q?: string) {
        const input = getSearchState(cm).widget.querySelector('input[type="search"]') as HTMLInputElement;
        if ( typeof q === 'string' && q !== input.value ) {
            input.value = q;
        }
        input.setSelectionRange(0, input.value.length);
        input.focus();
    };

    const SearchState = function(cm: CodeMirrorEditor): SearchState {
        this.query = null;
        this.panel = null;
        const widgetParent = document.querySelector('.cm-search-widget-template')!.cloneNode(true) as HTMLElement;
        this.widget = widgetParent.children[0] as HTMLElement;
        this.widget.addEventListener('keydown', searchWidgetKeydownHandler.bind(null, cm));
        this.widget.addEventListener('input', searchWidgetInputHandler.bind(null, cm));
        this.widget.addEventListener('click', (ev: MouseEvent) => {
            searchWidgetClickHandler(ev, cm);
        });
        if ( typeof cm.addPanel === 'function' ) {
            this.panel = cm.addPanel(this.widget);
        }
        this.queryText = '';
        this.dirty = true;
        this.lines = [];
        cm.on('changes', (_cm: CodeMirrorEditor, changes: CodeMirrorChange[]) => {
            for ( const change of changes ) {
                if ( change.text.length !== 0 || change.removed.length !== 0 ) {
                    this.dirty = true;
                    break;
                }
            }
        });
        cm.on('cursorActivity', (_cm: CodeMirrorEditor) => {
            updateCount(cm);
        });
        this.queryTimer = vAPI.defer.create(( ) => {
            findCommit(cm, 0);
        });
    };

    const reSearchCommands = /^(?:find|findNext|findPrev|newlineAndIndent)$/;

    const widgetCommandHandler = function(cm: CodeMirrorEditor, command: string): boolean {
        if ( reSearchCommands.test(command) === false ) { return false; }
        const queryText = queryTextFromSearchWidget(cm);
        if ( command === 'find' ) {
            queryTextToSearchWidget(cm);
            return true;
        }
        if ( queryText.length !== 0 ) {
            findNext(cm, command === 'findPrev' ? -1 : 1);
        }
        return true;
    };

    const getSearchState = function(cm: CodeMirrorEditor): SearchState {
        return cm.state.search || (cm.state.search = new (SearchState as unknown as { prototype: SearchState; new(cm: CodeMirrorEditor): SearchState })(cm));
    };

    const queryCaseInsensitive = function(query: RegExp | string): boolean {
        return typeof query === 'string' && query === query.toLowerCase();
    };

    const getSearchCursor = function(cm: CodeMirrorEditor, query: RegExp | string, pos: CodeMirrorPos | number) {
        return cm.getSearchCursor(
            query,
            pos,
            { caseFold: queryCaseInsensitive(query), multiline: false }
        );
    };

    const parseString = function(string: string): string {
        return string.replace(/\\[nrt\\]/g, match => {
            if ( match === '\\n' ) { return '\n'; }
            if ( match === '\\r' ) { return '\r'; }
            if ( match === '\\t' ) { return '\t'; }
            if ( match === '\\\\' ) { return '\\'; }
            return match;
        });
    };

    const reEscape = /[.*+\-?^${}()|[\]\\]/g;

    const parseQuery = function(query: string | RegExp): RegExp {
        let flags = 'i';
        let reParsed = query.match(/^\/(.+)\/([iu]*)$/);
        if ( reParsed !== null ) {
            try {
                const re = new RegExp(reParsed[1], reParsed[2]);
                query = re.source;
                flags = re.flags;
            }
            catch (e) {
                console.warn('[uBR] search: invalid regex parse', reParsed, e);
                reParsed = null;
            }
        }
        if ( reParsed === null ) {
            if ( /[A-Z]/.test(query as string) ) { flags = ''; }
            query = parseString(query as string).replace(reEscape, '\\$&');
        }
        if ( typeof query === 'string' ? query === '' : (query as RegExp).test('') ) {
            query = 'x^';
        }
        return new RegExp(query, `gm${  flags}`);
    };

    let intlNumberFormat: Intl.NumberFormat | null;

    const formatNumber = function(n: number): string {
        if ( intlNumberFormat === undefined ) {
            intlNumberFormat = null;
            if ( Intl.NumberFormat instanceof Function ) {
                const intl = new Intl.NumberFormat(undefined, {
                    notation: 'compact',
                    maximumSignificantDigits: 3
                });
                if ( intl.resolvedOptions().notation ) {
                    intlNumberFormat = intl;
                }
            }
        }
        return n > 10000 && intlNumberFormat instanceof Object
            ? intlNumberFormat.format(n)
            : n.toLocaleString();
    };

    const updateCount = function(cm: CodeMirrorEditor) {
        const state = getSearchState(cm);
        const lines = state.lines;
        const current = cm.getCursor().line;
        let l = 0;
        let r = lines.length;
        let i = -1;
        while ( l < r ) {
            i = l + r >>> 1;
            const candidate = lines[i];
            if ( current === candidate ) { break; }
            if ( current < candidate ) {
                r = i;
            } else /* if ( current > candidate ) */ {
                l = i + 1;
            }
        }
        let text = '';
        if ( i !== -1 ) {
            text = formatNumber(i + 1);
            if ( lines[i] !== current ) {
                text = `~${  text}`;
            }
            text = `${text  }\xA0/\xA0`;
        }
        const count = lines.length;
        text += formatNumber(count);
        const span = state.widget.querySelector('.cm-search-widget-count')!;
        span.textContent = text;
        span.title = count.toLocaleString();
    };

    const startSearch = function(cm: CodeMirrorEditor, state: SearchState) {
        state.query = parseQuery(state.queryText);
        if ( state.overlay !== undefined ) {
            cm.removeOverlay(state.overlay, queryCaseInsensitive(state.query));
        }
        state.overlay = searchOverlay(state.query, queryCaseInsensitive(state.query));
        cm.addOverlay(state.overlay);
        if ( state.dirty || searchThread.needHaystack() ) {
            searchThread.setHaystack(cm.getValue());
            state.dirty = false;
        }
        searchThread.search(state.query).then(lines => {
            if ( Array.isArray(lines) === false ) { return; }
            state.lines = lines;
            const count = lines.length;
            updateCount(cm);
            if ( state.annotate !== undefined ) {
                state.annotate.clear();
                state.annotate = undefined;
            }
            if ( count === 0 ) { return; }
            state.annotate = cm.annotateScrollbar('CodeMirror-search-match');
            const annotations: Array<{ from: CodeMirrorPos; to: CodeMirrorPos }> = [];
            let lineBeg = -1;
            let lineEnd = -1;
            for ( const line of lines ) {
                if ( lineBeg === -1 ) {
                    lineBeg = line;
                    lineEnd = line + 1;
                    continue;
                } else if ( line === lineEnd ) {
                    lineEnd = line + 1;
                    continue;
                }
                annotations.push({
                    from: { line: lineBeg, ch: 0 },
                    to: { line: lineEnd, ch: 0 }
                });
                lineBeg = -1;
            }
            if ( lineBeg !== -1 ) {
                annotations.push({
                    from: { line: lineBeg, ch: 0 },
                    to: { line: lineEnd, ch: 0 }
                });
            }
            state.annotate.update(annotations);
        });
        state.widget.setAttribute('data-query', state.queryText);
    };

    const findNext = function(cm: CodeMirrorEditor, dir: number, callback?: (from: CodeMirrorPos, to: CodeMirrorPos) => void) {
        cm.operation(() => {
            const state = getSearchState(cm);
            if ( !state.query ) { return; }
            let cursor = getSearchCursor(
                cm,
                state.query,
                dir <= 0 ? cm.getCursor('from') : cm.getCursor('to')
            );
            const previous = dir < 0;
            if (!cursor.find(previous)) {
                cursor = getSearchCursor(
                    cm,
                    state.query,
                    previous
                        ? CodeMirror.Pos(cm.lastLine())
                        : CodeMirror.Pos(cm.firstLine(), 0)
                );
                if (!cursor.find(previous)) return;
            }
            cm.setSelection(cursor.from(), cursor.to());
            const { clientHeight } = cm.getScrollInfo();
            cm.scrollIntoView(
                { from: cursor.from(), to: cursor.to() },
                clientHeight >>> 1
            );
            if (callback) callback(cursor.from(), cursor.to());
        });
    };

    const findNextError = function(cm: CodeMirrorEditor, dir: number) {
        const doc = cm.getDoc();
        const cursor = cm.getCursor('from');
        const cursorLine = cursor.line;
        const start = dir < 0 ? 0 : cursorLine + 1;
        const end = dir < 0 ? cursorLine : doc.lineCount();
        let found = -1;
        doc.eachLine(start, end, (lineHandle: CodeMirrorLineHandle) => {
            const markers = lineHandle.gutterMarkers || null;
            if ( markers === null ) { return; }
            const marker = markers['CodeMirror-lintgutter'];
            if ( marker === undefined ) { return; }
            if ( marker.dataset.error !== 'y' ) { return; }
            const line = lineHandle.lineNo();
            if ( dir < 0 ) {
                found = line;
                return;
            }
            found = line;
            return true;
        });
        if ( found === -1 || found === cursorLine ) { return; }
        cm.getDoc().setCursor(found);
        const { clientHeight } = cm.getScrollInfo();
        cm.scrollIntoView({ line: found, ch: 0 }, clientHeight >>> 1);
    };

    const clearSearch = function(cm: CodeMirrorEditor, hard?: boolean) {
        cm.operation(() => {
            const state = getSearchState(cm);
            if ( state.query ) {
                state.query = state.queryText = null as unknown as string;
            }
            state.lines = [];
            if ( state.overlay !== undefined ) {
                cm.removeOverlay(state.overlay);
                state.overlay = undefined;
            }
            if ( state.annotate ) {
                state.annotate.clear();
                state.annotate = undefined;
            }
            state.widget.removeAttribute('data-query');
            if ( hard ) {
                state.panel!.clear();
                state.panel = null;
                state.widget = null as unknown as HTMLElement;
                cm.state.search = null as unknown as SearchState;
            }
        });
    };

    const findCommit = function(cm: CodeMirrorEditor, dir: number) {
        const state = getSearchState(cm);
        state.queryTimer.off();
        const queryText = queryTextFromSearchWidget(cm);
        if ( queryText === state.queryText ) { return; }
        state.queryText = queryText;
        if ( state.queryText === '' ) {
            clearSearch(cm);
        } else {
            cm.operation(() => {
                startSearch(cm, state);
                findNext(cm, dir);
            });
        }
    };

    const findCommand = function(cm: CodeMirrorEditor) {
        let queryText = cm.getSelection() || undefined;
        if ( !queryText ) {
            const word = cm.findWordAt(cm.getCursor());
            queryText = cm.getRange(word.anchor, word.head);
            if ( /^\W|\W$/.test(queryText) ) {
                queryText = undefined;
            }
            cm.setCursor(word.anchor);
        }
        queryTextToSearchWidget(cm, queryText);
        findCommit(cm, 1);
    };

    const findNextCommand = function(cm: CodeMirrorEditor) {
        const state = getSearchState(cm);
        if ( state.query ) { return findNext(cm, 1); }
    };

    const findPrevCommand = function(cm: CodeMirrorEditor) {
        const state = getSearchState(cm);
        if ( state.query ) { return findNext(cm, -1); }
    };

    {
        const searchWidgetTemplate = [
            '<div class="cm-search-widget-template" style="display:none;">',
              '<div class="cm-search-widget">',
                '<span class="cm-maximize"><svg viewBox="0 0 40 40"><path d="M4,16V4h12M24,4H36V16M4,24V36H16M36,24V36H24" /><path d="M14 2.5v12h-12M38 14h-12v-12M14 38v-12h-12M26 38v-12h12" /></svg></span>&ensp;',
                '<span class="cm-search-widget-input">',
                    '<span class="searchfield">',
                        '<input type="search" spellcheck="false" placeholder="">',
                        '<span class="fa-icon">search</span>',
                    '</span>&ensp;',
                  '<span class="cm-search-widget-up cm-search-widget-button fa-icon">angle-up</span>&nbsp;',
                  '<span class="cm-search-widget-down cm-search-widget-button fa-icon fa-icon-vflipped">angle-up</span>&ensp;',
                  '<span class="cm-search-widget-count"></span>',
                '</span>',
                '<span class="cm-linter-widget" data-lint="0">',
                  '<span class="cm-linter-widget-count"></span>&ensp;',
                  '<span class="cm-linter-widget-up cm-search-widget-button fa-icon">angle-up</span>&nbsp;',
                  '<span class="cm-linter-widget-down cm-search-widget-button fa-icon fa-icon-vflipped">angle-up</span>&ensp;',
                '</span>',
                '<span>',
                    '<a class="fa-icon sourceURL" href>external-link</a>',
                '</span>',
              '</div>',
            '</div>',
        ].join('\n');
        const domParser = new DOMParser();
        const doc = domParser.parseFromString(searchWidgetTemplate, 'text/html');
        const widgetTemplate = document.adoptNode(doc.body.firstElementChild!);
        document.body.appendChild(widgetTemplate);
    }

    CodeMirror.commands.find = findCommand;
    CodeMirror.commands.findNext = findNextCommand;
    CodeMirror.commands.findPrev = findPrevCommand;

    CodeMirror.defineInitHook((cm: CodeMirrorEditor) => {
        getSearchState(cm);
        cm.on('linterDone', (details: { errorCount: number }) => {
            const linterWidget = qs$('.cm-linter-widget');
            const count = details.errorCount;
            if ( linterWidget.dataset.lint === `${count}` ) { return; }
            linterWidget.dataset.lint = `${count}`;
            dom.text(
                qs$(linterWidget, '.cm-linter-widget-count'),
                i18n$('linterMainReport').replace('{{count}}', count.toLocaleString())
            );
        });
    });
}
