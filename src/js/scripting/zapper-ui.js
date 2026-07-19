/*******************************************************************************

    uBlock Ultimate - Zapper UI Entry Point
    Handles zapper-specific UI events

    This script runs in the iframe context (isolated from page)

*******************************************************************************/

(function() {
    

    const toolOverlay = {
        svgOcean: null,
        svgIslands: null,
        port: null,
        onmessage: null,
        mstrackerX: 0,
        mstrackerY: 0,
        mstrackerTimer: null,

        start: function(onmessage) {
            this.onmessage = onmessage;

            window.addEventListener('message', (ev) => {
                const msg = ev.data || {};
                if ( msg.what === 'startOverlay' ) {
                    this.port = ev.ports[0];
                    if ( this.port ) {
                        this.initPort();
                    }
                    this.onMessage({ what: 'startTool' });
                }
            });
        },

        initPort: function() {
            const self = this;
            this.port.onmessage = function(ev) {
                const data = ev.data || {};
                self.onMessage(data);
            };
        },

        onMessage: function(msg) {
            if ( !msg ) { return; }
            
            switch ( msg.what ) {
            case 'svgPaths':
                this.updateSVGPaths(msg.ocean, msg.islands);
                break;
            case 'showTooltip':
                this.showTooltip(msg.text, msg.x, msg.y);
                break;
            case 'hideTooltip':
                this.hideTooltip();
                break;
            case 'updateCount':
                this.updateCount(msg.count);
                break;
            case 'stopTool':
                if ( this.onmessage ) {
                    this.onmessage({ what: 'stopTool' });
                }
                break;
            case 'startTool':
                startZapper();
                break;
            }
        },

        updateSVGPaths: function(ocean, islands) {
            if ( this.svgOcean ) {
                this.svgOcean.setAttribute('d', ocean + islands);
            }
            if ( this.svgIslands ) {
                this.svgIslands.setAttribute('d', islands);
            }
        },

        showTooltip: function(text, x, y) {
            const tooltip = document.getElementById('tooltip');
            if ( tooltip ) {
                tooltip.textContent = text || '';
                tooltip.style.left = `${x  }px`;
                tooltip.style.top = `${y + 20  }px`;
                tooltip.style.display = 'block';
            }
        },

        hideTooltip: function() {
            const tooltip = document.getElementById('tooltip');
            if ( tooltip ) {
                tooltip.style.display = 'none';
            }
        },

        updateCount: function(count) {
            const counter = document.getElementById('removeCount');
            if ( counter ) {
                counter.textContent = String(count || 0);
            }

            const undoBtn = document.getElementById('undo');
            if ( undoBtn ) {
                undoBtn.setAttribute('aria-disabled', count > 0 ? 'false' : 'true');
            }
        },

        highlightElementUnderMouse: function(state) {
            if ( state ) {
                document.addEventListener('mousemove', this.onHover.bind(this), { passive: true });
            } else {
                document.removeEventListener('mousemove', this.onHover.bind(this), { passive: true });
            }
        },

        onHover: function(ev) {
            this.mstrackerX = ev.clientX;
            this.mstrackerY = ev.clientY;

            if ( this.mstrackerTimer !== null ) { return; }

            const self = this;
            this.mstrackerTimer = requestAnimationFrame(() => {
                self.mstrackerTimer = null;
                self.onTimer();
            });
        },

        onTimer: function() {
            if ( this.port === null ) { return; }

            this.port.postMessage({
                what: 'highlightElementAtPoint',
                mx: this.mstrackerX,
                my: this.mstrackerY
            });
        },

        stop: function() {
            this.highlightElementUnderMouse(false);
            if ( this.port ) {
                this.port.postMessage({ what: 'quitTool' });
                this.port = null;
            }
            this.onmessage = null;
        }
    };

    // Touch handling
    const onSvgTouch = (function() {
        let startX = 0, startY = 0, t0 = 0;
        return function(ev) {
            if ( ev.type === 'touchstart' ) {
                startX = ev.touches[0].screenX;
                startY = ev.touches[0].screenY;
                t0 = ev.timeStamp;
                return;
            }
            const stopX = ev.changedTouches[0].screenX;
            const stopY = ev.changedTouches[0].screenY;
            const distance = Math.sqrt(
                Math.pow(stopX - startX, 2) +
                Math.pow(stopY - startY, 2)
            );
            const duration = ev.timeStamp - t0;
            if ( distance >= 32 || duration >= 200 ) { return; }
            
            onSvgClicked({
                clientX: ev.changedTouches[0].pageX,
                clientY: ev.changedTouches[0].pageY
            });
            
            ev.preventDefault();
        };
    })();

    function onSvgClicked(ev) {
        if ( !toolOverlay.port ) { return; }
        toolOverlay.port.postMessage({
            what: 'zapElementAtPoint',
            mx: ev.clientX,
            my: ev.clientY,
            options: { stay: true }
        });
    }

    function onKeyPressed(ev) {
        if ( ev.key === 'Delete' || ev.key === 'Backspace' ) {
            if ( toolOverlay.port ) {
                toolOverlay.port.postMessage({
                    what: 'zapElementAtPoint',
                    options: { stay: true }
                });
            }
            return;
        }
        if ( ev.key === 'Escape' ) {
            quitZapper();
            return;
        }
        if ( ev.ctrlKey && ev.key === 'z' ) {
            if ( toolOverlay.port ) {
                toolOverlay.port.postMessage({ what: 'undoLastRemoval' });
            }
            ev.preventDefault();
        }
    }

    function startZapper() {
        if ( typeof faIconsInit === 'function' ) {
            faIconsInit();
        }
        
        if ( toolOverlay.port ) {
            toolOverlay.port.postMessage({ what: 'startTool' });
        }
        
        document.addEventListener('keydown', onKeyPressed, true);
        
        const svg = document.getElementById('overlay');
        if ( svg ) {
            svg.addEventListener('click', onSvgClicked);
            svg.addEventListener('touchstart', onSvgTouch, { passive: true });
            svg.addEventListener('touchend', onSvgTouch);
        }
        
        const quitBtn = document.getElementById('quit');
        if ( quitBtn ) {
            quitBtn.addEventListener('click', quitZapper);
        }
        
        const undoBtn = document.getElementById('undo');
        if ( undoBtn ) {
            undoBtn.addEventListener('click', () => {
                if ( undoBtn.getAttribute('aria-disabled') === 'true' ) { return; }
                if ( toolOverlay.port ) {
                    toolOverlay.port.postMessage({ what: 'undoLastRemoval' });
                }
            });
        }
        
        toolOverlay.updateCount(0);
        
        if ( toolOverlay.port ) {
            toolOverlay.port.postMessage({ what: 'getStackCount' });
        }
        
        toolOverlay.highlightElementUnderMouse(true);
    }

    function quitZapper() {
        document.removeEventListener('keydown', onKeyPressed, true);
        toolOverlay.stop();
    }

    // Initialize SVG references
    const svg = document.getElementById('overlay');
    if ( svg ) {
        const paths = svg.querySelectorAll('path');
        toolOverlay.svgOcean = paths[0];
        toolOverlay.svgIslands = paths[1];
    }

    // Start
    toolOverlay.start((msg) => {
        if ( msg.what === 'startTool' ) {
            startZapper();
        }
    });

})();
