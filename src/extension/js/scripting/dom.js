/*******************************************************************************

    uBlock Ultimate - DOM utilities for zapper UI
    Based on uBlock Origin code

*******************************************************************************/

/******************************************************************************/

const normalizeTarget = target => {
    if ( typeof target === 'string' ) { return Array.from(qsa$(target)); }
    if ( target instanceof Element ) { return [ target ]; }
    if ( target === null ) { return []; }
    if ( Array.isArray(target) ) { return target; }
    return Array.from(target);
};

const makeEventHandler = (selector, callback) => {
    return function(event) {
        const dispatcher = event.currentTarget;
        if (
            dispatcher instanceof HTMLElement === false ||
            typeof dispatcher.querySelectorAll !== 'function'
        ) {
            return;
        }
        const receiver = event.target;
        const ancestor = receiver.closest(selector);
        if (
            ancestor === receiver &&
            ancestor !== dispatcher &&
            dispatcher.contains(ancestor)
        ) {
            callback.call(receiver, event);
        }
    };
};

/******************************************************************************/

class dom {
    static attr(target, attr, value = undefined) {
        for ( const elem of normalizeTarget(target) ) {
            if ( value === undefined ) {
                return elem.getAttribute(attr);
            }
            if ( value === null ) {
                elem.removeAttribute(attr);
            } else {
                elem.setAttribute(attr, value);
            }
        }
    }

    static clear(target) {
        for ( const elem of normalizeTarget(target) ) {
            while ( elem.firstChild !== null ) {
                elem.removeChild(elem.firstChild);
            }
        }
    }

    static clone(target) {
        const elements = normalizeTarget(target);
        if ( elements.length === 0 ) { return null; }
        return elements[0].cloneNode(true);
    }

    static create(a) {
        if ( typeof a === 'string' ) {
            return document.createElement(a);
        }
    }

    static prop(target, prop, value = undefined) {
        for ( const elem of normalizeTarget(target) ) {
            if ( value === undefined ) { return elem[prop]; }
            elem[prop] = value;
        }
    }

    static text(target, text) {
        const targets = normalizeTarget(target);
        if ( text === undefined ) {
            return targets.length !== 0 ? targets[0].textContent : undefined;
        }
        for ( const elem of targets ) {
            elem.textContent = text;
        }
    }

    static remove(target) {
        for ( const elem of normalizeTarget(target) ) {
            elem.remove();
        }
    }

    static empty(target) {
        for ( const elem of normalizeTarget(target) ) {
            while ( elem.firstElementChild !== null ) {
                elem.firstElementChild.remove();
            }
        }
    }

    static on(target, type, subtarget, callback, options) {
        if ( typeof subtarget === 'function' ) {
            options = callback;
            callback = subtarget;
            subtarget = undefined;
            if ( typeof options === 'boolean' ) {
                options = { capture: true };
            }
        } else {
            callback = makeEventHandler(subtarget, callback);
            if ( options === undefined || typeof options === 'boolean' ) {
                options = { capture: true };
            } else {
                options.capture = true;
            }
        }
        const targets = target instanceof Window || target instanceof Document
            ? [ target ]
            : normalizeTarget(target);
        for ( const elem of targets ) {
            elem.addEventListener(type, callback, options);
        }
    }

    static off(target, type, callback, options) {
        if ( typeof callback !== 'function' ) { return; }
        if ( typeof options === 'boolean' ) {
            options = { capture: true };
        }
        const targets = target instanceof Window || target instanceof Document
            ? [ target ]
            : normalizeTarget(target);
        for ( const elem of targets ) {
            elem.removeEventListener(type, callback, options);
        }
    }

    static onFirstShown(fn, elem) {
        let observer = new IntersectionObserver(entries => {
            if ( entries.every(a => a.isIntersecting === false) ) { return; }
            try { fn(); } catch (e) { console.warn('[uBlock Ultimate] dom: onFirstShown callback failed', e); }
            observer.disconnect();
            observer = undefined;
        });
        observer.observe(elem);
    }
}

dom.cl = class {
    static add(target, name) {
        for ( const elem of normalizeTarget(target) ) {
            elem.classList.add(name);
        }
    }

    static remove(target, ...names) {
        for ( const elem of normalizeTarget(target) ) {
            elem.classList.remove(...names);
        }
    }

    static toggle(target, name, state) {
        let r;
        for ( const elem of normalizeTarget(target) ) {
            r = elem.classList.toggle(name, state);
        }
        return r;
    }

    static has(target, name) {
        for ( const elem of normalizeTarget(target) ) {
            if ( elem.classList.contains(name) ) {
                return true;
            }
        }
        return false;
    }
};

/******************************************************************************/

function qs$(a, b) {
    if ( typeof a === 'string') {
        return document.querySelector(a);
    }
    if ( a === null ) { return null; }
    return a.querySelector(b);
}

function qsa$(a, b) {
    if ( typeof a === 'string') {
        return document.querySelectorAll(a);
    }
    if ( a === null ) { return []; }
    return a.querySelectorAll(b);
}

dom.root = qs$(':root');
dom.html = document.documentElement;
dom.head = document.head;
dom.body = document.body;

/******************************************************************************/

export { dom, qs$, qsa$ };
