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

interface Hsluv {
    hexToHsluv(hex: string): number[];
    hsluvToRgb(hsl: number[]): number[];
}

interface VAPI {
    messaging: {
        send(domain: string, message: object): Promise<unknown>;
    };
    webextFlavor: {
        soup: {
            has(value: string): boolean;
        };
    };
}

declare const vAPI: VAPI;
declare const self: Window & { matchMedia: (query: string) => MediaQueryList; hsluv?: Hsluv };

function getActualTheme(nominalTheme: string | null | undefined): string {
    let theme = nominalTheme || 'light';
    if ( nominalTheme === 'auto' ) {
        if ( typeof self.matchMedia === 'function' ) {
            const mql = self.matchMedia('(prefers-color-scheme: dark)');
            theme = mql instanceof Object && mql.matches === true
                ? 'dark'
                : 'light';
        } else {
            theme = 'light';
        }
    }
    return theme;
}

function setTheme(theme: string, propagate: boolean = false): void {
    theme = getActualTheme(theme);
    let w: Window = self;
    for (;;) {
        const rootcl = w.document.documentElement.classList;
        if ( theme === 'dark' ) {
            rootcl.add('dark');
            rootcl.remove('light');
        } else /* if ( theme === 'light' ) */ {
            rootcl.add('light');
            rootcl.remove('dark');
        }
        if ( propagate === false ) { break; }
        if ( w === w.parent ) { break; }
        w = w.parent;
        try { void w.document; } catch (e) { console.warn('[uBR] theme: setTheme cross-origin access failed', e); return; }
    }
}

function setAccentColor(
    accentEnabled: boolean,
    accentColor: string,
    propagate: boolean,
    stylesheet: string = ''
): void {
    if ( accentEnabled && stylesheet === '' && self.hsluv !== undefined ) {
        const toRGB = (hsl: number[]): string => self.hsluv!.hsluvToRgb(hsl).map(a => Math.round(a * 255)).join(' ');
        const hsl = self.hsluv!.hexToHsluv(accentColor);
        hsl[0] = Math.round(hsl[0] * 10) / 10;
        hsl[1] = Math.round(Math.min(100, Math.max(0, hsl[1])));
        const shades = [ 5, 10, 20, 30, 40, 50, 60, 70, 80, 90, 95 ];
        const text: string[] = [];
        text.push(':root.accented {');
        for ( const shade of shades ) {
            hsl[2] = shade;
            text.push(`   --primary-${shade}: ${toRGB(hsl)};`);
        }
        text.push('}');
        hsl[1] = Math.min(25, hsl[1]);
        hsl[2] = 80;
        text.push(
            ':root.light.accented {',
            `    --button-surface-rgb: ${toRGB(hsl)};`,
            '}',
        );
        hsl[2] = 30;
        text.push(
            ':root.dark.accented {',
            `    --button-surface-rgb: ${toRGB(hsl)};`,
            '}',
        );
        text.push('');
        stylesheet = text.join('\n');
        vAPI.messaging.send('dom', { what: 'uiAccentStylesheet', stylesheet });
    }
    let w: Window = self;
    for (;;) {
        const wdoc = w.document;
        let style = wdoc.querySelector('style#accentColors');
        if ( style !== null ) { style.remove(); }
        if ( accentEnabled ) {
            style = wdoc.createElement('style');
            style.id = 'accentColors';
            style.textContent = stylesheet;
            wdoc.head.append(style);
            wdoc.documentElement.classList.add('accented');
        } else {
            wdoc.documentElement.classList.remove('accented');
        }
        if ( propagate === false ) { break; }
        if ( w === w.parent ) { break; }
        w = w.parent;
        try { void w.document; } catch (e) { console.warn('[uBR] theme: setAccentColor cross-origin access failed', e); break; }
    }
}

interface UIThemeResponse {
    uiTheme: string;
    uiAccentCustom: boolean;
    uiAccentCustom0: string;
    uiAccentStylesheet: string;
    uiStyles: string;
}

{
    Promise.resolve(vAPI.messaging?.send?.('dom', { what: 'uiStyles' })).then(response => {
        if ( typeof response !== 'object' || response === null ) { return; }
        const r = response as UIThemeResponse;
        setTheme(r.uiTheme);
        if ( r.uiAccentCustom ) {
            setAccentColor(
                true,
                r.uiAccentCustom0,
                false,
                r.uiAccentStylesheet
            );
        }
        if ( r.uiStyles !== 'unset' ) {
            document.body.style.cssText = r.uiStyles;
        }
    }).catch(e => {
        console.warn('[uBR] theme: uiStyles failed', e);
    });

    const rootcl = document.documentElement.classList;
    if ( vAPI.webextFlavor.soup.has('mobile') ) {
        rootcl.add('mobile');
    } else {
        rootcl.add('desktop');
    }
    if ( window.matchMedia('(min-resolution: 150dpi)').matches ) {
        rootcl.add('hidpi');
    }
}

export {
    getActualTheme,
    setTheme,
    setAccentColor,
};
