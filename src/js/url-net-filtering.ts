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

import { LineIterator } from './text-utils.js';
import { decomposeHostname } from './uri-utils.js';
import { dom } from './dom.js';
import { i18n as i18nMod } from './i18n.js';
import './dashboard-common.js';

/*******************************************************************************

    The purpose of log filtering is to create ad hoc filtering rules, to
    diagnose and assist in the creation of custom filters.

    buckets: map of [hostname + type]
         bucket: array of rule entries, sorted from shorter to longer url
    rule entry: { url, action }

*******************************************************************************/

const actionToNameMap: Record<number, string> = {
    1: 'block',
    2: 'allow',
    3: 'noop'
};

const nameToActionMap: Record<string, number> = Object.create(null);
Object.assign(nameToActionMap, {
    'block': 1,
    'allow': 2,
     'noop': 3
});

const knownInvalidTypes = new Set<string>([
    'doc',
    'main_frame',
]);

const intToActionMap = new Map<number, string>([
    [ 1, ' block' ],
    [ 2, ' allow' ],
    [ 3, ' noop' ]
]);

const decomposedSource: string[] = [];

/******************************************************************************/

class RuleEntry {
    url: string;
    action: number;
    constructor(url: string, action: number) {
        this.url = url;
        this.action = action;
    }
}

/******************************************************************************/

function indexOfURL(entries: RuleEntry[], url: string): number {
    const urlLen = url.length;
    for ( let i = 0; i < entries.length; i++ ) {
        const entry = entries[i];
        if ( entry.url.length > urlLen ) { break; }
        if ( entry.url === url ) { return i; }
    }
    return -1;
}

/******************************************************************************/

function indexOfMatch(entries: RuleEntry[], url: string): number {
    const urlLen = url.length;
    let i = entries.length;
    while ( i-- ) {
        if ( entries[i].url.length <= urlLen ) {
            break;
        }
    }
    if ( i !== -1 ) {
        do {
            if ( url.startsWith(entries[i].url) ) {
                return i;
            }
        } while ( i-- );
    }
    return -1;
}

/******************************************************************************/

function indexFromLength(entries: RuleEntry[], len: number): number {
    for ( let i = 0; i < entries.length; i++ ) {
        if ( entries[i].url.length > len ) { return i; }
    }
    return -1;
}

/******************************************************************************/

function addRuleEntry(entries: RuleEntry[], url: string, action: number): void {
    const entry = new RuleEntry(url, action);
    const i = indexFromLength(entries, url.length);
    if ( i === -1 ) {
        entries.push(entry);
    } else {
        entries.splice(i, 0, entry);
    }
}

/******************************************************************************/

interface LogData {
    source: string;
    result: number;
    rule: string[];
    raw: string;
}

class DynamicURLRuleFiltering {
    rules: Map<string, RuleEntry[]>;
    context: string;
    url: string;
    type: string;
    r: number;
    changed: boolean;

    constructor() {
        this.reset();
    }

    reset(): void {
        this.rules = new Map<string, RuleEntry[]>();
        this.context = '';
        this.url = '';
        this.type = '';
        this.r = 0;
        this.changed = false;
    }

    assign(other: DynamicURLRuleFiltering): void {
        for ( const key of this.rules.keys() ) {
            if ( other.rules.has(key) === false ) {
                this.rules.delete(key);
            }
        }
        for ( const entry of other.rules ) {
            this.rules.set(entry[0], entry[1].slice());
        }
        this.changed = true;
    }

    setRule(srcHostname: string, url: string, type: string, action: number): boolean {
        if ( action === 0 ) {
            return this.removeRule(srcHostname, url, type);
        }
        const bucketKey = `${srcHostname  } ${  type}`;
        let entries = this.rules.get(bucketKey);
        if ( entries === undefined ) {
            entries = [];
            this.rules.set(bucketKey, entries);
        }
        const i = indexOfURL(entries, url);
        if ( i !== -1 ) {
            const entry = entries[i];
            if ( entry.action === action ) { return false; }
            entry.action = action;
        } else {
            addRuleEntry(entries, url, action);
        }
        this.changed = true;
        return true;
    }

    removeRule(srcHostname: string, url: string, type: string): boolean {
        const bucketKey = `${srcHostname  } ${  type}`;
        const entries = this.rules.get(bucketKey);
        if ( entries === undefined ) { return false; }
        const i = indexOfURL(entries, url);
        if ( i === -1 ) { return false; }
        entries.splice(i, 1);
        if ( entries.length === 0 ) {
            this.rules.delete(bucketKey);
        }
        this.changed = true;
        return true;
    }

    evaluateZ(context: string, target: string, type: string): number {
        this.r = 0;
        if ( this.rules.size === 0 ) { return 0; }
        decomposeHostname(context, decomposedSource);
        for ( const srchn of decomposedSource ) {
            this.context = srchn;
            let entries = this.rules.get(`${srchn} ${type}`);
            if ( entries !== undefined ) {
                const i = indexOfMatch(entries, target);
                if ( i !== -1 ) {
                    const entry = entries[i];
                    this.url = entry.url;
                    this.type = type;
                    this.r = entry.action;
                    return this.r;
                }
            }
            entries = this.rules.get(`${srchn} *`);
            if ( entries !== undefined ) {
                const i = indexOfMatch(entries, target);
                if ( i !== -1 ) {
                    const entry = entries[i];
                    this.url = entry.url;
                    this.type = '*';
                    this.r = entry.action;
                    return this.r;
                }
            }
        }
        return 0;
    }

    mustAllowCellZ(context: string, target: string, type: string): boolean {
        return this.evaluateZ(context, target, type) === 2;
    }

    mustBlockOrAllow(): boolean {
        return this.r === 1 || this.r === 2;
    }

    toLogData(): LogData | undefined {
        if ( this.r === 0 ) { return; }
        const { context, url, type } = this;
        return {
            source: 'dynamicUrl',
            result: this.r,
            rule: [ context, url, type, intToActionMap.get(this.r) as string ],
            raw: `${context} ${url} ${type} ${intToActionMap.get(this.r)}`,
        };
    }

    copyRules(other: DynamicURLRuleFiltering, context: string, urls: string[], type: string): boolean {
        let i = urls.length;
        while ( i-- ) {
            const url = urls[i];
            other.evaluateZ(context, url, type);
            const otherOwn = other.r !== 0 &&
                             other.context === context &&
                             other.url === url &&
                             other.type === type;
            this.evaluateZ(context, url, type);
            const thisOwn  = this.r !== 0 &&
                             this.context === context &&
                             this.url === url &&
                             this.type === type;
            if ( otherOwn && !thisOwn || other.r !== this.r ) {
                this.setRule(context, url, type, other.r);
                this.changed = true;
            }
            if ( !otherOwn && thisOwn ) {
                this.removeRule(context, url, type);
                this.changed = true;
            }
        }
        return this.changed;
    }

    toArray(): string[] {
        const out: string[] = [];
        for ( const [ key, entries ] of this.rules ) {
            let pos = key.indexOf(' ');
            const hn = key.slice(0, pos);
            pos = key.lastIndexOf(' ');
            const type = key.slice(pos + 1);
            for ( const { url, action } of entries ) {
                out.push(`${hn} ${url} ${type} ${actionToNameMap[action]}`);
            }
        }
        return out;
    }

    toString(): string {
        return this.toArray().sort().join('\n');
    }

    fromString(text: string): void {
        this.reset();
        const lineIter = new LineIterator(text);
        while ( lineIter.eot() === false ) {
            this.addFromRuleParts(lineIter.next().trim().split(/\s+/));
        }
    }

    validateRuleParts(parts: string[]): string[] | undefined {
        if ( parts.length !== 4 ) { return; }
        if ( parts[1].indexOf('://') <= 0 ) { return; }
        if (
            /[^a-z_-]/.test(parts[2]) && parts[2] !== '*' ||
            knownInvalidTypes.has(parts[2])
        ) {
            return;
        }
        if ( nameToActionMap[parts[3]] === undefined ) { return; }
        return parts;
    }

    addFromRuleParts(parts: string[]): boolean {
        if ( this.validateRuleParts(parts) !== undefined ) {
            this.setRule(parts[0], parts[1], parts[2], nameToActionMap[parts[3]]);
            return true;
        }
        return false;
    }

    removeFromRuleParts(parts: string[]): boolean {
        if ( this.validateRuleParts(parts) !== undefined ) {
            this.removeRule(parts[0], parts[1], parts[2]);
            return true;
        }
        return false;
    }
}

/******************************************************************************/

export default DynamicURLRuleFiltering;

/******************************************************************************/
