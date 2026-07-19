/*******************************************************************************

    uBlock Ultimate - Extension API utilities for zapper
    Based on uBlock Origin Lite code

*******************************************************************************/

/******************************************************************************/

const browser = typeof chrome !== 'undefined' ? chrome : 
    typeof globalThis.browser !== 'undefined' ? globalThis.browser : {};

export const i18n = browser.i18n || {
    getMessage: (key, substitutions) => key
};

export const runtime = browser.runtime || {
    getURL: (path) => path,
    sendMessage: () => Promise.resolve()
};

/******************************************************************************/

export function sendMessage(msg) {
    if ( runtime.sendMessage ) {
        return runtime.sendMessage(msg).catch(reason => {
            console.log('[Zapper] sendMessage error:', reason);
        });
    }
    return Promise.resolve();
}

/******************************************************************************/
