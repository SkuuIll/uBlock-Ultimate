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

import * as s14e from './s14e-serializer.js';
import {
    getAllCustomFilters,
    addCustomFilters,
    removeCustomFilters,
    removeAllCustomFilters,
    customFiltersFromHostname,
} from './filter-storage.js';
import * as sfp from './static-filtering-parser.js';

import {
    domainFromHostname,
    domainFromURI,
    hostnameFromURI,
    isNetworkURI,
} from './uri-utils.js';

import {
    permanentFirewall,
    permanentSwitches,
    permanentURLFiltering,
    sessionFirewall,
    sessionSwitches,
    sessionURLFiltering,
} from './filtering-engines.js';

import cacheStorage from './cachestorage.js';
import { denseBase64 } from './base64-custom.js';
import { broadcast, filteringBehaviorChanged } from './broadcast.js';
import htmlFilteringEngine from './html-filtering.js';
import { i18n$ } from './i18n.js';
import io from './assets.js';
import logger from './logger.js';
import lz4Codec from './lz4.js';
import publicSuffixList from '../extension/lib/publicsuffixlist/publicsuffixlist.js';
import punycode from '../extension/lib/punycode.js';
import { redirectEngine } from './redirect-engine.js';
import scriptletFilteringEngine from './scriptlet-filtering.js';
import { staticFilteringReverseLookup } from './reverselookup.js';
import staticExtFilteringEngine from './static-ext-filtering.js';
import staticNetFilteringEngine from './static-net-filtering.js';
import webRequest from './traffic.js';
import µb from './background.js';
import blockerAdapter from './blocker-adapter.js';

import { scriptingManager } from './mv3/scripting-manager.js';
import { dnrIntegration } from './dnr-integration.js';

/******************************************************************************/

const registerMessagingListener = (details: { name: string; listener: unknown }) => {
    if ( typeof vAPI.messaging?.listen !== 'function' ) { return; }
    vAPI.messaging.listen(details as never);
};

const getWarSecretShort = () =>
    typeof vAPI === 'object' && vAPI !== null && typeof vAPI.warSecret?.short === 'function'
        ? vAPI.warSecret.short()
        : '';

// https://github.com/uBlockOrigin/uBlock-issues/issues/710
//   Listeners have a name and a "privileged" status.
//   The nameless default handler is always deemed "privileged".
//   Messages from privileged ports must never relayed to listeners
//   which are not privileged.

/******************************************************************************/
/******************************************************************************/

// Default handler
//      privileged

{
// >>>>> start of local scope

const clickToLoad = function(request, sender) {
    const { tabId, frameId } = sender;
    if ( tabId === undefined || frameId === undefined ) { return false; }
    const pageStore = µb.pageStoreFromTabId(tabId);
    if ( pageStore === null ) { return false; }
    pageStore.clickToLoad(frameId, request.frameURL);
    return true;
};

const getDomainNames = function(targets) {
    return targets.map(target => {
        if ( typeof target !== 'string' ) { return ''; }
        return target.indexOf('/') !== -1
            ? domainFromURI(target) || ''
            : domainFromHostname(target) || target;
    });
};

const onMessage = function(request, sender, callback) {
    const webextAPI = typeof self.browser !== 'undefined' ? self.browser : chrome;
    // Async
    switch ( request.what ) {
    case 'getAssetContent':
        // https://github.com/chrisaljoudi/uBlock/issues/417
        io.get(request.url, {
            dontCache: true,
            needSourceURL: true,
        }).then(result => {
            result.trustedSource = µb.isTrustedList(result.assetKey);
            callback(result);
        });
        return;

    case 'listsFromNetFilter':
        staticFilteringReverseLookup.fromNetFilter(
            request.rawFilter
        ).then(response => {
            callback(response);
        });
        return;

    case 'listsFromCosmeticFilter':
        staticFilteringReverseLookup.fromExtendedFilter(
            request
        ).then(response => {
            callback(response);
        });
        return;

    case 'reloadAllFilters':
        console.log('[MV3-DEBUG] reloadAllFilters called');
        µb.loadFilterLists().then(( ) => { 
            console.log('[MV3-DEBUG] loadFilterLists completed');

            callback(); 
        });
        return;

    case 'createUserFilter':
        console.log('[MSG] createUserFilter received - filters:', request.filters, 'docURL:', request.docURL);
        const allLines = (request.filters || '').split('\n').map(l => l.trim()).filter(Boolean);
        const smartLinesFromFilter: string[] = [];
        const networkLinesFromFilter: string[] = [];
        for (const line of allLines) {
            if (line.startsWith('hide|') || line.startsWith('unhide|')) {
                smartLinesFromFilter.push(line);
            } else if (/##/.test(line)) {
                const m = line.match(/^(.*?)(#@?#)(.+)$/);
                if (m) {
                    const domain = m[1] || '*';
                    const isException = m[2] === '#@#';
                    const selector = m[3];
                    smartLinesFromFilter.push(`${isException ? 'unhide' : 'hide'}|${domain}|${selector}`);
                } else {
                    networkLinesFromFilter.push(line);
                }
            } else {
                networkLinesFromFilter.push(line);
            }
        }
        if (smartLinesFromFilter.length > 0) {
            (async () => {
                try {
                    const { smartRuleStore } = await import('../core/smart-cosmetic/smart-rule-store');
                    await smartRuleStore.load();
                    for (const smartLine of smartLinesFromFilter) {
                        const parts = smartLine.split('|');
                        const isUnhide = parts[0] === 'unhide';
                        const selector = parts[parts.length - 1];
                        const domain = parts.length > 2 ? parts.slice(1, -1).join('|') : '*';
                        if (!selector) continue;
                        const targets = domain === '*'
                            ? [{ form: 'host' as const, value: '*' }]
                            : domain.split(',').filter(Boolean).map(d => ({ form: 'host' as const, value: d }));
                        const rule = {
                            type: (isUnhide ? 'show-exact' : 'hide-exact') as const,
                            id: `ubr:smart:user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                            syntaxVersion: 1,
                            state: 'active' as const,
                            targets,
                            selector,
                            action: { action: (isUnhide ? 'show' : 'hide') as const },
                            metadata: { createdAt: new Date().toISOString(), source: 'user-filter' as const },
                            collectionId: 'user-filters',
                        };
                        await smartRuleStore.addRule(rule as any);
                    }
                } catch (e) {
                    console.error('[MSG] Failed to create smart rule:', e);
                }
            })();
        }
        const filterText = networkLinesFromFilter.join('\n');
        return µb.createUserFilters({ ...request, filters: filterText.length > 0 ? filterText : undefined }).then(() => {
            console.log('[MSG] createUserFilters completed');
            callback();
        });

    case 'scriptlet':
        vAPI.tabs.executeScript(request.tabId, {
            file: `/js/scriptlets/${request.scriptlet}.js`
        }).then(result => {
            callback(result);
        });
        return;

    // GAP #1: Dynamic Content Script Registration
    case 'getRegisteredContentScripts':
        scriptingManager.getRegisteredContentScripts().then(ids => {
            callback(ids);
        });
        return;

    case 'reRegisterContentScripts':
        scriptingManager.reRegisterContentScripts().then(() => {
            callback();
        });
        return;

    // GAP #2: Effective DNR Rules Visibility
    case 'getEffectiveDynamicRules':
        dnrIntegration.getDynamicRules().then(rules => {
            callback(rules);
        });
        return;

    case 'getEffectiveSessionRules':
        dnrIntegration.getSessionRules().then(rules => {
            callback(rules);
        });
        return;

    case 'getEffectiveUserRules':
        dnrIntegration.getUserRules().then(rules => {
            callback(rules);
        });
        return;

    case 'getRulesetDetails':
        dnrIntegration.getRulesetDetails().then(details => {
            callback(details);
        });
        return;

    case 'getEnabledRulesetsDetails':
        dnrIntegration.getEnabledRulesetsDetails().then(details => {
            callback(details);
        });
        return;

    case 'showMatchedRules':
        vAPI.tabs.create({ url: '/matched-rules.html' });
        callback();
        return;

    default:
        break;
    }

    // Sync
    let response;

    switch ( request.what ) {
    case 'applyFilterListSelection':
        response = µb.applyFilterListSelection(request);
        break;

    case 'clickToLoad':
        response = clickToLoad(request, sender);
        break;

    case 'getAppData':
        response = {
            name: webextAPI.runtime.getManifest().name,
            version: vAPI.app.version,
            canBenchmark: µb.hiddenSettings.benchmarkDatasetURL !== 'unset',
        };
        break;

    case 'getDomainNames':
        response = getDomainNames(request.targets);
        break;

    case 'getTrustedScriptletTokens':
        response = redirectEngine.getTrustedScriptletTokens();
        break;

    case 'getWhitelist':
        response = {
            whitelist: µb.arrayFromWhitelist(µb.netWhitelist),
            whitelistDefault: µb.netWhitelistDefault,
            reBadHostname: µb.reWhitelistBadHostname.source,
            reHostnameExtractor: µb.reWhitelistHostnameExtractor.source
        };
        break;

    case 'launchElementPicker':
        // Launched from some auxiliary pages, clear context menu coords.
        µb.epickerArgs.mouse = false;
        µb.elementPickerExec(request.tabId, 0, request.targetURL, request.zap);
        break;

    case 'loggerDisabled':
        µb.clearInMemoryFilters();
        break;

    case 'gotoURL':
        µb.openNewTab(request.details);
        break;

    case 'readyToFilter':
        response = µb.readyToFilter;
        break;

    // https://github.com/uBlockOrigin/uBlock-issues/issues/1954
    //   In case of document-blocked page, navigate to blocked URL instead
    //   of forcing a reload.
    case 'reloadTab': {
        if ( vAPI.isBehindTheSceneTabId(request.tabId) ) { break; }
        const { tabId, bypassCache, url, select } = request;
        vAPI.tabs.get(tabId).then(tab => {
            if ( url && tab && url !== tab.url ) {
                vAPI.tabs.replace(tabId, url);
            } else {
                vAPI.tabs.reload(tabId, bypassCache === true);
            }
        }).catch(() => {});
        if ( select && vAPI.tabs.select ) {
            vAPI.tabs.select(tabId);
        }
        break;
    }
    case 'setWhitelist':
        µb.netWhitelist = µb.whitelistFromString(request.whitelist);
        µb.saveWhitelist();
        filteringBehaviorChanged();
        break;

    case 'toggleHostnameSwitch':
        µb.toggleHostnameSwitch(request);
        break;

    case 'uiAccentStylesheet':
        µb.uiAccentStylesheet = request.stylesheet;
        break;

    case 'uiStyles':
        response = {
            uiAccentCustom: µb.userSettings.uiAccentCustom,
            uiAccentCustom0: µb.userSettings.uiAccentCustom0,
            uiAccentStylesheet: µb.uiAccentStylesheet,
            uiStyles: µb.hiddenSettings.uiStyles,
            uiTheme: µb.userSettings.uiTheme,
        };
        break;

    case 'userSettings':
        response = µb.changeUserSettings(request.name, request.value);
        if ( response instanceof Object ) {
            if ( vAPI.net.canUncloakCnames !== true ) {
                response.cnameUncloakEnabled = undefined;
            }
            response.canLeakLocalIPAddresses =
                vAPI.browserSettings.canLeakLocalIPAddresses === true;
        }
        break;

    default:
        return vAPI.messaging.UNHANDLED;
    }

    callback(response);
};

if ( typeof vAPI.messaging?.setup === 'function' ) {
    vAPI.messaging.setup(onMessage);
}

// <<<<< end of local scope
}

/******************************************************************************/
/******************************************************************************/

// Channel:
//      popupPanel
//      privileged

{
// >>>>> start of local scope

const createCounts = ( ) => {
    return {
        blocked: { any: 0, frame: 0, script: 0 },
        allowed: { any: 0, frame: 0, script: 0 },
    };
};

const getHostnameDict = function(hostnameDetailsMap, out) {
    const hnDict = Object.create(null);
    const cnMap = [];

    const createDictEntry = (domain, hostname, details) => {
        if ( details.cname ) {
            cnMap.push([ details.cname, hostname ]);
        }
        hnDict[hostname] = { domain, counts: details.counts };
    };

    for ( const hnDetails of hostnameDetailsMap.values() ) {
        const hostname = hnDetails.hostname;
        if ( hnDict[hostname] !== undefined ) { continue; }
        const domain = domainFromHostname(hostname) || hostname;
        const dnDetails =
            hostnameDetailsMap.get(domain) || { counts: createCounts() };
        if ( hnDict[domain] === undefined ) {
            createDictEntry(domain, domain, dnDetails);
        }
        if ( hostname === domain ) { continue; }
        createDictEntry(domain, hostname, hnDetails);
    }

    out.hostnameDict = hnDict;
    out.cnameMap = cnMap;
};

const firewallRuleTypes = [
    '*',
    'image',
    '3p',
    'inline-script',
    '1p-script',
    '3p-script',
    '3p-frame',
];

const getFirewallRules = function(src, out) {
    const ruleset = out.firewallRules = {};
    const df = sessionFirewall;

    for ( const type of firewallRuleTypes ) {
        const r = df.lookupRuleData('*', '*', type);
        if ( r === undefined ) { continue; }
        ruleset[`/ * ${type}`] = r;
    }
    if ( typeof src !== 'string' ) { return; }

    for ( const type of firewallRuleTypes ) {
        const r = df.lookupRuleData(src, '*', type);
        if ( r === undefined ) { continue; }
        ruleset[`. * ${type}`] = r;
    }

    const { hostnameDict } = out;
    for ( const des in hostnameDict ) {
        let r = df.lookupRuleData('*', des, '*');
        if ( r !== undefined ) { ruleset[`/ ${des} *`] = r; }
        r = df.lookupRuleData(src, des, '*');
        if ( r !== undefined ) { ruleset[`. ${des} *`] = r; }
    }
};

const popupDataFromTabId = function(tabId, tabTitle) {
    const tabContext = µb.tabContextManager.mustLookup(tabId);
    const rootHostname = tabContext.rootHostname;
    const µbus = µb.userSettings;
    const µbhs = µb.hiddenSettings;
    const r = {
        advancedUserEnabled: µbus.advancedUserEnabled,
        appName: vAPI.app.name,
        appVersion: vAPI.app.version,
        colorBlindFriendly: µbus.colorBlindFriendly,
        cosmeticFilteringSwitch: false,
        firewallPaneMinimized: µbus.firewallPaneMinimized,
        globalAllowedRequestCount: µb.requestStats.allowedCount,
        globalBlockedRequestCount: µb.requestStats.blockedCount,
        fontSize: µbhs.popupFontSize,
        godMode: µbhs.filterAuthorMode,
        netFilteringSwitch: false,
        userFiltersAreEnabled: µb.userFiltersAreEnabled(),
        rawURL: tabContext.rawURL,
        pageURL: tabContext.normalURL,
        pageHostname: rootHostname,
        pageDomain: tabContext.rootDomain,
        popupBlockedCount: 0,
        popupPanelSections: µbus.popupPanelSections,
        popupPanelDisabledSections: µbhs.popupPanelDisabledSections,
        popupPanelLockedSections: µbhs.popupPanelLockedSections,
        popupPanelHeightMode: µbhs.popupPanelHeightMode,
        popupPanelOrientation: µbhs.popupPanelOrientation,
        tabId,
        tabTitle,
        tooltipsDisabled: µbus.tooltipsDisabled,
        hasUnprocessedRequest: vAPI.net && vAPI.net.hasUnprocessedRequest(tabId),
    };

    if ( µbhs.uiPopupConfig !== 'unset' ) {
        r.uiPopupConfig = µbhs.uiPopupConfig;
    }

    const pageStore = µb.pageStoreFromTabId(tabId);
    if ( pageStore ) {
        r.pageCounts = pageStore.counts;
        r.netFilteringSwitch = pageStore.getNetFilteringSwitch();
        getHostnameDict(pageStore.getAllHostnameDetails(), r);
        r.contentLastModified = pageStore.contentLastModified;
        getFirewallRules(rootHostname, r);
        r.canElementPicker = isNetworkURI(r.rawURL) && /^https?:\/\/(chrome\.google\.com|chromewebstore\.google\.com)\//.test(r.rawURL) === false;
        r.noPopups = sessionSwitches.evaluateZ(
            'no-popups',
            rootHostname
        );
        r.popupBlockedCount = pageStore.popupBlockedCount;
        r.noCosmeticFiltering = sessionSwitches.evaluateZ(
            'no-cosmetic-filtering',
            rootHostname
        );
        r.noLargeMedia = sessionSwitches.evaluateZ(
            'no-large-media',
            rootHostname
        );
        r.largeMediaCount = pageStore.largeMediaCount;
        r.noRemoteFonts = sessionSwitches.evaluateZ(
            'no-remote-fonts',
            rootHostname
        );
        r.remoteFontCount = pageStore.remoteFontCount;
        r.noScripting = sessionSwitches.evaluateZ(
            'no-scripting',
            rootHostname
        );
    } else {
        r.hostnameDict = {};
        getFirewallRules(undefined, r);
    }

    r.matrixIsDirty = sessionFirewall.hasSameRules(
        permanentFirewall,
        rootHostname,
        r.hostnameDict
    ) === false;
    if ( r.matrixIsDirty === false ) {
        r.matrixIsDirty = sessionSwitches.hasSameRules(
            permanentSwitches,
            rootHostname
        ) === false;
    }
    return r;
};

const popupDataFromRequest = async function(request) {
    if ( request.tabId ) {
        return popupDataFromTabId(request.tabId, '');
    }

    // Still no target tab id? Use currently selected tab.
    const tab = await vAPI.tabs.getCurrent();
    let tabId = '';
    let tabTitle = '';
    if ( tab instanceof Object ) {
        tabId = tab.id;
        tabTitle = tab.title || '';
    }
    return popupDataFromTabId(tabId, tabTitle);
};

const getElementCount = async function(tabId, what) {
    const results = await vAPI.tabs.executeScript(tabId, {
        allFrames: true,
        file: `/js/scriptlets/dom-survey-${what}.js`,
        runAt: 'document_end',
    });

    let total = 0;
    for ( const count of results ) {
        if ( typeof count !== 'number' ) { continue; }
        if ( count === -1 ) { return -1; }
        total += count;
    }

    return total;
};



const onMessage = function(request, sender, callback) {
    // Async
    switch ( request.what ) {
    case 'getHiddenElementCount':
        getElementCount(request.tabId, 'elements').then(count => {
            callback(count);
        });
        return;

    case 'getScriptCount':
        getElementCount(request.tabId, 'scripts').then(count => {
            callback(count);
        });
        return;

    case 'getPopupData':
        popupDataFromRequest(request).then(popupData => {
            callback(popupData);
        });
        return;

    default:
        break;
    }

    // Sync
    let response;

    switch ( request.what ) {
    case 'dismissUnprocessedRequest':
        vAPI.net.removeUnprocessedRequest(request.tabId);
        µb.updateToolbarIcon(request.tabId, 0b110);
        break;

    case 'hasPopupContentChanged': {
        const pageStore = µb.pageStoreFromTabId(request.tabId);
        const lastModified = pageStore ? pageStore.contentLastModified : 0;
        response = lastModified !== request.contentLastModified;
        break;
    }

    case 'revertFirewallRules':
        // TODO: use Set() to message around sets of hostnames
        sessionFirewall.copyRules(
            permanentFirewall,
            request.srcHostname,
            Object.assign(Object.create(null), request.desHostnames)
        );
        sessionSwitches.copyRules(
            permanentSwitches,
            request.srcHostname
        );
        µb.updateToolbarIcon(request.tabId, 0b100);
        response = popupDataFromTabId(request.tabId);
        break;

    case 'saveFirewallRules':
        // TODO: use Set() to message around sets of hostnames
        if (
            permanentFirewall.copyRules(
                sessionFirewall,
                request.srcHostname,
                Object.assign(Object.create(null), request.desHostnames)
            )
        ) {
            µb.savePermanentFirewallRules();
        }
        if (
            permanentSwitches.copyRules(
                sessionSwitches,
                request.srcHostname
            )
        ) {
            µb.saveHostnameSwitches();
        }
        break;

    case 'toggleHostnameSwitch':
        µb.toggleHostnameSwitch(request);
        response = popupDataFromTabId(request.tabId);
        break;

    case 'toggleFirewallRule':
        µb.toggleFirewallRule(request);
        response = popupDataFromTabId(request.tabId);
        break;

    case 'toggleNetFiltering': {
        const pageStore = µb.pageStoreFromTabId(request.tabId);
        if ( pageStore ) {
            pageStore.toggleNetFilteringSwitch(
                request.url,
                request.scope,
                request.state
            );
            µb.updateToolbarIcon(request.tabId, 0b111);
        }
        break;
    }
    default:
        return vAPI.messaging.UNHANDLED;
    }

    callback(response);
};

registerMessagingListener({
    name: 'popupPanel',
    listener: onMessage,
    privileged: true,
});

// <<<<< end of local scope
}

/******************************************************************************/
/******************************************************************************/

// Channel:
//      contentscript
//      unprivileged

{
// >>>>> start of local scope

const retrieveContentScriptParameters = async function(sender, request) {
    if ( µb.readyToFilter !== true ) { return; }
    const { tabId, frameId } = sender;
    if ( tabId === undefined || frameId === undefined ) { return; }

    const pageStore = µb.pageStoreFromTabId(tabId);
    if ( pageStore === null || pageStore.getNetFilteringSwitch() === false ) {
        return;
    }

    // A content script may not always be able to successfully look up the
    // effective context, hence in such case we try again to look up here
    // using cached information about embedded frames.
    if ( frameId !== 0 && request.url.startsWith('about:') ) {
        request.url = pageStore.getEffectiveFrameURL(sender);
    }

    const noSpecificCosmeticFiltering =
        pageStore.shouldApplySpecificCosmeticFilters(frameId) === false;
    const noGenericCosmeticFiltering =
        pageStore.shouldApplyGenericCosmeticFilters(frameId) === false;

    const response = {
        collapseBlocked: µb.userSettings.collapseBlocked,
        noGenericCosmeticFiltering,
        noSpecificCosmeticFiltering,
    };

    request.tabId = tabId;
    request.frameId = frameId;
    request.hostname = hostnameFromURI(request.url);
    request.domain = domainFromHostname(request.hostname);
    request.ancestors = pageStore.getFrameAncestorDetails(frameId);

    console.log('[MV3-MSg] retrieveContentScriptParameters - tabId:', tabId, 'frameId:', frameId, 'hostname:', request.hostname);



    // The procedural filterer's code is loaded only when needed and must be
    // present before returning response to caller.
    if (
        staticExtFilteringEngine.acceptedCount !== 0 || (
            logger.enabled && staticExtFilteringEngine.discardedCount !== 0
        )
    ) {
        await vAPI.tabs.executeScript(tabId, {
            allFrames: false,
            file: '/js/contentscript-extra.js',
            frameId,
            matchAboutBlank: true,
            runAt: 'document_start',
        });
    }

    // https://github.com/uBlockOrigin/uBlock-issues/issues/688#issuecomment-748179731
    //   For non-network URIs, scriptlet injection is deferred to here. The
    //   effective URL is available here in `request.url`.
    if ( logger.enabled ) {
        const scriptletDetails = scriptletFilteringEngine.retrieve(request);
        if ( scriptletDetails !== undefined ) {
            scriptletFilteringEngine.toLogger(request, scriptletDetails);
        }
    }
    if ( request.needScriptlets ) {
        scriptletFilteringEngine.injectNow(request);
    }

    // https://github.com/NanoMeow/QuickReports/issues/6#issuecomment-414516623
    //   Inject as early as possible to make the cosmetic logger code less
    //   sensitive to the removal of DOM nodes which may match injected
    //   cosmetic filters.
    if ( logger.enabled ) {
        if (
            noSpecificCosmeticFiltering === false ||
            noGenericCosmeticFiltering === false
        ) {
            vAPI.tabs.executeScript(tabId, {
                allFrames: false,
                file: '/js/scriptlets/cosmetic-logger.js',
                frameId,
                matchAboutBlank: true,
                runAt: 'document_start',
            });
        }
    }

    return response;
};

const onMessage = function(request, sender, callback) {
    // Async
    switch ( request.what ) {
    case 'retrieveContentScriptParameters':
        return retrieveContentScriptParameters(
            sender,
            request
        ).then(response => {
            callback(response);
        });
    default:
        break;
    }

    const pageStore = µb.pageStoreFromTabId(sender.tabId);

    // Sync
    let response;

    switch ( request.what ) {




    case 'maybeGoodPopup':
        µb.maybeGoodPopup.tabId = sender.tabId;
        µb.maybeGoodPopup.url = request.url;
        break;

    case 'messageToLogger':
        if ( logger.enabled !== true ) { break; }
        logger.writeOne({
            tabId: sender.tabId,
            realm: 'message',
            type: request.type || 'info',
            keywords: [ 'scriptlet' ],
            text: request.text,
        });
        break;

    case 'shouldRenderNoscriptTags': {
        if ( pageStore === null ) { break; }
        if ( µb.hiddenSettings.noScriptingCSP !== µb.hiddenSettingsDefault.noScriptingCSP ) {
            break;
        }
        const fctxt = µb.filteringContext.fromTabId(sender.tabId);
        if ( pageStore.filterScripting(fctxt, undefined) ) {
            vAPI.tabs.executeScript(sender.tabId, {
                file: '/js/scriptlets/noscript-spoof.js',
                frameId: sender.frameId,
                runAt: 'document_end',
            });
        }
        break;
    }


    default:
        return vAPI.messaging.UNHANDLED;
    }

    callback(response);
};

registerMessagingListener({
    name: 'contentscript',
    listener: onMessage,
});

// <<<<< end of local scope
}

/******************************************************************************/
/******************************************************************************/

// Channel:
//      elementPicker
//      unprivileged

{
// >>>>> start of local scope

// Global debug log storage for epicker
let epickerDebugLogs = [];

const onMessage = function(request, sender, callback) {
    // Async
    switch ( request.what ) {
    // Save epicker debug logs
    case 'epickerDebugLog':
        epickerDebugLogs.push(request.log);
        // Keep only last 500 entries
        if (epickerDebugLogs.length > 500) {
            epickerDebugLogs = epickerDebugLogs.slice(-500);
        }
        // Log to console so it appears in about:debugging
        console.log('[EPICKER-LOG]', request.log);
        return;
    // Get epicker debug logs
    case 'getEpickerLogs':
        callback(epickerDebugLogs);
        return;
    // Clear epicker debug logs
    case 'clearEpickerLogs':
        epickerDebugLogs = [];
        callback();
        return;
    // The procedural filterer must be present in case the user wants to
    // type-in custom filters.
    case 'elementPickerArguments':
        return vAPI.tabs.executeScript(sender.tabId, {
            allFrames: false,
            file: '/js/contentscript-extra.js',
            frameId: sender.frameId,
            matchAboutBlank: true,
            runAt: 'document_start',
        }).then(( ) => {
            callback({
                target: µb.epickerArgs.target,
                mouse: µb.epickerArgs.mouse,
                zap: µb.epickerArgs.zap,
                eprom: µb.epickerArgs.eprom,
                pickerURL: vAPI.getURL(
                    `/web_accessible_resources/epicker-ui.html?secret=${getWarSecretShort()}`
                ),
            });
            µb.epickerArgs.target = '';
        });

    case 'createUserFilter': {
        const filterLines = (request.filters || request.filter || '').split('\n').map(l => l.trim()).filter(Boolean);
        const smartLinesFromFilter: string[] = [];
        const networkLinesFromFilter: string[] = [];
        for (const line of filterLines) {
            if (line.startsWith('hide|') || line.startsWith('unhide|')) {
                smartLinesFromFilter.push(line);
            } else if (/##/.test(line)) {
                const m = line.match(/^(.*?)(#@?#)(.+)$/);
                if (m) {
                    const domain = m[1] || '*';
                    const isException = m[2] === '#@#';
                    const selector = m[3];
                    smartLinesFromFilter.push(`${isException ? 'unhide' : 'hide'}|${domain}|${selector}`);
                } else {
                    networkLinesFromFilter.push(line);
                }
            } else {
                networkLinesFromFilter.push(line);
            }
        }
        const saveSmartRules = async (): Promise<void> => {
            if (smartLinesFromFilter.length === 0) return;
            try {
                const { smartRuleStore } = await import('../core/smart-cosmetic/smart-rule-store');
                await smartRuleStore.load();
                for (const smartLine of smartLinesFromFilter) {
                    const parts = smartLine.split('|');
                    const isUnhide = parts[0] === 'unhide';
                    const selector = parts[parts.length - 1];
                    const domain = parts.length > 2 ? parts.slice(1, -1).join('|') : '*';
                    if (!selector) continue;
                    const targets = domain === '*'
                        ? [{ form: 'host' as const, value: '*' }]
                        : domain.split(',').filter(Boolean).map(d => ({ form: 'host' as const, value: d }));
                    const rule = {
                        type: (isUnhide ? 'show-exact' : 'hide-exact') as const,
                        id: `ubr:smart:user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                        syntaxVersion: 1,
                        state: 'active' as const,
                        targets,
                        selector,
                        action: { action: (isUnhide ? 'show' : 'hide') as const },
                        metadata: { createdAt: new Date().toISOString(), source: 'user-filter' as const },
                        collectionId: 'user-filters',
                    };
                    await smartRuleStore.addRule(rule as any);
                }
            } catch (e) {
                console.error('[MSG] Failed to create smart rule:', e);
            }
        };
        if (networkLinesFromFilter.length > 0) {
            return Promise.all([
                saveSmartRules(),
                µb.createUserFilters({ ...request, filters: networkLinesFromFilter.join('\n') }),
            ]).then(() => {
                callback();
            });
        }
        saveSmartRules().then(() => { callback(); });
        return;
    }

    default:
        break;
    }

    // Sync
    let response;

    switch ( request.what ) {
    case 'elementPickerEprom':
        µb.epickerArgs.eprom = request;
        break;

    default:
        return vAPI.messaging.UNHANDLED;
    }

    callback(response);
};

registerMessagingListener({
    name: 'elementPicker',
    listener: onMessage,
});

// <<<<< end of local scope
}

/******************************************************************************/
/******************************************************************************/

// Channel:
//      cloudWidget
//      privileged

{
// >>>>> start of local scope

const fromBase64 = function(encoded) {
    if ( typeof encoded !== 'string' ) {
        return Promise.resolve(encoded);
    }
    let u8array;
    try {
        u8array = denseBase64.decode(encoded);
    } catch (e) {
        console.warn('[uBR] messaging: denseBase64.decode failed', e);
    }
    return Promise.resolve(u8array !== undefined ? u8array : encoded);
};

const onMessage = function(request, sender, callback) {
    // Cloud storage support is optional.
    if ( µb.cloudStorageSupported !== true ) {
        callback();
        return;
    }

    // Async
    switch ( request.what ) {
    case 'cloudGetOptions':
        vAPI.cloud.getOptions((options) => {
            options.enabled = µb.userSettings.cloudStorageEnabled === true;
            callback(options);
        });
        return;

    case 'cloudSetOptions':
        vAPI.cloud.setOptions(request.options, callback);
        return;

    case 'cloudPull':
        request.decode = encoded => {
            if ( s14e.isSerialized(encoded) ) {
                return s14e.deserializeAsync(encoded, { thread: true });
            }
            // Legacy decoding: needs to be kept around for the foreseeable future.
            return lz4Codec.decode(encoded, fromBase64);
        };
        return vAPI.cloud.pull(request).then(result => {
            callback(result);
        });

    case 'cloudPush':
        request.encode = data => {
            const options = {
                compress: µb.hiddenSettings.cloudStorageCompression,
                thread: true,
            };
            return s14e.serializeAsync(data, options);
        };
        return vAPI.cloud.push(request).then(result => {
            callback(result);
        });

    case 'cloudUsed':
        return vAPI.cloud.used(request.datakey).then(result => {
            callback(result);
        });

    default:
        break;
    }

    // Sync
    let response;

    switch ( request.what ) {
    // For when cloud storage is disabled.
    case 'cloudPull':
        // fallthrough
    case 'cloudPush':
        break;

    default:
        return vAPI.messaging.UNHANDLED;
    }

    callback(response);
};

registerMessagingListener({
    name: 'cloudWidget',
    listener: onMessage,
    privileged: true,
});

// <<<<< end of local scope
}

/******************************************************************************/
/******************************************************************************/

// Channel:
//      dashboard
//      privileged

{
// >>>>> start of local scope

// Settings
const getLocalData = async function() {
    const data = Object.assign({}, µb.restoreBackupSettings);
    data.storageUsed = await µb.getBytesInUse();
    data.cloudStorageSupported = µb.cloudStorageSupported;
    data.privacySettingsSupported = µb.privacySettingsSupported;
    return data;
};

const backupUserData = async function() {
    const userFilters = await µb.loadUserFilters();

    const userData = {
        timeStamp: Date.now(),
        version: vAPI.app.version,
        userSettings:
            µb.getModifiedSettings(µb.userSettings, µb.userSettingsDefault),
        selectedFilterLists: µb.selectedFilterLists,
        hiddenSettings:
            µb.getModifiedSettings(µb.hiddenSettings, µb.hiddenSettingsDefault),
        whitelist: µb.arrayFromWhitelist(µb.netWhitelist),
        dynamicFilteringString: permanentFirewall.toString(),
        urlFilteringString: permanentURLFiltering.toString(),
        hostnameSwitchesString: permanentSwitches.toString(),
        userFilters: userFilters.content,
    };

    const filename = i18n$('aboutBackupFilename')
        .replace('{{datetime}}', µb.dateNowToSensibleString())
        .replace(/ +/g, '_');
    µb.restoreBackupSettings.lastBackupFile = filename;
    µb.restoreBackupSettings.lastBackupTime = Date.now();
    vAPI.storage.set(µb.restoreBackupSettings);

    const localData = await getLocalData();

    return { localData, userData };
};

const restoreUserData = async function(request) {
    const userData = request.userData;

    // https://github.com/LiCybora/NanoDefenderFirefox/issues/196
    //   Backup data could be from Chromium platform or from an older
    //   Firefox version.
    if (
        vAPI.webextFlavor.soup.has('firefox') &&
        vAPI.app.intFromVersion(userData.version) <= 1031003011
    ) {
        userData.hostnameSwitchesString += '\nno-csp-reports: * true';
    }

    // List of external lists is meant to be a string.
    if ( Array.isArray(userData.externalLists) ) {
        userData.externalLists = userData.externalLists.join('\n');
    }

    // https://github.com/chrisaljoudi/uBlock/issues/1102
    //   Ensure all currently cached assets are flushed from storage AND memory.
    io.rmrf();

    // If we are going to restore all, might as well wipe out clean local
    // storages
    await Promise.all([
        cacheStorage.clear(),
        vAPI.storage.clear(),
    ]);

    // Restore block stats
    await µb.saveLocalSettings();

    // Restore user data
    await vAPI.storage.set(userData.userSettings);

    // Restore advanced settings.
    let hiddenSettings = userData.hiddenSettings;
    if ( hiddenSettings instanceof Object === false ) {
        hiddenSettings = µb.hiddenSettingsFromString(
            userData.hiddenSettingsString || ''
        );
    }
    // Discard unknown setting or setting with default value.
    for ( const key in hiddenSettings ) {
        if (
            Object.hasOwn(µb.hiddenSettingsDefault, key) === false ||
            hiddenSettings[key] === µb.hiddenSettingsDefault[key]
        ) {
            delete hiddenSettings[key];
        }
    }

    // Whitelist directives can be represented as an array or as a
    // (eventually to be deprecated) string.
    let whitelist = userData.whitelist;
    if (
        Array.isArray(whitelist) === false &&
        typeof userData.netWhitelist === 'string' &&
        userData.netWhitelist !== ''
    ) {
        whitelist = userData.netWhitelist.split('\n');
    }
    await vAPI.storage.set({
        hiddenSettings,
        netWhitelist: whitelist || [],
        dynamicFilteringString: userData.dynamicFilteringString || '',
        urlFilteringString: userData.urlFilteringString || '',
        hostnameSwitchesString: userData.hostnameSwitchesString || '',
        lastRestoreFile: request.file || '',
        lastRestoreTime: Date.now(),
        lastBackupFile: '',
        lastBackupTime: 0
    });
    await µb.saveUserFilters(userData.userFilters);
    if ( Array.isArray(userData.selectedFilterLists) ) {
        await µb.saveSelectedFilterLists(userData.selectedFilterLists);
    }

    vAPI.app.restart();
};

// Remove all stored data but keep global counts, people can become
// quite attached to numbers
const resetUserData = async function() {
    await Promise.all([
        cacheStorage.clear(),
        vAPI.storage.clear(),
    ]);

    await µb.saveLocalSettings();

    vAPI.app.restart();
};

// Filter lists
const prepListEntries = function(entries) {
    for ( const k in entries ) {
        if ( Object.hasOwn(entries, k) === false ) { continue; }
        const entry = entries[k];
        if ( typeof entry.supportURL === 'string' && entry.supportURL !== '' ) {
            entry.supportName = hostnameFromURI(entry.supportURL);
        } else if ( typeof entry.homeURL === 'string' && entry.homeURL !== '' ) {
            const hn = hostnameFromURI(entry.homeURL);
            entry.supportURL = `http://${hn}/`;
            entry.supportName = domainFromHostname(hn);
        }
    }
};

const getLists = async function(callback) {
    const r = {
        autoUpdate: µb.userSettings.autoUpdate,
        available: null,
        cache: null,

        current: µb.availableFilterLists,
        ignoreGenericCosmeticFilters: µb.userSettings.ignoreGenericCosmeticFilters,
        isUpdating: io.isUpdating(),
        netFilterCount: staticNetFilteringEngine.getFilterCount(),
        suspendUntilListsAreLoaded: µb.userSettings.suspendUntilListsAreLoaded,
        userFiltersPath: µb.userFiltersPath
    };
    const [ lists, metadata ] = await Promise.all([
        µb.getAvailableLists(),
        io.metadata(),
    ]);
    r.available = lists;
    prepListEntries(r.available);
    r.cache = metadata;
    prepListEntries(r.cache);
    callback(r);
};

// My filters

// TODO: also return origin of embedded frames?
const getOriginHints = function() {
    const out = new Set();
    for ( const tabId of µb.pageStores.keys() ) {
        if ( tabId === -1 ) { continue; }
        const tabContext = µb.tabContextManager.lookup(tabId);
        if ( tabContext === null ) { continue; }
        const { rootDomain, rootHostname } = tabContext;
        if ( rootDomain.endsWith('-scheme') ) { continue; }
        const isPunycode = rootHostname.includes('xn--');
        out.add(isPunycode ? punycode.toUnicode(rootDomain) : rootDomain);
        if ( rootHostname === rootDomain ) { continue; }
        out.add(isPunycode ? punycode.toUnicode(rootHostname) : rootHostname);
    }
    return Array.from(out);
};

// My rules
const getRules = function() {
    return {
        permanentRules:
            permanentFirewall.toArray().concat(
                permanentSwitches.toArray(),
                permanentURLFiltering.toArray()
            ),
        sessionRules:
            sessionFirewall.toArray().concat(
                sessionSwitches.toArray(),
                sessionURLFiltering.toArray()
            ),
        pslSelfie: publicSuffixList.toSelfie(),
    };
};

const modifyRuleset = function(details) {
    let swRuleset, hnRuleset, urlRuleset;
    if ( details.permanent ) {
        swRuleset = permanentSwitches;
        hnRuleset = permanentFirewall;
        urlRuleset = permanentURLFiltering;
    } else {
        swRuleset = sessionSwitches;
        hnRuleset = sessionFirewall;
        urlRuleset = sessionURLFiltering;
    }
    const toRemove = new Set(details.toRemove.trim().split(/\s*[\n\r]+\s*/));
    for ( const rule of toRemove ) {
        if ( rule === '' ) { continue; }
        const parts = rule.split(/\s+/);
        if ( hnRuleset.removeFromRuleParts(parts) === false ) {
            if ( swRuleset.removeFromRuleParts(parts) === false ) {
                urlRuleset.removeFromRuleParts(parts);
            }
        }
    }
    const toAdd = new Set(details.toAdd.trim().split(/\s*[\n\r]+\s*/));
    for ( const rule of toAdd ) {
        if ( rule === '' ) { continue; }
        const parts = rule.split(/\s+/);
        if ( hnRuleset.addFromRuleParts(parts) === false ) {
            if ( swRuleset.addFromRuleParts(parts) === false ) {
                urlRuleset.addFromRuleParts(parts);
            }
        }
    }
    if ( details.permanent ) {
        if ( swRuleset.changed ) {
            µb.saveHostnameSwitches();
            swRuleset.changed = false;
        }
        if ( hnRuleset.changed ) {
            µb.savePermanentFirewallRules();
            hnRuleset.changed = false;
        }
        if ( urlRuleset.changed ) {
            µb.savePermanentURLFilteringRules();
            urlRuleset.changed = false;
        }
    }
};



const onMessage = function(request, sender, callback) {
    // Async
    switch ( request.what ) {
    case 'getSmartRules':
        return (async () => {
            const { smartRuleStore } = await import('../core/smart-cosmetic/smart-rule-store');
            await smartRuleStore.load();
            const rules = smartRuleStore.getAllRules();
            const collections = smartRuleStore.getAllCollections();
            callback({ rules, collections });
        })();

    case 'addSmartRule':
        return (async () => {
            const { smartRuleStore } = await import('../core/smart-cosmetic/smart-rule-store');
            await smartRuleStore.load();
            const rule = request.rule;
            rule.id = rule.id || `ubr:smart:${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
            rule.metadata = rule.metadata || { createdAt: new Date().toISOString() };
            const result = await smartRuleStore.addRule(rule);
            callback(result);
        })();

    case 'updateSmartRule':
        return (async () => {
            const { smartRuleStore } = await import('../core/smart-cosmetic/smart-rule-store');
            await smartRuleStore.load();
            const result = await smartRuleStore.updateRule(request.rule.id, request.rule);
            callback(result);
        })();

    case 'removeSmartRule':
        return (async () => {
            const { smartRuleStore } = await import('../core/smart-cosmetic/smart-rule-store');
            await smartRuleStore.load();
            const ok = await smartRuleStore.removeRule(request.id);
            callback({ ok });
        })();

    case 'setSmartRuleState':
        return (async () => {
            const { smartRuleStore } = await import('../core/smart-cosmetic/smart-rule-store');
            await smartRuleStore.load();
            const ok = await smartRuleStore.setRuleState(request.id, request.state);
            callback({ ok });
        })();

    case 'subscribeSmartCollection':
        return (async () => {
            const { smartEngine } = await import('../core/smart-cosmetic/engine');
            await smartEngine.init();
            const collectionId = `col-${Date.now()}`;
            const ok = await smartEngine.subscribeToCollection(request.url, collectionId);
            callback({ ok, collectionId });
        })();

    case 'testSmartRules':
        return (async () => {
            const { smartEngine } = await import('../core/smart-cosmetic/engine');
            await smartEngine.init();
            const selectors = smartEngine.applyRulesToTab(0, request.url).selectors;
            callback({ selectors });
        })();

    case 'getCosmeticPlanForDocument':
        return (async () => {
            const { smartEngine } = await import('../core/smart-cosmetic/engine');
            await smartEngine.init();
            const tabId = request.tabId || sender.tabId || 0;
            const result = smartEngine.getCosmeticPlanForTab(tabId, request.url);
            callback(result);
        })();

    case 'getSmartTabId':
        callback({ tabId: sender.tabId || 0 });
        return;

    case 'previewSmartCosmeticRule':
        return (async () => {
            const { smartRuleStore } = await import('../core/smart-cosmetic/smart-rule-store');
            const { evaluateWhereExcept } = await import('../core/smart-cosmetic/logic-evaluator');
            await smartRuleStore.load();
            callback({ ok: true });
        })();

    case 'confirmSmartCosmeticRulePreview':
        return (async () => {
            const { smartRuleStore } = await import('../core/smart-cosmetic/smart-rule-store');
            await smartRuleStore.load();
            const rule = smartRuleStore.getRule(request.id);
            if (rule) {
                const updated = {
                    ...rule,
                    preview: {
                        status: 'confirmed',
                        confirmationHash: request.hash || rule.preview?.confirmationHash,
                        confirmedAt: new Date().toISOString(),
                        lastPreviewedAt: new Date().toISOString(),
                    },
                };
                await smartRuleStore.updateRule(request.id, updated);
                callback({ ok: true });
            } else {
                callback({ ok: false, error: 'Rule not found' });
            }
        })();

    case 'exportSmartRules':
        return (async () => {
            const { exportAllRules } = await import('../core/smart-cosmetic/export');
            const result = await exportAllRules();
            callback(result);
        })();

    case 'exportSmartRulesToClassic':
        return (async () => {
            const { exportAllRules } = await import('../core/smart-cosmetic/export');
            const result = await exportAllRules();
            callback({ classicLines: result.classicLines, lossMetadata: result.lossMetadata });
        })();

    case 'importSmartRules':
        return (async () => {
            const { parseSmartRules } = await import('../core/smart-cosmetic/smart-rule-parser');
            const { smartRuleStore } = await import('../core/smart-cosmetic/smart-rule-store');
            await smartRuleStore.load();
            const parsed = parseSmartRules(request.yaml);
            const imported: any[] = [];
            const errors: string[] = [...parsed.errors];
            for (const rule of parsed.rules) {
                const meta = rule.metadata || { createdAt: new Date().toISOString() };
                (meta as any).importedAt = new Date().toISOString();
                (rule as any).metadata = meta;
                const result = await smartRuleStore.addRule(rule);
                if (result.ok) {
                    imported.push(rule);
                } else {
                    errors.push(`Validation failed for rule ${rule.id}: ${JSON.stringify(result.validation?.diagnostics)}`);
                }
            }
            callback({ ok: imported.length > 0, count: imported.length, errors });
        })();

    case 'backupUserData':
        return backupUserData().then(data => {
            callback(data);
        });

    case 'getLists':
        return µb.isReadyPromise.then(( ) => {
            getLists(callback);
        });

    case 'getLocalData':
        return getLocalData().then(localData => {
            callback(localData);
        });

    case 'readUserFilters':
        return µb.loadUserFilters().then(result => {
            result.enabled = µb.selectedFilterLists.includes(µb.userFiltersPath);
            result.trusted = µb.isTrustedList(µb.userFiltersPath);
            callback(result);
        });

    case 'writeUserFilters':
        console.log('[MV3-DEBUG] writeUserFilters called - content length:', request.content ? request.content.length : 0);
        console.log('[MV3-DEBUG] Enabled:', request.enabled, 'Trusted:', request.trusted);
        // Convert any legacy ## filters to smart rules
        if ( request.content && request.content.includes('##') ) {
            const lines = request.content.split('\n');
            const smartLines: string[] = [];
            const cleaned: string[] = [];
            for (const line of lines) {
                if (line.includes('##')) {
                    smartLines.push(line);
                } else {
                    cleaned.push(line);
                }
            }
            if (smartLines.length > 0) {
                (async () => {
                    try {
                        const { smartRuleStore } = await import('../core/smart-cosmetic/smart-rule-store');
                        await smartRuleStore.load();
                        for (const line of smartLines) {
                            const hashIdx = line.indexOf('##');
                            const domainPart = hashIdx > 0 ? line.slice(0, hashIdx) : '*';
                            const selector = line.slice(hashIdx + 2);
                            if (!selector) continue;
                            const targets = domainPart === '*'
                                ? [{ form: 'host' as const, value: '*' }]
                                : domainPart.split(',').filter(Boolean).map(d => ({ form: 'host' as const, value: d }));
                            const rule = {
                                type: 'hide-exact' as const,
                                id: `migrated:wf-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                                syntaxVersion: 1,
                                state: 'active' as const,
                                targets,
                                selector,
                                action: { action: 'hide' as const },
                                metadata: { createdAt: new Date().toISOString(), source: 'migration' as const },
                                collectionId: 'migrated-cosmetic',
                            };
                            await smartRuleStore.addRule(rule as any);
                        }
                    } catch (e) {
                        console.error('[writeUserFilters] Failed to migrate ## filters:', e);
                    }
                })();
            }
            request.content = cleaned.join('\n');
        }
        return Promise.resolve().then(async ( ) => {
            const selected = new Set(µb.selectedFilterLists);
            if ( request.enabled ) {
                selected.add(µb.userFiltersPath);
            } else {
                selected.delete(µb.userFiltersPath);
            }
            await µb.saveSelectedFilterLists(Array.from(selected));
            µb.changeUserSettings('userFiltersTrusted', request.trusted || false);
            const result = await µb.saveUserFilters(request.content || '');
            broadcast({ what: 'userFiltersUpdated' });
            callback(result);
        }).catch(reason => {
            console.warn('[uBR] writeUserFilters: applyUserFilters failed', reason);
            callback({
                error: reason instanceof Error ? reason.message : String(reason),
            });
        });

    case 'getAllCustomFilters':
        return getAllCustomFilters().then(result => {
            callback(result);
        });

    case 'addCustomFilters':
        return addCustomFilters(request.hostname, request.selectors).then(result => {
            callback(result);
        });

    case 'removeCustomFilters':
        return removeCustomFilters(request.hostname, request.selectors).then(result => {
            callback(result);
        });

    case 'removeAllCustomFilters':
        return removeAllCustomFilters(request.hostname).then(result => {
            callback(result);
        });

    case 'customFiltersFromHostname':
        return customFiltersFromHostname(request.hostname).then(result => {
            callback(result);
        });

    default:
        break;
    }

    // Sync
    let response;

    switch ( request.what ) {
    case 'dashboardConfig':
        response = {
            noDashboard: µb.noDashboard,
        };
        break;

    case 'getAutoCompleteDetails':
        response = {};
        if ( (request.hintUpdateToken || 0) === 0 ) {
            response.redirectResources = redirectEngine.getResourceDetails();
            response.preparseDirectiveEnv = vAPI.webextFlavor.env.slice();
            response.preparseDirectiveHints = sfp.utils.preparser.getHints();
        }
        if ( request.hintUpdateToken !== µb.pageStoresToken ) {
            response.originHints = getOriginHints();
            response.hintUpdateToken = µb.pageStoresToken;
        }
        break;

    case 'getRules':
        response = getRules();
        break;

    case 'modifyRuleset':
        modifyRuleset(request);
        response = getRules();
        break;

    case 'listsUpdateNow': {
        const { assetKeys, preferOrigin = false } = request;
        if ( assetKeys.length === 0 ) { callback(response); break; }
        for ( const assetKey of assetKeys ) {
            io.purge(assetKey);
        }
        µb.scheduleAssetUpdater({ now: true, fetchDelay: 100, auto: preferOrigin !== true });
        break;
    }

    case 'readHiddenSettings':
        response = {
            'default': µb.hiddenSettingsDefault,
            'admin': µb.hiddenSettingsAdmin,
            'current': µb.hiddenSettings,
        };
        break;

    case 'restoreUserData':
        restoreUserData(request);
        break;

    case 'resetUserData':
        resetUserData();
        break;

    case 'updateNow':
        µb.scheduleAssetUpdater({ now: true, fetchDelay: 100, auto: true });
        break;

    case 'writeHiddenSettings':
        µb.changeHiddenSettings(µb.hiddenSettingsFromString(request.content));
        break;

    default:
        return vAPI.messaging.UNHANDLED;
    }

    callback(response);
};

registerMessagingListener({
    name: 'dashboard',
    listener: onMessage,
    privileged: true,
});

// <<<<< end of local scope
}

/******************************************************************************/
/******************************************************************************/

// Channel:
//      loggerUI
//      privileged

{
// >>>>> start of local scope

const extensionOriginURL = vAPI.getURL('');
const documentBlockedURL = vAPI.getURL('document-blocked.html');

const getLoggerData = async function(details, activeTabId, callback) {
    const response = {
        activeTabId,
        colorBlind: µb.userSettings.colorBlindFriendly,
        entries: logger.readAll(details.ownerId),
        tabIdsToken: µb.pageStoresToken,
        tooltips: µb.userSettings.tooltipsDisabled === false
    };
    if ( µb.pageStoresToken !== details.tabIdsToken ) {
        response.tabIds = [];
        for ( const [ tabId, pageStore ] of µb.pageStores ) {
            const { rawURL, title } = pageStore;
            if ( rawURL.startsWith(extensionOriginURL) ) {
                if ( rawURL.startsWith(documentBlockedURL) === false ) { continue; }
            }
            response.tabIds.push([ tabId, title ]);
        }
    }
    if ( activeTabId ) {
        const pageStore = µb.pageStoreFromTabId(activeTabId);
        const rawURL = pageStore && pageStore.rawURL;
        if (
            rawURL === null ||
            rawURL.startsWith(extensionOriginURL) &&
                rawURL.startsWith(documentBlockedURL) === false
        ) {
            response.activeTabId = undefined;
        }
    }
    if ( details.popupLoggerBoxChanged && vAPI.windows instanceof Object ) {
        const tabs = await vAPI.tabs.query({
            url: vAPI.getURL('/logger-ui.html?popup=1')
        });
        if ( tabs.length !== 0 ) {
            const win = await vAPI.windows.get(tabs[0].windowId);
            if ( win === null ) { callback(response); return; }
            vAPI.localStorage.setItem('popupLoggerBox', JSON.stringify({
                left: win.left,
                top: win.top,
                width: win.width,
                height: win.height,
            }));
        }
    }
    callback(response);
};

const getURLFilteringData = function(details) {
    const colors = {};
    const response = {
        dirty: false,
        colors: colors
    };
    const suf = sessionURLFiltering;
    const puf = permanentURLFiltering;
    const urls = details.urls;
    const context = details.context;
    const type = details.type;
    for ( const url of urls ) {
        const colorEntry = colors[url] = { r: 0, own: false };
        if ( suf.evaluateZ(context, url, type).r !== 0 ) {
            colorEntry.r = suf.r;
            colorEntry.own = suf.r !== 0 &&
                             suf.context === context &&
                             suf.url === url &&
                             suf.type === type;
        }
        if ( response.dirty ) { continue; }
        puf.evaluateZ(context, url, type);
        const pown = (
            puf.r !== 0 &&
            puf.context === context &&
            puf.url === url &&
            puf.type === type
        );
        response.dirty = colorEntry.own !== pown || colorEntry.r !== puf.r;
    }
    return response;
};

const onMessage = function(request, sender, callback) {
    // Async
    switch ( request.what ) {
    case 'readAll':
        if ( logger.ownerId !== undefined && logger.ownerId !== request.ownerId ) {
            return callback({ unavailable: true });
        }
        vAPI.tabs.getCurrent().then(tab => {
            getLoggerData(request, tab && tab.id, callback);
        });
        return;

    case 'toggleInMemoryFilter': {
        const promise = µb.hasInMemoryFilter(request.filter)
            ? µb.removeInMemoryFilter(request.filter)
            : µb.addInMemoryFilter(request.filter);
        promise.then(status => { callback(status); });
        return;
    }
    default:
        break;
    }

    // Sync
    let response;

    switch ( request.what ) {
    case 'hasInMemoryFilter':
        response = µb.hasInMemoryFilter(request.filter);
        break;

    case 'releaseView':
        if ( request.ownerId !== logger.ownerId ) { break; }
        logger.ownerId = undefined;
        µb.clearInMemoryFilters();
        break;

    case 'saveURLFilteringRules':
        response = permanentURLFiltering.copyRules(
            sessionURLFiltering,
            request.context,
            request.urls,
            request.type
        );
        if ( response ) {
            µb.savePermanentURLFilteringRules();
        }
        break;

    case 'setURLFilteringRule':
        µb.toggleURLFilteringRule(request);
        break;

    case 'getURLFilteringData':
        response = getURLFilteringData(request);
        break;

    default:
        return vAPI.messaging.UNHANDLED;
    }

    callback(response);
};

registerMessagingListener({
    name: 'loggerUI',
    listener: onMessage,
    privileged: true,
});

// <<<<< end of local scope
}

/******************************************************************************/
/******************************************************************************/

// Channel:
//      domInspectorContent
//      unprivileged

{
// >>>>> start of local scope

const onMessage = (request, sender, callback) => {
    // Async
    switch ( request.what ) {
    default:
        break;
    }
    // Sync
    let response;
    switch ( request.what ) {
    case 'getInspectorArgs': {
        const bc = new globalThis.BroadcastChannel('contentInspectorChannel');
        bc.postMessage({
            what: 'contentInspectorChannel',
            tabId: sender.tabId || 0,
            frameId: sender.frameId || 0,
        });
        response = {
            inspectorURL: vAPI.getURL(
                `/web_accessible_resources/dom-inspector.html?secret=${getWarSecretShort()}`
            ),
        };
        break;
    }
    default:
        return vAPI.messaging.UNHANDLED;
    }

    callback(response);
};

registerMessagingListener({
    name: 'domInspectorContent',
    listener: onMessage,
    privileged: false,
});

// <<<<< end of local scope
}

/******************************************************************************/
/******************************************************************************/

// Channel:
//      documentBlocked
//      privileged

{
// >>>>> start of local scope

const onMessage = function(request, sender, callback) {
    const tabId = sender.tabId || 0;

    // Async
    switch ( request.what ) {
    default:
        break;
    }

    // Sync
    let response;

    switch ( request.what ) {
    case 'closeThisTab':
        vAPI.tabs.remove(tabId);
        break;

    case 'temporarilyWhitelistDocument':
        webRequest.strictBlockBypass(request.hostname);
        break;

    default:
        return vAPI.messaging.UNHANDLED;
    }

    callback(response);
};

registerMessagingListener({
    name: 'documentBlocked',
    listener: onMessage,
    privileged: true,
});

// <<<<< end of local scope
}

/******************************************************************************/
/******************************************************************************/

// Channel:
//      devTools
//      privileged

{
// >>>>> start of local scope

const onMessage = function(request, sender, callback) {
    // Async
    switch ( request.what ) {
    case 'purgeAllCaches':
        µb.getBytesInUse().then(bytesInUseBefore =>
            io.remove(/./).then(( ) =>
                µb.getBytesInUse().then(bytesInUseAfter => {
                    callback([
                        `Storage used before: ${µb.formatCount(bytesInUseBefore)}B`,
                        `Storage used after: ${µb.formatCount(bytesInUseAfter)}B`,
                    ].join('\n'));
                })
            )
        );
        return;

    case 'snfeBenchmark':
        Promise.all([
            import('/js/benchmarks.js').catch(e => {
                console.warn('[uBR] messaging: benchmarks.js import failed', e);
                return { benchmarkStaticNetFiltering: async () => ({ error: 'Benchmarks disabled' }) };
            })
        ]).then(([module]) => {
            if (module && typeof module.benchmarkStaticNetFiltering === 'function') {
                module.benchmarkStaticNetFiltering({ redirectEngine }).then(result => {
                    callback(result);
                });
            } else {
                callback({ error: 'Benchmarks not available' });
            }
        });
        return;

    case 'cfeBenchmark':
        Promise.all([
            import('/js/benchmarks.js').catch(e => {
                console.warn('[uBR] messaging: benchmarks.js import failed', e);
                return { benchmarkCosmeticFiltering: async () => ({ error: 'Benchmarks disabled' }) };
            })
        ]).then(([module]) => {
            if (module && typeof module.benchmarkCosmeticFiltering === 'function') {
                module.benchmarkCosmeticFiltering().then(result => {
                    callback(result);
                });
            } else {
                callback({ error: 'Benchmarks not available' });
            }
        });
        return;

    case 'sfeBenchmark':
        Promise.all([
            import('/js/benchmarks.js').catch(e => {
                console.warn('[uBR] messaging: benchmarks.js import failed', e);
                return { benchmarkScriptletFiltering: async () => ({ error: 'Benchmarks disabled' }) };
            })
        ]).then(([module]) => {
            if (module && typeof module.benchmarkScriptletFiltering === 'function') {
                module.benchmarkScriptletFiltering().then(result => {
                    callback(result);
                });
            } else {
                callback({ error: 'Benchmarks not available' });
            }
        });
        return;

    case 'snfeToDNR': {
        const listPromises = [];
        const listNames = [];
        for ( const assetKey of µb.selectedFilterLists ) {
            listPromises.push(
                io.get(assetKey, { dontCache: true }).then(details => {
                    listNames.push(assetKey);
                    return {
                        name: assetKey,
                        text: details.content,
                        trustedSource: assetKey.startsWith('ublock-') ||
                            assetKey === µb.userFiltersPath &&
                                µb.userSettings.userFiltersTrusted,
                    };
                })
            );
        }
        const options = {
            extensionPaths: redirectEngine.getResourceDetails().filter(e =>
                typeof e[1].extensionPath === 'string' && e[1].extensionPath !== ''
            ).map(e =>
                [ e[0], e[1].extensionPath ]
            ),
            env: vAPI.webextFlavor.env,
        };
        import('./static-dnr-filtering.js').then(module => {
            const t0 = Date.now();
            return module.dnrRulesetFromRawLists(listPromises, options).then(dnrdata => {
                dnrdata.listNames = listNames;
                dnrdata.runtime = Date.now() - t0;
                callback(s14e.serialize(dnrdata));
            });
        }).catch(reason => {
            console.warn('[uBR] dnrModule: dnrRulesetFromRawLists call failed', reason);
            callback(reason);
        });
        return;
    }
    default:
        break;
    }

    // Sync
    let response;

    switch ( request.what ) {
    case 'snfeDump':
        response = staticNetFilteringEngine.dump();
        break;

    case 'snfeQuery':
        response = staticNetFilteringEngine.test(
            Object.assign({ redirectEngine }, request.query)
        );
        break;

    default:
        return vAPI.messaging.UNHANDLED;
    }

    callback(response);
};

registerMessagingListener({
    name: 'devTools',
    listener: onMessage,
    privileged: true,
});

// <<<<< end of local scope
}

/******************************************************************************/
/******************************************************************************/

// Channel:
//      scriptlets
//      unprivileged

{
// >>>>> start of local scope

const logCosmeticFilters = function(tabId, details) {
    if ( logger.enabled === false ) { return; }

    const filter = { source: 'cosmetic', raw: '' };
    const fctxt = µb.filteringContext.duplicate();
    fctxt.fromTabId(tabId)
         .setRealm('cosmetic')
         .setType('dom')
         .setURL(details.frameURL)
         .setDocOriginFromURL(details.frameURL)
         .setFilter(filter);
    for ( const selector of details.matchedSelectors.sort() ) {
        filter.raw = selector;
        fctxt.toLogger();
    }
};

const logCSPViolations = function(pageStore, request) {
    if ( logger.enabled === false || pageStore === null ) {
        return false;
    }
    if ( request.violations.length === 0 ) {
        return true;
    }

    const fctxt = µb.filteringContext.duplicate();
    fctxt.fromTabId(pageStore.tabId)
         .setRealm('network')
         .setDocOriginFromURL(request.docURL)
         .setURL(request.docURL);

    let cspData = pageStore.extraData.get('cspData');
    if ( cspData === undefined ) {
        cspData = new Map();

        const staticDirectives =
            staticNetFilteringEngine.matchAndFetchModifiers(fctxt, 'csp');
        if ( staticDirectives !== undefined ) {
            for ( const directive of staticDirectives ) {
                if ( directive.result !== 1 ) { continue; }
                cspData.set(directive.value, directive.logData());
            }
        }

        fctxt.type = 'inline-script';
        fctxt.filter = undefined;
        if ( pageStore.filterRequest(fctxt) === 1 ) {
            cspData.set(µb.cspNoInlineScript, fctxt.filter);
        }

        fctxt.type = 'script';
        fctxt.filter = undefined;
        if ( pageStore.filterScripting(fctxt, true) === 1 ) {
            cspData.set(µb.hiddenSettings.noScriptingCSP, fctxt.filter);
        }
    
        fctxt.type = 'inline-font';
        fctxt.filter = undefined;
        if ( pageStore.filterRequest(fctxt) === 1 ) {
            cspData.set(µb.cspNoInlineFont, fctxt.filter);
        }

        if ( cspData.size === 0 ) { return false; }

        pageStore.extraData.set('cspData', cspData);
    }

    const typeMap = logCSPViolations.policyDirectiveToTypeMap;
    for ( const json of request.violations ) {
        const violation = JSON.parse(json);
        let type = typeMap.get(violation.directive);
        if ( type === undefined ) { continue; }
        const logData = cspData.get(violation.policy);
        if ( logData === undefined ) { continue; }
        if ( /^[\w.+-]+:\/\//.test(violation.url) === false ) {
            violation.url = request.docURL;
            if ( type === 'script' ) { type = 'inline-script'; }
            else if ( type === 'font' ) { type = 'inline-font'; }
        }
        // The resource was blocked as a result of applying a CSP directive
        // elsewhere rather than to the resource itself.
        logData.modifier = undefined;
        fctxt.setURL(violation.url)
             .setType(type)
             .setFilter(logData)
             .toLogger();
    }

    return true;
};

logCSPViolations.policyDirectiveToTypeMap = new Map([
    [ 'img-src', 'image' ],
    [ 'connect-src', 'xmlhttprequest' ],
    [ 'font-src', 'font' ],
    [ 'frame-src', 'sub_frame' ],
    [ 'media-src', 'media' ],
    [ 'object-src', 'object' ],
    [ 'script-src', 'script' ],
    [ 'script-src-attr', 'script' ],
    [ 'script-src-elem', 'script' ],
    [ 'style-src', 'stylesheet' ],
    [ 'style-src-attr', 'stylesheet' ],
    [ 'style-src-elem', 'stylesheet' ],
]);

const onMessage = function(request, sender, callback) {
    const tabId = sender.tabId || 0;
    const pageStore = µb.pageStoreFromTabId(tabId);

    // Async
    switch ( request.what ) {
    default:
        break;
    }

    // Sync
    let response;

    switch ( request.what ) {
    case 'inlinescriptFound':
        if ( logger.enabled && pageStore !== null ) {
            const fctxt = µb.filteringContext.duplicate();
            fctxt.fromTabId(tabId)
                .setType('inline-script')
                .setURL(request.docURL)
                .setDocOriginFromURL(request.docURL);
            if ( pageStore.filterRequest(fctxt) === 0 ) {
                fctxt.setRealm('network').toLogger();
            }
        }
        break;

    case 'logCosmeticFilteringData':
        logCosmeticFilters(tabId, request);
        break;

    case 'securityPolicyViolation':
        response = logCSPViolations(pageStore, request);
        break;

    case 'temporarilyAllowLargeMediaElement':
        if ( pageStore !== null ) {
            pageStore.allowLargeMediaElementsUntil = Date.now() + 5000;
        }
        break;

    case 'subscribeTo': {
        // https://github.com/uBlockOrigin/uBlock-issues/issues/1797
        if ( /^(file|https?):\/\//.test(request.location) === false ) { break; }
        const url = encodeURIComponent(request.location);
        const title = encodeURIComponent(request.title);
        const hash = µb.selectedFilterLists.indexOf(request.location) !== -1
            ? '#subscribed'
            : '';
        vAPI.tabs.open({
            url: `/asset-viewer.html?url=${url}&title=${title}&subscribe=1${hash}`,
            select: true,
        });
        break;
    }
    case 'updateLists': {
        const listkeys = request.listkeys.split(',').filter(s => s !== '');
        if ( listkeys.length === 0 ) { return; }
        if ( listkeys.includes('all') ) {
            io.purge(/./, 'public_suffix_list.dat');
        } else {
            for ( const listkey of listkeys ) {
                io.purge(listkey);
            }
        }
        µb.openNewTab({
            url: 'dashboard.html#3p-filters.html',
            select: true,
        });
        µb.scheduleAssetUpdater({ now: true, fetchDelay: 100, auto: request.auto });
        break;
    }
    default:
        return vAPI.messaging.UNHANDLED;
    }

    callback(response);
};

registerMessagingListener({
    name: 'scriptlets',
    listener: onMessage,
});

// <<<<< end of local scope
}


/******************************************************************************/
/******************************************************************************/
