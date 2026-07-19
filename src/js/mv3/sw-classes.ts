/*******************************************************************************

    uBlock Origin - MV3 Classes
    https://github.com/gorhill/uBlock

    This file contains DynamicFirewallRules, FrameStore, and MV3PageStore classes.

******************************************************************************/

import { decomposeHostname, isThirdParty, domainFromHostname } from "./sw-helpers.js";
import { firewallTypeBitOffsets } from "./sw-types.js";

export type FirewallCount = {
    any: number;
    frame: number;
    script: number;
};

export type FirewallCounts = {
    allowed: FirewallCount;
    blocked: FirewallCount;
};

export type HostnameDetails = {
    domain: string;
    counts: FirewallCounts;
    hasSubdomains?: boolean;
    hasScript?: boolean;
    hasFrame?: boolean;
    totals?: FirewallCounts;
};

const supportedDynamicTypes = new Set([
    "3p",
    "image",
    "inline-script",
    "1p-script",
    "3p-script",
    "3p-frame",
]);

const actionNames: Record<number, string> = {
    1: "block",
    2: "allow",
    3: "noop",
};

const actionValues: Record<string, number> = {
    block: 1,
    allow: 2,
    noop: 3,
};

export class DynamicFirewallRules {
    private rules = new Map<string, number>();
    private r = 0;
    private type = '';
    private y = '';
    private z = '';
    private changed = false;

    reset() {
        this.r = 0;
        this.type = "";
        this.y = "";
        this.z = "";
        this.rules = new Map();
        this.changed = false;
    }

    clearRegisters() {
        this.r = 0;
        this.type = '';
        this.y = '';
        this.z = '';
        return this;
    }

    assign(other: DynamicFirewallRules) {
        for ( const key of this.rules.keys() ) {
            if ( other.rules.has(key) === false ) {
                this.rules.delete(key);
                this.changed = true;
            }
        }
        for ( const entry of other.rules ) {
            if ( this.rules.get(entry[0]) !== entry[1] ) {
                this.rules.set(entry[0], entry[1]);
                this.changed = true;
            }
        }
    }

    copyRules(
        from: DynamicFirewallRules,
        srcHostname: string,
        desHostnames: Record<string, unknown>,
    ) {
        let thisBits = this.rules.get("* *");
        let fromBits = from.rules.get("* *");
        if ( fromBits !== thisBits ) {
            if ( fromBits !== undefined ) {
                this.rules.set("* *", fromBits);
            } else {
                this.rules.delete("* *");
            }
            this.changed = true;
        }

        let key = `${srcHostname} *`;
        thisBits = this.rules.get(key);
        fromBits = from.rules.get(key);
        if ( fromBits !== thisBits ) {
            if ( fromBits !== undefined ) {
                this.rules.set(key, fromBits);
            } else {
                this.rules.delete(key);
            }
            this.changed = true;
        }

        for ( const desHostname in desHostnames ) {
            key = `* ${desHostname}`;
            thisBits = this.rules.get(key);
            fromBits = from.rules.get(key);
            if ( fromBits !== thisBits ) {
                if ( fromBits !== undefined ) {
                    this.rules.set(key, fromBits);
                } else {
                    this.rules.delete(key);
                }
                this.changed = true;
            }
            key = `${srcHostname} ${desHostname}`;
            thisBits = this.rules.get(key);
            fromBits = from.rules.get(key);
            if ( fromBits !== thisBits ) {
                if ( fromBits !== undefined ) {
                    this.rules.set(key, fromBits);
                } else {
                    this.rules.delete(key);
                }
                this.changed = true;
            }
        }

        return this.changed;
    }

    hasSameRules(
        other: DynamicFirewallRules,
        srcHostname: string,
        desHostnames: Record<string, unknown>,
    ) {
        let key = "* *";
        if ( this.rules.get(key) !== other.rules.get(key) ) {
            return false;
        }
        key = `${srcHostname} *`;
        if ( this.rules.get(key) !== other.rules.get(key) ) {
            return false;
        }
        for ( const desHostname in desHostnames ) {
            key = `* ${desHostname}`;
            if ( this.rules.get(key) !== other.rules.get(key) ) {
                return false;
            }
            key = `${srcHostname} ${desHostname}`;
            if ( this.rules.get(key) !== other.rules.get(key) ) {
                return false;
            }
        }
        return true;
    }

    setCell(srcHostname: string, desHostname: string, type: string, state: number) {
        const bitOffset = firewallTypeBitOffsets[type];
        const key = `${srcHostname} ${desHostname}`;
        const oldBitmap = this.rules.get(key) || 0;
        const newBitmap = (oldBitmap & ~(3 << bitOffset)) | (state << bitOffset);
        if ( newBitmap === oldBitmap ) {
            return false;
        }
        if (newBitmap === 0) {
            this.rules.delete(key);
        } else {
            this.rules.set(key, newBitmap);
        }
        this.changed = true;
        return true;
    }

    unsetCell(srcHostname: string, desHostname: string, type: string) {
        this.evaluateCellZY(srcHostname, desHostname, type);
        if (this.r === 0) { return false; }
        this.setCell(srcHostname, desHostname, type, 0);
        this.changed = true;
        return true;
    }

    evaluateCell(srcHostname: string, desHostname: string, type: string) {
        const bitmap = this.rules.get(`${srcHostname} ${desHostname}`);
        if (bitmap === undefined) { return 0; }
        return (bitmap >> firewallTypeBitOffsets[type]) & 3;
    }

    private evaluateCellZ(srcHostname: string, desHostname: string, type: string) {
        this.type = type;
        const bitOffset = firewallTypeBitOffsets[type];
        for ( const srchn of decomposeHostname(srcHostname) ) {
            this.z = srchn;
            let value = this.rules.get(`${srchn} ${desHostname}`);
            if ( value === undefined ) { continue; }
            value = (value >>> bitOffset) & 3;
            if ( value === 0 ) { continue; }
            this.r = value;
            return value;
        }
        this.r = 0;
        return 0;
    }

    evaluateCellZY(srcHostname: string, desHostname: string, type: string) {
        if ( desHostname === "" ) {
            this.r = 0;
            return 0;
        }

        for ( const deshn of decomposeHostname(desHostname) ) {
            if ( deshn === "*" ) { break; }
            this.y = deshn;
            if ( this.evaluateCellZ(srcHostname, deshn, "*") !== 0 ) {
                return this.r;
            }
        }

        const thirdParty = isThirdParty(srcHostname, desHostname);
        this.y = "*";

        if ( thirdParty ) {
            if ( type === "script" ) {
                if ( this.evaluateCellZ(srcHostname, "*", "3p-script") !== 0 ) {
                    return this.r;
                }
            } else if ( type === "sub_frame" || type === "object" ) {
                if ( this.evaluateCellZ(srcHostname, "*", "3p-frame") !== 0 ) {
                    return this.r;
                }
            }
            if ( this.evaluateCellZ(srcHostname, "*", "3p") !== 0 ) {
                return this.r;
            }
        } else if ( type === "script" ) {
            if ( this.evaluateCellZ(srcHostname, "*", "1p-script") !== 0 ) {
                return this.r;
            }
        }

        if ( supportedDynamicTypes.has(type) ) {
            if ( this.evaluateCellZ(srcHostname, "*", type) !== 0 ) {
                return this.r;
            }
            if ( type.startsWith("3p-") ) {
                if ( this.evaluateCellZ(srcHostname, "*", "3p") !== 0 ) {
                    return this.r;
                }
            }
        }

        if ( this.evaluateCellZ(srcHostname, "*", "*") !== 0 ) {
            return this.r;
        }

        this.type = "";
        return 0;
    }

    mustAllowCellZY(srcHostname: string, desHostname: string, type: string) {
        return this.evaluateCellZY(srcHostname, desHostname, type) === 2;
    }

    mustBlockOrAllow() {
        return this.r === 1 || this.r === 2;
    }

    mustBlock() {
        return this.r === 1;
    }

    mustAbort() {
        return this.r === 3;
    }

    lookupRuleData(srcHostname: string, desHostname: string, type: string) {
        const value = this.evaluateCellZY(srcHostname, desHostname, type);
        if ( value === 0 || this.type === "" ) {
            return;
        }
        return `${this.z} ${this.y} ${this.type} ${value}`;
    }

    toLogData() {
        if ( this.r === 0 || this.type === "" ) {
            return;
        }
        return {
            source: "dynamicHost",
            result: this.r,
            raw: `${this.z} ${this.y} ${this.type} ${actionNames[this.r]}`,
        };
    }

    private srcHostnameFromRule(rule: string) {
        return rule.slice(0, rule.indexOf(" "));
    }

    private desHostnameFromRule(rule: string) {
        return rule.slice(rule.indexOf(" ") + 1);
    }

    toArray(): string[] {
        const out: string[] = [];
        for ( const key of this.rules.keys() ) {
            const src = this.srcHostnameFromRule(key);
            const dest = this.desHostnameFromRule(key);
            for ( const type of Object.keys(firewallTypeBitOffsets) ) {
                const value = this.evaluateCell(src, dest, type);
                if ( value === 0 ) { continue; }
                out.push(`${src} ${dest} ${type} ${actionNames[value]}`);
            }
        }
        return out;
    }

    addFromRuleParts(parts: [string, string, string, string]) {
        if ( parts.length < 4 ) {
            return false;
        }
        const [src, dest, type, action] = parts;
        const value = actionValues[action];
        if (
            value === undefined ||
            firewallTypeBitOffsets[type] === undefined ||
            (dest !== "*" && type !== "*")
        ) {
            return false;
        }
        this.setCell(src, dest, type, value);
        return true;
    }

    removeFromRuleParts(parts: [string, string, string, string]) {
        if ( parts.length < 4 ) {
            return false;
        }
        const [src, dest, type] = parts;
        if (
            firewallTypeBitOffsets[type] === undefined ||
            (dest !== "*" && type !== "*")
        ) {
            return false;
        }
        this.setCell(src, dest, type, 0);
        return true;
    }

    fromString(text: string, append?: boolean) {
        if ( append !== true ) {
            this.reset();
        }
        for ( const line of text.split("\n") ) {
            const trimmed = line.trim();
            if ( trimmed === "" || trimmed.startsWith("#") ) {
                continue;
            }
            this.addFromRuleParts(trimmed.split(/\s+/) as [string, string, string, string]);
        }
    }

    toString() {
        return this.toArray().join('\n');
    }
}

export class FrameStore {
    frameURL: string;
    parentId: number;
    clickToLoad: boolean;
    type: number;
    timestamp: number;

    constructor(frameURL: string, parentId: number) {
        this.frameURL = frameURL;
        this.parentId = parentId;
        this.clickToLoad = false;
        this.type = 0;
        this.timestamp = Date.now();
    }

    init(frameURL: string, parentId: number): void {
        this.frameURL = frameURL;
        this.parentId = parentId;
        this.clickToLoad = false;
        this.type = 0;
        this.timestamp = Date.now();
    }

    dispose(): void {
        this.frameURL = '';
        this.parentId = 0;
        this.clickToLoad = false;
    }

    updateURL(url: string): void {
        this.frameURL = url;
        this.timestamp = Date.now();
    }

    getCosmeticFilteringBits(_tabId: number): number {
        return 0;
    }

    shouldApplySpecificCosmeticFilters(_tabId: number): boolean {
        return true;
    }

    shouldApplyGenericCosmeticFilters(_tabId: number): boolean {
        return true;
    }
}

export class MV3PageStore {
    tabId: number;
    rawURL: string;
    hostname: string;
    rootHostname: string;
    rootDomain: string;
    title: string;
    netFilteringSwitch: boolean;
    contentLastModified: number;
    largeMediaCount: number;
    remoteFontCount: number;
    popupBlockedCount: number;
    counts: FirewallCounts;
    hostnameDetailsMap: Map<string, any>;
    frameStores: Map<number, FrameStore>;
    extraData: Map<string, any>;
    allowLargeMediaElementsUntil: number;

    constructor(tabId: number) {
        this.tabId = tabId;
        this.rawURL = '';
        this.hostname = '';
        this.rootHostname = '';
        this.rootDomain = '';
        this.title = '';
        this.netFilteringSwitch = true;
        this.contentLastModified = 0;
        this.largeMediaCount = 0;
        this.remoteFontCount = 0;
        this.popupBlockedCount = 0;
        this.counts = {
            allowed: { any: 0, frame: 0, script: 0 },
            blocked: { any: 0, frame: 0, script: 0 },
        };
        this.hostnameDetailsMap = new Map();
        this.frameStores = new Map();
        this.extraData = new Map();
        this.allowLargeMediaElementsUntil = 0;
    }

    async initialize(tab: chrome.tabs.Tab): Promise<void> {
        if (!tab?.url) return;

        try {
            const url = new URL(tab.url);
            this.rawURL = url.href;
            this.hostname = url.hostname;

            const parts = this.hostname.split('.');
            if (parts.length >= 2) {
                this.rootDomain = domainFromHostname(this.hostname);
                this.rootHostname = this.rootDomain
                    ? this.rootDomain.split(".")[0]
                    : parts.slice(-2)[0];
            } else {
                this.rootHostname = this.hostname;
                this.rootDomain = this.hostname;
            }

            const storedFiltering = await chrome.storage.local.get('perSiteFiltering');
            const perSiteFiltering = storedFiltering?.perSiteFiltering || {};
            this.netFilteringSwitch = perSiteFiltering[this.hostname] !== false;

            const storedVersions = await chrome.storage.local.get('popupContentVersions');
            const versions = storedVersions?.popupContentVersions || {};
            this.contentLastModified = versions[tab.id] || 0;

            const storedMetrics = await chrome.storage.local.get('tabMetrics');
            const metrics = storedMetrics?.tabMetrics || {};
            const tabMetric = metrics[tab.id] || {};
            this.largeMediaCount = tabMetric.largeMediaCount || 0;
            this.remoteFontCount = tabMetric.remoteFontCount || 0;
            this.popupBlockedCount = tabMetric.popupBlockedCount || 0;
            this.counts.blocked = tabMetric.blocked || { any: 0, frame: 0, script: 0 };
            this.counts.allowed = tabMetric.allowed || { any: 0, frame: 0, script: 0 };

            const storedDetails = await chrome.storage.local.get('hostnameDetailsMap');
            const detailsMap = storedDetails?.hostnameDetailsMap || {};
            const tabDetails = detailsMap[tab.id] || {};
            for (const [hostname, detail] of Object.entries(tabDetails)) {
                this.hostnameDetailsMap.set(hostname, detail);
            }

            const storedExtraData = await chrome.storage.local.get('pageStoreExtraData');
            const extraDataMap = storedExtraData?.pageStoreExtraData || {};
            const tabExtraData = extraDataMap[tab.id] || {};
            for (const [key, value] of Object.entries(tabExtraData)) {
                this.extraData.set(key, value);
            }

            const storedLargeMedia = await chrome.storage.local.get('allowLargeMediaElements');
            const largeMediaMap = storedLargeMedia?.allowLargeMediaElements || {};
            this.allowLargeMediaElementsUntil = largeMediaMap[tab.id] || 0;
        } catch (e) {
            console.log('[MV3] MV3PageStore.initialize error:', e);
        }
    }

    getNetFilteringSwitch(): boolean {
        return this.netFilteringSwitch;
    }

    getAllHostnameDetails(): Map<string, any> {
        return this.hostnameDetailsMap;
    }

    disposeFrameStores(): void {
        this.frameStores.clear();
    }

    async clickToLoad(frameId: number, _frameURL: string): Promise<void> {
        const frameStore = this.frameStores.get(frameId);
        if (frameStore) {
            frameStore.clickToLoad = true;
        }
    }
}

export const pageStores = new Map<number, MV3PageStore>();
export let pageStoresToken = 0;

export const pageStoreFromTabId = async (tabId: number): Promise<MV3PageStore | null> => {
    let pageStore = pageStores.get(tabId);
    if (pageStore) {
        pageStoresToken += 1;
        return pageStore;
    }

    try {
        const tab = await chrome.tabs.get(tabId);
        if (!tab) return null;

        pageStore = new MV3PageStore(tabId);
        await pageStore.initialize(tab);
        pageStores.set(tabId, pageStore);
        pageStoresToken += 1;
        return pageStore;
    } catch (e) {
        console.warn('[uBR] lookupOrCreatePageStore: failed for tab', tabId, e);
        return null;
    }
};

export const mustLookup = async (tabId: number): Promise<MV3PageStore | null> => {
    return pageStoreFromTabId(tabId);
};
