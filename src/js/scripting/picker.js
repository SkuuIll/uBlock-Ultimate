/*******************************************************************************

    uBlock Ultimate - Picker Content Script
    Handles element picking and selector generation

    This script runs in the page context via scripting.executeScript

*******************************************************************************/

(function() {
    

    const ubolOverlay = self.ubolOverlay;
    if (!ubolOverlay) { return; }
    if (ubolOverlay.file === '/picker-ui.html') { return; }

    function isExtensionOwnedElement(elem) {
        if (!(elem instanceof Element)) { return false; }

        if (elem.hasAttribute('data-ubol-overlay')) { return true; }
        if (elem.hasAttribute('data-ubol-overlay-dialog')) { return true; }
        if (elem.hasAttribute('data-ubr-extension-ui')) { return true; }

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
    }

    let previewedSelector = '';
    let previewSavedElements = [];
    let previewedElements = [];

    const previewAttribute =
        `data-ubr-picker-preview-${Math.random()
            .toString(36)
            .slice(2)}`;

    const previewStyleId = 'picker-preview-style';
    const ignoredClassNames = new Set([
        'login-required',
    ]);
    const genericContainerTags = new Set([
        'article',
        'aside',
        'div',
        'footer',
        'header',
        'main',
        'nav',
        'section',
    ]);
    const meaningfulContainerTags = new Set([
        'article',
        'aside',
        'li',
        'nav',
        'section',
    ]);
    const ignorablePickedTags = new Set([
        'B',
        'CODE',
        'EM',
        'H1',
        'H2',
        'H3',
        'H4',
        'H5',
        'H6',
        'I',
        'P',
        'SMALL',
        'SPAN',
        'STRONG',
    ]);
    const urlAttributeNames = new Set([
        'action',
        'href',
        'poster',
        'src',
    ]);
    const textAnchorTags = new Set([
        'button',
        'figcaption',
        'h1',
        'h2',
        'h3',
        'h4',
        'h5',
        'h6',
        'label',
        'legend',
        'summary',
    ]);
    const textAnchorRoles = new Set([
        'button',
        'heading',
        'link',
        'menuitem',
        'option',
        'radio',
        'tab',
        'treeitem',
    ]);
    const weakStructuredAttributeTokens = new Set([
        'component',
        'components',
        'com',
        'dsl',
        'generated',
        'impl',
        'profile',
        'www',
    ]);
    const stableExactAttributeNames = new Set([
        'alt',
        'aria-description',
        'aria-label',
        'aria-roledescription',
        'name',
        'placeholder',
        'title',
    ]);
    const categoryPatterns = [
        { category: 'cookie-banner', type: 'id', pattern: /^eu-cookie|^cookie[-_](?:law|notice|consent|banner|policy|infobar|toaster|popup|wrapper)|^gdpr|^ccpa|^consent[-_](?:banner|notice|layer)/i, score: 40 },
        { category: 'cookie-banner', type: 'class', pattern: /cookie[-_](?:infobar|banner|notice|consent|law|toaster|popup|wrapper)|consent[-_](?:banner|notice|popup|layer)|gdpr[-_](?:banner|notice)|cc[-_]banner|fc[-_]consent|osano|truste[-_]banner/i, score: 25 },
        { category: 'cookie-banner', type: 'aria', pattern: /cookie[-_]?(?:consent|banner|notice)|consent[-_]?(?:banner|notice|dialog)/i, score: 15 },
        { category: 'overlay', type: 'id', pattern: /^(?:overlay|modal|popup|lightbox|dialog|drawer|slide[_-]?in|side[_-]?bar|flyout)/i, score: 40 },
        { category: 'overlay', type: 'class', pattern: /(?:overlay|modal|popup|lightbox|dialog|drawer|slide[_-]?in|side[_-]?bar|flyout|mfp[-_]|remodal|fancybox)/i, score: 25 },
        { category: 'overlay', type: 'aria', pattern: /(?:dialog|modal|overlay|popup)/i, score: 15 },
        { category: 'social-widget', type: 'id', pattern: /^(?:share|social|follow|like)[_-]/i, score: 35 },
        { category: 'social-widget', type: 'class', pattern: /(?:social|share|follow|like)[_-]?(?:widget|button|bar|box|plugin)/i, score: 20 },
        { category: 'social-widget', type: 'aria', pattern: /social|share|follow/i, score: 10 },
        { category: 'newsletter', type: 'id', pattern: /^(?:newsletter|subscribe|mailing|email[_-]?sign[_-]?up|sign[_-]?up)/i, score: 35 },
        { category: 'newsletter', type: 'class', pattern: /(?:newsletter|subscribe|mailing[_-]?list|email[_-]?sign[_-]?up|sign[_-]?up[_-]?form|mc[-_]?embed)/i, score: 20 },
        { category: 'app-banner', type: 'id', pattern: /^(?:app[_-]?banner|install[_-]?app|download[_-]?app|smart[_-]?banner)/i, score: 35 },
        { category: 'app-banner', type: 'class', pattern: /(?:app[_-]?banner|install[_-]?app|download[_-]?app|smart[_-]?banner|google[_-]?install)/i, score: 20 },
        { category: 'age-gate', type: 'id', pattern: /^(?:age[_-]?gate|age[_-]?verify|18[_-]?verify)/i, score: 40 },
        { category: 'age-gate', type: 'class', pattern: /(?:age[_-]?gate|age[_-]?verify|birth[_-]?date|confirm[_-]?age)/i, score: 25 },
    ];
    const classCache = new WeakMap();
    const attrCache = new WeakMap();

    function clearPickerCache() {
        classCache.delete(document.body);
        classCache.delete(document.documentElement);
        attrCache.delete(document.body);
        attrCache.delete(document.documentElement);
    }

    function qsa(node, selector) {
        if ( ubolOverlay.qsa ) {
            return ubolOverlay.qsa(node, selector);
        }
        if (node === null) { return []; }
        selector = selector.replace(/::[^:]+$/, '');
        const proceduralResult = proceduralQsa(node, selector);
        if ( proceduralResult !== null ) { return proceduralResult; }
        try {
            return Array.from(node.querySelectorAll(selector));
        } catch (e) {
            return [];
        }
    }

    function filterToSelector(filter) {
        if ( typeof filter !== 'string' ) { return ''; }
        filter = filter.trim();
        const parts = filter.split('|');
        if (
            (parts[0] === 'hide' || parts[0] === 'unhide') &&
            parts.length >= 2
        ) {
            return parts[parts.length - 1];
        }
        const cosmeticIdx = filter.indexOf('##');
        if ( cosmeticIdx !== -1 ) {
            return filter.slice(cosmeticIdx + 2);
        }
        return filter;
    }

    function scopeCosmeticFilter(filter) {
        const parts = filter.split('|');
        if (parts[0] !== 'hide' || self.location.hostname === '') {
            return filter;
        }
        if (parts.length === 2) {
            return `hide|${self.location.hostname}|${parts[1]}`;
        }
        return filter;
    }

    function escapeClassNames(classList) {
        return classList.map((name) => {
            return `.${  CSS.escape(name)}`;
        }).join('');
    }

    function cosmeticFilterFromSelector(selector) {
        return `hide|${  selector}`;
    }

    function cssAttrSelector(name, operator, value) {
        return `[${  name  }${  operator  }"${  CSS.escape(value)  }"]`;
    }

    function escapeRegexLiteral(value) {
        return value.replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&');
    }

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

    function isVolatileClassName(name) {
        if ( /^(?:css|emotion|jss|jsx|makeStyles|sc|styled)-[a-z0-9_-]{5,}$/i.test(name) ) {
            return true;
        }
        if ( /^[a-z]{1,4}-[a-z0-9_-]{8,}$/i.test(name) && /\d/.test(name) ) {
            return true;
        }
        return /^_?[a-f0-9]{7,}$/i.test(name);
    }

    function volatileClassCountFromSelector(selector) {
        const matches = selector.match(/\.(_?[a-f0-9]{7,})/ig);
        return matches !== null ? matches.length : 0;
    }

    function stableHrefFragment(value) {
        if ( typeof value !== 'string' || value === '' ) { return ''; }
        const trimmed = value.trim();
        if ( trimmed === '' || trimmed.startsWith('#') || trimmed.startsWith('?') ) { return ''; }
        if ( trimmed.startsWith('/') === false && /^https?:\/\//i.test(trimmed) === false ) { return ''; }
        try {
            const url = new URL(trimmed, self.location.href);
            if ( url.protocol !== 'http:' && url.protocol !== 'https:' ) { return ''; }
            if ( url.pathname === '' || url.pathname === '/' ) { return ''; }
            return url.pathname;
        } catch {
            const path = trimmed.split(/[?#]/, 1)[0];
            return path.startsWith('/') && path !== '/' ? path : '';
        }
    }

    function isStableDataAttributeName(name) {
        return /^data-[\w-]*(?:test|qa|cy|automation|component|module|widget|view|section|type|name|role|entity|urn|action|target|tracking|href|url|src|link)/i.test(name);
    }

    function isLikelyVolatileAttributeValue(value) {
        const compact = value.replace(/[-_:.]/g, '');
        if ( /^[a-f0-9]{10,}$/i.test(compact) ) { return true; }
        if ( /^\d{5,}$/.test(compact) ) { return true; }
        if ( /^[a-z0-9_-]{24,}$/i.test(value) && /[a-z]/i.test(value) && /\d/.test(value) ) {
            return true;
        }
        return false;
    }

    function isWeakStructuredAttributeToken(token) {
        if ( weakStructuredAttributeTokens.has(token.toLowerCase()) ) { return true; }
        return /(?:^|[-_])generated(?:$|[-_])/i.test(token);
    }

    function isLikelyVolatileStructuredAttributeToken(token) {
        if ( isWeakStructuredAttributeToken(token) ) { return true; }
        if ( isLikelyVolatileAttributeValue(token) ) { return true; }
        return /\d$/.test(token) && /[a-z]/i.test(token) && /[A-Z]/.test(token);
    }

    function canUseExactAttributeValue(name, value) {
        if ( typeof value !== 'string' ) { return false; }
        value = value.trim();
        if ( value.length < 2 || value.length > 120 ) { return false; }
        if ( isLikelyVolatileAttributeValue(value) ) { return false; }
        return (
            stableExactAttributeNames.has(name) ||
            isStableDataAttributeName(name) ||
            name === 'role'
        );
    }

    function stableStructuredAttributeFragment(value) {
        if ( typeof value !== 'string' || value.length < 4 ) { return ''; }
        const tokens = value
            .split(/[./:#?&=\s]+/)
            .map(token => token.trim())
            .filter(token => token.length >= 4 && /[a-z]/i.test(token));
        const hasGeneratedMarker = tokens.some(token => /^generated$/i.test(token));
        if ( hasGeneratedMarker ) {
            const last = tokens[tokens.length - 1] || '';
            return isLikelyVolatileStructuredAttributeToken(last) ? '' : last;
        }
        for ( let i = tokens.length - 1; i >= 0; i-- ) {
            if ( isLikelyVolatileStructuredAttributeToken(tokens[i]) === false ) {
                return tokens[i];
            }
        }
        return '';
    }

    function stableAttributePart(attr) {
        if ( attr instanceof Object === false ) { return ''; }
        const name = attr.name;
        const value = typeof attr.value === 'string' ? attr.value.trim() : '';
        if ( name === '' || value === '' ) { return ''; }
        if ( urlAttributeNames.has(name) ) {
            const fragment = stableHrefFragment(value);
            return fragment !== '' ? cssAttrSelector(name, '*=', fragment) : '';
        }
        if ( name.startsWith('data-') && /(?:href|url|src|link)/i.test(name) ) {
            const fragment = stableHrefFragment(value);
            if ( fragment !== '' ) {
                return cssAttrSelector(name, '*=', fragment);
            }
        }
        if ( isStableDataAttributeName(name) ) {
            const fragment = stableStructuredAttributeFragment(value);
            if ( fragment !== '' && fragment !== value ) {
                return cssAttrSelector(name, '*=', fragment);
            }
            if ( /(?:^|[.:/])generated(?:[.:/]|$)/i.test(value) && fragment === '' ) {
                return '';
            }
        }
        if ( canUseExactAttributeValue(name, value) ) {
            return cssAttrSelector(name, '=', value);
        }
        return '';
    }

    function generateStableAttributeSelectors(elem, attrs, tagName) {
        const selectors = [];
        const seen = new Set();
        const parts = [];
        const urlParts = [];
        const semanticParts = [];
        const dataParts = [];

        const pushSelector = selector => {
            if ( selector === '' || seen.has(selector) ) { return; }
            seen.add(selector);
            selectors.push(cosmeticFilterFromSelector(selector));
        };
        const pushPart = part => {
            pushSelector(`${  tagName  }${  part}`);
            pushSelector(part);
        };
        const collectPart = attr => {
            const part = stableAttributePart(attr);
            if ( part === '' || parts.includes(part) ) { return; }
            parts.push(part);
            if ( urlAttributeNames.has(attr.name) ) {
                urlParts.push(part);
            } else if ( stableExactAttributeNames.has(attr.name) || attr.name.startsWith('aria-') ) {
                semanticParts.push(part);
            } else if ( attr.name.startsWith('data-') ) {
                dataParts.push(part);
            }
        };

        collectPart({ name: 'href', value: elem.getAttribute('href') || '' });
        collectPart({ name: 'src', value: elem.getAttribute('src') || '' });
        for ( let i = 0; i < attrs.length; i++ ) {
            collectPart(attrs[i]);
        }

        for ( const urlPart of urlParts.slice(0, 2) ) {
            for ( const semanticPart of semanticParts.slice(0, 2) ) {
                pushSelector(`${  tagName  }${  urlPart  }${  semanticPart}`);
                pushSelector(`${  urlPart  }${  semanticPart}`);
            }
        }
        for ( const dataPart of dataParts.slice(0, 2) ) {
            for ( const semanticPart of semanticParts.slice(0, 2) ) {
                pushSelector(`${  tagName  }${  dataPart  }${  semanticPart}`);
                pushSelector(`${  dataPart  }${  semanticPart}`);
            }
        }
        if ( dataParts.length >= 2 ) {
            pushSelector(`${  tagName  }${  dataParts[0]  }${  dataParts[1]}`);
            pushSelector(`${  dataParts[0]  }${  dataParts[1]}`);
        }
        for ( const part of parts ) {
            pushPart(part);
        }

        return selectors;
    }

    function selectorCandidatesForElement(elem) {
        const tagName = CSS.escape(elem.localName);
        const attrs = filterAllAttributes(elem);
        return generateStableAttributeSelectors(elem, attrs, tagName)
            .map(filter => filterToSelector(filter))
            .filter(selector => selector !== '');
    }

    function normalizedText(value) {
        return value.replace(/\s+/g, ' ').trim();
    }

    function textSnippetCandidates(elem) {
        const seen = new Set();
        const out = [];
        const add = value => {
            value = normalizedText(value || '');
            if ( value.length < 6 || value.length > 80 ) { return; }
            const key = value.toLowerCase();
            if ( seen.has(key) ) { return; }
            seen.add(key);
            out.push(value);
        };

        add(elem.getAttribute('aria-label') || '');
        add(elem.getAttribute('title') || '');
        add(elem.getAttribute('alt') || '');
        for ( const textElem of elem.querySelectorAll('p,span,h1,h2,h3,h4,h5,h6,li,button,strong,em') ) {
            add(textElem.textContent || '');
        }
        if ( out.length === 0 ) {
            add(elem.textContent || '');
        }

        out.sort((a, b) => {
            const score = value => value.length +
                (/\d/.test(value) ? 20 : 0) +
                (/[$€£¥%]/.test(value) ? 20 : 0);
            return score(b) - score(a);
        });
        return out;
    }

    function textSelectorCandidatesForElement(elem) {
        const selectors = [];
        const seen = new Set();
        const tagName = CSS.escape(elem.localName);
        const push = selector => {
            if ( selector === '' || seen.has(selector) ) { return; }
            seen.add(selector);
            selectors.push(selector);
        };

        if ( textAnchorTags.has(elem.localName) ) {
            push(tagName);
        }
        const role = elem.getAttribute('role') || '';
        if ( textAnchorRoles.has(role) ) {
            push(cssAttrSelector('role', '=', role));
            push(`${  tagName  }${  cssAttrSelector('role', '=', role)}`);
        }
        return selectors;
    }

    function upwardDistance(fromElem, toElem) {
        let current = fromElem;
        let distance = 0;
        while ( current !== null && current !== toElem && distance < 10 ) {
            current = current.parentElement;
            distance += 1;
        }
        return current === toElem ? distance : 0;
    }

    function generateDescendantUpwardSelectors(elem) {
        const selectors = [];
        const seen = new Set();
        const descendantSelector = [
            'a[href]',
            'button',
            'figcaption',
            'h1',
            'h2',
            'h3',
            'h4',
            'h5',
            'h6',
            'label',
            'legend',
            'summary',
            '[role="button"]',
            '[role="heading"]',
            '[role="link"]',
            '[role="menuitem"]',
            '[role="option"]',
            '[role="radio"]',
            '[role="tab"]',
            '[role="treeitem"]',
            '[aria-label]',
            '[title]',
            '[data-testid]',
            '[data-test]',
            '[data-qa]',
            '[data-cy]',
            '[data-component]',
            '[data-sdui-component]',
            '[data-href-url]',
            '[data-url]',
            '[data-src]',
            '[data-action]',
            '[data-target]',
        ].join(',');
        const push = selector => {
            if ( selector === '' || seen.has(selector) ) { return; }
            seen.add(selector);
            selectors.push(cosmeticFilterFromSelector(selector));
        };

        for ( const descendant of elem.querySelectorAll(descendantSelector) ) {
            const distance = upwardDistance(descendant, elem);
            if ( distance < 1 || distance > 8 ) { continue; }
            const baseSelectors = selectorCandidatesForElement(descendant).slice(0, 4);
            const textSnippets = textSnippetCandidates(descendant).slice(0, 3);
            for ( const baseSelector of baseSelectors ) {
                for ( const text of textSnippets ) {
                    push(`${  baseSelector  }:has-text(/${  escapeRegexLiteral(text)  }/):upward(${  distance  })`);
                }
                push(`${  baseSelector  }:upward(${  distance  })`);
            }
            if ( textSnippets.length === 0 ) { continue; }
            for ( const textSelector of textSelectorCandidatesForElement(descendant) ) {
                for ( const text of textSnippets ) {
                    push(`${  textSelector  }:has-text(/${  escapeRegexLiteral(text)  }/):upward(${  distance  })`);
                }
            }
            if ( selectors.length >= 24 ) { break; }
        }

        return selectors;
    }

    function nthOfTypeIndex(elem) {
        let index = 1;
        let prev = elem.previousElementSibling;
        while ( prev ) {
            if ( prev.localName === elem.localName ) {
                index += 1;
            }
            prev = prev.previousElementSibling;
        }
        return index;
    }

    function filterClasses(elem) {
        if (classCache.has(elem)) { return classCache.get(elem); }
        const classAttr = typeof elem.getAttribute === 'function'
            ? elem.getAttribute('class') || ''
            : '';
        const seen = new Set();
        const classes = classAttr.split(/\s+/).filter((name) => {
            if ( name === '' ) { return false; }
            if ( seen.has(name) ) { return false; }
            seen.add(name);
            if ( ignoredClassNames.has(name) ) { return false; }
            if ( name.indexOf('__') !== -1 ) { return false; }
            if ( isVolatileClassName(name) ) { return false; }
            return true;
        });
        const classCounts = new Map();
        for ( let i = 0; i < classes.length; i++ ) {
            classCounts.set(classes[i], selectorCount(`.${CSS.escape(classes[i])}`));
        }
        classes.sort((a, b) => {
            const countDelta = classCounts.get(a) - classCounts.get(b);
            if ( countDelta !== 0 ) { return countDelta; }
            return b.length - a.length;
        });
        classCache.set(elem, classes);
        return classes;
    }

    function filterDataAttributes(elem) {
        const attrs = [];
        if (typeof elem.getAttribute !== 'function') { return attrs; }
        
        const dataAttrs = ['data-id', 'data-href-url', 'data-event-action', 'data-outbound-url', 'data-outbound-expiration'];
        
        for (let i = 0; i < dataAttrs.length; i++) {
            const value = elem.getAttribute(dataAttrs[i]);
            if (value && value.length > 0) {
                attrs.push({ name: dataAttrs[i], value: value });
            }
        }
        
        if (attrs.length === 0) {
            const allAttrs = elem.attributes;
            if (allAttrs) {
                for (let j = 0; j < allAttrs.length; j++) {
                    const attrName = allAttrs[j].name;
                    if (attrName.startsWith('data-') && allAttrs[j].value) {
                        attrs.push({ name: attrName, value: allAttrs[j].value });
                    }
                }
            }
        }
        
        return attrs;
    }

    function buildAttrSelector(attrs) {
        if (!attrs || attrs.length === 0) { return ''; }
        
        const parts = [];
        for (let i = 0; i < attrs.length; i++) {
            // Use full attribute value, not truncated - critical for uniqueness
            const escapedValue = CSS.escape(attrs[i].value);
            parts.push(`[${  attrs[i].name  }="${  escapedValue  }"]`);
        }
        return parts.join('');
    }

    function filterAllAttributes(elem) {
        if (attrCache.has(elem)) { return attrCache.get(elem); }
        const attrs = [];
        if (typeof elem.getAttribute !== 'function' || !elem.attributes) { return attrs; }
        
        const importantAttrs = [
            'href', 'src', 'title', 'alt', 'name', 'value', 'placeholder',
            'role', 'type', 'lang', 'rel', 'id', 'class'
        ];
        const importantDataAttrs = [
            'data-id', 'data-href-url', 'data-event-action', 'data-outbound-url',
            'data-outbound-expiration', 'data-action', 'data-url', 'data-target',
            'data-src', 'data-title', 'data-text', 'data-post-id', 'data-fullname'
        ];
        
        const seen = new Set();
        
        for (let i = 0; i < elem.attributes.length; i++) {
            const attr = elem.attributes[i];
            const name = attr.name;
            const value = attr.value;
            
            if (!value || seen.has(name)) { continue; }
            seen.add(name);
            
            if (importantAttrs.indexOf(name) !== -1 || name.startsWith('data-') || name.startsWith('aria-')) {
                if (name === 'class' || name === 'id') { continue; }
                attrs.push({ name: name, value: value });
            }
        }
        
        attrCache.set(elem, attrs);
        return attrs;
    }

    function buildPathSelector(elem, targetElem, maxDepth) {
        const parts = [];
        let current = elem;
        let depth = 0;
        
        while (current && current !== document.body && depth < maxDepth) {
            const tagName = CSS.escape(current.localName);
            const classes = filterClasses(current);
            const attrs = filterAllAttributes(current);
            const id = current.id;
            
            let part = tagName;
            
            if (id) {
                part += `#${  CSS.escape(id)}`;
            }
            
            if (classes.length > 0) {
                part += escapeClassNames(classes.slice(0, 2));
            }
            
            if (attrs.length > 0) {
                const attrParts = [];
                for (let i = 0; i < attrs.length && attrParts.length < 2; i++) {
                    const attrPart = stableAttributePart(attrs[i]);
                    if ( attrPart !== '' ) {
                        attrParts.push(attrPart);
                    }
                }
                part += attrParts.join('');
            }
            
            parts.unshift(part);
            current = current.parentElement;
            depth++;
        }
        
        return parts.join(' > ');
    }

    function generateAttributeSelectors(elem) {
        const selectors = [];
        const attrs = filterAllAttributes(elem);
        const tagName = CSS.escape(elem.localName);
        const classes = filterClasses(elem);
        const descendantSelectors = generateDescendantUpwardSelectors(elem);
        
        if (attrs.length === 0 && classes.length === 0) { return descendantSelectors; }

        selectors.push(...generateStableAttributeSelectors(elem, attrs, tagName));
        selectors.push(...descendantSelectors);
        
        // Generate selectors with ALL classes combined (most specific)
        if (classes.length > 0) {
            const allClasses = escapeClassNames(classes);
            selectors.push(`hide|${  tagName  }${allClasses}`);
            selectors.push(`hide|${  allClasses}`);
        }
        
        // Generate selectors with individual attributes
        for (let i = 0; i < attrs.length; i++) {
            // Use full value, not truncated - this is critical for uniqueness
            const attrStr = `[${  attrs[i].name  }="${  CSS.escape(attrs[i].value)  }"]`;
            selectors.push(`hide|${  tagName  }${attrStr}`);
            selectors.push(`hide|${  attrStr}`);
        }
        
        // Generate selectors with multiple attributes combined
        if (attrs.length >= 2) {
            let combinedAttrs = '';
            for (let j = 0; j < attrs.length; j++) {
                combinedAttrs += `[${  attrs[j].name  }="${  CSS.escape(attrs[j].value)  }"]`;
            }
            selectors.push(`hide|${  tagName  }${combinedAttrs}`);
            selectors.push(`hide|${  combinedAttrs}`);
        }
        
        // Generate selectors combining classes and attributes
        if (classes.length > 0 && attrs.length > 0) {
            const classPart = escapeClassNames(classes);
            let attrPart = '';
            for (let k = 0; k < Math.min(attrs.length, 2); k++) {
                attrPart += `[${  attrs[k].name  }="${  CSS.escape(attrs[k].value)  }"]`;
            }
            selectors.push(`hide|${  tagName  }${classPart  }${attrPart}`);
            selectors.push(`hide|${  classPart  }${attrPart}`);
        }
        
        return selectors;
    }

    function normalizePickedElement(elem) {
        while ( elem && elem.parentElement ) {
            if ( ignorablePickedTags.has(elem.tagName) === false ) {
                break;
            }
            if ( typeof elem.id === 'string' && elem.id !== '' ) {
                break;
            }
            if ( filterClasses(elem).length !== 0 ) {
                break;
            }
            elem = elem.parentElement;
        }
        if (
            elem &&
            elem.localName === 'div' &&
            filterClasses(elem).length === 0 &&
            selectorCandidatesForElement(elem).length === 0 &&
            elem.querySelector('h1,h2,h3,h4,h5,h6,label,legend,summary,[role="heading"]') !== null
        ) {
            let current = elem.parentElement;
            let depth = 0;
            while (
                current !== null &&
                current !== document.body &&
                current !== document.documentElement &&
                depth < 5
            ) {
                if ( meaningfulContainerTags.has(current.localName) ) {
                    return current;
                }
                current = current.parentElement;
                depth += 1;
            }
        }
        return elem;
    }

    function getSelectorInfo(selector, targetElem) {
        try {
            const elems = qsa(document, selector);
            const count = Array.isArray(elems) ? elems.length : 0;
            return {
                count,
                isUnique: count === 1 && Array.isArray(elems) && elems[0] === targetElem,
            };
        } catch (e) {
            return { count: 0, isUnique: false };
        }
    }

    function selectorCount(selector) {
        return getSelectorInfo(selector).count;
    }

    function isUniqueSelector(selector, targetElem) {
        return getSelectorInfo(selector, targetElem).isUnique;
    }

    function filterRank(filter, targetElem) {
        const parts = filter.split('|');
        const selector = parts[parts.length - 1] || '';
        let score = 0;
        const tagMatch = /^[a-z][a-z0-9-]*/i.exec(selector);
        const tagName = tagMatch ? tagMatch[0].toLowerCase() : '';
        
        const info = targetElem ? getSelectorInfo(selector, targetElem) : null;
        if (info) {
            if (info.count > 1) {
                score -= 500 + (info.count * 10);
            }
            if (info.isUnique) {
                score += 300;
            }
        }
        
        if ( selector.startsWith('#') ) {
            score -= 200;
        } else if ( selector.startsWith('.') ) {
            const classCount = (selector.match(/\./g) || []).length;
            if ( classCount >= 2 ) {
                score -= 120;
            } else {
                score += 20;
            }
        }
        if ( selector.indexOf(':nth-of-type(') !== -1 ) {
            score -= 20;
        }
        if ( genericContainerTags.has(tagName) ) {
            score += 40;
        }
        const volatileClassCount = volatileClassCountFromSelector(selector);
        if ( volatileClassCount !== 0 ) {
            score += 400 + (volatileClassCount * 80);
        }
        const hasUrlPath = /\[(?:action|href|poster|src)\*=/.test(selector);
        const hasSemanticAttr = /\[(?:alt|aria-[a-z-]+|name|placeholder|title)=/.test(selector);
        const hasStableDataAttr = /\[data-[^\]]+(?:=|\*=)/.test(selector);
        const stableAttrCount = (selector.match(/\[[^\]]+(?:=|\*=)/g) || []).length;
        if ( selector.includes(':upward(') ) {
            score -= selector.includes(':has-text(') ? 280 : 120;
        }
        if ( /^(?:h[1-6]|label|legend|summary|figcaption):has-text\(/.test(selector) ) {
            score -= 90;
        } else if ( /^\[role=/.test(selector) && selector.includes(':has-text(') ) {
            score += 80;
        }
        if ( hasUrlPath && hasSemanticAttr ) {
            score -= 260;
        } else if ( hasStableDataAttr && hasSemanticAttr ) {
            score -= 240;
        } else if ( hasStableDataAttr ) {
            score -= 220;
        } else if ( hasSemanticAttr ) {
            score -= 140;
        } else if ( selector.indexOf('[') !== -1 ) {
            score -= 60;
        }
        if ( stableAttrCount >= 2 ) {
            score -= 40;
        }
        if ( /^[a-z]/i.test(selector) ) {
            score += 10;
        }
        score += selector.length / 1000;
        return score;
    }

    function matchesCategoryPattern(elem) {
        let bestScore = 0;
        let bestCategory = null;
        const id = typeof elem.id === 'string' ? elem.id : '';
        if ( id !== '' ) {
            for ( const p of categoryPatterns ) {
                if ( p.type === 'id' && p.pattern.test(id) && p.score > bestScore ) {
                    bestScore = p.score;
                    bestCategory = p.category;
                }
            }
        }
        const classAttr = typeof elem.getAttribute === 'function' ? (elem.getAttribute('class') || '') : '';
        if ( classAttr !== '' ) {
            for ( const p of categoryPatterns ) {
                if ( p.type === 'class' && p.pattern.test(classAttr) && p.score > bestScore ) {
                    bestScore = p.score;
                    bestCategory = p.category;
                }
            }
        }
        const ariaLabel = typeof elem.getAttribute === 'function' ? (elem.getAttribute('aria-label') || '') : '';
        if ( ariaLabel !== '' ) {
            for ( const p of categoryPatterns ) {
                if ( p.type === 'aria' && p.pattern.test(ariaLabel) && p.score > bestScore ) {
                    bestScore = p.score;
                    bestCategory = p.category;
                }
            }
        }
        return { score: bestScore, category: bestCategory };
    }

    function generateStaticElementSelector(elem) {
        if ( typeof elem.id === 'string' && elem.id !== '' ) {
            return `#${CSS.escape(elem.id)}`;
        }
        const classes = filterClasses(elem);
        if ( classes.length > 0 ) {
            return `${CSS.escape(elem.localName)}${escapeClassNames(classes)}`;
        }
        const idParent = elem.closest('[id]');
        if ( idParent && idParent !== elem && idParent !== document.body && idParent !== document.documentElement ) {
            return `${CSS.escape(idParent.localName)}#${CSS.escape(idParent.id)} > ${CSS.escape(elem.localName)}`;
        }
        return '';
    }

    function detectElementCategory(pickedElem) {
        let current = pickedElem;
        let bestTarget = null;
        let bestScore = 0;
        let bestCategory = null;
        while ( current && current !== document.body && current !== document.documentElement ) {
            const { score, category } = matchesCategoryPattern(current);
            if ( score > bestScore ) {
                bestScore = score;
                bestCategory = category;
                bestTarget = current;
            }
            current = current.parentElement;
        }
        if ( bestTarget && bestScore >= 15 ) {
            const selector = generateStaticElementSelector(bestTarget);
            if ( selector ) {
                return {
                    category: bestCategory,
                    selector: selector,
                };
            }
        }
        return null;
    }

    function scopeCategoryFilter(selector) {
        const hostname = self.location.hostname;
        if ( hostname === '' ) { return `hide|${selector}`; }
        return `hide|${hostname}|${selector}`;
    }

    function buildGroupCandidates(elem) {
        const tagName = CSS.escape(elem.localName);
        const classes = filterClasses(elem);
        const dataAttrs = filterDataAttributes(elem);
        const attrSelector = buildAttrSelector(dataAttrs);
        const allAttrs = filterAllAttributes(elem);
        let filters = [];

        // 1. Generate attribute-based selectors (all attributes, not just data-*)
        const attrBasedSelectors = generateAttributeSelectors(elem);
        filters = filters.concat(attrBasedSelectors);

        // 2. Generate combinations using data attributes (highest priority - most unique)
        if (dataAttrs.length > 0) {
            // Tag + data attributes
            if (classes.length > 0) {
                filters.push(`hide|${  tagName  }${escapeClassNames(classes)  }${attrSelector}`);
                filters.push(`hide|${  escapeClassNames(classes)  }${attrSelector}`);
            }
            // Tag + data attributes (without classes)
            filters.push(`hide|${  tagName  }${attrSelector}`);
            filters.push(`hide|${  attrSelector}`);
            
            // Individual data attributes
            for (let i = 0; i < dataAttrs.length; i++) {
                const singleAttr = `[${  dataAttrs[i].name  }="${  CSS.escape(dataAttrs[i].value)  }"]`;
                filters.push(`hide|${  tagName  }${singleAttr}`);
                filters.push(`hide|${  singleAttr}`);
            }
        }

        // 3. Generate combinations using ALL classes (not just subsets)
        if (classes.length >= 1) {
            // All classes combined (highest specificity)
            const allClasses = escapeClassNames(classes);
            filters.push(`hide|${  tagName  }${allClasses}`);
            filters.push(`hide|${  allClasses}`);
            
            // Tag + single class
            for (let j = 0; j < classes.length; j++) {
                const singleClass = `.${  CSS.escape(classes[j])}`;
                filters.push(`hide|${  tagName  }${singleClass}`);
                filters.push(`hide|${  singleClass}`);
            }
        }

        // 4. ID-based selectors (highest priority when available)
        if ( typeof elem.id === 'string' && elem.id !== '' ) {
            filters.push(`hide|#${  CSS.escape(elem.id)}`);
            filters.push(`hide|${  tagName  }#${  CSS.escape(elem.id)}`);
            // ID + data attributes
            if (dataAttrs.length > 0) {
                filters.push(`hide|${  tagName  }#${  CSS.escape(elem.id)  }${attrSelector}`);
            }
        }

        // 5. Generate hierarchical path-based selectors (walk up DOM tree)
        let current = elem;
        let ancestorCount = 0;
        while (current && current.parentElement && current !== document.body && ancestorCount < 5) {
            const parent = current.parentElement;
            if (parent) {
                const parentTagName = CSS.escape(parent.localName);
                const parentClasses = filterClasses(parent);
                const parentId = parent.id;
                const parentAttrs = filterAllAttributes(parent);
                const parentAttrPart = parentAttrs
                    .map(attr => stableAttributePart(attr))
                    .find(part => part !== '');
                
                // Build parent part of selector
                let parentPart = parentTagName;
                if (parentId) {
                    parentPart += `#${  CSS.escape(parentId)}`;
                } else if (parentClasses.length > 0) {
                    parentPart += escapeClassNames(parentClasses.slice(0, 1));
                } else if (parentAttrPart) {
                    parentPart += parentAttrPart;
                }
                
                // Build full path selector
                let tagPart = tagName;
                if (classes.length > 0) {
                    tagPart += escapeClassNames(classes.slice(0, 1));
                } else if (allAttrs.length > 0) {
                    const attrPart = allAttrs
                        .map(attr => stableAttributePart(attr))
                        .find(part => part !== '');
                    if ( attrPart ) {
                        tagPart += attrPart;
                    }
                }
                
                const pathSelector = `hide|${  parentPart  } > ${  tagPart}`;
                if (filters.indexOf(pathSelector) === -1) {
                    filters.push(pathSelector);
                }
                
                // Try with more parent context
                if (ancestorCount > 0) {
                    const deeperPath = buildPathSelector(elem, elem, ancestorCount + 2);
                    if (deeperPath && filters.indexOf(`hide|${  deeperPath}`) === -1) {
                        filters.push(`hide|${  deeperPath}`);
                    }
                }
            }
            current = parent;
            ancestorCount++;
        }

        // 6. Tag-based selectors as fallback
        const tagSelector = `hide|${  tagName}`;
        const nthSelector = `hide|${  tagName  }:nth-of-type(${  nthOfTypeIndex(elem)  })`;
        filters.push(nthSelector);
        filters.push(tagSelector);

        if ( filters.length === 0 ) {
            return null;
        }

        // Deduplicate and evaluate each filter ONCE with getSelectorInfo
        const seenFilters = new Set();
        const evaluated = [];

        for ( let i = 0; i < filters.length; i++ ) {
            const filter = filters[i];
            if ( seenFilters.has(filter) ) { continue; }
            seenFilters.add(filter);

            const selector = filterToSelector(filter);
            const info = getSelectorInfo(selector, elem);
            if ( info.count === 0 ) { continue; }

            evaluated.push({ filter, selector, info });
        }

        if ( evaluated.length === 0 ) {
            return null;
        }

        // Sort: unique first, then by match count, then by rank
        evaluated.sort((a, b) => {
            if ( a.info.isUnique && !b.info.isUnique ) { return -1; }
            if ( !a.info.isUnique && b.info.isUnique ) { return 1; }
            const countDelta = a.info.count - b.info.count;
            if ( countDelta !== 0 ) { return countDelta; }
            const rankDelta = filterRank(a.filter, elem) - filterRank(b.filter, elem);
            if ( rankDelta !== 0 ) { return rankDelta; }
            return 0;
        });

        const scopedFilters = evaluated.map(e => scopeCosmeticFilter(e.filter));
        return {
            label: scopedFilters[0],
            filters: scopedFilters,
        };
    }

    function bestSpecificityForGroup(group) {
        if ( group instanceof Object === false || Array.isArray(group.filters) === false ) {
            return 0;
        }
        for ( let i = 0; i < group.filters.length; i++ ) {
            const filter = group.filters[i];
            const selector = filterToSelector(filter);
            if ( getSelectorInfo(selector).count === 1 ) {
                return i;
            }
        }
        return 0;
    }

    function candidatesAtPoint(x, y, options) {
        options = options || {};
        let elem = null;
        if (typeof x === 'number') {
            elem = ubolOverlay.elementFromPoint(x, y);
        } else if (x instanceof HTMLElement) {
            elem = x;
        }

        if (!elem) { return; }
        if (isExtensionOwnedElement(elem)) {
            return {
                cosmeticFilters: [],
                filter: { slot: 0, specificity: 0 },
                error: 'Extension UI cannot be picked',
            };
        }
        if ( options.preserveExact !== true ) {
            elem = normalizePickedElement(elem);
        }

        const categoryInfo = detectElementCategory(elem);
        clearPickerCache();
        const groups = [];
        while (elem && elem !== document.body && elem !== document.documentElement) {
            if (isExtensionOwnedElement(elem)) {
                elem = elem.parentElement;
                continue;
            }
            const group = buildGroupCandidates(elem);
            if ( group !== null ) {
                groups.push(group);
            }
            elem = elem.parentElement;
        }

        if ( groups.length === 0 ) { return; }

        // Keep the initial selection anchored to the picked element.
        // Ancestors stay available through the depth slider instead of
        // overriding the initial choice.
        let bestSlot = 0;
        while ( bestSlot < groups.length ) {
            if ( Array.isArray(groups[bestSlot].filters) && groups[bestSlot].filters.length !== 0 ) {
                break;
            }
            bestSlot += 1;
        }
        if ( bestSlot >= groups.length ) { bestSlot = 0; }
        const bestSpecificity = bestSpecificityForGroup(groups[bestSlot]);

        const result = {
            cosmeticFilters: groups,
            filter: {
                slot: bestSlot,
                specificity: bestSpecificity,
            }
        };
        if ( categoryInfo ) {
            result.category = categoryInfo.category;
            result.categoryFilter = scopeCategoryFilter(categoryInfo.selector);
        }
        return result;
    }

    function elementFromTargetSpec(target) {
        if ( typeof target !== 'string' || target === '' ) { return null; }
        const pos = target.indexOf('\t');
        if ( pos === -1 ) { return null; }

        const tagName = target.slice(0, pos).toLowerCase();
        const url = target.slice(pos + 1);
        const attr = {
            a: 'href',
            audio: 'src',
            iframe: 'src',
            img: 'src',
            video: 'src',
        }[tagName];
        if ( !attr ) { return null; }

        const elems = document.getElementsByTagName(tagName);
        for ( let i = 0; i < elems.length; i++ ) {
            const elem = elems[i];
            if ( elem === ubolOverlay.frame ) { continue; }
            let value = '';
            try {
                value = elem.getAttribute(attr) || elem[attr] || '';
            } catch (e) {
                console.warn('[uBR] picker: getAttribute failed', e);
            }
            if ( value === url ) {
                return elem;
            }
        }
        return null;
    }

    function elementFromExactTarget(target) {
        if ( target instanceof Object === false ) { return null; }
        if ( typeof target.selector !== 'string' || target.selector === '' ) { return null; }
        const elems = qsa(document, target.selector);
        if ( Array.isArray(elems) === false || elems.length === 0 ) { return null; }
        return elems[0];
    }

    function consumeBootSelection() {
        const boot = self.__ubrPickerBoot;
        if ( boot instanceof Object === false ) { return; }
        self.__ubrPickerBoot = undefined;

        const exactElem = elementFromExactTarget(boot.exactTarget);
        if ( exactElem !== null ) {
            ubolOverlay.highlightElements([ exactElem ]);
            return {
                primed: true,
                highlighted: true,
            };
        }

        const point = boot.initialPoint;
        if (
            point instanceof Object &&
            typeof point.x === 'number' &&
            typeof point.y === 'number'
        ) {
            const pointElem = ubolOverlay.elementFromPoint(point.x, point.y);
            if ( pointElem ) {
                ubolOverlay.highlightElements([ pointElem ]);
                return {
                    primed: true,
                    highlighted: true,
                };
            }
        }

        const elem = elementFromTargetSpec(boot.target);
        if ( elem !== null ) {
            ubolOverlay.highlightElements([ elem ]);
            return {
                primed: true,
                highlighted: true,
            };
        }
    }

    function clearPreview() {
        const style =
            document.getElementById(previewStyleId);

        if (style !== null) {
            style.remove();
        }

        for (const element of previewedElements) {
            if (element instanceof Element) {
                element.removeAttribute(previewAttribute);
            }
        }

        previewedElements = [];

        if (previewSavedElements.length !== 0) {
            const connectedElements =
                previewSavedElements.filter(element =>
                    element instanceof Element &&
                    element.isConnected
                );

            ubolOverlay.highlightElements(
                connectedElements
            );

            previewSavedElements = [];
        }
    }

    function previewSelector(selector) {
        selector =
            typeof selector === 'string'
                ? selector.trim()
                : '';

        clearPreview();

        previewedSelector = selector;

        if (selector === '') {
            return {
                count: 0,
                error: null,
            };
        }

        if (
            Array.isArray(
                ubolOverlay.highlightedElements
            ) &&
            ubolOverlay.highlightedElements.length !== 0
        ) {
            previewSavedElements =
                ubolOverlay.highlightedElements.slice();
        }

        ubolOverlay.highlightElements([]);

        const result =
            typeof ubolOverlay.elementsFromSelector ===
                'function'
                ? ubolOverlay.elementsFromSelector(selector)
                : {
                    elems: qsa(document, selector),
                    error: undefined,
                };

        const elements = uniqueElements(
            Array.isArray(result?.elems)
                ? result.elems
                : []
        ).filter(element =>
            isExtensionOwnedElement(element) === false &&
            element !== document.documentElement &&
            element !== document.body
        );

        if (elements.length === 0) {
            if (previewSavedElements.length !== 0) {
                const connectedElements =
                    previewSavedElements.filter(element =>
                        element instanceof Element &&
                        element.isConnected
                    );

                ubolOverlay.highlightElements(
                    connectedElements
                );

                previewSavedElements = [];
            }

            return {
                count: 0,
                error:
                    result?.error ||
                    'No elements found',
            };
        }

        const style = document.createElement('style');

        style.id = previewStyleId;
        style.textContent =
            `[${previewAttribute}] { ` +
            `display: none !important; ` +
            `}`;

        (
            document.head ||
            document.documentElement
        ).appendChild(style);

        for (const element of elements) {
            element.setAttribute(
                previewAttribute,
                ''
            );
        }

        previewedElements = elements;

        return {
            count: elements.length,
            error: null,
        };
    }

    function removeElementsFromSelector(selector) {
        const fromSelector = typeof ubolOverlay.elementsFromSelector === 'function'
            ? ubolOverlay.elementsFromSelector(selector)
            : { elems: qsa(document, selector), error: undefined };
        const elems = Array.isArray(fromSelector.elems)
            ? fromSelector.elems.filter(elem => isExtensionOwnedElement(elem) === false)
            : [];
        for ( let i = 0; i < elems.length; i++ ) {
            if ( elems[i] && typeof elems[i].remove === 'function' ) {
                elems[i].remove();
            }
        }
        ubolOverlay.highlightElements([]);
        return {
            count: elems.length,
            error: fromSelector.error || null,
        };
    }

    function confirmSelection(filter) {
        if ( typeof filter !== 'string' || filter.trim() === '' ) {
            return Promise.resolve({ count: 0, error: 'No filter selected' });
        }
        const normalizedFilter = filter.trim();
        const selector = filterToSelector(normalizedFilter);
        const removal = removeElementsFromSelector(selector);
        return Promise.resolve().then(() => {
            previewSelector('');
            return removal;
        }).catch((error) => {
            return {
                count: removal.count,
                error: error instanceof Error ? error.message : String(error),
            };
        });
    }

    function highlightFromSelector(selector) {
        const result = { count: 0, error: null };

        if (!selector) {
            ubolOverlay.highlightElements([]);
            return result;
        }

        const fromSelector = typeof ubolOverlay.elementsFromSelector === 'function'
            ? ubolOverlay.elementsFromSelector(selector)
            : { elems: qsa(document, selector), error: undefined };
        const elems = fromSelector.elems.filter(elem => isExtensionOwnedElement(elem) === false);
        if (elems.length === 0) {
            result.error = fromSelector.error || 'No elements found';
        } else {
            result.count = elems.length;
        }

        ubolOverlay.highlightElements(elems);
        return result;
    }

    function onMessage(msg) {
        switch (msg.what) {
        case 'startTool':
            return consumeBootSelection();
        case 'quitTool':
            previewSelector('');
            ubolOverlay.stop();
            break;
        case 'startCustomFilters':
            return ubolOverlay.sendMessage({ what: 'startCustomFilters' });
        case 'terminateCustomFilters':
            return ubolOverlay.sendMessage({ what: 'terminateCustomFilters' });
        case 'candidatesAtPoint':
            return candidatesAtPoint(msg.mx, msg.my);
        case 'highlightFromSelector':
            return highlightFromSelector(msg.selector);
        case 'previewSelector':
            return previewSelector(msg.selector);
        case 'createUserFilter':
            return ubolOverlay.sendMessage({
                channel: 'elementPicker',
                msg: {
                    what: 'elementPickerCreateFilter',
                    filters: msg.filter,
                    docURL: self.location.href,
                },
            });
        case 'confirmSelection':
            return confirmSelection(msg.filter);
        case 'unhighlight':
            ubolOverlay.highlightElements([]);
            break;
        case 'highlightElementAtPoint':
            var elem = ubolOverlay.elementFromPoint(msg.mx, msg.my);
            if (elem) {
                ubolOverlay.highlightElements([elem]);
            }
            break;
        }
    }

    ubolOverlay.install('/picker-ui.html', onMessage);

})();
