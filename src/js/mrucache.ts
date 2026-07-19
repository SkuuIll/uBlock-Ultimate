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

export class MRUCache<TKey, TValue> {
    maxSize: number;
    array: TKey[];
    map: Map<TKey, TValue>;
    resetTime: number;

    constructor(maxSize: number) {
        this.maxSize = maxSize;
        this.array = [];
        this.map = new Map<TKey, TValue>();
        this.resetTime = Date.now();
    }

    add(key: TKey, value: TValue): void {
        const found = this.map.has(key);
        this.map.set(key, value);
        if (found) {
            return;
        }
        if (this.array.length === this.maxSize) {
            this.map.delete(this.array.pop() as TKey);
        }
        this.array.unshift(key);
    }

    remove(key: TKey): void {
        if (this.map.delete(key) === false) {
            return;
        }
        const i = this.array.indexOf(key);
        if (i !== -1) {
            this.array.splice(i, 1);
        }
    }

    lookup(key: TKey): TValue | undefined {
        const value = this.map.get(key);
        if (value === undefined) {
            return undefined;
        }
        if (this.array[0] === key) {
            return value;
        }
        const i = this.array.indexOf(key);
        this.array.copyWithin(1, 0, i);
        this.array[0] = key;
        return value;
    }

    reset(): void {
        this.array = [];
        this.map.clear();
        this.resetTime = Date.now();
    }
}
