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
    send(details: { what: string; location?: string; title?: string }): Promise<unknown>;
}

interface VAPI {
    messaging: VAPIMessaging;
}


/******************************************************************************/

// Injected into specific web pages, those which have been pre-selected
// because they are known to contains `abp:subscribe` links.

/******************************************************************************/

(( ) => {

/******************************************************************************/

// https://github.com/chrisaljoudi/uBlock/issues/464
if ( document instanceof HTMLDocument === false ) { return; }

// Maybe uBR has gone away meanwhile.
if ( typeof vAPI !== 'object' || vAPI === null ) { return; }

const onMaybeSubscriptionLinkClicked = function(target: HTMLAnchorElement): boolean | undefined {
    if ( vAPI instanceof Object === false ) {
        document.removeEventListener('click', onMaybeSubscriptionLinkClicked);
        return;
    }

    try {
        // https://github.com/uBlockOrigin/uBlock-issues/issues/763#issuecomment-691696716
        //   Remove replacement patch if/when filterlists.com fixes encoded '&'.
        const subscribeURL = new URL(
            target.href.replace('&amp;title=', '&title=')
        );
        if (
            /^(abp|ubo):$/.test(subscribeURL.protocol) === false &&
            subscribeURL.hostname !== 'subscribe.adblockplus.org'
        ) {
            return;
        }
        const location = subscribeURL.searchParams.get('location') || '';
        const title = subscribeURL.searchParams.get('title') || '';
        if ( location === '' || title === '' ) { return true; }
        // https://github.com/uBlockOrigin/uBlock-issues/issues/1797
        if ( /^(file|https?):\/\//.test(location) === false ) { return true; }
        vAPI.messaging.send('scriptlets', {
            what: 'subscribeTo',
            location,
            title,
        });
        return true;
    } catch (e) {
        console.warn('[uBR] subscriber: onMaybeSubscriptionLinkClicked failed', e);
    }
};

// https://github.com/easylist/EasyListHebrew/issues/89
//   Ensure trusted events only.

document.addEventListener('click', (ev: MouseEvent) => {
    if ( ev.button !== 0 || ev.isTrusted === false ) { return; }
    const target = ev.target.closest('a');
    if ( target instanceof HTMLAnchorElement === false ) { return; }
    if ( onMaybeSubscriptionLinkClicked(target) === true ) {
        ev.stopPropagation();
        ev.preventDefault();
    }
});

/******************************************************************************/

// <<<<< end of local scope
})();

void 0;
