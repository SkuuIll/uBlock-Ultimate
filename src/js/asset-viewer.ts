/*******************************************************************************

    uBlock Origin - a comprehensive, efficient content blocker
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

/* global CodeMirror, uBlockDashboard */

import './codemirror/ubo-static-filtering.js';
import { dom, qs$ } from './dom.js';

/******************************************************************************/

(async ( ) => {
    const subscribeURL = new URL(document.location);
    const subscribeParams = subscribeURL.searchParams;
    const assetKey = subscribeParams.get('url');
    if ( assetKey === null ) { return; }

    const subscribeElem = subscribeParams.get('subscribe') !== null
        ? qs$('#subscribe')
        : null;
    if ( subscribeElem !== null && subscribeURL.hash !== '#subscribed' ) {
        const title = subscribeParams.get('title');
        const promptElem = qs$('#subscribePrompt');
        dom.text(promptElem.children[0], title);
        const a = promptElem.children[1];
        dom.text(a, assetKey);
        dom.attr(a, 'href', assetKey);
        dom.cl.remove(subscribeElem, 'hide');
    }

    const cmEditor = new CodeMirror(qs$('#content'), {
        autofocus: true,
        foldGutter: true,
        gutters: [
            'CodeMirror-linenumbers',
            { className: 'CodeMirror-lintgutter', style: 'width: 11px' },
        ],
        lineNumbers: true,
        lineWrapping: true,
        matchBrackets: true,
        maxScanLines: 1,
        maximizable: false,
        readOnly: true,
        styleActiveLine: {
            nonEmpty: true,
        },
    });

    // First tries - use CDN URLs directly for reliable loading
    const loadFromCDNs = async () => {
        const cdnURLs = [
            // Primary CDN - jsdelivr
            `https://cdn.jsdelivr.net/gh/uBlockOrigin/uAssetsCDN@main/thirdparties/${assetKey}.txt`,
            // Backup CDN - GitHub pages 
            `https://ublockorigin.github.io/uAssets/thirdparties/${assetKey}.txt`,
            // Backup - try direct from easylist.to
            `https://easylist.to/easylist/${assetKey}.txt`,
            // Try raw GitHub for easyprivacy specifically (in case assetKey is easyprivacy)
            `https://raw.githubusercontent.com/easylist/easylist/master/easyprivacy.txt`,
        ];
        
        for (const url of cdnURLs) {
            try {
                const response = await fetch(url);
                if (response.ok) {
                    return await response.text();
                }
            } catch (e) {
                continue;
            }
        }
        return null;
    };

    let content = '';
    let sourceURL = '';
    
    // Try direct CDN load first (most reliable for external access)
    content = await loadFromCDNs();
    
    // If CDN fails, try vAPI messaging as fallback
    if (!content && typeof vAPI !== 'undefined' && vAPI && vAPI.messaging) {
        try {
            const details = await vAPI.messaging.send('default', {
                what: 'getAssetContent',
                url: assetKey,
            });
            content = details?.content || '';
            sourceURL = details?.sourceURL || '';
        } catch(e) {
            console.warn('[uBR] asset-viewer: getAssetContent failed for', assetKey, e);
        }
    }
    
    // Last resort - try loading from the assets config
    if (!content) {
        content = `# Filter list "${assetKey}" not found.\n\nPlease ensure you are connected to the internet and try again.`;
    }

    cmEditor.setValue(content);

    if (subscribeElem !== null) {
        dom.on('#subscribeButton', 'click', ( ) => {
            dom.cl.add(subscribeElem, 'hide');
        }, { once: true });
    }

    if (sourceURL) {
        const a = qs$('.cm-search-widget .sourceURL');
        if (a) {
            dom.attr(a, 'href', sourceURL);
            dom.attr(a, 'title', sourceURL);
        }
    }

    dom.cl.remove(dom.body, 'loading');
})();
