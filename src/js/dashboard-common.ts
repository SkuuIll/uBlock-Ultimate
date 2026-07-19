/*******************************************************************************

    uBlock Ultimate - a comprehensive, efficient content blocker
    Copyright (C) 2014-present Raymond Hill

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

import { dom } from './dom.js';

/******************************************************************************/

interface VAPIDefer {
    create: (fn: () => void) => { on: (ms: number) => void };
}

interface VAPIMessaging {
    send: (target: string, message: object) => void;
}

interface VAPI {
    defer: VAPIDefer;
    messaging: VAPIMessaging;
}

declare const vAPI: VAPI;

interface CodeMirror {
    options: { inputStyle: string };
    on: (event: string, handler: (...args: unknown[]) => void) => void;
    getViewport: () => { from: number; to: number };
    lineCount: () => number;
    setSelection: (anchor: { line: number; ch: number }, head: number | { line: number; ch: number }, options?: object) => void;
    getHelper: (pos: { line: number; ch: number }, type: string) => unknown;
}

interface SelectionDetails {
    ranges: Array<{
        anchor: { line: number; ch: number };
        head: { line: number; ch: number };
    }>;
    update: (changes: Array<{ anchor: { line: number; ch: number }; head: { line: number; ch: number } }>) => void;
}

interface OpenOrSelectOptions {
    url?: string;
    select?: boolean;
    index?: number;
}

interface UBlockDashboard {
    mergeNewLines: (text: string, newText: string) => string;
    dateNowToSensibleString: () => string;
    patchCodeMirrorEditor: (cm: CodeMirror) => void;
    openOrSelectPage: (url: string | MouseEvent, options?: OpenOrSelectOptions) => void;
}

declare const self: Window & { uBlockDashboard: UBlockDashboard };

(self as any).uBlockDashboard = (self as any).uBlockDashboard || {};

/******************************************************************************/

(self as any).uBlockDashboard.mergeNewLines = function(text: string, newText: string): string {
    const fromDict = new Map<string, string | string[]>();
    let lineBeg = 0;
    let textEnd = text.length;
    while ( lineBeg < textEnd ) {
        let lineEnd = text.indexOf('\n', lineBeg);
        if ( lineEnd === -1 ) {
            lineEnd = text.indexOf('\r', lineBeg);
            if ( lineEnd === -1 ) {
                lineEnd = textEnd;
            }
        }
        const line = text.slice(lineBeg, lineEnd).trim();
        lineBeg = lineEnd + 1;
        if ( line.length === 0 ) { continue; }
        const hash = line.slice(0, 8);
        const bucket = fromDict.get(hash);
        if ( bucket === undefined ) {
            fromDict.set(hash, line);
        } else if ( typeof bucket === 'string' ) {
            fromDict.set(hash, [ bucket, line ]);
        } else {
            bucket.push(line);
        }
    }

    const out = [ '' ];
    lineBeg = 0;
    textEnd = newText.length;
    while ( lineBeg < textEnd ) {
        let lineEnd = newText.indexOf('\n', lineBeg);
        if ( lineEnd === -1 ) {
            lineEnd = newText.indexOf('\r', lineBeg);
            if ( lineEnd === -1 ) {
                lineEnd = textEnd;
            }
        }
        const line = newText.slice(lineBeg, lineEnd).trim();
        lineBeg = lineEnd + 1;
        if ( line.length === 0 ) {
            if ( out[out.length - 1] !== '' ) {
                out.push('');
            }
            continue;
        }
        const bucket = fromDict.get(line.slice(0, 8));
        if ( bucket === undefined ) {
            out.push(line);
            continue;
        }
        if ( typeof bucket === 'string' && line !== bucket ) {
            out.push(line);
            continue;
        }
        if ( (bucket as string[]).indexOf(line) === -1 ) {
            out.push(line);
        }
    }

    const append = out.join('\n').trim();
    if ( text !== '' && append !== '' ) {
        text += '\n\n';
    }
    return text + append;
};

/******************************************************************************/

(self as any).uBlockDashboard.dateNowToSensibleString = function(): string {
    const now = new Date(Date.now() - (new Date()).getTimezoneOffset() * 60000);
    return now.toISOString().replace(/\.\d+Z$/, '')
                            .replace(/:/g, '.')
                            .replace('T', '_');
};

/******************************************************************************/

(self as any).uBlockDashboard.patchCodeMirrorEditor = (function() {
    let grabFocusTarget: CodeMirror | undefined;

    const grabFocus = function() {
        if (grabFocusTarget) {
            (grabFocusTarget as any).focus();
        }
        grabFocusTarget = undefined;
    };

    const grabFocusTimer = vAPI.defer.create(grabFocus);

    const grabFocusAsync = function(cm: CodeMirror) {
        grabFocusTarget = cm;
        grabFocusTimer.on(1);
    };

    const patchSelectAll = function(cm: CodeMirror, details: SelectionDetails) {
        const vp = cm.getViewport();
        if ( details.ranges.length !== 1 ) { return; }
        const range = details.ranges[0];
        const lineFrom = range.anchor.line;
        let lineTo = range.head.line;
        if ( lineTo === lineFrom ) { return; }
        if ( range.head.ch !== 0 ) { lineTo += 1; }
        if ( lineFrom !== vp.from || lineTo !== vp.to ) { return; }
        details.update([
            {
                anchor: { line: 0, ch: 0 },
                head: { line: cm.lineCount(), ch: 0 }
            }
        ]);
        grabFocusAsync(cm);
    };

    let lastGutterClick = 0;
    let lastGutterLine = 0;

    const onGutterClicked = function(cm: CodeMirror, line: number, gutter: string) {
        if ( gutter !== 'CodeMirror-linenumbers' ) { return; }
        grabFocusAsync(cm);
        const delta = Date.now() - lastGutterClick;
        if ( delta >= 500 || line !== lastGutterLine ) {
            cm.setSelection(
                { line, ch: 0 },
                { line: line + 1, ch: 0 }
            );
            lastGutterClick = Date.now();
            lastGutterLine = line;
            return;
        }
        let lineFrom = 0;
        let lineTo = cm.lineCount();
        const foldFn = cm.getHelper({ line, ch: 0 }, 'fold');
        if ( foldFn instanceof Function ) {
            const range = foldFn(cm, { line, ch: 0 });
            if ( range !== undefined ) {
                lineFrom = range.from.line;
                lineTo = range.to.line + 1;
            }
        }
        cm.setSelection(
            { line: lineFrom, ch: 0 },
            { line: lineTo, ch: 0 },
            { scroll: false }
        );
        lastGutterClick = 0;
    };

    return function(cm: CodeMirror) {
        if ( cm.options.inputStyle === 'contenteditable' ) {
            cm.on('beforeSelectionChange', patchSelectAll as any);
        }
        cm.on('gutterClick', onGutterClicked as any);
    };
})();

/******************************************************************************/

(self as any).uBlockDashboard.openOrSelectPage = function(url: string | MouseEvent, options: OpenOrSelectOptions = {}) {
    let ev: MouseEvent | undefined;
    if ( url instanceof MouseEvent ) {
        ev = url;
        url = dom.attr(ev.currentTarget as HTMLElement, 'href') as string;
    }
    const details = Object.assign({ url, select: true, index: -1 }, options);
    vAPI.messaging.send('default', {
        what: 'gotoURL',
        details,
    });
    if ( ev ) {
        ev.preventDefault();
    }
};

/******************************************************************************/

dom.attr('a', 'target', '_blank');
dom.attr('a[href*="dashboard.html"]', 'target', '_parent');