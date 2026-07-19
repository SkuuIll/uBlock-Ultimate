/*******************************************************************************

    uBlock Ultimate - a comprehensive, efficient content blocker
    Copyright (C) 2014-2018 Raymond Hill

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
    decomposeHostname,
    domainFromHostname,
} from './uri-utils.js';
import { LineIterator } from './text-utils.js';
import punycode from '../extension/lib/punycode.js';

/******************************************************************************/

interface SupportedDynamicTypes {
    [key: string]: boolean;
}

interface TypeBitOffsets {
    [key: string]: number;
}

interface NameToActionMap {
    [key: string]: number;
}

interface RuleParts {
    0: string;
    1: string;
    2: string;
    3: string;
    length: number;
}

interface LogData {
    source: string;
    result: number;
    raw: string;
}

interface Selfie {
    magicId: number;
    rules: [string, number][];
}

const supportedDynamicTypes: SupportedDynamicTypes = Object.create(null);
Object.assign(supportedDynamicTypes, {
           '3p': true,
        'image': true,
'inline-script': true,
    '1p-script': true,
    '3p-script': true,
     '3p-frame': true
});

const typeBitOffsets: TypeBitOffsets = Object.create(null);
Object.assign(typeBitOffsets, {
            '*':  0,
'inline-script':  2,
    '1p-script':  4,
    '3p-script':  6,
     '3p-frame':  8,
        'image': 10,
           '3p': 12
});

const nameToActionMap: NameToActionMap = Object.create(null);
Object.assign(nameToActionMap, {
    'block': 1,
    'allow': 2,
     'noop': 3
});

const intToActionMap = new Map<number, string>([
    [ 1, 'block' ],
    [ 2, 'allow' ],
    [ 3, 'noop' ]
]);

const reBadHostname = /[^0-9a-z_.[\]:%-]/;
const reNotASCII = /[^\x20-\x7F]/;
const decomposedSource: string[] = [];
const decomposedDestination: string[] = [];

/******************************************************************************/

function is3rdParty(srcHostname: string, desHostname: string): boolean {
    if ( desHostname === '*' || srcHostname === '*' || srcHostname === '' ) {
        return false;
    }

    const srcDomain = domainFromHostname(srcHostname) || srcHostname;

    if ( desHostname.endsWith(srcDomain) === false ) {
        return true;
    }
    return desHostname.length !== srcDomain.length &&
           desHostname.charAt(desHostname.length - srcDomain.length - 1) !== '.';
}

/******************************************************************************/

class DynamicHostRuleFiltering {
    private r: number;
    private type: string;
    private y: string;
    private z: string;
    private rules: Map<string, number>;
    private changed: boolean;
    public static readonly magicId = 1;

    constructor() {
        this.reset();
    }

    reset(): void {
        this.r = 0;
        this.type = '';
        this.y = '';
        this.z = '';
        this.rules = new Map<string, number>();
        this.changed = false;
    }

    assign(other: DynamicHostRuleFiltering): void {
        for ( const k of this.rules.keys() ) {
            if ( other.rules.has(k) === false ) {
                this.rules.delete(k);
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

    copyRules(from: DynamicHostRuleFiltering, srcHostname: string, desHostnames: Record<string, unknown>): boolean {
        let thisBits = this.rules.get('* *');
        let fromBits = from.rules.get('* *');
        if ( fromBits !== thisBits ) {
            if ( fromBits !== undefined ) {
                this.rules.set('* *', fromBits);
            } else {
                this.rules.delete('* *');
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
            key = `${srcHostname} ${desHostname}` ;
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

    hasSameRules(other: DynamicHostRuleFiltering, srcHostname: string, desHostnames: Record<string, unknown>): boolean {
        let key = '* *';
        if ( this.rules.get(key) !== other.rules.get(key) ) { return false; }
        key = `${srcHostname} *`;
        if ( this.rules.get(key) !== other.rules.get(key) ) { return false; }
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

    setCell(srcHostname: string, desHostname: string, type: string, state: number): boolean {
        const bitOffset = typeBitOffsets[type];
        const k = `${srcHostname} ${desHostname}`;
        const oldBitmap = this.rules.get(k) || 0;
        const newBitmap = oldBitmap & ~(3 << bitOffset) | (state << bitOffset);
        if ( newBitmap === oldBitmap ) { return false; }
        if ( newBitmap === 0 ) {
            this.rules.delete(k);
        } else {
            this.rules.set(k, newBitmap);
        }
        this.changed = true;
        return true;
    }

    unsetCell(srcHostname: string, desHostname: string, type: string): boolean {
        this.evaluateCellZY(srcHostname, desHostname, type);
        if ( this.r === 0 ) { return false; }
        this.setCell(srcHostname, desHostname, type, 0);
        this.changed = true;
        return true;
    }

    evaluateCell(srcHostname: string, desHostname: string, type: string): number {
        const key = `${srcHostname} ${desHostname}`;
        const bitmap = this.rules.get(key);
        if ( bitmap === undefined ) { return 0; }
        return bitmap >> typeBitOffsets[type] & 3;
    }

    clearRegisters(): this {
        this.r = 0;
        this.type = this.y = this.z = '';
        return this;
    }

    evaluateCellZ(srcHostname: string, desHostname: string, type: string): number {
        decomposeHostname(srcHostname, decomposedSource);
        this.type = type;
        const bitOffset = typeBitOffsets[type];
        for ( const srchn of decomposedSource ) {
            this.z = srchn;
            let v = this.rules.get(`${srchn} ${desHostname}`);
            if ( v === undefined ) { continue; }
            v = v >>> bitOffset & 3;
            if ( v === 0 ) { continue; }
            return (this.r = v);
        }
        this.r = 0;
        return 0;
    }

    evaluateCellZY(srcHostname: string, desHostname: string, type: string): number {
        if ( desHostname === '' ) {
            this.r = 0;
            return 0;
        }

        decomposeHostname(desHostname, decomposedDestination);
        for ( const deshn of decomposedDestination ) {
            if ( deshn === '*' ) { break; }
            this.y = deshn;
            if ( this.evaluateCellZ(srcHostname, deshn, '*') !== 0 ) {
                return this.r;
            }
        }

        const thirdParty = is3rdParty(srcHostname, desHostname);

        this.y = '*';

        if ( thirdParty ) {
            if ( type === 'script' ) {
                if ( this.evaluateCellZ(srcHostname, '*', '3p-script') !== 0 ) {
                    return this.r;
                }
            } else if ( type === 'sub_frame' || type === 'object' ) {
                if ( this.evaluateCellZ(srcHostname, '*', '3p-frame') !== 0 ) {
                    return this.r;
                }
            }
            if ( this.evaluateCellZ(srcHostname, '*', '3p') !== 0 ) {
                return this.r;
            }
        } else if ( type === 'script' ) {
            if ( this.evaluateCellZ(srcHostname, '*', '1p-script') !== 0 ) {
                return this.r;
            }
        }

        if ( supportedDynamicTypes[type] !== undefined ) {
            if ( this.evaluateCellZ(srcHostname, '*', type) !== 0 ) {
                return this.r;
            }
            if ( type.startsWith('3p-') ) {
                if ( this.evaluateCellZ(srcHostname, '*', '3p') !== 0 ) {
                    return this.r;
                }
            }
        }

        if ( this.evaluateCellZ(srcHostname, '*', '*') !== 0 ) {
            return this.r;
        }

        this.type = '';
        return 0;
    }

    mustAllowCellZY(srcHostname: string, desHostname: string, type: string): boolean {
        return this.evaluateCellZY(srcHostname, desHostname, type) === 2;
    }

    mustBlockOrAllow(): boolean {
        return this.r === 1 || this.r === 2;
    }

    mustBlock(): boolean {
        return this.r === 1;
    }

    mustAbort(): boolean {
        return this.r === 3;
    }

    lookupRuleData(src: string, des: string, type: string): string | undefined {
        const r = this.evaluateCellZY(src, des, type);
        if ( r === 0 ) { return; }
        return `${this.z} ${this.y} ${this.type} ${r}`;
    }

    toLogData(): LogData | undefined {
        if ( this.r === 0  || this.type === '' ) { return; }
        return {
            source: 'dynamicHost',
            result: this.r,
            raw: `${this.z} ${this.y} ${this.type} ${intToActionMap.get(this.r)}`
        };
    }

    srcHostnameFromRule(rule: string): string {
        return rule.slice(0, rule.indexOf(' '));
    }

    desHostnameFromRule(rule: string): string {
        return rule.slice(rule.indexOf(' ') + 1);
    }

    toArray(): string[] {
        const out: string[] = [];
        for ( const key of this.rules.keys() ) {
            const srchn = this.srcHostnameFromRule(key);
            const deshn = this.desHostnameFromRule(key);
            const srchnPretty = srchn.includes('xn--') && punycode
                ? punycode.toUnicode(srchn)
                : srchn;
            const deshnPretty = deshn.includes('xn--') && punycode
                ? punycode.toUnicode(deshn)
                : deshn;
            for ( const type in typeBitOffsets ) {
                if ( typeBitOffsets[type] === undefined ) { continue; }
                const val = this.evaluateCell(srchn, deshn, type);
                if ( val === 0 ) { continue; }
                const action = intToActionMap.get(val);
                if ( action === undefined ) { continue; }
                out.push(`${srchnPretty} ${deshnPretty} ${type} ${action}`);
            }
        }
        return out;
    }

    toString(): string {
        return this.toArray().join('\n');
    }

    fromString(text: string, append?: boolean): void {
        const lineIter = new LineIterator(text);
        if ( append !== true ) { this.reset(); }
        while ( lineIter.eot() === false ) {
            this.addFromRuleParts(lineIter.next().trim().split(/\s+/) as unknown as RuleParts);
        }
    }

    validateRuleParts(parts: RuleParts): RuleParts | undefined {
        if ( parts.length < 4 ) { return; }

        if ( parts[0].endsWith(':') ) { return; }

        if ( parts[1].includes('/') ) { return; }

        if ( typeBitOffsets[parts[2]] === undefined ) { return; }

        if ( nameToActionMap[parts[3]] === undefined ) { return; }

        if ( parts[1] !== '*' && parts[2] !== '*' ) { return; }

        if ( punycode !== undefined ) {
            if ( reNotASCII.test(parts[0]) ) {
                parts[0] = punycode.toASCII(parts[0]);
            }
            if ( reNotASCII.test(parts[1]) ) {
                parts[1] = punycode.toASCII(parts[1]);
            }
        }

        if (
            (parts[0] !== '*' && reBadHostname.test(parts[0])) ||
            (parts[1] !== '*' && reBadHostname.test(parts[1]))
        ) {
            return;
        }

        return parts;
    }

    addFromRuleParts(parts: RuleParts): boolean {
        if ( this.validateRuleParts(parts) !== undefined ) {
            this.setCell(parts[0], parts[1], parts[2], nameToActionMap[parts[3]]);
            return true;
        }
        return false;
    }

    removeFromRuleParts(parts: RuleParts): boolean {
        if ( this.validateRuleParts(parts) !== undefined ) {
            this.setCell(parts[0], parts[1], parts[2], 0);
            return true;
        }
        return false;
    }

    toSelfie(): Selfie {
        return {
            magicId: DynamicHostRuleFiltering.magicId,
            rules: Array.from(this.rules)
        };
    }

    fromSelfie(selfie: Selfie): boolean {
        if ( selfie.magicId !== DynamicHostRuleFiltering.magicId ) { return false; }
        this.rules = new Map(selfie.rules);
        this.changed = true;
        return true;
    }
}

/******************************************************************************/

export default DynamicHostRuleFiltering;

/******************************************************************************/
