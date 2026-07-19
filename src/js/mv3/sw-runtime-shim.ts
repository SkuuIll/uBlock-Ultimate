/*******************************************************************************

    uBlock Origin - MV3 Service Worker Runtime Shim
    Provides the minimum browser/DOM globals expected by legacy modules
    before they execute inside a service worker.

*******************************************************************************/

const noop = () => {};
const nullFn = () => null;

if ( typeof (globalThis as any).window === 'undefined' ) {
    (globalThis as any).window = globalThis;
}

(globalThis as any).vAPI ??= {};
const vAPI: any = (globalThis as any).vAPI;
if ( typeof (globalThis as any).window.vAPI === 'undefined' ) {
    (globalThis as any).window.vAPI = vAPI;
}

if ( typeof vAPI.T0 !== 'number' ) {
    vAPI.T0 = Date.now();
}
if ( typeof vAPI.sessionId !== 'string' ) {
    vAPI.sessionId = 'mv3-sw';
}
if ( typeof vAPI.getURL !== 'function' ) {
    vAPI.getURL = (path = '') => chrome.runtime.getURL(path);
}
if ( typeof vAPI.setTimeout !== 'function' ) {
    vAPI.setTimeout = globalThis.setTimeout.bind(globalThis);
}
if ( typeof vAPI.clearTimeout !== 'function' ) {
    vAPI.clearTimeout = globalThis.clearTimeout.bind(globalThis);
}
if ( typeof vAPI.localStorage !== 'object' || vAPI.localStorage === null ) {
    const storageMap = new Map<string, string>();
    vAPI.localStorage = {
        getItem(key: string) {
            return storageMap.has(key) ? storageMap.get(key) ?? null : null;
        },
        setItem(key: string, value: string) {
            storageMap.set(key, `${value}`);
        },
        removeItem(key: string) {
            storageMap.delete(key);
        },
        clear() {
            storageMap.clear();
        },
    };
}
if (
    typeof vAPI.webextFlavor !== 'object' ||
    vAPI.webextFlavor === null ||
    typeof vAPI.webextFlavor.soup?.has !== 'function'
) {
    vAPI.webextFlavor = {
        major: 120,
        env: [],
        soup: new Set([ 'chromium', 'mv3', 'ublock' ]),
    };
} else {
    vAPI.webextFlavor.major ??= 120;
    vAPI.webextFlavor.env ??= [];
    if ( typeof vAPI.webextFlavor.soup?.add === 'function' ) {
        vAPI.webextFlavor.soup.add('chromium');
        vAPI.webextFlavor.soup.add('mv3');
        vAPI.webextFlavor.soup.add('ublock');
    }
}

if ( typeof (globalThis as any).screen === 'undefined' ) {
    (globalThis as any).screen = { width: 1280, height: 720 };
}
if ( typeof (globalThis as any).window.screen === 'undefined' ) {
    (globalThis as any).window.screen = (globalThis as any).screen;
}
if ( typeof (globalThis as any).Element === 'undefined' ) {
    (globalThis as any).Element = class {};
}
if ( typeof (globalThis as any).HTMLElement === 'undefined' ) {
    (globalThis as any).HTMLElement = (globalThis as any).Element;
}
if ( typeof (globalThis as any).Node === 'undefined' ) {
    (globalThis as any).Node = (globalThis as any).Element;
}
if ( typeof (globalThis as any).DocumentFragment === 'undefined' ) {
    (globalThis as any).DocumentFragment = class {};
}
if ( typeof (globalThis as any).requestAnimationFrame !== 'function' ) {
    (globalThis as any).requestAnimationFrame = (callback: FrameRequestCallback) =>
        globalThis.setTimeout(() => callback(Date.now()), 16);
}
if ( typeof (globalThis as any).cancelAnimationFrame !== 'function' ) {
    (globalThis as any).cancelAnimationFrame = (handle: number) => {
        globalThis.clearTimeout(handle);
    };
}
if ( typeof (globalThis as any).requestIdleCallback !== 'function' ) {
    (globalThis as any).requestIdleCallback = (callback: IdleRequestCallback) => {
        return globalThis.setTimeout(() => {
            callback({
                didTimeout: false,
                timeRemaining: () => 50,
            } as IdleDeadline);
        }, 1);
    };
}
if ( typeof (globalThis as any).cancelIdleCallback !== 'function' ) {
    (globalThis as any).cancelIdleCallback = (handle: number) => {
        globalThis.clearTimeout(handle);
    };
}
if ( typeof vAPI.defer !== 'object' || vAPI.defer === null ) {
    vAPI.defer = {
        normalizeDelay(delay: number | { sec?: number; min?: number } = 0) {
            if ( typeof delay === 'number' ) { return delay; }
            if ( typeof delay?.min === 'number' ) { return delay.min * 60000; }
            if ( typeof delay?.sec === 'number' ) { return delay.sec * 1000; }
            return 0;
        },
        create(callback: (..._args: any[]) => void) {
            return new (this as any).Client(callback);
        },
        once(delay: number | { sec?: number; min?: number }, ...args: any[]) {
            const delayInMs = (this as any).normalizeDelay(delay);
            return new Promise(resolve => {
                globalThis.setTimeout(() => resolve(args[0]), delayInMs, ...args);
            });
        },
        Client: class {
            timer: any = null;
            type = 0;
            callback: (..._args: any[]) => void;
            constructor(callback: (..._args: any[]) => void) {
                this.callback = callback;
            }
            on(delay: number | { sec?: number; min?: number }, ...args: any[]) {
                if ( this.timer !== null ) { return; }
                const delayInMs = (vAPI.defer as any).normalizeDelay(delay);
                this.type = 0;
                this.timer = globalThis.setTimeout(() => {
                    this.timer = null;
                    this.callback(...args);
                }, delayInMs || 1);
            }
            offon(delay: number | { sec?: number; min?: number }, ...args: any[]) {
                this.off();
                this.on(delay, ...args);
            }
            onvsync(delay: number | { sec?: number; min?: number }, ...args: any[]) {
                const delayInMs = (vAPI.defer as any).normalizeDelay(delay);
                if ( delayInMs !== 0 ) {
                    this.on(delayInMs, ...args);
                    return;
                }
                this.onraf(...args);
            }
            onidle(delay: number | { sec?: number; min?: number }, options?: IdleRequestOptions, ...args: any[]) {
                const delayInMs = (vAPI.defer as any).normalizeDelay(delay);
                if ( delayInMs !== 0 ) {
                    this.type = 0;
                    this.timer = globalThis.setTimeout(() => {
                        this.timer = null;
                        this.onric(options, ...args);
                    }, delayInMs);
                    return;
                }
                this.onric(options, ...args);
            }
            onraf(...args: any[]) {
                if ( this.timer !== null ) { return; }
                this.type = 1;
                this.timer = (globalThis as any).requestAnimationFrame(() => {
                    this.timer = null;
                    this.callback(...args);
                });
            }
            onric(options?: IdleRequestOptions, ...args: any[]) {
                if ( this.timer !== null ) { return; }
                this.type = 2;
                this.timer = (globalThis as any).requestIdleCallback(() => {
                    this.timer = null;
                    this.callback(...args);
                }, options);
            }
            off() {
                if ( this.timer === null ) { return; }
                if ( this.type === 1 ) {
                    (globalThis as any).cancelAnimationFrame(this.timer);
                } else if ( this.type === 2 ) {
                    (globalThis as any).cancelIdleCallback(this.timer);
                } else {
                    globalThis.clearTimeout(this.timer);
                }
                this.timer = null;
            }
        },
    };
}

const createElementLike = () => ({
    style: {},
    childNodes: [],
    firstChild: null,
    textContent: '',
    setAttribute: noop,
    getAttribute: () => null,
    removeAttribute: noop,
    addEventListener: noop,
    removeEventListener: noop,
    appendChild: noop,
    removeChild: noop,
    cloneNode: () => createElementLike(),
    querySelector: nullFn,
    querySelectorAll: () => [],
    closest: nullFn,
    contains: () => false,
    remove: noop,
    classList: {
        add: noop,
        remove: noop,
        contains: () => false,
    },
});

const createCanvasElement = () => {
    const canvas = createElementLike() as Record<string, any>;
    canvas.width = 0;
    canvas.height = 0;
    canvas.getContext = (type?: string) => {
        if ( type !== '2d' ) { return null; }
        return {
            canvas,
            clearRect: noop,
            drawImage: noop,
            getImageData: (_x: number, _y: number, w = 1, h = 1) => ({
                data: new Uint8ClampedArray(Math.max(4, w * h * 4)),
                width: w,
                height: h,
            }),
        };
    };
    return canvas;
};

if ( typeof (globalThis as any).document === 'undefined' ) {
    const documentElement = createElementLike();
    const head = createElementLike();
    const body = createElementLike();
    (globalThis as any).document = {
        body,
        head,
        documentElement,
        title: '',
        hidden: true,
        visibilityState: 'hidden',
        readyState: 'complete',
        addEventListener: noop,
        removeEventListener: noop,
        dispatchEvent: noop,
        createDocumentFragment: () => createElementLike(),
        createElement: (tagName?: string) =>
            tagName === 'canvas' ? createCanvasElement() : createElementLike(),
        querySelector: nullFn,
        querySelectorAll: () => [],
        getElementById: nullFn,
    };
}
if ( typeof (globalThis as any).window.document === 'undefined' ) {
    (globalThis as any).window.document = (globalThis as any).document;
}

if ( typeof (globalThis as any).Image === 'undefined' ) {
    (globalThis as any).Image = class {
        onload: null | (() => void) = null;
        onerror: null | (() => void) = null;
        width = 0;
        height = 0;
        complete = false;
        private listeners = new Map<string, Set<() => void>>();
        addEventListener(type: string, listener: () => void) {
            const bucket = this.listeners.get(type) || new Set<() => void>();
            bucket.add(listener);
            this.listeners.set(type, bucket);
        }
        removeEventListener(type: string, listener: () => void) {
            this.listeners.get(type)?.delete(listener);
        }
        set src(_value: string) {
            this.complete = true;
            queueMicrotask(() => {
                if ( typeof this.onload === 'function' ) {
                    this.onload();
                }
                for ( const listener of this.listeners.get('load') || [] ) {
                    listener();
                }
            });
        }
    };
}

export {}
