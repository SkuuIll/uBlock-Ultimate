/*******************************************************************************

    uBlock Origin - a comprehensive, efficient content blocker
    Copyright (C) 2014-2018 Raymond Hill

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

import { dom, qs$ } from './dom.js';
import { i18n$ } from './i18n.js';

/******************************************************************************/

declare const CodeMirror: any;
declare const vAPI: any;
declare const uBlockDashboard: any;

interface WhitelistDetails {
    reBadHostname: string;
    reHostnameExtractor: string;
    whitelistDefault: string[];
    whitelist: string[];
}

const reComment = /^\s*#\s*/;

const directiveFromLine = (line: string): string => {
    const match = reComment.exec(line);
    return match === null
        ? line.trim()
        : line.slice(match.index + match[0].length).trim();
};

/******************************************************************************/

CodeMirror.defineMode('ubo-whitelist-directives', () => {
    const reRegex = /^\/.+\/$/;

    return {
        token: function(stream: any) {
            const line = stream.string.trim();
            stream.skipToEnd();
            if ( reBadHostname === undefined ) {
                return null;
            }
            if ( reComment.test(line) ) {
                return 'comment';
            }
            if ( line.indexOf('/') === -1 ) {
                if ( reBadHostname.test(line) ) { return 'error'; }
                if ( whitelistDefaultSet.has(line.trim()) ) {
                    return 'keyword';
                }
                return null;
            }
            if ( reRegex.test(line) ) {
                try {
                    new RegExp(line.slice(1, -1));
                } catch(e) { console.warn("[uBR] catch:", e);
                    return 'error'; }
                return null;
            }
            if ( reHostnameExtractor.test(line) === false ) {
                return 'error';
            }
            if ( whitelistDefaultSet.has(line.trim()) ) {
                return 'keyword';
            }
            return null;
        }
    };
});

let reBadHostname: RegExp | undefined;
let reHostnameExtractor: RegExp | undefined;
let whitelistDefaultSet = new Set<string>();

/******************************************************************************/

const messaging = vAPI.messaging;
const noopFunc = (): void => {};

let cachedWhitelist = '';

const cmEditor = new CodeMirror(qs$('#whitelist') as HTMLElement, {
    autofocus: true,
    lineNumbers: true,
    lineWrapping: true,
    styleActiveLine: true,
    mode: 'ubo-whitelist-directives',
});

uBlockDashboard.patchCodeMirrorEditor(cmEditor);

/******************************************************************************/

const getEditorText = (): string => {
    const text = cmEditor.getValue().trimEnd();
    return text === '' ? text : `${text}\n`;
};

const setEditorText = (text: string): void => {
    cmEditor.setValue(`${text.trimEnd()}\n`);
};

/******************************************************************************/

const whitelistChanged = () => {
    const whitelistElem = qs$('#whitelist');
    const bad = qs$(whitelistElem, '.cm-error') !== null;
    const changedWhitelist = getEditorText().trim();
    const changed = changedWhitelist !== cachedWhitelist;
    (qs$('#whitelistApply') as HTMLButtonElement).disabled = !changed || bad;
    (qs$('#whitelistRevert') as HTMLButtonElement).disabled = !changed;
    (CodeMirror as any).commands.save = changed && !bad ? applyChanges : noopFunc;
};

cmEditor.on('changes', whitelistChanged);

/******************************************************************************/

async function renderWhitelist() {
    const details = await messaging.send('dashboard', { what: 'getWhitelist' }) as WhitelistDetails;
    if (
        details === undefined ||
        typeof details.reBadHostname !== 'string' ||
        typeof details.reHostnameExtractor !== 'string' ||
        Array.isArray(details.whitelistDefault) === false ||
        Array.isArray(details.whitelist) === false
    ) {
        throw new Error('Trusted sites initialization returned an invalid response');
    }

    const first = reBadHostname === undefined;
    if ( first ) {
        reBadHostname = new RegExp(details.reBadHostname);
        reHostnameExtractor = new RegExp(details.reHostnameExtractor);
        whitelistDefaultSet = new Set(details.whitelistDefault);
    }

    const toAdd = new Set(whitelistDefaultSet);
    for ( const line of details.whitelist ) {
        const directive = directiveFromLine(line);
        if ( whitelistDefaultSet.has(directive) === false ) { continue; }
        toAdd.delete(directive);
        if ( toAdd.size === 0 ) { break; }
    }
    if ( toAdd.size !== 0 ) {
        details.whitelist.push(...Array.from(toAdd).map(a => `# ${a}`));
    }
    details.whitelist.sort((a, b) => {
        const ad = directiveFromLine(a);
        const bd = directiveFromLine(b);
        const abuiltin = whitelistDefaultSet.has(ad);
        if ( abuiltin !== whitelistDefaultSet.has(bd) ) {
            return abuiltin ? -1 : 1;
        }
        return ad.localeCompare(bd);
    });
    const whitelistStr = details.whitelist.join('\n').trim();
    cachedWhitelist = whitelistStr;
    setEditorText(whitelistStr);
    if ( first ) {
        cmEditor.clearHistory();
    }
}

/******************************************************************************/

function handleImportFilePicker(this: HTMLInputElement) {
    const file = this.files[0];
    if ( file === undefined || file.name === '' ) { return; }
    if ( file.type.indexOf('text') !== 0 ) { return; }
    const fr = new FileReader();
    fr.onload = ( ) => {
        if ( typeof fr.result !== 'string' || fr.result === '' ) { return; }
        const content = uBlockDashboard.mergeNewLines(
            getEditorText().trim(),
            fr.result.trim()
        );
        setEditorText(content);
    };
    fr.readAsText(file);
}

/******************************************************************************/

const startImportFilePicker = () => {
    const input = qs$('#importFilePicker') as HTMLInputElement;
    // Reset to empty string, this will ensure a change event is properly
    // triggered if the user picks a file, even if it is the same as the
    // last one picked.
    input.value = '';
    input.click();
};

/******************************************************************************/

const exportWhitelistToFile = () => {
    const val = getEditorText();
    if ( val === '' ) { return; }
    const filename = i18n$('whitelistExportFilename')
        .replace('{{datetime}}', uBlockDashboard.dateNowToSensibleString())
        .replace(/ +/g, '_');
    vAPI.download({
        'url': `data:text/plain;charset=utf-8,${encodeURIComponent(`${val  }\n`)}`,
        'filename': filename,
    });
};

/******************************************************************************/

async function applyChanges() {
    cachedWhitelist = getEditorText().trim();
    await messaging.send('dashboard', { what: 'setWhitelist', whitelist: cachedWhitelist });
    renderWhitelist();
}

const revertChanges = () => {
    setEditorText(cachedWhitelist);
};

/******************************************************************************/

const getCloudData = () => {
    return getEditorText();
};

const setCloudData = (data: any, append?: boolean) => {
    if ( typeof data !== 'string' ) { return; }
    if ( append ) {
        data = uBlockDashboard.mergeNewLines(getEditorText().trim(), data);
    }
    setEditorText(data.trim());
};

self.cloud.onPush = getCloudData;
self.cloud.onPull = setCloudData;

/******************************************************************************/

self.hasUnsavedData = function() {
    return getEditorText().trim() !== cachedWhitelist;
};

/******************************************************************************/



/******************************************************************************/

dom.on('#importWhitelistFromFile', 'click', startImportFilePicker);
dom.on('#importFilePicker', 'change', handleImportFilePicker);
dom.on('#exportWhitelistToFile', 'click', exportWhitelistToFile);
dom.on('#whitelistApply', 'click', ( ) => { applyChanges(); });
dom.on('#whitelistRevert', 'click', revertChanges);

// Wait for service worker readiness before loading whitelist data
(async () => {
    await new Promise<void>(resolve => {
        const check = async () => {
            try {
                const response = await vAPI.messaging.send('dashboard', { what: 'readyToFilter' });
                if (response) return resolve();
            } catch (e) { console.warn('[uBR] whitelist: readyToFilter messaging failed', e); }
            vAPI.defer.once(250).then(() => check());
        };
        check();
    });
    await renderWhitelist();
    document.body.dataset.ready = 'true';
})();

/******************************************************************************/
