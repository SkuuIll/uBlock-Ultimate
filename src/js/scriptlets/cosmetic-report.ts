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

/******************************************************************************/

(( ) => {
// >>>>>>>> start of private namespace

/******************************************************************************/

interface vAPI {
    domFilterer: {
        getAllSelectors: () => {
            declarative?: string[];
            procedural?: Array<{ raw: string; hit?: boolean; exec: () => Element[] }>;
            exceptions?: string[];
        } | null;
        createProceduralFilter: (details: unknown) => {
            test: () => boolean;
            exec: () => Element[];
            raw: string;
        };
    } | null;
}

interface AllSelectors {
    declarative?: string[];
    procedural?: Array<{ raw: string; hit?: boolean; exec: () => Element[] }>;
    exceptions?: string[];
}

const rePseudoElements = /:(?::?after|:?before|:[a-z-]+)$/;

const hasSelector = (selector: string): boolean => {
    try {
        return document.querySelector(selector) !== null;
    }
    catch (e) {
        console.warn('[uBR] cosmetic-report: hasSelector failed', e);
    }
    return false;
};

const safeQuerySelector = (selector: string): Element | null => {
    const safeSelector = rePseudoElements.test(selector)
        ? selector.replace(rePseudoElements, '')
        : selector;
    try {
        return document.querySelector(safeSelector);
    }
    catch (e) {
        console.warn('[uBR] cosmetic-report: safeQuerySelector failed', e);
    }
    return null;
};

const safeGroupSelectors = (selectors: string[] | Iterable<string>): string => {
    const arr = Array.isArray(selectors)
        ? selectors
        : Array.from(selectors);
    return arr.map(s => {
        return rePseudoElements.test(s)
            ? s.replace(rePseudoElements, '')
            : s;
    }).join(',\n');
};

const allSelectors = vAPI.domFilterer.getAllSelectors();
const matchedSelectors: string[] = [];



if ( self.uBR_scriptletsInjected !== undefined ) {
    matchedSelectors.push(...self.uBR_scriptletsInjected);
}

if ( matchedSelectors.length === 0 ) { return; }

return matchedSelectors;

/******************************************************************************/

// <<<<<<<< end of private namespace
})();
