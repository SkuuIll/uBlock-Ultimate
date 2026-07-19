/*******************************************************************************

    uBlock Ultimate - Tool Overlay Content Script
    Creates the zapper UI iframe and handles DOM manipulation

    This script runs in the page context via scripting.executeScript

    Architecture:
    - tool-overlay.js: Content script (page context) - handles DOM
    - tool-overlay-ui.js: UI logic (iframe context) - handles events
    - zapper.js: Zapper-specific logic (page context)

    Communication: MessageChannel via ubolOverlay.port

*******************************************************************************/

(function() {
    

    if ( self.ubolOverlay ) {
        self.ubolOverlay.stop();
    }

    const secretAttr = (function() {
        let secret = String.fromCharCode((Math.random() * 26) + 97);
        do {
            secret += Math.floor(Math.random() * 0xFFFFFFFF).toString(36);
        } while ( secret.length < 8 );
        return secret;
    })();

    const webext = {
        i18n: {
            getMessage: function(key) {
                if ( typeof chrome !== 'undefined' && chrome.i18n ) {
                    return chrome.i18n.getMessage(key) || key;
                }
                return key;
            }
        },
        runtime: {
            getURL: function(path) {
                if ( typeof chrome !== 'undefined' && chrome.runtime ) {
                    return chrome.runtime.getURL(path);
                }
                return path;
            },
            sendMessage: function(msg) {
                if ( typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage ) {
                    return chrome.runtime.sendMessage(msg).catch((e) => {
                        console.warn('[uBlock Ultimate] tool-overlay: runtime.sendMessage failed', e);
                    });
                }
                return Promise.resolve();
            }
        }
    };

    function parseRegexLiteral(value) {
        const match = /^\/((?:\\.|[^\\/])*)\/([a-z]*)$/.exec(value);
        if ( match === null ) { return null; }
        try {
            return new RegExp(match[1], match[2]);
        } catch {
            return null;
        }
    }

    function uniqueElements(elements) {
        const seen = new Set();
        const out = [];
        for ( const elem of elements ) {
            if ( elem instanceof Element === false || seen.has(elem) ) { continue; }
            seen.add(elem);
            out.push(elem);
        }
        return out;
    }

    const proceduralOperatorNames = [
        'has-text',
        'upward',
        'has',
    ];

    function findProceduralArgumentEnd(value, start) {
        let depth = 1;
        let quote = '';
        let inRegex = false;
        let escaped = false;

        for ( let i = start; i < value.length; i++ ) {
            const ch = value[i];
            if ( escaped ) {
                escaped = false;
                continue;
            }
            if ( ch === '\\' ) {
                escaped = true;
                continue;
            }
            if ( quote !== '' ) {
                if ( ch === quote ) { quote = ''; }
                continue;
            }
            if ( inRegex ) {
                if ( ch === '/' ) { inRegex = false; }
                continue;
            }
            if ( ch === '"' || ch === "'" ) {
                quote = ch;
                continue;
            }
            if ( ch === '/' ) {
                inRegex = true;
                continue;
            }
            if ( ch === '(' ) {
                depth += 1;
            } else if ( ch === ')' ) {
                depth -= 1;
                if ( depth === 0 ) { return i; }
            }
        }
        return -1;
    }

    function proceduralOperatorAt(value, offset) {
        if ( value[offset] !== ':' ) { return ''; }
        for ( const name of proceduralOperatorNames ) {
            if ( value.startsWith(`${name}(`, offset + 1) ) {
                return name;
            }
        }
        return '';
    }

    function parseProceduralSelector(selector) {
        let base = '';
        const tasks = [];
        for ( let i = 0; i < selector.length; i++ ) {
            const operator = proceduralOperatorAt(selector, i);
            if ( operator === '' ) {
                base += selector[i];
                continue;
            }
            const argStart = i + operator.length + 2;
            const argEnd = findProceduralArgumentEnd(selector, argStart);
            if ( argEnd === -1 ) { return null; }
            const arg = selector.slice(argStart, argEnd).trim();
            if ( operator === 'has-text' ) {
                const regex = parseRegexLiteral(arg);
                if ( regex !== null ) {
                    tasks.push({ type: 'has-text', regex });
                }
            } else if ( operator === 'upward' ) {
                tasks.push(/^\d+$/.test(arg)
                    ? { type: 'upward', depth: parseInt(arg, 10) }
                    : { type: 'upward', selector: arg });
            } else if ( operator === 'has' ) {
                tasks.push({ type: 'has', selector: arg });
            }
            i = argEnd;
        }
        return tasks.length === 0 ? null : { base: base.trim(), tasks };
    }

    function proceduralQsa(root, selector) {
        const parsed = parseProceduralSelector(selector);
        if ( parsed === null ) { return null; }

        let elements = [];
        try {
            elements = parsed.base === ''
                ? [ root instanceof Element ? root : document.documentElement ]
                : Array.from(root.querySelectorAll(parsed.base));
        } catch {
            return [];
        }

        for ( const task of parsed.tasks ) {
            if ( task.type === 'has-text' ) {
                elements = elements.filter(elem => task.regex.test(elem.textContent || ''));
            } else if ( task.type === 'has' ) {
                elements = elements.filter(elem => {
                    const nested = proceduralQsa(elem, task.selector);
                    if ( nested !== null ) { return nested.length !== 0; }
                    try {
                        return elem.querySelector(task.selector) !== null;
                    } catch {
                        return false;
                    }
                });
            } else if ( task.type === 'upward' ) {
                const upward = [];
                for ( const elem of elements ) {
                    let current = elem;
                    if ( typeof task.selector === 'string' && task.selector !== '' ) {
                        current = current.parentElement;
                        current = current !== null ? current.closest(task.selector) : null;
                    } else {
                        for ( let i = 0; i < task.depth && current !== null; i++ ) {
                            current = current.parentElement;
                        }
                    }
                    if ( current instanceof Element ) {
                        upward.push(current);
                    }
                }
                elements = uniqueElements(upward);
            }
        }
        return elements;
    }

    self.ubolOverlay = {
        secretAttr: secretAttr,
        url: new URL(document.baseURI),
        file: null,
        port: null,
        frame: null,
        onmessage: null,
        keydownHandler: null,
        highlightedElements: [],
        qsaError: undefined,
        lastX: undefined,
        lastY: undefined,
        messageId: 1,
        pendingMessages: new Map(),
        scrollLocked: false,
        overlayDialog: null,
        overlayIntegrityObserver: null,

        applyOverlayFrameStyle: function(frame) {
            frame.setAttribute('data-ubol-overlay', '');
            frame.setAttribute('data-ubr-extension-ui', 'picker');
            frame.setAttribute('aria-hidden', 'true');
            frame.style.setProperty('position', 'fixed', 'important');
            frame.style.setProperty('top', '0', 'important');
            frame.style.setProperty('left', '0', 'important');
            frame.style.setProperty('width', '100vw', 'important');
            frame.style.setProperty('height', '100vh', 'important');
            frame.style.setProperty('border', 'none', 'important');
            frame.style.setProperty('z-index', '2147483647', 'important');
            frame.style.setProperty('background', 'transparent', 'important');
            frame.style.setProperty('pointer-events', 'auto', 'important');
            frame.style.setProperty('display', 'block', 'important');
        },

        applyOverlayHostStyle: function(host) {
            host.setAttribute('data-ubol-overlay-dialog', '');
            host.setAttribute('data-ubr-extension-ui', 'picker-dialog');
            host.style.setProperty('position', 'fixed', 'important');
            host.style.setProperty('inset', '0', 'important');
            host.style.setProperty('width', '100vw', 'important');
            host.style.setProperty('height', '100vh', 'important');
            host.style.setProperty('max-width', '100vw', 'important');
            host.style.setProperty('max-height', '100vh', 'important');
            host.style.setProperty('padding', '0', 'important');
            host.style.setProperty('margin', '0', 'important');
            host.style.setProperty('border', 'none', 'important');
            host.style.setProperty('background', 'transparent', 'important');
            host.style.setProperty('z-index', '2147483647', 'important');
            host.style.setProperty('pointer-events', 'auto', 'important');
            host.style.setProperty('overflow', 'hidden', 'important');
        },

        createTopLayerHost: function(frame) {
            const canPopover = typeof HTMLElement !== 'undefined' &&
                typeof HTMLElement.prototype.showPopover === 'function';
            const host = document.createElement(canPopover ? 'div' : 'dialog');

            this.applyOverlayHostStyle(host);
            if ( canPopover ) {
                host.setAttribute('popover', 'manual');
            }

            host.appendChild(frame);
            document.documentElement.appendChild(host);

            try {
                if ( canPopover ) {
                    host.showPopover();
                } else if ( typeof host.show === 'function' ) {
                    host.show();
                } else {
                    host.remove();
                    return null;
                }
            } catch {
                host.remove();
                return null;
            }

            return host;
        },

        startOverlayIntegrityWatch: function() {
            if ( this.overlayIntegrityObserver ) { return; }

            this.overlayIntegrityObserver = new MutationObserver(() => {
                if ( !this.frame ) { return; }

                this.applyOverlayFrameStyle(this.frame);

                if ( this.frame.isConnected === false ) {
                    document.documentElement.appendChild(this.frame);
                }
            });

            this.overlayIntegrityObserver.observe(document.documentElement, {
                childList: true,
                subtree: true,
                attributes: true,
                attributeFilter: ['style', 'class', 'hidden']
            });
        },

        stopOverlayIntegrityWatch: function() {
            if ( this.overlayIntegrityObserver ) {
                this.overlayIntegrityObserver.disconnect();
                this.overlayIntegrityObserver = null;
            }
        },

        start: function() {
            this.injectCSS();
            this.startOverlayIntegrityWatch();
            if ( this.keydownHandler === null ) {
                this.keydownHandler = this.onKeyPressed.bind(this);
            }
            document.addEventListener('keydown', this.keydownHandler, true);
            window.addEventListener('scroll', this.onViewportChanged, { passive: true });
            window.addEventListener('resize', this.onViewportChanged, { passive: true });

        },

        injectCSS: function() {
            const css = [
                'html {',
                'scrollbar-gutter:stable!important;',
                '}',
                '[data-ubol-overlay] {',
                'position:fixed!important;',
                'top:0!important;',
                'left:0!important;',
                'width:100%!important;',
                'height:100%!important;',
                'border:none!important;',
                'z-index:2147483647!important;',
                'background:transparent!important;',
                'pointer-events:auto!important;',
                '}',
                '[data-ubol-overlay-click] {',
                'pointer-events:none!important;',
                '}',
                '[data-ubol-overlay-dialog][data-ubol-overlay-click] {',
                'pointer-events:none!important;',
                '}'
            ].join('');
            
            if ( document.head ) {
                let style = document.getElementById('ubol-zapper-css');
                if ( !style ) {
                    style = document.createElement('style');
                    style.id = 'ubol-zapper-css';
                    document.head.appendChild(style);
                }
                style.textContent = css;
            }
        },

        removeCSS: function() {
            const style = document.getElementById('ubol-zapper-css');
            if ( style ) {
                style.remove();
            }
        },

        stop: function() {
            this.stopOverlayIntegrityWatch();
            if ( this.keydownHandler !== null ) {
                document.removeEventListener('keydown', this.keydownHandler, true);
            }
            window.removeEventListener('scroll', this.onViewportChanged, { passive: true });
            window.removeEventListener('resize', this.onViewportChanged, { passive: true });
            if ( this.scrollLocked ) {
                document.documentElement.style.overflow = '';
                document.body.style.overflow = '';
                this.scrollLocked = false;
            }
            if ( this.overlayDialog ) {
                try {
                    if (
                        typeof this.overlayDialog.hidePopover === 'function' &&
                        this.overlayDialog.matches(':popover-open')
                    ) {
                        this.overlayDialog.hidePopover();
                    } else if ( typeof this.overlayDialog.close === 'function' ) {
                        this.overlayDialog.close();
                    }
                } catch {}
                this.overlayDialog.remove();
                this.overlayDialog = null;
            }
            if ( this.frame ) {
                this.frame.onload = null;
                this.frame.remove();
                this.frame = null;
            }
            if ( this._preloadedIFrame ) {
                this._preloadedIFrame.remove();
                this._preloadedIFrame = null;
            }
            if ( this.port ) {
                this.port.onmessage = null;
                this.port.onmessageerror = null;
                this.port.close();
                this.port = null;
            }
            this.pendingMessages.clear();
            this.onmessage = null;
            this.removeCSS();
        },

        onViewportChanged: function() {
            if ( self.ubolOverlay ) {
                self.ubolOverlay.highlightUpdate();
            }
        },

        onKeyPressed: function(ev) {
            if ( ev.key !== 'Escape' && ev.which !== 27 ) { return; }
            ev.stopPropagation();
            ev.preventDefault();
            if ( self.ubolOverlay && self.ubolOverlay.onmessage ) {
                self.ubolOverlay.onmessage({ what: 'quitTool' });
            }
        },

        sendMessage: function(msg) {
            return webext.runtime.sendMessage(msg).catch((e) => {
                console.warn('[uBlock Ultimate] tool-overlay: webext.runtime.sendMessage failed', e);
            });
        },

        postMessage: function(msg) {
            if ( this.port === null ) { return Promise.resolve(); }
            const wrapped = {
                fromScriptId: this.messageId++,
                msg: msg
            };
            const selfRef = this;
            return new Promise((resolve) => {
                selfRef.pendingMessages.set(wrapped.fromScriptId, resolve);
                selfRef.port.postMessage(wrapped);
            });
        },

        onMessage: function(wrapped) {
            if ( typeof wrapped?.fromScriptId === 'number' ) {
                const resolve = this.pendingMessages.get(wrapped.fromScriptId);
                if ( resolve ) {
                    this.pendingMessages.delete(wrapped.fromScriptId);
                    resolve(wrapped.msg);
                }
                return;
            }

            const msg = wrapped.msg || wrapped;
            let response;

            switch ( msg.what ) {
            case 'startTool':
                this.start();
                break;
            case 'lockScroll':
                if ( this.scrollLocked === false ) {
                    document.documentElement.style.overflow = 'hidden';
                    document.body.style.overflow = 'hidden';
                    this.scrollLocked = true;
                }
                break;
            case 'unlockScroll':
                if ( this.scrollLocked ) {
                    document.documentElement.style.overflow = '';
                    document.body.style.overflow = '';
                    this.scrollLocked = false;
                }
                break;
            case 'quitTool':
                this.stop();
                break;
            case 'highlightElementAtPoint':
                this.highlightElementAtPoint(msg.mx, msg.my);
                break;
            case 'highlightFromSelector':
                var details = this.elementsFromSelector(msg.selector);
                this.highlightElements(details.elems);
                if ( msg.scrollTo && details.elems.length !== 0 ) {
                    details.elems[0].scrollIntoView({ block: 'nearest', inline: 'nearest' });
                }
                response = {
                    count: details.elems.length,
                    error: details.error || null
                };
                break;
            case 'unhighlight':
                this.unhighlight();
                break;
            default:
                break;
            }

            if ( this.onmessage ) {
                response = this.onmessage(msg) || response;
            }

            if ( wrapped?.fromFrameId && this.port ) {
                const fromFrameId = wrapped.fromFrameId;
                if ( response instanceof Promise ) {
                    response.then((resolved) => {
                        if ( self.ubolOverlay === null || self.ubolOverlay?.port === null ) { return; }
                        self.ubolOverlay.port.postMessage({ fromFrameId: fromFrameId, msg: resolved });
                    });
                } else {
                    this.port.postMessage({ fromFrameId: fromFrameId, msg: response });
                }
            }
        },

        isExtensionOwnedElement: function(elem) {
            if ( !(elem instanceof Element) ) { return false; }

            if ( elem === this.frame || elem === this.overlayDialog ) { return true; }
            if ( elem.hasAttribute('data-ubol-overlay') ) { return true; }
            if ( elem.hasAttribute('data-ubol-overlay-dialog') ) { return true; }
            if ( elem.hasAttribute('data-ubr-extension-ui') ) { return true; }

            const src = elem.getAttribute('src') || '';
            if (
                src.startsWith('chrome-extension://') &&
                (
                    src.includes('/picker-ui.html') ||
                    src.includes('/zapper-ui.html')
                )
            ) {
                return true;
            }

            return false;
        },

        elementFromPoint: function(x, y) {
            if ( this.frame === null ) { return null; }
            if ( x !== undefined ) {
                this.lastX = x;
                this.lastY = y;
            } else if ( this.lastX !== undefined ) {
                x = this.lastX;
                y = this.lastY;
            } else {
                return null;
            }

            const magicAttr = 'data-ubol-overlay-click';
            this.frame.setAttribute(magicAttr, '');
            if ( this.overlayDialog ) {
                this.overlayDialog.setAttribute(magicAttr, '');
            }

            let elem = null;
            const stack = typeof document.elementsFromPoint === 'function'
                ? document.elementsFromPoint(x, y)
                : [ document.elementFromPoint(x, y) ];

            for ( const candidate of stack ) {
                if ( !(candidate instanceof Element) ) { continue; }
                if ( this.isExtensionOwnedElement(candidate) ) { continue; }
                if ( candidate === document.body || candidate === document.documentElement ) { continue; }
                elem = candidate;
                break;
            }

            this.frame.removeAttribute(magicAttr);
            if ( this.overlayDialog ) {
                this.overlayDialog.removeAttribute(magicAttr);
            }

            return elem;
        },

        getElementRect: function(elem) {
            if ( typeof elem.getBoundingClientRect !== 'function' ) {
                return this._getElementRectFromChildren(elem);
            }
            const rect = elem.getBoundingClientRect();
            if ( rect.width !== 0 && rect.height !== 0 ) {
                return rect;
            }
            if ( elem.shadowRoot instanceof DocumentFragment ) {
                const shadowRect = this._getElementRectFromChildren(elem.shadowRoot);
                if ( shadowRect.width !== 0 || shadowRect.height !== 0 ) {
                    return shadowRect;
                }
            }
            return this._getElementRectFromChildren(elem);
        },

        _getElementRectFromChildren: function(node) {
            let left = Infinity;
            let right = -Infinity;
            let top = Infinity;
            let bottom = -Infinity;
            const children = node.children || [];
            for ( let i = 0; i < children.length; i++ ) {
                const childRect = this.getElementRect(children[i]);
                if ( childRect.width === 0 || childRect.height === 0 ) { continue; }
                if ( childRect.left < left ) { left = childRect.left; }
                if ( childRect.right > right ) { right = childRect.right; }
                if ( childRect.top < top ) { top = childRect.top; }
                if ( childRect.bottom > bottom ) { bottom = childRect.bottom; }
            }
            if ( left === Infinity ) {
                return { left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 };
            }
            return {
                left: left,
                right: right,
                top: top,
                bottom: bottom,
                width: right - left,
                height: bottom - top
            };
        },

        qsa: function(node, selector) {
            if ( node === null ) { return []; }
            if ( selector.startsWith('{') ) { return []; }
            selector = selector.replace(/::[^:]+$/, '');
            const proceduralResult = proceduralQsa(node, selector);
            if ( proceduralResult !== null ) {
                this.qsaError = undefined;
                return proceduralResult;
            }
            try {
                const elems = node.querySelectorAll(selector);
                this.qsaError = undefined;
                return Array.from(elems);
            } catch (reason) {
                this.qsaError = String(reason);
            }
            return [];
        },

        elementsFromSelector: function(selector) {
            return {
                elems: this.qsa(document, selector),
                error: this.qsaError
            };
        },

        highlightElementAtPoint: function(x, y) {
            const elem = this.elementFromPoint(x, y);
            this.highlightElements([ elem ]);
        },

        unhighlight: function() {
            this.highlightElements([]);
        },

        highlightElements: function(elems) {
            if ( !elems ) { elems = []; }
            this.highlightedElements = Array.prototype.slice.call(elems).filter((a) => {
                return a instanceof Element && a !== this.frame;
            });
            this.highlightUpdate();
        },

        highlightUpdate: function() {
            if ( this.port === null ) { return; }

            const ow = window.innerWidth;
            const oh = window.innerHeight;
            const islands = [];

            for ( let i = 0; i < this.highlightedElements.length; i++ ) {
                const elem = this.highlightedElements[i];
                const rect = this.getElementRect(elem);

                if ( rect.left > ow ) { continue; }
                if ( rect.top > oh ) { continue; }
                if ( rect.left + rect.width < 0 ) { continue; }
                if ( rect.top + rect.height < 0 ) { continue; }

                islands.push(
                    `M${  rect.left  } ${  rect.top 
                    }h${  rect.width 
                    }v${  rect.height 
                    }h-${  rect.width  }z`
                );
            }

            this.port.postMessage({
                what: 'svgPaths',
                ocean: `M0 0h${  ow  }v${  oh  }h-${  ow  }z`,
                islands: islands.join('')
            });
        },

        install: function(file, onmessage) {
            const self = this;
            this.file = file;
            this.onmessage = onmessage;

            // Use preloaded iframe for picker when ready
            if ( file === '/picker-ui.html' && self._preloadedIFrame ) {
                const frame = self._preloadedIFrame;
                const setup = function() {
                    if ( self.frame ) { return; }
                    self.applyOverlayFrameStyle(frame);
                    if ( frame.isConnected === false ) {
                        document.documentElement.appendChild(frame);
                    }
                    self.frame = frame;
                    const iframeWindow = frame.contentWindow;
                    if ( !iframeWindow ) { return; }
                    const channel = new MessageChannel();
                    self.port = channel.port1;
                    self.port.onmessage = function(ev) {
                        self.onMessage(ev.data || {});
                    };
                    self.port.onmessageerror = function() {
                        self.onMessage({ what: 'quitTool' });
                    };
                    iframeWindow.postMessage(
                        {
                            what: 'startOverlay',
                            url: document.baseURI,
                            width: window.innerWidth,
                            height: window.innerHeight
                        },
                        '*',
                        [ channel.port2 ]
                    );
                    iframeWindow.focus();
                };
                if ( self._preloadedReady ) {
                    setup();
                    return true;
                }
                frame.addEventListener('load', () => {
                    setup();
                }, { once: true });
                return true;
            }

            const frame = document.createElement('iframe');
            frame.setAttribute('data-ubol-overlay', '');
            frame.onload = function() {
                const iframeWindow = frame.contentWindow;
                if ( !iframeWindow ) { return; }

                const channel = new MessageChannel();
                self.port = channel.port1;

                self.port.onmessage = function(ev) {
                    const data = ev.data || {};
                    self.onMessage(data);
                };

                self.port.onmessageerror = function() {
                    self.onMessage({ what: 'quitTool' });
                };

                iframeWindow.postMessage(
                    {
                        what: 'startOverlay',
                        url: document.baseURI,
                        width: window.innerWidth,
                        height: window.innerHeight
                    },
                    '*',
                    [ channel.port2 ]
                );
                iframeWindow.focus();
            };
            // Set src to load zapper UI - use chrome.runtime.getURL in MV3
            if ( typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL ) {
                frame.src = chrome.runtime.getURL(file);
            } else {
                frame.src = file;
            }
            this.applyOverlayFrameStyle(frame);

            this.overlayDialog = this.createTopLayerHost(frame);
            if ( !this.overlayDialog && frame.isConnected === false ) {
                document.documentElement.appendChild(frame);
            }

            this.frame = frame;

            return true;
        }
    };

    // Pre-create picker iframe for instant activation
    (function(overlay) {
        var frame = document.createElement('iframe');
        frame.setAttribute('data-ubol-overlay', '');
        frame.style.cssText = 'display:none!important;';
        overlay._preloadedReady = false;
        frame.addEventListener('load', () => {
            overlay._preloadedReady = true;
        }, { once: true });
        var url;
        if ( typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL ) {
            url = chrome.runtime.getURL('/picker-ui.html');
        } else {
            url = '/picker-ui.html';
        }
        frame.src = url;
        document.documentElement.appendChild(frame);
        overlay._preloadedIFrame = frame;
    })(self.ubolOverlay);

    self.ubolOverlay.start();

})();
