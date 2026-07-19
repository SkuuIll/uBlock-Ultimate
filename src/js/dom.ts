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

/******************************************************************************/

type Target =
    | string
    | Element
    | Element[]
    | NodeListOf<Element>
    | null
    | undefined;

type EventCallback = (this: Element, ev: Event) => void;

interface NormalizedElements extends Array<Element> {
    0: Element;
}

const normalizeTarget = (target: Target): NormalizedElements => {
    if (typeof target === 'string') { return Array.from(qsa$(target)) as NormalizedElements; }
    if (target instanceof Element) { return [target] as NormalizedElements; }
    if (target === null || target === undefined) { return [] as unknown as NormalizedElements; }
    if (Array.isArray(target)) { return target as NormalizedElements; }
    return Array.from(target) as NormalizedElements;
};

const makeEventHandler = (selector: string, callback: EventCallback): (event: Event) => void => {
    return function(event: Event): void {
        const dispatcher = event.currentTarget;
        if (
            dispatcher instanceof HTMLElement === false ||
            typeof dispatcher.querySelectorAll !== 'function'
        ) {
            return;
        }
        const receiver = event.target as Element | null;
        const ancestor = receiver?.closest(selector);
        if (
            ancestor === receiver &&
            ancestor !== dispatcher &&
            dispatcher.contains(ancestor)
        ) {
            callback.call(receiver as Element, event);
        }
    };
};

/******************************************************************************/

class dom {
    static cl: {
        new(): { procelem: Element; selectFilter: string }
        add(target: Target, name: string): void
        remove(target: Target, ...names: string[]): void
        toggle(target: Target, name: string, state?: boolean): boolean | undefined
        has(target: Target, name: string): boolean
    } = null as any
    static root: Element | null = null
    static html: HTMLElement = null as any
    static head: HTMLHeadElement = null as any
    static body: HTMLBodyElement = null as any

    static attr(target: Target, attr: string, value?: string | null): string | null | undefined {
        for (const elem of normalizeTarget(target)) {
            if (value === undefined) {
                return elem.getAttribute(attr);
            }
            if (value === null) {
                elem.removeAttribute(attr);
            } else {
                elem.setAttribute(attr, value);
            }
        }
        return undefined;
    }

    static clear(target: Target): void {
        for (const elem of normalizeTarget(target)) {
            while (elem.firstChild !== null) {
                elem.removeChild(elem.firstChild);
            }
        }
    }

    static clone(target: Target): Node | null {
        const elements = normalizeTarget(target);
        if (elements.length === 0) { return null; }
        return elements[0].cloneNode(true);
    }

    static create(a: string): HTMLElement | undefined {
        if (typeof a === 'string') {
            return document.createElement(a);
        }
        return undefined;
    }

    static prop<T>(target: Target, prop: string, value?: T): T | undefined {
        for (const elem of normalizeTarget(target)) {
            if (value === undefined) { return (elem as unknown as Record<string, T>)[prop] as T; }
            (elem as unknown as Record<string, T>)[prop] = value;
        }
        return undefined;
    }

    static text(target: Target, text?: string): string | undefined {
        const targets = normalizeTarget(target);
        if (text === undefined) {
            return targets.length !== 0 ? targets[0].textContent ?? undefined : undefined;
        }
        for (const elem of targets) {
            elem.textContent = text;
        }
        return undefined;
    }

    static remove(target: Target): void {
        for (const elem of normalizeTarget(target)) {
            elem.remove();
        }
    }

    static empty(target: Target): void {
        for (const elem of normalizeTarget(target)) {
            while (elem.firstElementChild !== null) {
                elem.firstElementChild.remove();
            }
        }
    }

    // target, type, callback, [options]
    // target, type, subtarget, callback, [options]

    static on(
        target: Target,
        type: string,
        subtarget: string | EventCallback,
        callback?: EventCallback,
        options?: boolean | AddEventListenerOptions
    ): void {
        let actualCallback: EventListener;
        let actualOptions: boolean | AddEventListenerOptions;

        if (typeof subtarget === 'function') {
            actualOptions = options as boolean | AddEventListenerOptions | undefined;
            actualCallback = subtarget;
            subtarget = '';
            if (typeof actualOptions === 'boolean') {
                actualOptions = { capture: actualOptions };
            }
        } else {
            actualCallback = makeEventHandler(subtarget as string, callback as EventCallback);
            actualOptions = options as boolean | AddEventListenerOptions | undefined;
            if (actualOptions === undefined || typeof actualOptions === 'boolean') {
                actualOptions = { capture: true };
            } else {
                actualOptions.capture = true;
            }
        }
        const targets = target instanceof Window || target instanceof Document
            ? [target]
            : normalizeTarget(target);
        for (const elem of targets) {
            elem.addEventListener(type, actualCallback, actualOptions);
        }
    }

    static off(
        target: Target,
        type: string,
        callback: EventCallback,
        options?: boolean | EventListenerOptions
    ): void {
        if (typeof callback !== 'function') { return; }
        let actualOptions: boolean | EventListenerOptions;
        if (typeof options === 'boolean') {
            actualOptions = { capture: true };
        } else {
            actualOptions = options as boolean | EventListenerOptions | undefined;
        }
        const targets = target instanceof Window || target instanceof Document
            ? [target]
            : normalizeTarget(target);
        for (const elem of targets) {
            elem.removeEventListener(type, callback, actualOptions);
        }
    }

    static onFirstShown(fn: () => void, elem: Element): void {
        let observer: IntersectionObserver | undefined = new IntersectionObserver(entries => {
            if (entries.every(a => a.isIntersecting === false)) { return; }
            try { fn(); } catch (e) { console.warn('[uBR] dom: onFirstShown callback failed', e); }
            observer?.disconnect();
            observer = undefined;
        });
        observer.observe(elem);
    }
}

(dom as any).cl = class DomCl {
    static add(target: Target, name: string): void {
        for (const elem of normalizeTarget(target)) {
            elem.classList.add(name);
        }
    }

    static remove(target: Target, ...names: string[]): void {
        for (const elem of normalizeTarget(target)) {
            elem.classList.remove(...names);
        }
    }

    static toggle(target: Target, name: string, state?: boolean): boolean | undefined {
        let r: boolean | undefined;
        for (const elem of normalizeTarget(target)) {
            r = elem.classList.toggle(name, state);
        }
        return r;
    }

    static has(target: Target, name: string): boolean {
        for (const elem of normalizeTarget(target)) {
            if (elem.classList.contains(name)) {
                return true;
            }
        }
        return false;
    }
};

/******************************************************************************/

function qs$(a: string): Element | null;
function qs$<T extends Element = Element>(a: Element, b: string): T | null;
function qs$(a: string | Element, b?: string): Element | null {
    if (typeof a === 'string') {
        return document.querySelector(a);
    }
    if (a === null) { return null; }
    return a.querySelector(b ?? '') as Element | null;
}

function qsa$(a: string): NodeListOf<Element>;
function qsa$<T extends Element = Element>(a: Element, b: string): NodeListOf<T>;
function qsa$(a: string | Element, b?: string): NodeListOf<Element> {
    if (typeof a === 'string') {
        return document.querySelectorAll(a);
    }
    if (a === null) { return [] as unknown as NodeListOf<Element>; }
    return a.querySelectorAll(b ?? '') as NodeListOf<Element>;
}

(dom as any).root = qs$(':root');
(dom as any).html = document.documentElement;
(dom as any).head = document.head;
(dom as any).body = document.body;

/******************************************************************************/

export { dom, qs$, qsa$ };
