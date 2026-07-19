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

/******************************************************************************/

interface I18nMessageHandler {
    getMessage(key: string, args?: unknown[]): string;
}

interface I18nDict {
    [key: string]: string;
}

interface I18n {
    getMessage(key: string, args?: unknown[]): string;
    safeTemplateToDOM(id: string, dict?: I18nDict, parent?: DocumentFragment): DocumentFragment;
    render(context?: Document | HTMLElement): void;
    renderElapsedTimeToString(tstamp: number): string;
    patchUnicodeFlags(text: string): DocumentFragment;
}

let i18n: I18n | null = null;
if (typeof (self as any).browser !== 'undefined' && (self as any).browser instanceof Object && !((self as any).browser instanceof Element)) {
    i18n = (self as any).browser.i18n as unknown as I18n;
} else if (typeof (self as any).chrome !== 'undefined' && (self as any).chrome.i18n) {
    i18n = (self as any).chrome.i18n as unknown as I18n;
}
if (!i18n) {
    i18n = {
        getMessage: function(key: string, _args?: unknown[]): string { return key; },
        safeTemplateToDOM: function(_id: string, _dict?: I18nDict, parent?: DocumentFragment): DocumentFragment {
            if (parent === undefined) {
                return document.createDocumentFragment();
            }
            return parent;
        },
        render: function(_context?: Document | HTMLElement): void { },
        renderElapsedTimeToString: function(_tstamp: number): string { return ''; },
        patchUnicodeFlags: function(_text: string): DocumentFragment { return document.createDocumentFragment(); },
    };
}

const i18n$ = (...args: unknown[]): string => (i18n as I18n).getMessage(args[0] as string, args.slice(1));

/******************************************************************************/

const isBackgroundProcess = document.title === 'uBlock Ultimate Background Page';

if ( isBackgroundProcess !== true ) {

    document.body.setAttribute(
        'dir',
        ['ar', 'he', 'fa', 'ps', 'ur'].indexOf(i18n$('@@ui_locale')) !== -1
            ? 'rtl'
            : 'ltr'
    );

    const allowedTags = new Set<string>([
        'a',
        'b',
        'code',
        'em',
        'i',
        'span',
        'u',
    ]);

    const expandHtmlEntities = (() => {
        const entities = new Map<string, string>([
            [ '&shy;', '\u00AD' ],
            [ '&ldquo;', '“' ],
            [ '&rdquo;', '”' ],
            [ '&lsquo;', '‘' ],
            [ '&rsquo;', '’' ],
            [ '&lt;', '<' ],
            [ '&gt;', '>' ],
        ]);
        const decodeEntities = (match: string): string => {
            return entities.get(match) || match;
        };
        return function(text: string): string {
            if ( text.indexOf('&') !== -1 ) {
                text = text.replace(/&[a-z]+;/g, decodeEntities);
            }
            return text;
        };
    })();

    const safeTextToTextNode = function(text: string): Text {
        return document.createTextNode(expandHtmlEntities(text));
    };

    const sanitizeElement = function(node: Element): Element | null {
        if ( allowedTags.has(node.localName) === false ) { return null; }
        node.removeAttribute('style');
        let child = node.firstElementChild;
        while ( child !== null ) {
            const next = child.nextElementSibling;
            if ( sanitizeElement(child) === null ) {
                child.remove();
            }
            child = next;
        }
        return node;
    };

    const safeTextToDOM = function(text: string, parent: Node): void {
        if ( text === '' ) { return; }

        const hasTemplate = text.indexOf('{{') !== -1;

        if ( text.indexOf('<') === -1 && !hasTemplate ) {
            const toInsert = safeTextToTextNode(text);
            
            if ( (parent as Element).childNodes.length !== 0 ) {
                const toRemove: ChildNode[] = [];
                let child = (parent as Element).firstChild;
                while ( child !== null ) {
                    const next = child.nextSibling;
                    if ( child.nodeType === 3 && child.nodeValue !== null ) {
                        toRemove.push(child);
                    }
                    child = next;
                }
                for ( const node of toRemove ) {
                    node.remove();
                }
            }
            
            parent.appendChild(toInsert);
            return;
        }

        text = text.replace(/^<p>|<\/p>/g, '')
                   .replace(/<p>/g, '\n\n');
        const domParser = new DOMParser();
        const parsedDoc = domParser.parseFromString(text, 'text/html');
        
        if ( (parent as Element).childNodes.length !== 0 ) {
            const toRemove: ChildNode[] = [];
            let child = (parent as Element).firstChild;
            while ( child !== null ) {
                const next = child.nextSibling;
                if ( child.nodeType === 3 && child.nodeValue !== null ) {
                    toRemove.push(child);
                }
                child = next;
            }
            for ( const node of toRemove ) {
                node.remove();
            }
        }
        
        let node: Node | null = parsedDoc.body.firstChild;
        while ( node !== null ) {
            const next = node.nextSibling;
            switch ( node.nodeType ) {
            case 1: // element
                if ( sanitizeElement(node as Element) === null ) { break; }
                parent.appendChild(node);
                break;
            case 3: // text
                parent.appendChild(node);
                break;
            default:
                break;
            }
            node = next;
        }
    };

    (i18n as I18n).safeTemplateToDOM = function(id: string, dict?: I18nDict, parent?: DocumentFragment): DocumentFragment {
        if ( parent === undefined ) {
            parent = document.createDocumentFragment();
        }
        let textin = i18n$(id);
        if ( textin === '' ) {
            return parent;
        }
        if ( textin.indexOf('{{') === -1 ) {
            safeTextToDOM(textin, parent);
            return parent;
        }
        const re = /\{\{\w+\}\}/g;
        let textout = '';
        for (;;) {
            re.lastIndex = 0;
            const match = re.exec(textin);
            if ( match === null ) {
                textout += textin;
                break;
            }
            textout += textin.slice(0, match.index);
            const prop = match[0].slice(2, -2);
            if ( dict && Object.hasOwn(dict, prop) ) {
                textout += (dict as I18nDict)[prop].replace(/</g, '&lt;')
                                     .replace(/>/g, '&gt;');
            } else {
                textout += prop;
            }
            textin = textin.slice(re.lastIndex);
        }
        safeTextToDOM(textout, parent);
        return parent;
    };

    (i18n as I18n).render = function(context?: Document | HTMLElement): void {
        const docu = document;
        const root = context || docu;

        const elems = root.querySelectorAll('[data-i18n]');
        for ( let i = 0; i < elems.length; i++ ) {
            const elem = elems[i] as HTMLElement;
            const text = i18n$(elem.getAttribute('data-i18n') || '');
            if ( !text ) { continue; }
            if ( text.indexOf('{{') === -1 ) {
                safeTextToDOM(text, elem);
                if ( elem.tagName === 'TITLE' ) {
                    document.title = text;
                }
                continue;
            }
            const parts = text.split(/(\{\{[^}]+\}\})/);
            const fragment = document.createDocumentFragment();
            let textBefore = '';
            for ( let j = 0; j < parts.length; j++ ) {
                let part = parts[j];
                if ( part === '' ) { continue; }
                if ( part.startsWith('{{') && part.endsWith('}}') ) {
                    const pos = part.indexOf(':');
                    if ( pos !== -1 ) {
                        part = part.slice(0, 2) + part.slice(pos + 1);
                    }
                    const selector = part.slice(2, -2);
                    let node: Element | null;
                    if ( selector.charCodeAt(0) !== 0x2E /* '.' */ ) {
                        node = elem.querySelector(`.${selector}`);
                    }
                    if ( node instanceof Element === false ) {
                        node = elem.querySelector(selector);
                    }
                    if ( node instanceof Element ) {
                        safeTextToDOM(textBefore, fragment);
                        fragment.appendChild(node);
                        textBefore = '';
                        continue;
                    }
                }
                textBefore += part;
            }
            if ( textBefore !== '' ) {
                safeTextToDOM(textBefore, fragment);
            }
            elem.appendChild(fragment);
        }

        const elemsTitle = root.querySelectorAll('[data-i18n-title]');
        for ( let i = 0; i < elemsTitle.length; i++ ) {
            const elem = elemsTitle[i] as HTMLElement;
            const text = i18n$(elem.getAttribute('data-i18n-title') || '');
            if ( !text ) { continue; }
            elem.setAttribute('title', expandHtmlEntities(text));
        }

        const elemsPlaceholder = root.querySelectorAll('[placeholder]');
        for ( let i = 0; i < elemsPlaceholder.length; i++ ) {
            const elem = elemsPlaceholder[i] as HTMLInputElement;
            const text = i18n$(elem.getAttribute('placeholder') || '');
            if ( text === '' ) { continue; }
            elem.setAttribute('placeholder', text);
        }

        const elemsTip = root.querySelectorAll('[data-i18n-tip]');
        for ( let i = 0; i < elemsTip.length; i++ ) {
            const elem = elemsTip[i] as HTMLElement;
            const text = i18n$(elem.getAttribute('data-i18n-tip') || '')
                       .replace(/<br>/g, '\n')
                       .replace(/\n{3,}/g, '\n\n');
            elem.setAttribute('data-tip', text);
            if ( elem.hasAttribute('aria-label') ) {
                elem.setAttribute('aria-label', text);
            }
        }

        const elemsLabel = root.querySelectorAll('[data-i18n-label]');
        for ( let i = 0; i < elemsLabel.length; i++ ) {
            const elem = elemsLabel[i] as HTMLElement;
            const text = i18n$(elem.getAttribute('data-i18n-label') || '');
            elem.setAttribute('label', text);
        }
    };

    (i18n as I18n).renderElapsedTimeToString = function(tstamp: number): string {
        let value = (Date.now() - tstamp) / 60000;
        if ( value < 2 ) {
            return i18n$('elapsedOneMinuteAgo');
        }
        if ( value < 60 ) {
            return i18n$('elapsedManyMinutesAgo').replace('{{value}}', Math.floor(value).toLocaleString());
        }
        value /= 60;
        if ( value < 2 ) {
            return i18n$('elapsedOneHourAgo');
        }
        if ( value < 24 ) {
            return i18n$('elapsedManyHoursAgo').replace('{{value}}', Math.floor(value).toLocaleString());
        }
        value /= 24;
        if ( value < 2 ) {
            return i18n$('elapsedOneDayAgo');
        }
        return i18n$('elapsedManyDaysAgo').replace('{{value}}', Math.floor(value).toLocaleString());
    };

    const unicodeFlagToImageSrc = new Map<string, string>([
        [ '🇦🇱', 'al' ], [ '🇦🇷', 'ar' ], [ '🇦🇹', 'at' ], [ '🇧🇦', 'ba' ],
        [ '🇧🇪', 'be' ], [ '🇧🇬', 'bg' ], [ '🇧🇷', 'br' ], [ '🇨🇦', 'ca' ],
        [ '🇨🇭', 'ch' ], [ '🇨🇳', 'cn' ], [ '🇨🇴', 'co' ], [ '🇨🇾', 'cy' ],
        [ '🇨🇿', 'cz' ], [ '🇩🇪', 'de' ], [ '🇩🇰', 'dk' ], [ '🇩🇿', 'dz' ],
        [ '🇪🇪', 'ee' ], [ '🇪🇬', 'eg' ], [ '🇪🇸', 'es' ], [ '🇫🇮', 'fi' ],
        [ '🇫🇴', 'fo' ], [ '🇫🇷', 'fr' ], [ '🇬🇷', 'gr' ], [ '🇭🇷', 'hr' ],
        [ '🇭🇺', 'hu' ], [ '🇮🇩', 'id' ], [ '🇮🇱', 'il' ], [ '🇮🇳', 'in' ],
        [ '🇮🇷', 'ir' ], [ '🇮🇸', 'is' ], [ '🇮🇹', 'it' ], [ '🇯🇵', 'jp' ],
        [ '🇰🇷', 'kr' ], [ '🇰🇿', 'kz' ], [ '🇱🇰', 'lk' ], [ '🇱🇹', 'lt' ],
        [ '🇱🇻', 'lv' ], [ '🇲🇦', 'ma' ], [ '🇲🇩', 'md' ], [ '🇲🇰', 'mk' ],
        [ '🇲🇽', 'mx' ], [ '🇲🇾', 'my' ], [ '🇳🇱', 'nl' ], [ '🇳🇴', 'no' ],
        [ '🇳🇵', 'np' ], [ '🇵🇱', 'pl' ], [ '🇵🇹', 'pt' ], [ '🇷🇴', 'ro' ],
        [ '🇷🇸', 'rs' ], [ '🇷🇺', 'ru' ], [ '🇸🇦', 'sa' ], [ '🇸🇮', 'si' ],
        [ '🇸🇰', 'sk' ], [ '🇸🇪', 'se' ], [ '🇸🇷', 'sr' ], [ '🇹🇭', 'th' ],
        [ '🇹🇯', 'tj' ], [ '🇹🇼', 'tw' ], [ '🇹🇷', 'tr' ], [ '🇺🇦', 'ua' ],
        [ '🇺🇿', 'uz' ], [ '🇻🇳', 'vn' ], [ '🇽🇰', 'xk' ],
    ]);
    const reUnicodeFlags = new RegExp(
        Array.from(unicodeFlagToImageSrc).map(a => a[0]).join('|'),
        'gu'
    );
    (i18n as I18n).patchUnicodeFlags = function(text: string): DocumentFragment {
        const fragment = document.createDocumentFragment();
        let i = 0;
        for (;;) {
            const match = reUnicodeFlags.exec(text);
            if ( match === null ) { break; }
            if ( match.index > i ) {
                fragment.append(text.slice(i, match.index));
            }
            const img = document.createElement('img');
            const countryCode = unicodeFlagToImageSrc.get(match[0]);
            img.src = `/img/flags-of-the-world/${countryCode}.png`;
            img.title = countryCode;
            img.classList.add('countryFlag');
            fragment.append(img, '\u200A');
            i = reUnicodeFlags.lastIndex;
        }
        if ( i < text.length ) {
            fragment.append(text.slice(i));
        }
        return fragment;
    };

    (i18n as I18n).render();
}

/******************************************************************************/

export { i18n, i18n as I18n, i18n$ };