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

interface VAPIMessaging {
    send(details: { what: string; [key: string]: unknown }): Promise<unknown>;
}

interface VAPIUserStylesheet {
    add(sheet: string): void;
    apply(): void;
}

interface VAPI {
    sessionId: string;
    loadAllLargeMedia?: () => void;
    largeMediaElementStyleSheet?: string;
    messaging: VAPIMessaging;
    userStylesheet: VAPIUserStylesheet;
}

declare const vAPI: VAPI | undefined;

(( ) => {

/******************************************************************************/

if ( typeof vAPI !== 'object' || vAPI.loadAllLargeMedia instanceof Function ) {
    return;
}

const largeMediaElementAttribute = `data-${  vAPI.sessionId}`;
const largeMediaElementSelector =
    `:root   audio[${  largeMediaElementAttribute  }],\n` +
    `:root     img[${  largeMediaElementAttribute  }],\n` +
    `:root picture[${  largeMediaElementAttribute  }],\n` +
    `:root   video[${  largeMediaElementAttribute  }]`;

const isMediaElement = (elem: Element): boolean =>
    (/^(?:audio|img|picture|video)$/.test(elem.localName));

const isPlayableMediaElement = (elem: Element): boolean =>
    (/^(?:audio|video)$/.test(elem.localName));

/******************************************************************************/

const mediaNotLoaded = function(elem: Element): boolean {
    switch ( elem.localName ) {
    case 'audio':
    case 'video': {
        const media = elem as HTMLMediaElement;
        return media.readyState === 0 || media.error !== null;
    }
    case 'img': {
        const img = elem as HTMLImageElement;
        if ( img.naturalWidth !== 0 || img.naturalHeight !== 0 ) {
            break;
        }
        const style = window.getComputedStyle(img);
        return style !== null ?
            style.getPropertyValue('display') !== 'none' :
            img.offsetHeight !== 0 && img.offsetWidth !== 0;
    }
    default:
        break;
    }
    return false;
};

/******************************************************************************/

const surveyMissingMediaElements = function(): number {
    let largeMediaElementCount = 0;
    for ( const elem of document.querySelectorAll('audio,img,video') ) {
        if ( mediaNotLoaded(elem) === false ) { continue; }
        elem.setAttribute(largeMediaElementAttribute, '');
        largeMediaElementCount += 1;
        switch ( elem.localName ) {
        case 'img': {
            const picture = elem.closest('picture');
            if ( picture !== null ) {
                picture.setAttribute(largeMediaElementAttribute, '');
            }
        } break;
        default:
            break;
        }
    }
    return largeMediaElementCount;
};

if ( surveyMissingMediaElements() ) {
    if ( vAPI.largeMediaElementStyleSheet === undefined ) {
        vAPI.largeMediaElementStyleSheet = [
            `${largeMediaElementSelector  } {`,
                'border: 2px dotted red !important;',
                'box-sizing: border-box !important;',
                'cursor: zoom-in !important;',
                'display: inline-block;',
                'filter: none !important;',
                'font-size: 1rem !important;',
                'min-height: 1em !important;',
                'min-width: 1em !important;',
                'opacity: 1 !important;',
                'outline: none !important;',
                'transform: none !important;',
                'visibility: visible !important;',
                'z-index: 2147483647',
            '}',
        ].join('\n');
        vAPI.userStylesheet.add(vAPI.largeMediaElementStyleSheet);
        vAPI.userStylesheet.apply();
    }
}

/******************************************************************************/

const loadMedia = async function(elem: Element): Promise<void> {
    const media = elem as HTMLMediaElement;
    const src = media.getAttribute('src') || '';
    if ( src === '' ) { return; }
    media.removeAttribute('src');
    await vAPI.messaging.send('scriptlets', {
        what: 'temporarilyAllowLargeMediaElement',
    });
    media.setAttribute('src', src);
    media.load();
};

/******************************************************************************/

const loadImage = async function(elem: Element): Promise<void> {
    const img = elem as HTMLImageElement;
    const src = img.getAttribute('src') || '';
    const srcset = src === '' && img.getAttribute('srcset') || '';
    if ( src === '' && srcset === '' ) { return; }
    if ( src !== '' ) {
        img.removeAttribute('src');
    }
    if ( srcset !== '' ) {
        img.removeAttribute('srcset');
    }
    await vAPI.messaging.send('scriptlets', {
        what: 'temporarilyAllowLargeMediaElement',
    });
    if ( src !== '' ) {
        img.setAttribute('src', src);
    } else if ( srcset !== '' ) {
        img.setAttribute('srcset', srcset);
    }
};

/******************************************************************************/

const loadMany = function(elems: Element[]): void {
    for ( const elem of elems ) {
        switch ( elem.localName ) {
        case 'audio':
        case 'video':
            loadMedia(elem);
            break;
        case 'img':
            loadImage(elem);
            break;
        default:
            break;
        }
    }
};

/******************************************************************************/

const onMouseClick = function(ev: MouseEvent): void {
    if ( ev.button !== 0 || ev.isTrusted === false ) { return; }

    const toLoad: Element[] = [];
    const elems = document.elementsFromPoint instanceof Function
        ? document.elementsFromPoint(ev.clientX, ev.clientY)
        : [ ev.target ];
    for ( const elem of elems ) {
        if ( elem.matches(largeMediaElementSelector) === false ) { continue; }
        elem.removeAttribute(largeMediaElementAttribute);
        if ( mediaNotLoaded(elem) ) {
            toLoad.push(elem);
        }
    }

    if ( toLoad.length === 0 ) { return; }

    loadMany(toLoad);

    ev.preventDefault();
    ev.stopPropagation();
};

document.addEventListener('click', onMouseClick, true);

/******************************************************************************/

const onLoadedData = function(ev: Event): void {
    const media = ev.target as Element;
    if ( media.localName !== 'audio' && media.localName !== 'video' ) {
        return;
    }
    const htmlMedia = media as HTMLMediaElement;
    const src = htmlMedia.src;
    if ( typeof src === 'string' && src.startsWith('blob:') === false ) {
        return;
    }
    htmlMedia.autoplay = false;
    htmlMedia.pause();
};

for ( const media of document.querySelectorAll('audio,video') ) {
    const htmlMedia = media as HTMLMediaElement;
    const src = htmlMedia.src;
    if (
        (typeof src === 'string') &&
        (src === '' || src.startsWith('blob:'))
    ) {
        htmlMedia.autoplay = false;
        htmlMedia.pause();
    }
}

document.addEventListener('loadeddata', onLoadedData);

/******************************************************************************/

const onLoad = function(ev: Event): void {
    const elem = ev.target as Element;
    if ( isMediaElement(elem) === false ) { return; }
    elem.removeAttribute(largeMediaElementAttribute);
};

document.addEventListener('load', onLoad, true);

/******************************************************************************/

const onLoadError = function(ev: Event): void {
    const elem = ev.target as Element;
    if ( isMediaElement(elem) === false ) { return; }
    if ( mediaNotLoaded(elem) ) {
        elem.setAttribute(largeMediaElementAttribute, '');
    }
};

document.addEventListener('error', onLoadError, true);

/******************************************************************************/

const autoPausedMedia = new WeakMap<Element, string>();

for ( const elem of document.querySelectorAll('audio,video') ) {
    elem.setAttribute('autoplay', 'false');
}

const preventAutoplay = function(ev: Event): void {
    const elem = ev.target as Element;
    if ( isPlayableMediaElement(elem) === false ) { return; }
    const htmlMedia = elem as HTMLMediaElement;
    const currentSrc = htmlMedia.getAttribute('src') || '';
    const pausedSrc = autoPausedMedia.get(elem);
    if ( pausedSrc === currentSrc ) { return; }
    autoPausedMedia.set(elem, currentSrc);
    htmlMedia.setAttribute('autoplay', 'false');
    htmlMedia.pause();
};

document.addEventListener('timeupdate', preventAutoplay, true);

/******************************************************************************/

vAPI.loadAllLargeMedia = function(): void {
    document.removeEventListener('click', onMouseClick, true);
    document.removeEventListener('loadeddata', onLoadedData, true);
    document.removeEventListener('load', onLoad, true);
    document.removeEventListener('error', onLoadError, true);

    const toLoad: Element[] = [];
    for ( const elem of document.querySelectorAll(largeMediaElementSelector) ) {
        elem.removeAttribute(largeMediaElementAttribute);
        if ( mediaNotLoaded(elem) ) {
            toLoad.push(elem);
        }
    }
    loadMany(toLoad);
};

/******************************************************************************/

})();

void 0;
