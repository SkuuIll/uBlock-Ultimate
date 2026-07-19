// @ts-nocheck
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

import {
    domainFromHostname,
    hostnameFromURI,
    originFromURI,
} from './uri-utils.js';

import {
    sessionFirewall,
    sessionSwitches,
    sessionURLFiltering,
} from './filtering-engines.js';

import { PageStore } from './pagestore.js';
import contextMenu from './contextmenu.js';
import { i18n$ } from './i18n.js';
import logger from './logger.js';
import scriptletFilteringEngine from './scriptlet-filtering.js';
import staticNetFilteringEngine from './static-net-filtering.js';
import webext from './webext.js';
import µb from './background.js';

/******************************************************************************/
/******************************************************************************/

// https://github.com/gorhill/httpswitchboard/issues/303
//   Any scheme other than 'http' and 'https' is remapped into a fake
//   URL which trick the rest of µBlock into being able to process an
//   otherwise unmanageable scheme. µBlock needs web page to have a proper
//   hostname to work properly, so just like the 'chromium-behind-the-scene'
//   fake domain name, we map unknown schemes into a fake '{scheme}-scheme'
//   hostname. This way, for a specific scheme you can create scope with
//   rules which will apply only to that scheme.

µb.normalizeTabURL = (( ) => {
    const tabURLNormalizer = new URL('about:blank');

    return (tabId: number, tabURL: string): string => {
        if ( tabId < 0 ) {
            return 'http://behind-the-scene/';
        }
        try {
            tabURLNormalizer.href = tabURL;
        } catch (e) {
            console.warn('[uBR] tab: normalizeTabURL failed', e);
            return tabURL;
        }
        const protocol = tabURLNormalizer.protocol.slice(0, -1);
        if ( protocol === 'https' || protocol === 'http' ) {
            return tabURLNormalizer.href;
        }

        let fakeHostname = `${protocol  }-scheme`;

        if ( tabURLNormalizer.hostname !== '' ) {
            fakeHostname = `${tabURLNormalizer.hostname  }.${  fakeHostname}`;
        } else if ( protocol === 'about' && (tabURLNormalizer as any).pathname !== '' ) {
            fakeHostname = `${(tabURLNormalizer as any).pathname  }.${  fakeHostname}`;
        }

        return `http://${fakeHostname}/`;
    };
})();

/******************************************************************************/

// https://github.com/gorhill/uBlock/issues/99
// https://github.com/gorhill/uBlock/issues/991
// 
// popup:
//   Test/close target URL
// popunder:
//   Test/close opener URL
//
// popup filter match:
//   0 = false
//   1 = true
//
// opener:      0     0     1     1
// target:      0     1     0     1
//           ----  ----  ----  ----
// result:      a     b     c     d
//
// a: do nothing
// b: close target
// c: close opener
// d: close target

const onPopupUpdated = (( ) => {
    const areDifferentURLs = function(a: string, b: string): boolean {
        if ( b === '' ) { return true; }
        if ( b.startsWith('about:') ) { return false; }
        let pos = a.indexOf('://');
        if ( pos === -1 ) { return false; }
        a = a.slice(pos);
        pos = b.indexOf('://');
        if ( pos !== -1 ) {
            b = b.slice(pos);
        }
        return b !== a;
    };

    const popupMatch = function(
        fctxt: any,
        rootOpenerURL: string,
        localOpenerURL: string | undefined,
        targetURL: string,
        popupType: string = 'popup'
    ): number {
        if (
            µb.getNetFilteringSwitch(targetURL) === false ||
            µb.getNetFilteringSwitch(µb.normalizeTabURL(0, targetURL)) === false
        ) {
            return 0;
        }

        fctxt.setTabOriginFromURL(rootOpenerURL)
             .setDocOriginFromURL(localOpenerURL || rootOpenerURL)
             .setURL(targetURL)
             .setType('popup');

        if ( fctxt.getTabHostname() !== '' && targetURL !== 'about:blank' ) {
            if (
                popupType === 'popup' &&
                sessionSwitches.evaluateZ(
                    'no-popups',
                    fctxt.getTabHostname()
                )
            ) {
                fctxt.filter = {
                    raw: `no-popups: ${  sessionSwitches.z  } true`,
                    result: 1,
                    source: 'switch'
                };
                return 1;
            }

            let result = sessionURLFiltering.evaluateZ(
                fctxt.getTabHostname(),
                targetURL,
                popupType
            );
            if (
                (result === 1 && sessionURLFiltering.type === popupType) ||
                result === 2
            ) {
                fctxt.filter = sessionURLFiltering.toLogData();
                return result;
            }

            result = sessionFirewall.evaluateCellZY(
                fctxt.getTabHostname(),
                fctxt.getHostname(),
                popupType
            );
            if ( result === 2 ) {
                fctxt.filter = sessionFirewall.toLogData();
                return 2;
            }
        }

        fctxt.type = popupType;
        const result = staticNetFilteringEngine.matchRequest(fctxt, 0b0001);
        if ( result !== 0 ) {
            fctxt.filter = staticNetFilteringEngine.toLogData();
            return result;
        }

        return 0;
    };

    const mapPopunderResult = function(
        fctxt: any,
        popunderURL: string,
        popunderHostname: string,
        result: number
    ): number {
        if ( fctxt.filter === undefined || (fctxt.filter as any).source !== 'static' ) {
            return 0;
        }
        if ( (fctxt.filter as any).isUntokenized() ) {
            return 0;
        }
        if ( (fctxt.filter as any).isPureHostname() ) {
            return result;
        }
        const re = new RegExp((fctxt.filter as any).regex, 'i');
        const matches = re.exec(popunderURL);
        if ( matches === null ) { return 0; }
        const beg = matches.index;
        const end = beg + matches[0].length;
        const pos = popunderURL.indexOf(popunderHostname);
        if ( pos === -1 ) { return 0; }
        return beg >= pos && beg < pos + popunderHostname.length && end > pos
            ? result
            : 0;
    };

    const popunderMatch = function(
        fctxt: any,
        rootOpenerURL: string,
        localOpenerURL: string | undefined,
        targetURL: string
    ): number {
        let result = popupMatch(
            fctxt,
            targetURL,
            undefined,
            rootOpenerURL,
            'popunder'
        );
        if ( result === 1 ) { return result; }

        let popunderURL = rootOpenerURL,
            popunderHostname = hostnameFromURI(popunderURL);
        if ( popunderHostname === '' ) { return 0; }

        result = mapPopunderResult(
            fctxt,
            popunderURL,
            popunderHostname,
            popupMatch(fctxt, targetURL, undefined, popunderURL)
        );
        if ( result !== 0 ) { return result; }

        popunderURL = originFromURI(popunderURL);
        if ( popunderURL === '' ) { return 0; }

        return mapPopunderResult(
            fctxt,
            popunderURL,
            popunderHostname,
            popupMatch(fctxt, targetURL, undefined, popunderURL)
        );
    };

    return function(targetTabId: number, openerDetails: any): boolean | undefined {
        const openerTabId = openerDetails.tabId;
        let tabContext = µb.tabContextManager.lookup(openerTabId);
        if ( tabContext === null ) { return; }
        const rootOpenerURL = tabContext.rawURL;
        if ( rootOpenerURL === '' ) { return; }
        const pageStore = µb.pageStoreFromTabId(openerTabId);

        let localOpenerURL = openerDetails.frameId !== 0
            ? openerDetails.frameURL
            : undefined;
        if ( localOpenerURL === 'about:blank' && pageStore !== null ) {
            let openerFrameId = openerDetails.frameId;
            do {
                const frame = pageStore.getFrameStore(openerFrameId);
                if ( frame === null ) { break; }
                openerFrameId = frame.parentId;
                const parentFrame = pageStore.getFrameStore(openerFrameId);
                if ( parentFrame === null ) { break; }
                localOpenerURL = parentFrame.rawURL;
            } while ( localOpenerURL === 'about:blank' && openerFrameId !== 0 );
        }

        tabContext = µb.tabContextManager.lookup(targetTabId);
        if ( tabContext === null ) { return; }
        let targetURL = tabContext.rawURL;
        if ( targetURL === '' ) { return; }

        if ( µb.getNetFilteringSwitch(rootOpenerURL) === false ) { return; }

        if (
            µb.getNetFilteringSwitch(
                µb.normalizeTabURL(openerTabId, rootOpenerURL)
            ) === false
        ) {
            return;
        }

        targetURL = µb.pageURLFromMaybeDocumentBlockedURL(targetURL);

        const fctxt = µb.filteringContext.duplicate();

        let popupType = 'popup',
            result = 0;
        if (
            areDifferentURLs(targetURL, openerDetails.trustedURL) &&
            areDifferentURLs(targetURL, µb.maybeGoodPopup.url)
        ) {
            result = popupMatch(fctxt, rootOpenerURL, localOpenerURL, targetURL);
        }

        if ( result === 0 && openerDetails.popunder ) {
            result = popunderMatch(fctxt, rootOpenerURL, localOpenerURL, targetURL);
            if ( result === 1 ) {
                popupType = 'popunder';
            }
        }

        if ( logger.enabled ) {
            fctxt.setRealm('network').setType(popupType);
            if ( popupType === 'popup' ) {
                fctxt.setURL(targetURL)
                     .setTabId(openerTabId)
                     .setTabOriginFromURL(rootOpenerURL)
                     .setDocOriginFromURL(localOpenerURL || rootOpenerURL);
            } else {
                fctxt.setURL(rootOpenerURL)
                     .setTabId(targetTabId)
                     .setTabOriginFromURL(targetURL)
                     .setDocOriginFromURL(targetURL);
            }
            fctxt.toLogger();
        }

        if ( result !== 1 ) { return; }

        if ( pageStore ) {
            pageStore.journalAddRequest(fctxt, result);
            pageStore.popupBlockedCount += 1;
        }

        if ( µb.userSettings.showIconBadge ) {
            µb.updateToolbarIcon(openerTabId, 0b010);
        }

        if ( popupType === 'popup' ) {
            µb.unbindTabFromPageStore(targetTabId);
            (vAPI as any).tabs.remove(targetTabId, false);
        } else {
            µb.unbindTabFromPageStore(openerTabId);
            (vAPI as any).tabs.remove(openerTabId, true);
        }

        return true;
    };
})();

/******************************************************************************/
/******************************************************************************

To keep track from which context *exactly* network requests are made. This is
often tricky for various reasons, and the challenge is not specific to one
browser.

The time at which a URL is assigned to a tab and the time when a network
request for a root document is made must be assumed to be unrelated: it's all
asynchronous. There is no guaranteed order in which the two events are fired.

Also, other "anomalies" can occur:

- a network request for a root document is fired without the corresponding
tab being really assigned a new URL
<https://github.com/chrisaljoudi/uBlock/issues/516>

- a network request for a secondary resource is labeled with a tab id for
which no root document was pulled for that tab.
<https://github.com/chrisaljoudi/uBlock/issues/1001>

- a network request for a secondary resource is made without the root
document to which it belongs being formally bound yet to the proper tab id,
causing a bad scope to be used for filtering purpose.
<https://github.com/chrisaljoudi/uBlock/issues/1205>
<https://github.com/chrisaljoudi/uBlock/issues/1140>

So the solution here is to keep a lightweight data structure which only
purpose is to keep track as accurately as possible of which root document
belongs to which tab. That's the only purpose, and because of this, there are
no restrictions for when the URL of a root document can be associated to a tab.

Before, the PageStore object was trying to deal with this, but it had to
enforce some restrictions so as to not descend into one of the above issues, or
other issues. The PageStore object can only be associated with a tab for which
a definitive navigation event occurred, because it collects information about
what occurred in the tab (for example, the number of requests blocked for a
page).

The TabContext objects do not suffer this restriction, and as a result they
offer the most reliable picture of which root document URL is really associated
to which tab. Moreover, the TabObject can undo an association from a root
document, and automatically re-associate with the next most recent. This takes
care of <https://github.com/chrisaljoudi/uBlock/issues/516>.

The PageStore object no longer cache the various information about which
root document it is currently bound. When it needs to find out, it will always
defer to the TabContext object, which will provide the real answer. This takes
case of <https://github.com/chrisaljoudi/uBlock/issues/1205>. In effect, the
master switch and dynamic filtering rules can be evaluated now properly even
in the absence of a PageStore object, this was not the case before.

Also, the TabContext object will try its best to find a good candidate root
document URL for when none exists. This takes care of 
<https://github.com/chrisaljoudi/uBlock/issues/1001>.

The TabContext manager is self-contained, and it takes care to properly
housekeep itself.

*/

µb.tabContextManager = (( ) => {
    const tabContexts = new Map<number, any>();

    let mostRecentRootDocURL = '';
    let mostRecentRootDocURLTimestamp = 0;

    const popupCandidates = new Map<number, any>();

    const PopupCandidate = class {
        targetTabId: number;
        opener: any;
        selfDestructionTimer: any;

        constructor(createDetails: any, openerDetails: any[]) {
            this.targetTabId = createDetails.tabId;
            this.opener = {
                tabId: createDetails.sourceTabId,
                tabURL: openerDetails[0].url,
                frameId: createDetails.sourceFrameId,
                frameURL: openerDetails[1].url,
                popunder: false,
                trustedURL: createDetails.sourceTabId === (µb as any).maybeGoodPopup.tabId
                    ? (µb as any).maybeGoodPopup.url
                    : ''
            };
            this.selfDestructionTimer = (vAPI as any).defer.create(( ) => {
                this.destroy();
            });
            this.launchSelfDestruction();
        }

        destroy() {
            this.selfDestructionTimer.off();
            popupCandidates.delete(this.targetTabId);
        }

        launchSelfDestruction() {
            this.selfDestructionTimer.offon(10000);
        }
    };

    const popupCandidateTest = async function(targetTabId: number): Promise<void> {
        for ( const [ tabId, candidate ] of popupCandidates ) {
            if (
                targetTabId !== tabId &&
                targetTabId !== candidate.opener.tabId
            ) {
                continue;
            }
            if ( targetTabId === candidate.opener.tabId ) {
                candidate.opener.popunder = true;
            }
            const result = onPopupUpdated(tabId, candidate.opener);
            if ( result === true ) {
                candidate.destroy();
            } else {
                candidate.launchSelfDestruction();
            }
        }
    };

    const onTabCreated = async function(createDetails: any): Promise<void> {
        const { sourceTabId, sourceFrameId, tabId } = createDetails;
        const popup = popupCandidates.get(tabId);
        if ( popup === undefined ) {
            let openerDetails: any[];
            try {
                openerDetails = await Promise.all([
                    webext.webNavigation.getFrame({
                        tabId: createDetails.sourceTabId,
                        frameId: 0,
                    }),
                    webext.webNavigation.getFrame({
                        tabId: sourceTabId,
                        frameId: sourceFrameId,
                    }),
                ]);
            } catch (e) {
                console.warn('[uBR] tab: onTabCreated failed', e);
                return;
            }
            if ( Array.isArray(openerDetails) === false ) { return; }
            if ( openerDetails.length !== 2 ) { return; }
            if ( openerDetails[0] === null ) { return; }
            if ( openerDetails[1] === null ) { return; }
            if ( openerDetails[1].url === 'about:newtab' ) { return; }
            if ( openerDetails[1].url.startsWith('chrome:') ) { return; }
            popupCandidates.set(
                tabId,
                new PopupCandidate(createDetails, openerDetails)
            );
        }
        popupCandidateTest(tabId);
    };

    const gcPeriod = 10 * 60 * 1000;

    const StackEntry = function(url: string, commit: boolean) {
        this.url = url;
        this.committed = commit;
        this.tstamp = Date.now();
    };

    const TabContext = function(tabId: number) {
        this.tabId = tabId;
        this.stack = [];
        this.rawURL =
        this.normalURL =
        this.origin =
        this.rootHostname =
        this.rootDomain = '';
        this.commitTimer = (vAPI as any).defer.create(( ) => {
            (this as any).onCommit();
        });
        this.gcTimer = (vAPI as any).defer.create(( ) => {
            (this as any).onGC();
        });
        this.onGCBarrier = false;
        this.netFiltering = true;
        this.netFilteringReadTime = 0;

        tabContexts.set(tabId, this);
    };

    TabContext.prototype.destroy = function(): void {
        if ( (vAPI as any).isBehindTheSceneTabId(this.tabId) ) { return; }
        this.gcTimer.off();
        tabContexts.delete(this.tabId);
    };

    TabContext.prototype.onGC = async function(): Promise<void> {
        if ( (vAPI as any).isBehindTheSceneTabId(this.tabId) ) { return; }
        if ( this.onGCBarrier ) { return; }
        this.onGCBarrier = true;
        this.gcTimer.off();
        let tab: any;
        try { tab = await (vAPI as any).tabs.get(this.tabId); } catch {}
        if ( tab instanceof Object === false || tab.discarded === true ) {
            this.destroy();
        } else {
            this.gcTimer.on(gcPeriod);
        }
        this.onGCBarrier = false;
    };

    TabContext.prototype.onCommit = function(): void {
        if ( (vAPI as any).isBehindTheSceneTabId(this.tabId) ) { return; }
        this.commitTimer.off();
        let i = this.stack.length;
        while ( i-- ) {
            if ( this.stack[i].committed ) { break; }
        }
        if ( i === -1 && this.stack.length !== 0 ) {
            this.stack[0].committed = true;
            i = 0;
        }
        i += 1;
        if ( i < this.stack.length ) {
            this.stack.length = i;
            (this as any).update();
        }
    };

    TabContext.prototype.autodestroy = function(): void {
        if ( (vAPI as any).isBehindTheSceneTabId(this.tabId) ) { return; }
        this.gcTimer.on(gcPeriod);
    };

    TabContext.prototype.update = function(): void {
        this.netFilteringReadTime = 0;
        if ( this.stack.length === 0 ) {
            this.rawURL =
            this.normalURL =
            this.origin =
            this.rootHostname =
            this.rootDomain = '';
            return;
        }
        const stackEntry = this.stack[this.stack.length - 1];
        this.rawURL = µb.pageURLFromMaybeDocumentBlockedURL(stackEntry.url);
        this.normalURL = µb.normalizeTabURL(this.tabId, this.rawURL);
        this.origin = originFromURI(this.normalURL);
        this.rootHostname = hostnameFromURI(this.origin);
        this.rootDomain =
            domainFromHostname(this.rootHostname) ||
            this.rootHostname;
    };

    TabContext.prototype.push = function(url: string): void {
        if ( (vAPI as any).isBehindTheSceneTabId(this.tabId) ) {
            return;
        }
        const count = this.stack.length;
        if ( count !== 0 && this.stack[count - 1].url === url ) {
            return;
        }
        this.stack.push(new StackEntry(url, false));
        (this as any).update();
        popupCandidateTest(this.tabId);
        this.commitTimer.offon(500);
    };

    TabContext.prototype.commit = function(url: string): boolean {
        if ( (vAPI as any).isBehindTheSceneTabId(this.tabId) ) { return false; }
        if ( this.stack.length !== 0 ) {
            const top = this.stack[this.stack.length - 1];
            if ( top.url === url && top.committed ) { return false; }
        }
        this.stack = [new StackEntry(url, true)];
        (this as any).update();
        return true;
    };

    TabContext.prototype.getNetFilteringSwitch = function(): boolean {
        if ( this.netFilteringReadTime > (µb as any).netWhitelistModifyTime ) {
            return this.netFiltering;
        }
        this.netFiltering = µb.getNetFilteringSwitch(this.normalURL);
        if (
            this.netFiltering &&
            this.rawURL !== this.normalURL &&
            this.rawURL !== ''
        ) {
            this.netFiltering = µb.getNetFilteringSwitch(this.rawURL);
        }
        this.netFilteringReadTime = Date.now();
        return this.netFiltering;
    };

    const push = function(tabId: number, url: string): any {
        let entry = tabContexts.get(tabId);
        if ( entry === undefined ) {
            entry = new TabContext(tabId);
            entry.autodestroy();
        }
        entry.push(url);
        mostRecentRootDocURL = url;
        mostRecentRootDocURLTimestamp = Date.now();
        return entry;
    };

    const lookup = function(tabId: number): any {
        return tabContexts.get(tabId) || null;
    };

    const mustLookup = function(tabId: number): any {
        const entry = tabContexts.get(tabId);
        if ( entry !== undefined ) {
            return entry;
        }
        if (
            mostRecentRootDocURL !== '' &&
            mostRecentRootDocURLTimestamp + 500 < Date.now()
        ) {
            mostRecentRootDocURL = '';
        }
        if ( mostRecentRootDocURL !== '' ) {
            return push(tabId, mostRecentRootDocURL);
        }
        return tabContexts.get((vAPI as any).noTabId);
    };

    const commit = function(tabId: number, url: string): any {
        let entry = tabContexts.get(tabId);
        if ( entry === undefined ) {
            entry = push(tabId, url);
        } else if ( entry.commit(url) ) {
        popupCandidateTest(tabId);
        }
        return entry;
    };

    const exists = function(tabId: number): boolean {
        return tabContexts.get(tabId) !== undefined;
    };

    {
        const entry = new TabContext((vAPI as any).noTabId);
        entry.stack.push(new StackEntry('', true));
        entry.rawURL = '';
        entry.normalURL = µb.normalizeTabURL(entry.tabId);
        entry.origin = originFromURI(entry.normalURL);
        entry.rootHostname = hostnameFromURI(entry.origin);
        entry.rootDomain = domainFromHostname(entry.rootHostname);
    }

    const contextJunkyard: any[] = [];
    const Context = class {
        rootHostname: string = '';
        rootDomain: string = '';
        pageHostname: string = '';
        pageDomain: string = '';
        requestURL: string = '';
        origin: string = '';
        requestHostname: string = '';
        requestDomain: string = '';

        constructor(tabId: number) {
            this.init(tabId);
        }
        init(tabId: number): this {
            const tabContext = lookup(tabId);
            if ( tabContext !== null ) {
                this.rootHostname = tabContext.rootHostname;
                this.rootDomain = tabContext.rootDomain;
            } else {
                this.rootHostname = '';
                this.rootDomain = '';
            }
            this.pageHostname =
            this.pageDomain =
            this.requestURL =
            this.origin =
            this.requestHostname =
            this.requestDomain = '';
            return this;
        }
        dispose(): void {
            contextJunkyard.push(this);
        }
    };

    const createContext = function(tabId: number): any {
        if ( contextJunkyard.length ) {
            return contextJunkyard.pop().init(tabId);
        }
        return new Context(tabId);
    };

    return {
        push,
        commit,
        lookup,
        mustLookup,
        exists,
        createContext,
        onTabCreated,
    };
})();

/******************************************************************************/
/******************************************************************************/

(vAPI as any).Tabs = class extends (vAPI as any).Tabs {
    onActivated(details: any): void {
        const { tabId } = details;
        if ( (vAPI as any).isBehindTheSceneTabId(tabId) ) { return; }
        const pageStore = µb.pageStoreFromTabId(tabId);
        if ( pageStore === null ) {
            this.onNewTab(tabId);
            return;
        }
        super.onActivated(details);
        µb.updateToolbarIcon(tabId);
        contextMenu.update(tabId);
    }

    onClosed(tabId: number): void {
        super.onClosed(tabId);
        if ( (vAPI as any).isBehindTheSceneTabId(tabId) ) { return; }
        µb.unbindTabFromPageStore(tabId);
        contextMenu.update();
    }

    onCreated(details: any): void {
        super.onCreated(details);
        µb.tabContextManager.onTabCreated(details);
    }

    onNavigation(details: any): void {
        super.onNavigation(details);
        const { frameId, tabId, url } = details;
        if ( frameId === 0 ) {
            µb.tabContextManager.commit(tabId, url);
            const pageStore = µb.bindTabToPageStore(tabId, 'tabCommitted', details);
            if ( pageStore !== null ) {
                pageStore.journalAddRootFrame('committed', url);
            }
        }
        const pageStore = µb.pageStoreFromTabId(tabId);
        if ( pageStore === null ) { return; }
        pageStore.setFrameURL(details);
        if ( pageStore.getNetFilteringSwitch() ) {
            details.ancestors = pageStore.getFrameAncestorDetails(frameId);
            scriptletFilteringEngine.injectNow(details);
        }
    }

    async onNewTab(tabId: number): Promise<void> {
        let tab: any;
        try { tab = await (vAPI as any).tabs.get(tabId); } catch {}
        if ( tab == null ) { return; }
        const { id, url = '' } = tab;
        if ( url === '' ) { return; }
        µb.tabContextManager.commit(id, url);
        µb.bindTabToPageStore(id, 'tabUpdated', tab);
        contextMenu.update(id);
    }

    onUpdated(tabId: number, changeInfo: any, tab: any): void {
        super.onUpdated(tabId, changeInfo, tab);
        if ( !tab.url || tab.url === '' ) { return; }
        if ( !changeInfo.url ) { return; }
        µb.tabContextManager.commit(tabId, changeInfo.url);
        µb.bindTabToPageStore(tabId, 'tabUpdated', tab);
    }
};

(vAPI as any).tabs = new (vAPI as any).Tabs();

/******************************************************************************/
/******************************************************************************/

µb.bindTabToPageStore = function(tabId: number, context: string, details: any = undefined): any {
    this.updateToolbarIcon(tabId, 0b111);

    if ( this.tabContextManager.exists(tabId) === false ) {
        this.unbindTabFromPageStore(tabId);
        return null;
    }

    let pageStore = this.pageStores.get(tabId);

    if ( pageStore === undefined ) {
        pageStore = PageStore.factory(tabId, details);
        this.pageStores.set(tabId, pageStore);
        this.pageStoresToken = Date.now();
        return pageStore;
    }

    if ( (vAPI as any).isBehindTheSceneTabId(tabId) ) {
        return pageStore;
    }

    if ( context === 'beforeRequest' ) {
        pageStore.netFilteringCache.empty();
        return pageStore;
    }

    pageStore.reuse(context, details);

    this.pageStoresToken = Date.now();

    return pageStore;
};

/******************************************************************************/

µb.unbindTabFromPageStore = function(tabId: number): void {
    const pageStore = this.pageStores.get(tabId);
    if ( pageStore === undefined ) { return; }
    pageStore.dispose();
    this.pageStores.delete(tabId);
    this.pageStoresToken = Date.now();
};

/******************************************************************************/

µb.pageStoreFromTabId = function(tabId: number): any {
    return this.pageStores.get(tabId) || null;
};

µb.mustPageStoreFromTabId = function(tabId: number): any {
    return this.pageStores.get(tabId) || this.pageStores.get((vAPI as any).noTabId);
};

/******************************************************************************/

// Permanent page store for behind-the-scene requests. Must never be removed.

{
    const NoPageStore = class extends PageStore {
        getNetFilteringSwitch(fctxt?: any): boolean {
            if ( fctxt ) {
                const docOrigin = fctxt.getDocOrigin();
                if ( docOrigin ) {
                    return µb.getNetFilteringSwitch(docOrigin);
                }
            }
            return super.getNetFilteringSwitch();
        }
    };
    const pageStore = new NoPageStore((vAPI as any).noTabId);
    µb.pageStores.set(pageStore.tabId, pageStore);
    pageStore.title = i18n$('logBehindTheScene');
}

/******************************************************************************/

// Update visual of extension icon.

{
    const tabIdToDetails = new Map<number, number>();

    const computeBadgeColor = (bits: number): string => {
        let color = (µb as any).blockingProfileColorCache.get(bits);
        if ( color !== undefined ) { return color; }
        let max = 0;
        for ( const profile of (µb as any).liveBlockingProfiles ) {
            const v = bits & (profile.bits & ~1);
            if ( v < max ) { break; }
            color = profile.color;
            max = v;
        }
        if ( color === undefined ) {
            color = '#666';
        }
        (µb as any).blockingProfileColorCache.set(bits, color);
        return color;
    };

    const updateBadge = (tabId: number): void => {
        let parts = tabIdToDetails.get(tabId);
        tabIdToDetails.delete(tabId);

        let state = 0;
        let badge = '';
        let color = '#666';

        const pageStore = µb.pageStoreFromTabId(tabId);
        if ( pageStore !== null ) {
            state = pageStore.getNetFilteringSwitch() ? 1 : 0;
            if ( state === 1 ) {
                if ( (parts! & 0b0010) !== 0 ) {
                    const blockCount = pageStore.counts.blocked.any;
                    if ( blockCount !== 0 ) {
                        badge = µb.formatCount(blockCount);
                    }
                }
                if ( (parts! & 0b0100) !== 0 ) {
                    color = computeBadgeColor(
                        (µb as any).blockingModeFromHostname(pageStore.tabHostname)
                    );
                }
            }
        }

        if ( (µb as any).userSettings.showIconBadge === false ) {
            parts! |= 0b1000;
        }

        (vAPI as any).setIcon(tabId, { parts, state, badge, color });
    };

    µb.updateToolbarIcon = function(tabId: number, newParts: number = 0b0111): void {
        if ( this.readyToFilter === false ) { return; }
        if ( typeof tabId !== 'number' ) { return; }
        if ( (vAPI as any).isBehindTheSceneTabId(tabId) ) { return; }
        const currentParts = tabIdToDetails.get(tabId);
        if ( currentParts === newParts ) { return; }
        if ( currentParts === undefined ) {
            self.requestIdleCallback(
                ( ) => updateBadge(tabId),
                { timeout: 701 }
            );
        } else {
            newParts |= currentParts;
        }
        tabIdToDetails.set(tabId, newParts);
    };
}

/******************************************************************************/

// https://github.com/chrisaljoudi/uBlock/issues/455
//   Stale page store entries janitor

{
    let pageStoreJanitorSampleAt = 0;
    const pageStoreJanitorSampleSize = 10;

    const checkTab = async (tabId: number): Promise<void> => {
        let tab: any;
        try { tab = await (vAPI as any).tabs.get(tabId); } catch {}
        if ( tab instanceof Object && tab.discarded !== true ) { return; }
        µb.unbindTabFromPageStore(tabId);
    };

    const pageStoreJanitor = function(): void {
        const tabIds = Array.from((µb as any).pageStores.keys()).sort();
        if ( pageStoreJanitorSampleAt >= tabIds.length ) {
            pageStoreJanitorSampleAt = 0;
        }
        const n = Math.min(
            pageStoreJanitorSampleAt + pageStoreJanitorSampleSize,
            tabIds.length
        );
        for ( let i = pageStoreJanitorSampleAt; i < n; i++ ) {
            const tabId = tabIds[i];
            if ( (vAPI as any).isBehindTheSceneTabId(tabId) ) { continue; }
            checkTab(tabId);
        }
        pageStoreJanitorSampleAt = n;

        pageStoreJanitorTimer.on(pageStoreJanitorPeriod);
    };

    const pageStoreJanitorTimer = (vAPI as any).defer.create(pageStoreJanitor);
    const pageStoreJanitorPeriod = { min: 15 };

    pageStoreJanitorTimer.on(pageStoreJanitorPeriod);
}

/******************************************************************************/
