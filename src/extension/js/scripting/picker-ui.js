/*******************************************************************************

    uBlock Ultimate - Picker UI Entry Point
    Handles picker-specific UI events for the simple overlay picker

*******************************************************************************/

(function() {
    

    const toolOverlay = self.toolOverlay;
    if ( !toolOverlay ) { return; }

    const root = document.documentElement;
    let cosmeticFilterCandidates = [];
    let selectedDepth = 0;
    let selectedSpecificity = 0;

    const extensionStorage = self.browser && self.browser.storage && self.browser.storage.local
        ? self.browser.storage.local
        : self.chrome && self.chrome.storage && self.chrome.storage.local
            ? self.chrome.storage.local
            : null;
    const runtimeAPI = self.browser && self.browser.runtime
        ? self.browser.runtime
        : self.chrome && self.chrome.runtime
            ? self.chrome.runtime
            : null;

    const qs = function(selector) {
        return document.querySelector(selector);
    };

    const qsa = function(selector, context) {
        return Array.from((context || document).querySelectorAll(selector));
    };

    function localRead(key) {
        try {
            return Promise.resolve(self.localStorage.getItem(key));
        } catch (e) {
            console.warn('[uBlock Ultimate] picker-ui: localStorage.getItem failed', e);
        }
        return Promise.resolve(null);
    }

    function storageGet(keys) {
        if ( extensionStorage === null ) {
            return Promise.resolve({});
        }
        try {
            const result = extensionStorage.get(keys);
            if ( result instanceof Promise ) {
                return result;
            }
        } catch (e) {
            console.warn('[uBlock Ultimate] picker-ui: extensionStorage.get failed', e);
        }
        return new Promise((resolve) => {
            extensionStorage.get(keys, (items) => {
                resolve(items || {});
            });
        });
    }

    function storageSet(items) {
        if ( extensionStorage === null ) {
            return Promise.resolve();
        }
        try {
            const result = extensionStorage.set(items);
            if ( result instanceof Promise ) {
                return result;
            }
        } catch (e) {
            console.warn('[uBlock Ultimate] picker-ui: extensionStorage.set failed', e);
        }
        return new Promise((resolve) => {
            extensionStorage.set(items, () => {
                resolve();
            });
        });
    }

    function runtimeSendMessage(message) {
        if ( runtimeAPI === null || typeof runtimeAPI.sendMessage !== 'function' ) {
            return Promise.resolve();
        }
        try {
            const result = runtimeAPI.sendMessage(message);
            return Promise.resolve(result).catch((e) => {
                console.warn('[uBlock Ultimate] picker-ui: runtime.sendMessage failed', e);
            });
        } catch (e) {
            console.warn('[uBlock Ultimate] picker-ui: runtime.sendMessage threw', e);
        }
        return Promise.resolve();
    }

    function overlayPostMessage(message) {
        try {
            return Promise.resolve(toolOverlay.postMessage(message)).catch((e) => {
                console.warn('[uBlock Ultimate] picker-ui: overlay.postMessage failed', e);
            });
        } catch (e) {
            console.warn('[uBlock Ultimate] picker-ui: overlay.postMessage threw', e);
        }
        return Promise.resolve();
    }

    function appendFilterToMyFilters(filter) {
        return storageGet([ 'userFilters', 'user-filters', 'selectedFilterLists' ]).then((bin) => {
            const existing = typeof bin.userFilters === 'string'
                ? bin.userFilters.trim()
                : typeof bin['user-filters'] === 'string'
                    ? bin['user-filters'].trim()
                    : '';
            const lines = existing === ''
                ? []
                : existing.split(/\n+/).map((line) => { return line.trim(); }).filter(Boolean);
            if ( lines.indexOf(filter) === -1 ) {
                lines.push(filter);
            }
            const selected = Array.isArray(bin.selectedFilterLists)
                ? bin.selectedFilterLists.slice()
                : [];
            if ( selected.indexOf('user-filters') === -1 ) {
                selected.push('user-filters');
            }
            const updated = lines.join('\n');
            return storageSet({
                userFilters: updated,
                'user-filters': updated,
                selectedFilterLists: selected,
            });
        }).then(() => {
            try {
                const ch = new BroadcastChannel('uBR');
                ch.postMessage({ what: 'userFiltersUpdated' });
                ch.close();
            } catch (e) {
                console.warn('[uBlock Ultimate] picker-ui: BroadcastChannel postMessage failed', e);
            }
            void runtimeSendMessage({
                what: 'applyFilterListSelection',
                toSelect: [ 'user-filters' ],
                merge: true,
            });
            void runtimeSendMessage({
                what: 'reloadAllFilters',
            });
        });
    }

    function initFrameTheme() {
        if ( self.matchMedia instanceof Function ) {
            root.classList.toggle(
                'dark',
                self.matchMedia('(prefers-color-scheme: dark)').matches
            );
            root.classList.toggle(
                'light',
                self.matchMedia('(prefers-color-scheme: dark)').matches === false
            );
            root.classList.toggle(
                'hidpi',
                self.matchMedia('(min-resolution: 150dpi)').matches
            );
        } else {
            root.classList.add('light');
        }

        root.classList.toggle('mobile', 'ontouchstart' in self);
        root.classList.toggle('desktop', root.classList.contains('mobile') === false);
    }

    function renderRange(id, value, invert) {
        const input = qs(`#${  id  } input`);
        if ( !input ) { return; }
        const max = parseInt(input.max || '0', 10);
        if ( typeof value !== 'number' ) {
            value = parseInt(input.value || '0', 10);
        }
        if ( invert ) {
            value = max - value;
        }
        input.value = String(value);
        const slider = qs(`#${  id  } > span`);
        if ( !slider ) { return; }
        const lside = slider.children[0];
        const thumb = slider.children[1];
        const sliderWidth = slider.offsetWidth || 1;
        const maxPercent = (sliderWidth - thumb.offsetWidth) / sliderWidth * 100;
        const widthPercent = max === 0 ? 0 : value / max * maxPercent;
        lside.style.width = `${widthPercent  }%`;
    }

    function currentFilterGroup() {
        return cosmeticFilterCandidates[selectedDepth] || null;
    }

    function currentFilter() {
        const group = currentFilterGroup();
        if ( !group ) { return ''; }
        return group.filters[selectedSpecificity] || '';
    }

    function parsePickerFilter(filter) {
        if ( typeof filter !== 'string' ) {
            return { selector: '', domains: '', kind: '' };
        }
        filter = filter.trim();

        const parts = filter.split('|');
        if ( parts[0] === 'hide' && parts.length >= 2 ) {
            return {
                selector: parts[parts.length - 1],
                domains: parts.slice(1, -1).join(','),
                kind: 'hide',
            };
        }
        if ( parts[0] === 'unhide' && parts.length >= 2 ) {
            return {
                selector: parts[parts.length - 1],
                domains: parts.slice(1, -1).join(','),
                kind: 'unhide',
            };
        }

        const cosmeticIdx = filter.indexOf('##');
        if ( cosmeticIdx !== -1 ) {
            return {
                selector: filter.slice(cosmeticIdx + 2),
                domains: filter.slice(0, cosmeticIdx),
                kind: 'hide',
            };
        }

        return { selector: filter, domains: '', kind: '' };
    }

    function filterToSelector(filter) {
        return parsePickerFilter(filter).selector;
    }

    function isSafePickerFilter(filter) {
        const parsed = parsePickerFilter(filter);
        if ( parsed.kind !== 'hide' || parsed.selector === '' ) { return false; }
        const domains = parsed.domains;
        if ( domains === '' || domains === '*' ) { return true; }
        return domains.split(',').every((token) => {
            const hostname = token.trim();
            return hostname !== '' && hostname.indexOf('*') === -1 && hostname.startsWith('~') === false;
        });
    }

    function updateElementCount(details) {
        const count = details && details.count || 0;
        const error = details && details.error || null;
        const span = qs('#resultsetCount');
        if ( error ) {
            span.textContent = 'Error';
            span.setAttribute('title', error);
        } else {
            span.textContent = String(count);
            span.removeAttribute('title');
        }
        qs('#create').disabled = error !== null || count < 1;
    }

    function setActiveCandidate() {
        const items = qsa('#cosmeticFilters .changeFilter li');
        for ( let i = 0; i < items.length; i++ ) {
            items[i].classList.toggle('active', i === selectedDepth);
        }
    }

    function applyCurrentSelection() {
        const filter = currentFilter();
        qs('#filterText').value = filter;
        setActiveCandidate();
        renderRange('resultsetDepth', selectedDepth, true);
        renderRange('resultsetSpecificity', selectedSpecificity);
        if (root.classList.contains('preview')) {
            void updatePreview(true);
        } else {
            highlightCandidate();
        }
    }

    function highlightCandidate() {
        const filter = currentFilter();
        const selector = filterToSelector(filter);
        if ( selector === '' ) {
            void overlayPostMessage({ what: 'unhighlight' });
            updateElementCount({ count: 0, error: null });
            return;
        }
        overlayPostMessage({
            what: 'highlightFromSelector',
            selector: selector,
        }).then((result) => {
            updateElementCount(result);
        });
    }

    function populateCandidates() {
        const list = qs('#cosmeticFilters .changeFilter');
        list.innerHTML = '';
        for ( let i = 0; i < cosmeticFilterCandidates.length; i++ ) {
            const li = document.createElement('li');
            li.textContent = cosmeticFilterCandidates[i].label;
            li.dataset.depth = String(i);
            list.appendChild(li);
        }
    }

    function syncSpecificityRange() {
        const input = qs('#resultsetSpecificity input');
        const group = currentFilterGroup();
        const max = group ? Math.max(group.filters.length - 1, 0) : 0;
        input.max = String(max);
        if ( selectedSpecificity > max ) {
            selectedSpecificity = 0;
        }
        input.disabled = max === 0;
        renderRange('resultsetSpecificity', selectedSpecificity);
    }

    function showDialog(msg) {
        pausePicker();

        cosmeticFilterCandidates = Array.isArray(msg.cosmeticFilters)
            ? msg.cosmeticFilters
            : [];
        populateCandidates();

        const depthInput = qs('#resultsetDepth input');
        const depthMax = Math.max(cosmeticFilterCandidates.length - 1, 0);
        depthInput.max = String(depthMax);
        selectedDepth = Math.min(msg.filter && msg.filter.slot || 0, depthMax);
        depthInput.value = String(depthMax - selectedDepth);
        depthInput.disabled = depthMax === 0;

        selectedSpecificity = Math.max(msg.filter && msg.filter.specificity || 0, 0);
        syncSpecificityRange();

        if ( msg.category && msg.categoryFilter ) {
            qs('#filterText').value = msg.categoryFilter;
            const selector = filterToSelector(msg.categoryFilter);
            if ( selector !== '' ) {
                overlayPostMessage({ what: 'highlightFromSelector', selector }).then(updateElementCount);
            }
        } else {
            applyCurrentSelection();
        }
    }

    function onSvgTouch(ev) {
        if ( ev.type === 'touchstart' ) {
            onSvgTouch.x0 = ev.touches[0].screenX;
            onSvgTouch.y0 = ev.touches[0].screenY;
            onSvgTouch.t0 = ev.timeStamp;
            return;
        }
        if ( onSvgTouch.x0 === undefined ) { return; }

        const stopX = ev.changedTouches[0].screenX;
        const stopY = ev.changedTouches[0].screenY;
        const distance = Math.sqrt(
            Math.pow(stopX - onSvgTouch.x0, 2) +
            Math.pow(stopY - onSvgTouch.y0, 2)
        );
        const duration = ev.timeStamp - onSvgTouch.t0;
        if ( distance >= 32 || duration >= 200 ) { return; }

        onSvgClicked({
            type: 'touch',
            clientX: ev.changedTouches[0].clientX,
            clientY: ev.changedTouches[0].clientY,
        });
        ev.preventDefault();
    }

    onSvgTouch.x0 = 0;
    onSvgTouch.y0 = 0;
    onSvgTouch.t0 = 0;

    function onSvgClicked(ev) {
        root.classList.remove('aside-hidden');
        if ( root.classList.contains('paused') ) {
            if ( root.classList.contains('preview') ) {
                updatePreview(false);
            }
            unpausePicker();
            return;
        }
        pausePicker();
        root.classList.add('loading-results');
        cosmeticFilterCandidates = [];
        selectedDepth = 0;
        selectedSpecificity = 0;
        const filterList = qs('#candidateFilters .changeFilter');
        if (filterList) filterList.innerHTML = '';
        qs('#filterText').value = '';
        updateElementCount({ count: 0, error: null });
        overlayPostMessage({
            what: 'candidatesAtPoint',
            mx: ev.clientX,
            my: ev.clientY,
            broad: ev.ctrlKey,
        }).then((details) => {
            root.classList.remove('loading-results');
            showDialog(details);
        });
    }

    function onKeyPressed(ev) {
        if ( ev.key === 'Escape' || ev.which === 27 ) {
            quitPicker();
        }
    }

    function onDepthChanged(ev) {
        const input = ev.target;
        const max = parseInt(input.max || '0', 10);
        selectedDepth = max - Math.round(input.valueAsNumber);
        selectedSpecificity = 0;
        syncSpecificityRange();
        applyCurrentSelection();
    }

    function onSpecificityChanged(ev) {
        selectedSpecificity = Math.round(ev.target.valueAsNumber);
        renderRange('resultsetSpecificity', selectedSpecificity);
        applyCurrentSelection();
    }

    function onCandidateClicked(ev) {
        const li = ev.target.closest('li');
        if ( li === null ) { return; }
        selectedDepth = parseInt(li.dataset.depth || '0', 10);
        selectedSpecificity = 0;
        syncSpecificityRange();
        applyCurrentSelection();
    }

    function onMinimizeClicked() {
        if ( root.classList.contains('paused') === false ) {
            pausePicker();
            highlightCandidate();
            return;
        }
        root.classList.toggle('minimized');
    }

    function onFilterTextChanged() {
        const filter = qs('#filterText').value.trim();
        const selector = filterToSelector(filter);
        if ( selector === '' ) {
            void overlayPostMessage({ what: 'unhighlight' });
            updateElementCount({ count: 0, error: null });
            return;
        }
        if (root.classList.contains('preview')) {
            void updatePreview(true);
            return;
        }
        overlayPostMessage({
            what: 'highlightFromSelector',
            selector: selector,
        }).then((result) => {
            updateElementCount(result);
        });
    }

    function onPreviewClicked() {
        const state = root.classList.toggle('preview');
        updatePreview();
        qs('#preview').textContent = state ? 'Undo' : 'Preview';
        qs('#pick').disabled = state;
    }

    function onCreateClicked() {
        const filter = qs('#filterText').value.trim();
        const count = parseInt(qs('#resultsetCount').textContent || '0', 10);
        if ( filter === '' || count < 1 || isSafePickerFilter(filter) === false ) { return; }
        updatePreview(false);
        Promise.allSettled([
            overlayPostMessage({
                what: 'createUserFilter',
                filter: filter,
            }),
            overlayPostMessage({
                what: 'confirmSelection',
                filter: filter,
            }),
        ]).then(results => {
            for (const r of results) {
                if (r.status === 'rejected') {
                    console.warn('[uBlock Ultimate] picker-ui overlayPostMessage failed:', r.reason);
                }
            }
        }).finally(() => {
            toolOverlay.stop();
        });
    }

    function updatePreview(state) {
        if ( state === undefined ) {
            state = root.classList.contains('preview');
        } else {
            root.classList.toggle('preview', state);
        }
        let selector = '';
        if ( state ) {
            selector = filterToSelector(qs('#filterText').value.trim());
        }
        return overlayPostMessage({ what: 'previewSelector', selector }).then(result => {
            if ( state === true && result instanceof Object ) {
                updateElementCount(result);
            }
            return result;
        });
    }

    function pausePicker() {
        root.classList.add('paused');
        root.classList.remove('minimized');
        toolOverlay.highlightElementUnderMouse(false);
    }

    function unpausePicker() {
        root.classList.remove('paused', 'preview');
        root.classList.add('minimized');
        qs('#pick').disabled = false;
        updatePreview(false);
        toolOverlay.highlightElementUnderMouse(true);
    }

    function resetPicker() {
        void overlayPostMessage({ what: 'unhighlight' });
        root.classList.remove('paused', 'preview');
        qs('#pick').disabled = false;
        toolOverlay.highlightElementUnderMouse(true);
    }

    function quitPicker() {
        updatePreview(false);
        toolOverlay.stop();
    }

    function startPicker() {
        initFrameTheme();
        document.body.classList.remove('loading');

        if ( typeof faIconsInit === 'function' ) {
            faIconsInit();
        }

        root.classList.remove('minimized');
        root.classList.add('aside-hidden');

        void overlayPostMessage({ what: 'startTool' });

        localRead('picker.view').then(() => {});

        self.addEventListener('keydown', onKeyPressed, true);
        qs('#overlay').addEventListener('click', onSvgClicked);
        qs('#overlay').addEventListener('touchstart', onSvgTouch, { passive: true });
        qs('#overlay').addEventListener('touchend', onSvgTouch);
        qs('#minimize').addEventListener('click', onMinimizeClicked);
        qs('#quit').addEventListener('click', quitPicker);
        qs('#filterText').addEventListener('input', onFilterTextChanged);
        qs('#resultsetDepth input').addEventListener('input', onDepthChanged);
        qs('#resultsetSpecificity input').addEventListener('input', onSpecificityChanged);
        qs('#pick').addEventListener('click', resetPicker);
        qs('#preview').addEventListener('click', onPreviewClicked);
        qs('#create').addEventListener('click', onCreateClicked);

        qs('#candidateFilters').addEventListener('click', onCandidateClicked);
        toolOverlay.highlightElementUnderMouse(true);
    }

    function onMessage(msg) {
        switch ( msg.what ) {
        case 'startTool':
            startPicker();
            break;
        default:
            break;
        }
    }

    self.pickerState = {
        get paused() { return root.classList.contains('paused'); },
        get minimized() { return root.classList.contains('minimized'); },
        get preview() { return root.classList.contains('preview'); },
        get selectedSelector() { return qs('#filterText').value; },
        get candidateCount() { return parseInt(qs('#resultsetCount').textContent || '0', 10); },
        get selectedDepth() { return selectedDepth; },
        get selectedSpecificity() { return selectedSpecificity; },
        get cosmeticFilterCandidates() { return cosmeticFilterCandidates; },
    };

    toolOverlay.start(onMessage);
})();
