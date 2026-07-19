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
    broadcast,
    filteringBehaviorChanged,
    onBroadcast,
} from './broadcast.js';

import {
    permanentFirewall,
    permanentSwitches,
    permanentURLFiltering,
    sessionFirewall,
    sessionSwitches,
    sessionURLFiltering,
} from './filtering-engines.js';

import contextMenu from './contextmenu.js';
import { hostnameFromURI } from './uri-utils.js';
import { dnrIntegration } from './dnr-integration.js';
import io from './assets.js';
import { redirectEngine } from './redirect-engine.js';
import µb from './background.js';

/******************************************************************************/
/******************************************************************************/

const whitelistDirectiveEscape = /[-/\\^$+?.()|[\]{}]/g;

const whitelistDirectiveEscapeAsterisk = /\*/g;

const directiveToRegexpMap = new Map<string, RegExp>();

const isHandcraftedWhitelistDirective = function(directive: string): boolean {
    return (directive.startsWith('/') && directive.endsWith('/')) ||
           (directive.indexOf('/') !== -1 && directive.indexOf('*') !== -1);
};

const matchDirective = function(url: string, hostname: string, directive: string): boolean {
    if ( directive.indexOf('/') === -1 ) {
        return hostname.endsWith(directive) &&
              (hostname.length === directive.length ||
               hostname.charAt(hostname.length - directive.length - 1) === '.');
    }
    if (
        directive.startsWith('/') === false &&
        directive.indexOf('*') === -1
    ) {
        return url === directive;
    }
    let re = directiveToRegexpMap.get(directive);
    if ( re === undefined ) {
        let reStr: string;
        if ( directive.startsWith('/') && directive.endsWith('/') ) {
            reStr = directive.slice(1, -1);
        } else {
            reStr = directive.replace(whitelistDirectiveEscape, '\\$&')
                             .replace(whitelistDirectiveEscapeAsterisk, '.*');
        }
        re = new RegExp(reStr);
        directiveToRegexpMap.set(directive, re);
    }
    return re.test(url);
};

const matchBucket = function(url: string, hostname: string, bucket: string[] | undefined, start: number): number {
    if ( bucket ) {
        for ( let i = start || 0, n = bucket.length; i < n; i++ ) {
            if ( matchDirective(url, hostname, bucket[i]) ) {
                return i;
            }
        }
    }
    return -1;
};

/******************************************************************************/

µb.getNetFilteringSwitch = function(url: string): boolean {
    const hostname = hostnameFromURI(url);
    let key = hostname;
    for (;;) {
        if ( matchBucket(url, hostname, this.netWhitelist.get(key)) !== -1 ) {
            return false;
        }
        const pos = key.indexOf('.');
        if ( pos === -1 ) { break; }
        key = key.slice(pos + 1);
    }
    if ( matchBucket(url, hostname, this.netWhitelist.get('//')) !== -1 ) {
        return false;
    }
    return true;
};

/******************************************************************************/

µb.toggleNetFilteringSwitch = function(url: string, scope: string, newState?: boolean): boolean {
    const currentState = this.getNetFilteringSwitch(url);
    if ( newState === undefined ) {
        newState = !currentState;
    }
    if ( newState === currentState ) {
        return currentState;
    }

    const netWhitelist = this.netWhitelist;
    const pos = url.indexOf('#');
    const targetURL = pos !== -1 ? url.slice(0, pos) : url;
    const targetHostname = hostnameFromURI(targetURL);
    let key = targetHostname;
    let directive = scope === 'page' ? targetURL : targetHostname;

    if ( newState === false ) {
        let bucket = netWhitelist.get(key);
        if ( bucket === undefined ) {
            bucket = [];
            netWhitelist.set(key, bucket);
        }
        bucket.push(directive);
        this.saveWhitelist();
        filteringBehaviorChanged({ hostname: targetHostname, direction: -1 });
        return true;
    }

    for (;;) {
        const bucket = netWhitelist.get(key);
        if ( bucket !== undefined ) {
            let i: number | undefined;
            for (;;) {
                i = matchBucket(targetURL, targetHostname, bucket, i);
                if ( i === -1 ) { break; }
                directive = bucket.splice(i, 1)[0];
                if ( isHandcraftedWhitelistDirective(directive) ) {
                    netWhitelist.get('#').push(`# ${directive}`);
                }
            }
            if ( bucket.length === 0 ) {
                netWhitelist.delete(key);
            }
        }
        const pos = key.indexOf('.');
        if ( pos === -1 ) { break; }
        key = key.slice(pos + 1);
    }
    const bucket = netWhitelist.get('//');
    if ( bucket !== undefined ) {
        let i: number | undefined;
        for (;;) {
            i = matchBucket(targetURL, targetHostname, bucket, i);
            if ( i === -1 ) { break; }
            directive = bucket.splice(i, 1)[0];
            if ( isHandcraftedWhitelistDirective(directive) ) {
                netWhitelist.get('#').push(`# ${directive}`);
            }
        }
        if ( bucket.length === 0 ) {
            netWhitelist.delete('//');
        }
    }
    this.saveWhitelist();
    filteringBehaviorChanged({ direction: 1 });
    return true;
};

/******************************************************************************/

µb.arrayFromWhitelist = function(whitelist: Map<string, string[]>): string[] {
    const out = new Set<string>();
    for ( const bucket of whitelist.values() ) {
        for ( const directive of bucket ) {
            out.add(directive);
        }
    }
    return Array.from(out).sort((a, b) => a.localeCompare(b));
};

µb.stringFromWhitelist = function(whitelist: Map<string, string[]>): string {
    return this.arrayFromWhitelist(whitelist).join('\n');
};

/******************************************************************************/

µb.whitelistFromArray = function(lines: string[]): Map<string, string[]> {
    const whitelist = new Map<string, string[]>();

    whitelist.set('#', []);

    directiveToRegexpMap.clear();

    for ( let line of lines ) {
        line = line.trim();

        if ( line === '' ) { continue; }

        let key: string, directive: string;

        if ( line.startsWith('#') ) {
            key = '#';
            directive = line;
        }
        else if ( line.indexOf('/') === -1 ) {
            if ( this.reWhitelistBadHostname.test(line) ) {
                key = '#';
                directive = `# ${  line}`;
            } else {
                key = directive = line;
            }
        }
        else if (
            line.length > 2 &&
            line.startsWith('/') &&
            line.endsWith('/')
        ) {
            key = '//';
            directive = line;
            try {
                const re = new RegExp(directive.slice(1, -1));
                directiveToRegexpMap.set(directive, re);
            } catch(e) {
                console.warn('[uBR] ublock: directive regex compile failed', directive, e);
                key = '#';
                directive = `# ${  line}`;
            }
        }
        else {
            const matches = this.reWhitelistHostnameExtractor.exec(line);
            if ( !matches || matches.length !== 2 ) {
                key = '#';
                directive = `# ${  line}`;
            } else {
                key = matches[1];
                directive = line;
            }
        }

        if ( key === '' ) { continue; }

        let bucket = whitelist.get(key);
        if ( bucket === undefined ) {
            bucket = [];
            whitelist.set(key, bucket);
        }
        bucket.push(directive);
    }
    return whitelist;
};

µb.whitelistFromString = function(s: string): Map<string, string[]> {
    return this.whitelistFromArray(s.split('\n'));
};

µb.reWhitelistBadHostname = /[^a-z0-9.\-_[\]:]/;
µb.reWhitelistHostnameExtractor = /([a-z0-9.\-_[\]]+)(?::[\d*]+)?\/(?:[^\x00-\x20/]|$)[^\x00-\x20]*$/;

/******************************************************************************/

interface UserSettings {
    [key: string]: unknown;
    noCosmeticFiltering?: boolean;
    noLargeMedia?: boolean;
    noRemoteFonts?: boolean;
    noScripting?: boolean;
    noCSPReports?: boolean;
    advancedUserEnabled?: boolean;
    autoUpdate?: boolean;
    largeMediaSize?: number;
    popupPanelSections?: number;
}

µb.changeUserSettings = function(name?: string, value?: unknown): UserSettings | unknown {
    let us = this.userSettings;

    if ( name === undefined ) {
        us = JSON.parse(JSON.stringify(us)) as UserSettings;
        us.noCosmeticFiltering = sessionSwitches.evaluate('no-cosmetic-filtering', '*') === 1;
        us.noLargeMedia = sessionSwitches.evaluate('no-large-media', '*') === 1;
        us.noRemoteFonts = sessionSwitches.evaluate('no-remote-fonts', '*') === 1;
        us.noScripting = sessionSwitches.evaluate('no-scripting', '*') === 1;
        us.noCSPReports = sessionSwitches.evaluate('no-csp-reports', '*') === 1;
        return us;
    }

    if ( typeof name !== 'string' || name === '' ) { return; }

    if ( value === undefined ) {
        return us[name];
    }

    switch ( name ) {
    case 'largeMediaSize':
        if ( typeof value !== 'number' ) {
            value = parseInt(String(value), 10) || 0;
        }
        value = Math.ceil(Math.max(Number(value), 0));
        break;
    default:
        break;
    }

    const mustSave = Object.hasOwn(us, name) && value !== us[name];
    if ( mustSave ) {
        us[name] = value;
    }

    switch ( name ) {
    case 'advancedUserEnabled':
        if ( value === true ) {
            us.popupPanelSections |= 0b11111;
        }
        break;
    case 'autoUpdate':
        this.scheduleAssetUpdater({ updateDelay: value ? 2000 : 0 });
        break;
    case 'cnameUncloakEnabled':
        if ( vAPI.net.canUncloakCnames === true ) {
            vAPI.net.setOptions({ cnameUncloakEnabled: value === true });
        }
        break;
    case 'collapseBlocked':
        break;
    case 'contextMenuEnabled':
        contextMenu.update(null);
        break;
    case 'hyperlinkAuditingDisabled':
        if ( this.privacySettingsSupported ) {
            vAPI.browserSettings.set({ 'hyperlinkAuditing': !value });
        }
        break;
    case 'noCosmeticFiltering':
    case 'noLargeMedia':
    case 'noRemoteFonts':
    case 'noScripting':
    case 'noCSPReports': {
        let switchName: string | undefined;
        switch ( name ) {
        case 'noCosmeticFiltering':
            switchName = 'no-cosmetic-filtering'; break;
        case 'noLargeMedia':
            switchName = 'no-large-media'; break;
        case 'noRemoteFonts':
            switchName = 'no-remote-fonts'; break;
        case 'noScripting':
            switchName = 'no-scripting'; break;
        case 'noCSPReports':
            switchName = 'no-csp-reports'; break;
        default:
            break;
        }
        if ( switchName === undefined ) { break; }
        const switchState = value ? 1 : 0;
        sessionSwitches.toggle(switchName, '*', switchState);
        if ( permanentSwitches.toggle(switchName, '*', switchState) ) {
            this.saveHostnameSwitches();
        }
        break;
    }
    case 'prefetchingDisabled':
        if ( this.privacySettingsSupported ) {
            vAPI.browserSettings.set({ 'prefetching': !value });
        }
        break;
    case 'webrtcIPAddressHidden':
        if ( this.privacySettingsSupported ) {
            vAPI.browserSettings.set({ 'webrtcIPAddress': !value });
        }
        break;
    default:
        break;
    }

    if ( mustSave ) {
        this.saveUserSettings();
    }
};

/******************************************************************************/

interface HiddenSettings {
    userResourcesLocation?: string;
    blockingProfiles?: string;
}

µb.changeHiddenSettings = function(hs: HiddenSettings): void {
    const mustReloadResources =
        hs.userResourcesLocation !== this.hiddenSettings.userResourcesLocation;
    this.hiddenSettings = hs;
    this.saveHiddenSettings();
    if ( mustReloadResources ) {
        redirectEngine.invalidateResourcesSelfie(io);
        this.loadRedirectResources();
    }
    broadcast({ what: 'hiddenSettingsChanged' });
};

/******************************************************************************/

interface EpickerArgs {
    target: string;
    zap: boolean;
}

µb.elementPickerExec = async function(
    tabId: number,
    frameId: number,
    targetElement: string,
    zap = false,
): Promise<void> {
    console.log('[DEBUG] elementPickerExec called - tabId:', tabId, 'frameId:', frameId, 'zap:', zap);
    if ( vAPI.isBehindTheSceneTabId(tabId) ) { return; }

    (this.epickerArgs as EpickerArgs).target = targetElement || '';
    (this.epickerArgs as EpickerArgs).zap = zap;

    if ( zap !== true ) {
        console.log('[DEBUG] elementPickerExec - executing diff library');
        vAPI.tabs.executeScript(tabId, {
            file: '/lib/diff/swatinem_diff.js',
            runAt: 'document_end',
        });
    }

    console.log('[DEBUG] elementPickerExec - executing epicker.js');
    await vAPI.tabs.executeScript(tabId, {
        file: '/js/scriptlets/epicker.js',
        frameId,
        runAt: 'document_end',
    });
    console.log('[DEBUG] elementPickerExec - epicker.js executed');

    vAPI.tabs.select(tabId);
};

/******************************************************************************/

interface FirewallRuleDetails {
    desHostname: string;
    requestType: string;
    action: number;
    srcHostname?: string;
    persist?: boolean;
    tabId?: number;
}

µb.toggleFirewallRule = function(details: FirewallRuleDetails): void {
    const { desHostname, requestType, action } = details;
    let { srcHostname } = details;

    if ( action !== 0 ) {
        sessionFirewall.setCell(
            srcHostname,
            desHostname,
            requestType,
            action
        );
    } else {
        sessionFirewall.unsetCell(
            srcHostname,
            desHostname,
            requestType
        );
    }

    if ( details.persist ) {
        if ( action !== 0 ) {
            permanentFirewall.setCell(
                srcHostname,
                desHostname,
                requestType,
                action
            );
        } else {
            permanentFirewall.unsetCell(
                srcHostname,
                desHostname,
                requestType
            );
        }
        this.savePermanentFirewallRules();
        
        // Sync firewall rules to DNR after persisting
        if (typeof dnrIntegration !== 'undefined') {
            dnrIntegration.compileAndInstallRules();
        }
    }

    if (
        (srcHostname !== '*') &&
        (
            requestType === '*' ||
            requestType === 'image' ||
            requestType === '3p' ||
            requestType === '3p-frame'
        )
    ) {
        srcHostname = '*';
    }

    filteringBehaviorChanged({
        direction: action === 1 ? 1 : 0,
        hostname: srcHostname,
    });

    if ( details.tabId === undefined ) { return; }

    if ( requestType.startsWith('3p') ) {
        this.updateToolbarIcon(details.tabId, 0b100);
    }

    if ( requestType === '3p' && action === 3 ) {
        vAPI.tabs.executeScript(details.tabId, {
            file: '/js/scriptlets/load-3p-css.js',
            allFrames: true,
            runAt: 'document_idle',
        });
    }
};

/******************************************************************************/

interface URLFilteringRuleDetails {
    context: string;
    url: string;
    type: string;
    action: number;
    persist?: boolean;
}

µb.toggleURLFilteringRule = function(details: URLFilteringRuleDetails): void {
    const changed = sessionURLFiltering.setRule(
        details.context,
        details.url,
        details.type,
        details.action
    );
    if ( changed === false ) { return; }

    if ( details.persist !== true ) { return; }

    const permChanged = permanentURLFiltering.setRule(
        details.context,
        details.url,
        details.type,
        details.action
    );

    if ( permChanged ) {
        this.savePermanentURLFilteringRules();
    }
};

/******************************************************************************/

interface HostnameSwitchDetails {
    state?: boolean;
    name: string;
    hostname: string;
    deep?: boolean;
    tabId?: number;
    persist?: boolean;
}

µb.toggleHostnameSwitch = function(details: HostnameSwitchDetails): void {
    const newState = typeof details.state === 'boolean'
        ? details.state
        : !sessionSwitches.evaluateZ(details.name, details.hostname);
    let changed = sessionSwitches.toggleZ(
        details.name,
        details.hostname,
        !!details.deep,
        newState
    );
    if ( changed === false ) { return; }

    switch ( details.name ) {
    case 'no-scripting':
        this.updateToolbarIcon(details.tabId, 0b100);
        break;
    case 'no-cosmetic-filtering': {
        const scriptlet = newState ? 'cosmetic-off' : 'cosmetic-on';
        vAPI.tabs.executeScript(details.tabId, {
            file: `/js/scriptlets/${scriptlet}.js`,
            allFrames: true,
        });
        break;
    }
    case 'no-large-media': {
        const pageStore = this.pageStoreFromTabId(details.tabId);
        if ( pageStore !== null ) {
            pageStore.temporarilyAllowLargeMediaElements(!newState);
        }
        break;
    }
    default:
        break;
    }

    if ( newState ) {
        switch ( details.name ) {
        case 'no-scripting':
        case 'no-remote-fonts':
            filteringBehaviorChanged({
                direction: details.state ? 1 : 0,
                hostname: details.hostname,
            });
            break;
        default:
            break;
        }
    }

    if ( details.persist !== true ) { return; }

    changed = permanentSwitches.toggleZ(
        details.name,
        details.hostname,
        !!details.deep,
        newState
    );
    if ( changed ) {
        this.saveHostnameSwitches();
    }
};

/******************************************************************************/

µb.blockingModeFromHostname = function(hn: string): number {
    let bits = 0;
    if ( sessionSwitches.evaluateZ('no-scripting', hn) ) {
        bits |= 0b00000010;
    }
    if ( this.userSettings.advancedUserEnabled ) {
        if ( sessionFirewall.evaluateCellZY(hn, '*', '3p') === 1 ) {
            bits |= 0b00000100;
        }
        if ( sessionFirewall.evaluateCellZY(hn, '*', '3p-script') === 1 ) {
            bits |= 0b00001000;
        }
        if ( sessionFirewall.evaluateCellZY(hn, '*', '3p-frame') === 1 ) {
            bits |= 0b00010000;
        }
    }
    return bits;
};

interface BlockingProfile {
    bits: number;
    color: string;
}

{
    const parse = function(): void {
        const s = µb.hiddenSettings.blockingProfiles;
        const profiles: BlockingProfile[] = [];
        s.split(/\s+/).forEach(s => {
            let pos = s.indexOf('/');
            if ( pos === -1 ) {
                pos = s.length;
            }
            const bits = parseInt(s.slice(0, pos), 2);
            if ( isNaN(bits) ) { return; }
            const color = s.slice(pos + 1);
            profiles.push({ bits, color: color !== '' ? color : '#666' });
        });
        µb.liveBlockingProfiles = profiles;
        µb.blockingProfileColorCache.clear();
    };

    parse();

    onBroadcast((msg: { what?: string }) => {
        if ( msg.what !== 'hiddenSettingsChanged' ) { return; }
        parse();
    });
}

/******************************************************************************/

µb.pageURLFromMaybeDocumentBlockedURL = function(pageURL: string): string {
    if ( pageURL.startsWith(vAPI.getURL('/document-blocked.html?')) ) {
        try {
            const url = new URL(pageURL);
            return JSON.parse(url.searchParams.get('details') || '{}').url;
        } catch (e) {
            console.warn('[uBR] ublock: pageURLFromMaybeDocumentBlockedURL URL parse failed', pageURL, e);
        }
    }
    return pageURL;
};

/******************************************************************************/