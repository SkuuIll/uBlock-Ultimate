/*******************************************************************************

    uBlock Ultimate - Zapper Content Script
    Handles element removal and undo functionality

    This script runs in the page context via scripting.executeScript

    Architecture:
    - tool-overlay.js: Creates ubolOverlay singleton (this file depends on it)
    - zapper.js: Zapper-specific logic (installs iframe, handles removal)
    - zapper-ui.js: UI entry point (runs in iframe)

*******************************************************************************/

(function() {
    

    const ubolOverlay = self.ubolOverlay;
    if ( !ubolOverlay ) { return; }
    if ( ubolOverlay.file === '/zapper-ui.html' ) { return; }

    const MAX_UNDO_STACK = 1000;

    let undoStack = [];
    const messageId = 0;

    if ( !self.zapperUndoStack ) {
        self.zapperUndoStack = [];
    }

    function syncStackToWindow() {
        self.zapperUndoStack = undoStack.slice(-MAX_UNDO_STACK);
    }

    function onMessage(msg) {
        switch ( msg.what ) {
        case 'startTool':
            undoStack = self.zapperUndoStack || [];
            break;
        case 'quitTool':
            quitZapper();
            break;
        case 'zapElementAtPoint':
            zapElementAtPoint(msg.mx, msg.my, msg.options);
            break;
        case 'unhighlight':
            ubolOverlay.highlightElements([]);
            break;
        case 'highlightElementAtPoint':
            highlightAtPoint(msg.mx, msg.my);
            break;
        case 'undoLastRemoval':
            undoLastRemoval();
            break;
        case 'getStackCount':
            if ( ubolOverlay.port ) {
                ubolOverlay.port.postMessage({
                    what: 'updateCount',
                    count: undoStack.length
                });
            }
            break;
        }
    }

    function highlightAtPoint(x, y) {
        const elem = ubolOverlay.elementFromPoint(x, y);
        if ( elem ) {
            ubolOverlay.highlightElements([ elem ]);
        }
    }

    function zapElementAtPoint(x, y, options) {
        if ( options && options.highlight ) {
            if ( x !== undefined && y !== undefined ) {
                const elem = ubolOverlay.elementFromPoint(x, y);
                if ( elem ) {
                    ubolOverlay.highlightElements([ elem ]);
                }
            }
            return;
        }

        let elemToRemove = null;

        if ( ubolOverlay.highlightedElements && ubolOverlay.highlightedElements.length > 0 ) {
            elemToRemove = ubolOverlay.highlightedElements[0];
        } else if ( x !== undefined && y !== undefined ) {
            elemToRemove = ubolOverlay.elementFromPoint(x, y);
        }

        if ( !elemToRemove || !(elemToRemove instanceof Element) ) { return; }

        undoStack.push({
            elem: elemToRemove,
            parent: elemToRemove.parentNode,
            nextSibling: elemToRemove.nextSibling
        });

        handleScrollLock(elemToRemove);
        elemToRemove.remove();
        ubolOverlay.highlightElements([]);
        syncStackToWindow();
        updateRemovalCount();
    }

    function handleScrollLock(elem) {
        let maybeScrollLocked = elem.shadowRoot instanceof DocumentFragment;

        if ( !maybeScrollLocked ) {
            let current = elem;
            do {
                const style = window.getComputedStyle(current);
                const zIndex = parseInt(style.zIndex, 10);
                maybeScrollLocked =
                    (!isNaN(zIndex) && zIndex >= 1000) ||
                    style.position === 'fixed';
                current = current.parentElement;
            } while ( current && !maybeScrollLocked );
        }

        if ( maybeScrollLocked ) {
            const body = document.body;
            const html = document.documentElement;

            const bodyStyle = window.getComputedStyle(body);
            const htmlStyle = window.getComputedStyle(html);

            if ( bodyStyle.overflowY === 'hidden' ) {
                body.style.setProperty('overflow', 'auto', 'important');
            }
            if ( bodyStyle.position === 'fixed' ) {
                body.style.setProperty('position', 'initial', 'important');
            }
            if ( htmlStyle.position === 'fixed' ) {
                html.style.setProperty('position', 'initial', 'important');
            }
            if ( htmlStyle.overflowY === 'hidden' ) {
                html.style.setProperty('overflow', 'auto', 'important');
            }
        }
    }

    function undoLastRemoval() {
        if ( undoStack.length === 0 ) { return; }

        const item = undoStack.pop();
        if ( item.nextSibling ) {
            item.parent.insertBefore(item.elem, item.nextSibling);
        } else {
            item.parent.appendChild(item.elem);
        }

        syncStackToWindow();
        updateRemovalCount();
    }

    function updateRemovalCount() {
        if ( ubolOverlay.port === null ) { return; }

        ubolOverlay.port.postMessage({
            what: 'updateCount',
            count: undoStack.length
        });
    }

    function quitZapper() {
        syncStackToWindow();
        ubolOverlay.stop();
    }

    function clearUndoStack() {
        undoStack.length = 0;
        self.zapperUndoStack = [];
    }

    self.zapperClearUndoStack = clearUndoStack;

    ubolOverlay.install('/zapper-ui.html', onMessage);

})();
