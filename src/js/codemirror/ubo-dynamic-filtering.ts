/*******************************************************************************

    uBlock Ultimate - a comprehensive, efficient content blocker
    Copyright (C) 2019-present Raymond Hill

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

interface Slice {
    len: number;
    style: string | null;
}

interface CodeMirrorStream {
    sol(): boolean;
    string: string;
    pos: number;
    skipToEnd(): void;
    skipToEnd(stream: CodeMirrorStream): void;
}

interface CodeMirrorMode {
    token(stream: CodeMirrorStream): string | null;
    sortType: number;
    setHostnameToDomainMap(map: Map<string, string>): void;
    setPSL(psl: unknown): void;
}

interface CodeMirrorModeFactory {
    (config?: unknown): CodeMirrorMode;
}

declare const CodeMirror: {
    defineMode(name: string, factory: CodeMirrorModeFactory | (() => CodeMirrorMode)): void;
    defineOption(name: string, defaultValue: unknown, callback: (cm: CodeMirrorEditor, value: unknown) => void): void;
    registerHelper(type: string, name: string, helper: unknown): void;
    defineInitHook(callback: (cm: CodeMirrorEditor) => void): void;
    Pos(line: number, ch: number): CodeMirrorPos;
    signal(target: unknown, event: string, ...args: unknown[]): void;
};

const validSwitches = new Set<string>([
    'no-strict-blocking:',
    'no-popups:',
    'no-cosmetic-filtering:',
    'no-remote-fonts:',
    'no-large-media:',
    'no-csp-reports:',
    'no-scripting:',
]);

const validSwitcheStates = new Set<string>([
    'true',
    'false',
]);

const validHnRuleTypes = new Set<string>([
    '*',
    '3p',
    'image',
    'inline-script',
    '1p-script',
    '3p-script',
    '3p-frame',
]);

const invalidURLRuleTypes = new Set<string>([
    'doc',
    'main_frame',
]);

const validActions = new Set<string>([
    'block',
    'allow',
    'noop',
]);

const hnValidator = new URL(self.location.href);
const reBadHn = /[%]|^\.|\.$/;
const slices: Slice[] = [];
let sliceIndex = 0;
let sliceCount = 0;
let hostnameToDomainMap = new Map<string, string>();
let psl: unknown;

const isValidHostname = (hnin: string): boolean => {
    if (hnin === '*') { return true; }
    hnValidator.hostname = '_';
    try {
        hnValidator.hostname = hnin;
    } catch (e) {
        console.warn('[uBR] ubo-dynamic-filtering: invalid hostname', hnin, e);
        return false;
    }
    const hnout = hnValidator.hostname;
    return hnout !== '_' && hnout !== '' && reBadHn.test(hnout) === false;
};

const addSlice = (len: number, style: string | null = null): void => {
    const i = sliceCount;
    if (i === slices.length) {
        slices[i] = { len: 0, style: null };
    }
    const entry = slices[i] as Slice;
    entry.len = len;
    entry.style = style;
    sliceCount += 1;
};

const addMatchSlice = (match: RegExpMatchArray | null, style: string | null = null): string => {
    const len = match !== null ? match[0].length : 0;
    addSlice(len, style);
    return match !== null ? match.input.slice(len) : '';
};

const addMatchHnSlices = (match: RegExpMatchArray | null, style: string | null = null): string => {
    const hn = match?.[0] ?? '';
    if (hn === '*') {
        return addMatchSlice(match, style);
    }
    let dn = hostnameToDomainMap.get(hn) || '';
    if (dn === '' && psl !== undefined) {
        dn = /(\d|\])$/.test(hn) ? hn : ((psl as { getDomain: (hn: string) => string }).getDomain(hn) || hn);
    }
    const entityBeg = hn.length - dn.length;
    if (entityBeg !== 0) {
        addSlice(entityBeg, style);
    }
    let entityEnd = dn.indexOf('.');
    if (entityEnd === -1) { entityEnd = dn.length; }
    addSlice(entityEnd, style !== null ? `${style} strong` : 'strong');
    if (entityEnd < dn.length) {
        addSlice(dn.length - entityEnd, style);
    }
    return match?.input.slice(hn.length) ?? '';
};

const makeSlices = (stream: CodeMirrorStream, opts: { sortType: number }): void => {
    sliceIndex = 0;
    sliceCount = 0;
    let { string } = stream;
    if (string === '...') { return; }
    const { sortType } = opts;
    const reNotToken = /^\s+/;
    const reToken = /^\S+/;
    const tokens: string[] = [];
    let match = reNotToken.exec(string);
    if (match !== null) {
        string = addMatchSlice(match);
    }
    match = reToken.exec(string);
    if (match === null) { return; }
    tokens.push(match[0]);
    const isSwitchRule = validSwitches.has(match[0]);
    if (isSwitchRule) {
        string = addMatchSlice(match, sortType === 0 ? 'sortkey' : null);
    } else if (isValidHostname(match[0])) {
        if (sortType === 1) {
            string = addMatchHnSlices(match, 'sortkey');
        } else {
            string = addMatchHnSlices(match, null);
        }
    } else {
        string = addMatchSlice(match, 'error');
    }
    match = reNotToken.exec(string);
    if (match === null) { return; }
    string = addMatchSlice(match);
    match = reToken.exec(string);
    if (match === null) { return; }
    tokens.push(match[0]);
    const isURLRule = isSwitchRule === false && match[0].indexOf('://') > 0;
    if (isURLRule) {
        string = addMatchSlice(match, sortType === 2 ? 'sortkey' : null);
    } else if (isValidHostname(match[0]) === false) {
        string = addMatchSlice(match, 'error');
    } else if (sortType === 1 && isSwitchRule || sortType === 2) {
        string = addMatchHnSlices(match, 'sortkey');
    } else {
        string = addMatchHnSlices(match, null);
    }
    match = reNotToken.exec(string);
    if (match === null) { return; }
    string = addMatchSlice(match);
    match = reToken.exec(string);
    if (match === null) { return; }
    tokens.push(match[0]);
    if (isSwitchRule) {
        string = validSwitcheStates.has(match[0])
            ? addMatchSlice(match, match[0] === 'true' ? 'blockrule' : 'allowrule')
            : addMatchSlice(match, 'error');
    } else if (isURLRule) {
        string = invalidURLRuleTypes.has(match[0])
            ? addMatchSlice(match, 'error')
            : addMatchSlice(match);
    } else if (tokens[1] === '*') {
        string = validHnRuleTypes.has(match[0])
            ? addMatchSlice(match)
            : addMatchSlice(match, 'error');
    } else {
        string = match[0] === '*'
            ? addMatchSlice(match)
            : addMatchSlice(match, 'error');
    }
    match = reNotToken.exec(string);
    if (match === null) { return; }
    string = addMatchSlice(match);
    match = reToken.exec(string);
    if (match === null) { return; }
    tokens.push(match[0]);
    string = isSwitchRule || validActions.has(match[0]) === false
        ? addMatchSlice(match, 'error')
        : addMatchSlice(match, `${match[0]}rule`);
    match = reNotToken.exec(string);
    if (match === null) { return; }
    string = addMatchSlice(match);
    match = reToken.exec(string);
    if (match !== null) {
        string = addMatchSlice(null, 'error');
    }
};

const token = function(stream: CodeMirrorStream): string | null {
    if (stream.sol()) {
        makeSlices(stream, this);
    }
    if (sliceIndex >= sliceCount) {
        stream.skipToEnd(stream);
        return null;
    }
    const { len, style } = slices[sliceIndex++];
    if (len === 0) {
        stream.skipToEnd();
    } else {
        stream.pos += len;
    }
    return style ?? null;
};

CodeMirror.defineMode('ubo-dynamic-filtering', () => {
    return {
        token,
        sortType: 1,
        setHostnameToDomainMap: (a: Map<string, string>) => { hostnameToDomainMap = a; },
        setPSL: (a: unknown) => { psl = a; },
    };
});