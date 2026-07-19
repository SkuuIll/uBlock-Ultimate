/*******************************************************************************

    uBlock Ultimate - Tool Overlay UI
    Shared communication bridge for iframe context

    This script runs in the iframe context (isolated from page)

*******************************************************************************/

(function() {
    

    var toolOverlay = {
        url: new URL('about:blank'),
        svgRoot: null,
        svgOcean: null,
        svgIslands: null,
        emptyPath: 'M0 0',
        port: null,
        onmessage: null,
        moveable: null,
        mstrackerOn: false,
        mstrackerX: 0,
        mstrackerY: 0,
        mstrackerTimer: null,
        moverX0: 0,
        moverY0: 0,
        moverX1: 0,
        moverY1: 0,
        moverCX0: 0,
        moverCY0: 0,
        moverTimer: null,
        messageId: 1,
        pendingMessages: new Map(),

        start: function(onmessage) {
            this.onmessage = onmessage;

            window.addEventListener('message', (ev) => {
                const msg = ev.data || {};
                if (msg.what !== 'startOverlay') { return; }
                if (Array.isArray(ev.ports) === false) { return; }
                if (ev.ports.length === 0) { return; }

                this.port = ev.ports[0];
                this.port.onmessage = function(ev) {
                    const data = ev.data || {};
                    this.onMessage(data);
                }.bind(this);

                this.port.onmessageerror = function() {
                    if (this.onmessage) {
                        this.onmessage({ what: 'stopTool' });
                    }
                }.bind(this);

                this.svgRoot = document.getElementById('overlay');
                if (this.svgRoot) {
                    const paths = this.svgRoot.querySelectorAll('path');
                    this.svgOcean = paths[0];
                    this.svgIslands = paths[1];
                }
                this.moveable = document.querySelector('aside');
                if (this.moveable && this.moveable.querySelector('#move')) {
                    this.moveable.querySelector('#move').addEventListener('pointerdown', this.mover.bind(this));
                    this.moveable.querySelector('#move').addEventListener('touchstart', this.eatTouchEvent);
                }
                const aside = document.querySelector('aside');
                if (aside) {
                    aside.addEventListener('mouseenter', () => {
                        if (this.port) { this.port.postMessage({ what: 'lockScroll' }); }
                    });
                    aside.addEventListener('mouseleave', () => {
                        if (this.port) { this.port.postMessage({ what: 'unlockScroll' }); }
                    });
                }

                this.onMessage({
                    what: 'startTool',
                    url: msg.url,
                    width: msg.width,
                    height: msg.height
                });

                document.body.classList.remove('loading');
            }, { once: true });
        },

        onMessage: function(wrapped) {
            if (typeof wrapped.fromFrameId === 'number') {
                const resolve = this.pendingMessages.get(wrapped.fromFrameId);
                if (resolve) {
                    this.pendingMessages.delete(wrapped.fromFrameId);
                    resolve(wrapped.msg);
                }
                return;
            }

            const msg = wrapped.msg || wrapped;
            let response;

            switch (msg.what) {
            case 'startTool':
                this.url.href = msg.url || this.url.href;
                this.svgOcean.setAttribute('d', `M0 0h${  msg.width  }v${  msg.height  }h-${  msg.width  }z`);
                break;
            case 'svgPaths':
                this.svgOcean.setAttribute('d', msg.ocean + msg.islands);
                this.svgIslands.setAttribute('d', msg.islands || this.emptyPath);
                break;
            }

            if (this.onmessage) {
                response = this.onmessage(msg);
            }

            if (wrapped.fromScriptId && this.port) {
                const fromScriptId = wrapped.fromScriptId;
                const self = this;
                if (response instanceof Promise) {
                    response.then((response) => {
                        if (self.port === null) { return; }
                        self.port.postMessage({ fromScriptId: fromScriptId, msg: response });
                    });
                } else {
                    this.port.postMessage({ fromScriptId: fromScriptId, msg: response });
                }
            }
        },

        stop: function() {
            this.highlightElementUnderMouse(false);
            if (this.port) {
                this.port.postMessage({ what: 'quitTool' });
                this.port.onmessage = null;
                this.port.onmessageerror = null;
                this.port = null;
            }
        },

        postMessage: function(msg) {
            if (this.port === null) { return Promise.resolve(); }
            const wrapped = {
                fromFrameId: this.messageId++,
                msg: msg
            };
            const self = this;
            return new Promise((resolve) => {
                self.pendingMessages.set(wrapped.fromFrameId, resolve);
                self.port.postMessage(wrapped);
            });
        },

        sendMessage: function(msg) {
            if (
                typeof chrome === 'undefined' ||
                chrome.runtime === undefined ||
                chrome.runtime.sendMessage === undefined
            ) {
                return Promise.resolve();
            }
            return chrome.runtime.sendMessage(msg).catch((e) => {
                console.warn('[uBlock Ultimate] tool-overlay-ui: runtime.sendMessage failed', e);
            });
        },

        highlightElementUnderMouse: function(state) {
            if (document.documentElement.classList.contains('mobile')) { return; }
            if (state === this.mstrackerOn) { return; }
            this.mstrackerOn = state;
            if (this.mstrackerOn) {
                document.addEventListener('mousemove', this.onHover, { passive: true });
                return;
            }
            document.removeEventListener('mousemove', this.onHover, { passive: true });
            if (this.mstrackerTimer !== null) {
                cancelAnimationFrame(this.mstrackerTimer);
                this.mstrackerTimer = null;
            }
        },

        onTimer: function() {
            toolOverlay.mstrackerTimer = null;
            if (toolOverlay.port === null) { return; }
            toolOverlay.port.postMessage({
                what: 'highlightElementAtPoint',
                mx: toolOverlay.mstrackerX,
                my: toolOverlay.mstrackerY
            });
        },

        onHover: function(ev) {
            toolOverlay.mstrackerX = ev.clientX;
            toolOverlay.mstrackerY = ev.clientY;
            if (toolOverlay.mstrackerTimer !== null) { return; }
            toolOverlay.mstrackerTimer = requestAnimationFrame(toolOverlay.onTimer);
        },

        mover: function(ev) {
            const target = ev.target;
            if (target.matches('#move') === false) { return; }
            if (this.moveable && this.moveable.classList.contains('moving')) { return; }

            target.setPointerCapture(ev.pointerId);
            this.moverX0 = ev.pageX;
            this.moverY0 = ev.pageY;
            const rect = this.moveable.getBoundingClientRect();
            this.moverCX0 = rect.x + rect.width / 2;
            this.moverCY0 = rect.y + rect.height / 2;
            this.moveable.classList.add('moving');

            self.addEventListener('pointermove', this.moverMoveAsync, {
                passive: true,
                capture: true,
            });
            self.addEventListener('pointerup', this.moverStop, {
                capture: true,
                once: true,
            });

            ev.stopPropagation();
            ev.preventDefault();
        },

        moverMove: function() {
            this.moverTimer = null;
            const cx1 = this.moverCX0 + this.moverX1 - this.moverX0;
            const cy1 = this.moverCY0 + this.moverY1 - this.moverY0;
            const rootW = document.documentElement.clientWidth;
            const rootH = document.documentElement.clientHeight;
            const moveableW = this.moveable.clientWidth;
            const moveableH = this.moveable.clientHeight;

            if (cx1 < rootW / 2) {
                this.moveable.style.setProperty('left', `${Math.max(cx1 - moveableW / 2, 2)  }px`);
                this.moveable.style.removeProperty('right');
            } else {
                this.moveable.style.removeProperty('left');
                this.moveable.style.setProperty('right', `${Math.max(rootW - cx1 - moveableW / 2, 2)  }px`);
            }

            if (cy1 < rootH / 2) {
                this.moveable.style.setProperty('top', `${Math.max(cy1 - moveableH / 2, 2)  }px`);
                this.moveable.style.removeProperty('bottom');
            } else {
                this.moveable.style.removeProperty('top');
                this.moveable.style.setProperty('bottom', `${Math.max(rootH - cy1 - moveableH / 2, 2)  }px`);
            }
        },

        moverMoveAsync: function(ev) {
            toolOverlay.moverX1 = ev.pageX;
            toolOverlay.moverY1 = ev.pageY;
            if (toolOverlay.moverTimer !== null) { return; }
            toolOverlay.moverTimer = self.requestAnimationFrame(() => {
                toolOverlay.moverMove();
            });
        },

        moverStop: function(ev) {
            if (toolOverlay.moveable && toolOverlay.moveable.classList.contains('moving') === false) { return; }
            toolOverlay.moveable.classList.remove('moving');
            if (toolOverlay.moverTimer !== null) {
                cancelAnimationFrame(toolOverlay.moverTimer);
                toolOverlay.moverTimer = null;
            }
            self.removeEventListener('pointermove', toolOverlay.moverMoveAsync, {
                passive: true,
                capture: true,
            });
            ev.target.releasePointerCapture(ev.pointerId);
            ev.stopPropagation();
            ev.preventDefault();
        },

        eatTouchEvent: function(ev) {
            if (ev.target.matches('#move') === false) { return; }
            ev.stopPropagation();
            ev.preventDefault();
        }
    };

    self.toolOverlay = toolOverlay;

})();
