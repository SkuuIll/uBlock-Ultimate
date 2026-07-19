(() => {
  // dom.ts
  const normalizeTarget = (target) => {
      if (typeof target === "string") {
          return Array.from(qsa$(target));
      }
      if (target instanceof Element) {
          return [target];
      }
      if (target === null) {
          return [];
      }
      if (Array.isArray(target)) {
          return target;
      }
      return Array.from(target);
  };
  const makeEventHandler = (selector, callback) => {
      return function(event) {
          const dispatcher = event.currentTarget;
          if (dispatcher instanceof HTMLElement === false || typeof dispatcher.querySelectorAll !== "function") {
              return;
          }
          const receiver = event.target;
          const ancestor = receiver?.closest(selector);
          if (ancestor === receiver && ancestor !== dispatcher && dispatcher.contains(ancestor)) {
        callback.call(receiver, event);
          }
      };
  };
  const dom = class {
      static attr(target, attr, value) {
          for (const elem of normalizeTarget(target)) {
              if (value === void 0) {
                  return elem.getAttribute(attr);
              }
              if (value === null) {
          elem.removeAttribute(attr);
              } else {
          elem.setAttribute(attr, value);
              }
          }
          return void 0;
      }
      static clear(target) {
          for (const elem of normalizeTarget(target)) {
              while (elem.firstChild !== null) {
          elem.removeChild(elem.firstChild);
              }
          }
      }
      static clone(target) {
          const elements = normalizeTarget(target);
          if (elements.length === 0) {
              return null;
          }
          return elements[0].cloneNode(true);
      }
      static create(a) {
          if (typeof a === "string") {
              return document.createElement(a);
          }
          return void 0;
      }
      static prop(target, prop, value) {
          for (const elem of normalizeTarget(target)) {
              if (value === void 0) {
                  return elem[prop];
              }
              elem[prop] = value;
          }
          return void 0;
      }
      static text(target, text) {
          const targets = normalizeTarget(target);
          if (text === void 0) {
              return targets.length !== 0 ? targets[0].textContent ?? void 0 : void 0;
          }
          for (const elem of targets) {
              elem.textContent = text;
          }
          return void 0;
      }
      static remove(target) {
          for (const elem of normalizeTarget(target)) {
        elem.remove();
          }
      }
      static empty(target) {
          for (const elem of normalizeTarget(target)) {
              while (elem.firstElementChild !== null) {
          elem.firstElementChild.remove();
              }
          }
      }
      // target, type, callback, [options]
      // target, type, subtarget, callback, [options]
      static on(target, type, subtarget, callback, options) {
          let actualCallback;
          let actualOptions;
          if (typeof subtarget === "function") {
              actualOptions = options;
              actualCallback = subtarget;
              subtarget = "";
              if (typeof actualOptions === "boolean") {
                  actualOptions = { capture: true };
              }
          } else {
              actualCallback = makeEventHandler(subtarget, callback);
              if (actualOptions === void 0 || typeof actualOptions === "boolean") {
                  actualOptions = { capture: true };
              } else {
                  actualOptions.capture = true;
              }
          }
          const targets = target instanceof Window || target instanceof Document ? [target] : normalizeTarget(target);
          for (const elem of targets) {
        elem.addEventListener(type, actualCallback, actualOptions);
          }
      }
      static off(target, type, callback, options) {
          if (typeof callback !== "function") {
              return;
          }
          let actualOptions;
          if (typeof options === "boolean") {
              actualOptions = { capture: true };
          } else {
              actualOptions = options;
          }
          const targets = target instanceof Window || target instanceof Document ? [target] : normalizeTarget(target);
          for (const elem of targets) {
        elem.removeEventListener(type, callback, actualOptions);
          }
      }
      static onFirstShown(fn, elem) {
          let observer = new IntersectionObserver((entries) => {
              if (entries.every((a) => a.isIntersecting === false)) {
                  return;
              }
              try {
                  fn();
              } catch (e) {
                  console.warn('[uBlock Ultimate] codemirror: search callback failed', e);
              }
        observer?.disconnect();
        observer = void 0;
          });
      observer.observe(elem);
      }
  };
  dom.cl = class {
      static add(target, name) {
          for (const elem of normalizeTarget(target)) {
        elem.classList.add(name);
          }
      }
      static remove(target, ...names) {
          for (const elem of normalizeTarget(target)) {
        elem.classList.remove(...names);
          }
      }
      static toggle(target, name, state) {
          let r;
          for (const elem of normalizeTarget(target)) {
              r = elem.classList.toggle(name, state);
          }
          return r;
      }
      static has(target, name) {
          for (const elem of normalizeTarget(target)) {
              if (elem.classList.contains(name)) {
                  return true;
              }
          }
          return false;
      }
  };
  function qs$(a, b) {
      if (typeof a === "string") {
          return document.querySelector(a);
      }
      if (a === null) {
          return null;
      }
      return a.querySelector(b ?? "");
  }
  function qsa$(a, b) {
      if (typeof a === "string") {
          return document.querySelectorAll(a);
      }
      if (a === null) {
          return [];
      }
      return a.querySelectorAll(b ?? "");
  }
  dom.root = qs$(":root");
  dom.html = document.documentElement;
  dom.head = document.head;
  dom.body = document.body;

  // i18n.ts
  let i18n = null;
  if (typeof self.browser !== "undefined" && self.browser instanceof Object && !(self.browser instanceof Element)) {
      i18n = self.browser.i18n;
  } else if (typeof self.chrome !== "undefined" && self.chrome.i18n) {
      i18n = self.chrome.i18n;
  }
  if (!i18n) {
      i18n = {
      getMessage: function(key, _args) {
          return key;
      },
      safeTemplateToDOM: function(_id, _dict, parent) {
          if (parent === void 0) {
              return document.createDocumentFragment();
          }
          return parent;
      },
      render: function(_context) {
      },
      renderElapsedTimeToString: function(_tstamp) {
          return "";
      },
      patchUnicodeFlags: function(_text) {
          return document.createDocumentFragment();
      }
      };
  }
  const i18n$ = (...args) => i18n.getMessage(args[0], args.slice(1));
  const isBackgroundProcess = document.title === "uBlock Ultimate Background Page";
  if (isBackgroundProcess !== true) {
    document.body.setAttribute(
        "dir",
      ["ar", "he", "fa", "ps", "ur"].indexOf(i18n$("@@ui_locale")) !== -1 ? "rtl" : "ltr"
    );
    const allowedTags = /* @__PURE__ */ new Set([
      "a",
      "b",
      "code",
      "em",
      "i",
      "span",
      "u"
    ]);
    const expandHtmlEntities = /* @__PURE__ */ (() => {
        const entities = /* @__PURE__ */ new Map([
        ["&shy;", "\xAD"],
        ["&ldquo;", "\u201C"],
        ["&rdquo;", "\u201D"],
        ["&lsquo;", "\u2018"],
        ["&rsquo;", "\u2019"],
        ["&lt;", "<"],
        ["&gt;", ">"]
        ]);
        const decodeEntities = (match) => {
            return entities.get(match) || match;
        };
        return function(text) {
            if (text.indexOf("&") !== -1) {
                text = text.replace(/&[a-z]+;/g, decodeEntities);
            }
            return text;
        };
    })();
    const safeTextToTextNode = function(text) {
        return document.createTextNode(expandHtmlEntities(text));
    };
    const sanitizeElement = function(node) {
        if (allowedTags.has(node.localName) === false) {
            return null;
        }
      node.removeAttribute("style");
      let child = node.firstElementChild;
      while (child !== null) {
          const next = child.nextElementSibling;
          if (sanitizeElement(child) === null) {
          child.remove();
          }
          child = next;
      }
      return node;
    };
    const safeTextToDOM = function(text, parent) {
        if (text === "") {
            return;
        }
        const hasTemplate = text.indexOf("{{") !== -1;
        if (text.indexOf("<") === -1 && !hasTemplate) {
            const toInsert = safeTextToTextNode(text);
            if (parent.childNodes.length !== 0) {
                const toRemove = [];
                let child = parent.firstChild;
                while (child !== null) {
                    const next = child.nextSibling;
                    if (child.nodeType === 3 && child.nodeValue !== null) {
              toRemove.push(child);
                    }
                    child = next;
                }
                for (const node2 of toRemove) {
            node2.remove();
                }
            }
        parent.appendChild(toInsert);
        return;
        }
        text = text.replace(/^<p>|<\/p>/g, "").replace(/<p>/g, "\n\n");
        const domParser = new DOMParser();
        const parsedDoc = domParser.parseFromString(text, "text/html");
        if (parent.childNodes.length !== 0) {
            const toRemove = [];
            let child = parent.firstChild;
            while (child !== null) {
                const next = child.nextSibling;
                if (child.nodeType === 3 && child.nodeValue !== null) {
            toRemove.push(child);
                }
                child = next;
            }
            for (const node2 of toRemove) {
          node2.remove();
            }
        }
        let node = parsedDoc.body.firstChild;
        while (node !== null) {
            const next = node.nextSibling;
            switch (node.nodeType) {
            case 1:
                if (sanitizeElement(node) === null) {
                    break;
                }
            parent.appendChild(node);
                break;
            case 3:
            parent.appendChild(node);
                break;
            default:
                break;
            }
            node = next;
        }
    };
    i18n.safeTemplateToDOM = function(id, dict, parent) {
        if (parent === void 0) {
            parent = document.createDocumentFragment();
        }
        let textin = i18n$(id);
        if (textin === "") {
            return parent;
        }
        if (textin.indexOf("{{") === -1) {
            safeTextToDOM(textin, parent);
            return parent;
        }
        const re = /\{\{\w+\}\}/g;
        let textout = "";
        for (; ; ) {
            const match = re.exec(textin);
            if (match === null) {
                textout += textin;
                break;
            }
            textout += textin.slice(0, match.index);
            const prop = match[0].slice(2, -2);
            if (Object.hasOwn(dict, prop)) {
                textout += dict[prop].replace(/</g, "&lt;").replace(/>/g, "&gt;");
            } else {
                textout += prop;
            }
            textin = textin.slice(re.lastIndex);
        }
        safeTextToDOM(textout, parent);
        return parent;
    };
    i18n.render = function(context) {
        const docu = document;
        const root = context || docu;
        const elems = root.querySelectorAll("[data-i18n]");
        for (let i = 0; i < elems.length; i++) {
            const elem = elems[i];
            const text = i18n$(elem.getAttribute("data-i18n") || "");
            if (!text) {
                continue;
            }
            if (text.indexOf("{{") === -1) {
                safeTextToDOM(text, elem);
                continue;
            }
            const parts = text.split(/(\{\{[^}]+\}\})/);
            const fragment = document.createDocumentFragment();
            let textBefore = "";
            for (let j = 0; j < parts.length; j++) {
                const part = parts[j];
                if (part === "") {
                    continue;
                }
                if (part.startsWith("{{") && part.endsWith("}}")) {
                    const pos = part.indexOf(":");
                    if (pos !== -1) {
              part.slice(0, pos) + part.slice(-2);
                    }
                    const selector = part.slice(2, -2);
                    let node;
                    if (selector.charCodeAt(0) !== 46) {
                        node = elem.querySelector(`.${selector}`);
                    }
                    if (node instanceof Element === false) {
                        node = elem.querySelector(selector);
                    }
                    if (node instanceof Element) {
                        safeTextToDOM(textBefore, fragment);
              fragment.appendChild(node);
              textBefore = "";
              continue;
                    }
                }
                textBefore += part;
            }
            if (textBefore !== "") {
                safeTextToDOM(textBefore, fragment);
            }
        elem.appendChild(fragment);
        }
        const elemsTitle = root.querySelectorAll("[data-i18n-title]");
        for (let i = 0; i < elemsTitle.length; i++) {
            const elem = elemsTitle[i];
            const text = i18n$(elem.getAttribute("data-i18n-title") || "");
            if (!text) {
                continue;
            }
        elem.setAttribute("title", expandHtmlEntities(text));
        }
        const elemsPlaceholder = root.querySelectorAll("[placeholder]");
        for (let i = 0; i < elemsPlaceholder.length; i++) {
            const elem = elemsPlaceholder[i];
            const text = i18n$(elem.getAttribute("placeholder") || "");
            if (text === "") {
                continue;
            }
        elem.setAttribute("placeholder", text);
        }
        const elemsTip = root.querySelectorAll("[data-i18n-tip]");
        for (let i = 0; i < elemsTip.length; i++) {
            const elem = elemsTip[i];
            const text = i18n$(elem.getAttribute("data-i18n-tip") || "").replace(/<br>/g, "\n").replace(/\n{3,}/g, "\n\n");
        elem.setAttribute("data-tip", text);
        if (elem.getAttribute("aria-label") === "data-tip") {
          elem.setAttribute("aria-label", text);
        }
        }
        const elemsLabel = root.querySelectorAll("[data-i18n-label]");
        for (let i = 0; i < elemsLabel.length; i++) {
            const elem = elemsLabel[i];
            const text = i18n$(elem.getAttribute("data-i18n-label") || "");
        elem.setAttribute("label", text);
        }
    };
    i18n.renderElapsedTimeToString = function(tstamp) {
        let value = (Date.now() - tstamp) / 6e4;
        if (value < 2) {
            return i18n$("elapsedOneMinuteAgo");
        }
        if (value < 60) {
            return i18n$("elapsedManyMinutesAgo").replace("{{value}}", Math.floor(value).toLocaleString());
        }
        value /= 60;
        if (value < 2) {
            return i18n$("elapsedOneHourAgo");
        }
        if (value < 24) {
            return i18n$("elapsedManyHoursAgo").replace("{{value}}", Math.floor(value).toLocaleString());
        }
        value /= 24;
        if (value < 2) {
            return i18n$("elapsedOneDayAgo");
        }
        return i18n$("elapsedManyDaysAgo").replace("{{value}}", Math.floor(value).toLocaleString());
    };
    const unicodeFlagToImageSrc = /* @__PURE__ */ new Map([
      ["\u{1F1E6}\u{1F1F1}", "al"],
      ["\u{1F1E6}\u{1F1F7}", "ar"],
      ["\u{1F1E6}\u{1F1F9}", "at"],
      ["\u{1F1E7}\u{1F1E6}", "ba"],
      ["\u{1F1E7}\u{1F1EA}", "be"],
      ["\u{1F1E7}\u{1F1EC}", "bg"],
      ["\u{1F1E7}\u{1F1F7}", "br"],
      ["\u{1F1E8}\u{1F1E6}", "ca"],
      ["\u{1F1E8}\u{1F1ED}", "ch"],
      ["\u{1F1E8}\u{1F1F3}", "cn"],
      ["\u{1F1E8}\u{1F1F4}", "co"],
      ["\u{1F1E8}\u{1F1FE}", "cy"],
      ["\u{1F1E8}\u{1F1FF}", "cz"],
      ["\u{1F1E9}\u{1F1EA}", "de"],
      ["\u{1F1E9}\u{1F1F0}", "dk"],
      ["\u{1F1E9}\u{1F1FF}", "dz"],
      ["\u{1F1EA}\u{1F1EA}", "ee"],
      ["\u{1F1EA}\u{1F1EC}", "eg"],
      ["\u{1F1EA}\u{1F1F8}", "es"],
      ["\u{1F1EB}\u{1F1EE}", "fi"],
      ["\u{1F1EB}\u{1F1F4}", "fo"],
      ["\u{1F1EB}\u{1F1F7}", "fr"],
      ["\u{1F1EC}\u{1F1F7}", "gr"],
      ["\u{1F1ED}\u{1F1F7}", "hr"],
      ["\u{1F1ED}\u{1F1FA}", "hu"],
      ["\u{1F1EE}\u{1F1E9}", "id"],
      ["\u{1F1EE}\u{1F1F1}", "il"],
      ["\u{1F1EE}\u{1F1F3}", "in"],
      ["\u{1F1EE}\u{1F1F7}", "ir"],
      ["\u{1F1EE}\u{1F1F8}", "is"],
      ["\u{1F1EE}\u{1F1F9}", "it"],
      ["\u{1F1EF}\u{1F1F5}", "jp"],
      ["\u{1F1F0}\u{1F1F7}", "kr"],
      ["\u{1F1F0}\u{1F1FF}", "kz"],
      ["\u{1F1F1}\u{1F1F0}", "lk"],
      ["\u{1F1F1}\u{1F1F9}", "lt"],
      ["\u{1F1F1}\u{1F1FB}", "lv"],
      ["\u{1F1F2}\u{1F1E6}", "ma"],
      ["\u{1F1F2}\u{1F1E9}", "md"],
      ["\u{1F1F2}\u{1F1F0}", "mk"],
      ["\u{1F1F2}\u{1F1FD}", "mx"],
      ["\u{1F1F2}\u{1F1FE}", "my"],
      ["\u{1F1F3}\u{1F1F1}", "nl"],
      ["\u{1F1F3}\u{1F1F4}", "no"],
      ["\u{1F1F3}\u{1F1F5}", "np"],
      ["\u{1F1F5}\u{1F1F1}", "pl"],
      ["\u{1F1F5}\u{1F1F9}", "pt"],
      ["\u{1F1F7}\u{1F1F4}", "ro"],
      ["\u{1F1F7}\u{1F1F8}", "rs"],
      ["\u{1F1F7}\u{1F1FA}", "ru"],
      ["\u{1F1F8}\u{1F1E6}", "sa"],
      ["\u{1F1F8}\u{1F1EE}", "si"],
      ["\u{1F1F8}\u{1F1F0}", "sk"],
      ["\u{1F1F8}\u{1F1EA}", "se"],
      ["\u{1F1F8}\u{1F1F7}", "sr"],
      ["\u{1F1F9}\u{1F1ED}", "th"],
      ["\u{1F1F9}\u{1F1EF}", "tj"],
      ["\u{1F1F9}\u{1F1FC}", "tw"],
      ["\u{1F1F9}\u{1F1F7}", "tr"],
      ["\u{1F1FA}\u{1F1E6}", "ua"],
      ["\u{1F1FA}\u{1F1FF}", "uz"],
      ["\u{1F1FB}\u{1F1F3}", "vn"],
      ["\u{1F1FD}\u{1F1F0}", "xk"]
    ]);
    const reUnicodeFlags = new RegExp(
      Array.from(unicodeFlagToImageSrc).map((a) => a[0]).join("|"),
      "gu"
    );
    i18n.patchUnicodeFlags = function(text) {
        const fragment = document.createDocumentFragment();
        let i = 0;
        for (; ; ) {
            const match = reUnicodeFlags.exec(text);
            if (match === null) {
                break;
            }
            if (match.index > i) {
          fragment.append(text.slice(i, match.index));
            }
            const img = document.createElement("img");
            const countryCode = unicodeFlagToImageSrc.get(match[0]);
            img.src = `/img/flags-of-the-world/${countryCode}.png`;
            img.title = countryCode;
        img.classList.add("countryFlag");
        fragment.append(img, "\u200A");
        i = reUnicodeFlags.lastIndex;
        }
        if (i < text.length) {
        fragment.append(text.slice(i));
        }
        return fragment;
    };
    i18n.render();
  }

  // codemirror/search.ts
  {
      const CodeMirror = self.CodeMirror;
    CodeMirror.defineOption("maximizable", true, (cm, maximizable) => {
        if (typeof maximizable !== "boolean") {
            return;
        }
        const wrapper = cm.getWrapperElement();
        if (wrapper === null) {
            return;
        }
        const container = wrapper.closest(".codeMirrorContainer");
        if (container === null) {
            return;
        }
        container.dataset.maximizable = `${maximizable}`;
    });
    const searchOverlay = function(query, caseInsensitive) {
        if (typeof query === "string")
            query = new RegExp(
          query.replace(/[-[\]/{}()*+?.\\^$|]/g, "\\$&"),
          caseInsensitive ? "gi" : "g"
            );
        else if (!query.global)
            query = new RegExp(query.source, query.ignoreCase ? "gi" : "g");
        return {
        token: function(stream) {
            query.lastIndex = stream.pos;
            const match = query.exec(stream.string);
            if (match && match.index === stream.pos) {
                stream.pos += match[0].length || 1;
                return "searching";
            } else if (match) {
                stream.pos = match.index;
            } else {
            stream.skipToEnd();
            }
        }
        };
    };
    const searchWidgetKeydownHandler = function(cm, ev) {
        const keyName = CodeMirror.keyName(ev);
        if (!keyName) {
            return;
        }
      CodeMirror.lookupKey(
          keyName,
        cm.getOption("keyMap"),
        (command) => {
            if (widgetCommandHandler(cm, command)) {
            ev.preventDefault();
            ev.stopPropagation();
            }
        }
      );
    };
    const searchWidgetInputHandler = function(cm, ev) {
        const state = getSearchState(cm);
        if (ev.isTrusted !== true) {
            if (state.queryText === "") {
                clearSearch(cm);
            } else {
          cm.operation(() => {
              startSearch(cm, state);
          });
            }
            return;
        }
        if (queryTextFromSearchWidget(cm) === state.queryText) {
            return;
        }
      state.queryTimer.offon(350);
    };
    const searchWidgetClickHandler = (ev, cm) => {
        if (ev.button !== 0) {
            return;
        }
        const target = ev.target;
        const tcl = target.classList;
        if (tcl.contains("cm-search-widget-up")) {
            findNext(cm, -1);
        } else if (tcl.contains("cm-search-widget-down")) {
            findNext(cm, 1);
        } else if (tcl.contains("cm-linter-widget-up")) {
            findNextError(cm, -1);
        } else if (tcl.contains("cm-linter-widget-down")) {
            findNextError(cm, 1);
        } else if (tcl.contains("cm-maximize")) {
            const container = target.closest(".codeMirrorContainer");
            if (container !== null) {
          container.classList.toggle("cm-maximized");
            }
        }
        if (target.localName !== "input") {
        cm.focus();
        }
    };
    const queryTextFromSearchWidget = function(cm) {
        return getSearchState(cm).widget.querySelector('input[type="search"]').value;
    };
    const queryTextToSearchWidget = function(cm, q) {
        const input = getSearchState(cm).widget.querySelector('input[type="search"]');
        if (typeof q === "string" && q !== input.value) {
            input.value = q;
        }
      input.setSelectionRange(0, input.value.length);
      input.focus();
    };
    const SearchState = function(cm) {
        this.query = null;
        this.panel = null;
        const widgetParent = document.querySelector(".cm-search-widget-template").cloneNode(true);
        this.widget = widgetParent.children[0];
      this.widget.addEventListener("keydown", searchWidgetKeydownHandler.bind(null, cm));
      this.widget.addEventListener("input", searchWidgetInputHandler.bind(null, cm));
      this.widget.addEventListener("click", (ev) => {
          searchWidgetClickHandler(ev, cm);
      });
      if (typeof cm.addPanel === "function") {
          this.panel = cm.addPanel(this.widget);
      }
      this.queryText = "";
      this.dirty = true;
      this.lines = [];
      cm.on("changes", (_cm, changes) => {
          for (const change of changes) {
              if (change.text.length !== 0 || change.removed !== 0) {
                  this.dirty = true;
                  break;
              }
          }
      });
      cm.on("cursorActivity", (_cm) => {
          updateCount(cm);
      });
      this.queryTimer = vAPI.defer.create(() => {
          findCommit(cm, 0);
      });
    };
    const reSearchCommands = /^(?:find|findNext|findPrev|newlineAndIndent)$/;
    const widgetCommandHandler = function(cm, command) {
        if (reSearchCommands.test(command) === false) {
            return false;
        }
        const queryText = queryTextFromSearchWidget(cm);
        if (command === "find") {
            queryTextToSearchWidget(cm);
            return true;
        }
        if (queryText.length !== 0) {
            findNext(cm, command === "findPrev" ? -1 : 1);
        }
        return true;
    };
    const getSearchState = function(cm) {
        return cm.state.search || (cm.state.search = new SearchState(cm));
    };
    const queryCaseInsensitive = function(query) {
        return typeof query === "string" && query === query.toLowerCase();
    };
    const getSearchCursor = function(cm, query, pos) {
        return cm.getSearchCursor(
            query,
            pos,
            { caseFold: queryCaseInsensitive(query), multiline: false }
        );
    };
    const parseString = function(string) {
        return string.replace(/\\[nrt\\]/g, (match) => {
            if (match === "\\n") {
                return "\n";
            }
            if (match === "\\r") {
                return "\r";
            }
            if (match === "\\t") {
                return "	";
            }
            if (match === "\\\\") {
                return "\\";
            }
            return match;
        });
    };
    const reEscape = /[.*+\-?^${}()|[\]\\]/g;
    const parseQuery = function(query) {
        let flags = "i";
        let reParsed = query.match(/^\/(.+)\/([iu]*)$/);
        if (reParsed !== null) {
            try {
                const re = new RegExp(reParsed[1], reParsed[2]);
                query = re.source;
                flags = re.flags;
            } catch (e) {
                console.warn('[uBlock Ultimate] codemirror search: invalid regex parse', reParsed, e);
                reParsed = null;
            }
        }
        if (reParsed === null) {
            if (/[A-Z]/.test(query)) {
                flags = "";
            }
            query = parseString(query).replace(reEscape, "\\$&");
        }
        if (typeof query === "string" ? query === "" : query.test("")) {
            query = "x^";
        }
        return new RegExp(query, `gm${  flags}`);
    };
    let intlNumberFormat;
    const formatNumber = function(n) {
        if (intlNumberFormat === void 0) {
            intlNumberFormat = null;
            if (Intl.NumberFormat instanceof Function) {
                const intl = new Intl.NumberFormat(void 0, {
            notation: "compact",
            maximumSignificantDigits: 3
                });
                if (intl.resolvedOptions().notation) {
                    intlNumberFormat = intl;
                }
            }
        }
        return n > 1e4 && intlNumberFormat instanceof Object ? intlNumberFormat.format(n) : n.toLocaleString();
    };
    const updateCount = function(cm) {
        const state = getSearchState(cm);
        const lines = state.lines;
        const current = cm.getCursor().line;
        let l = 0;
        let r = lines.length;
        let i = -1;
        while (l < r) {
            i = l + r >>> 1;
            const candidate = lines[i];
            if (current === candidate) {
                break;
            }
            if (current < candidate) {
                r = i;
            } else {
                l = i + 1;
            }
        }
        let text = "";
        if (i !== -1) {
            text = formatNumber(i + 1);
            if (lines[i] !== current) {
                text = `~${  text}`;
            }
            text = `${text  }\xA0/\xA0`;
        }
        const count = lines.length;
        text += formatNumber(count);
        const span = state.widget.querySelector(".cm-search-widget-count");
        span.textContent = text;
        span.title = count.toLocaleString();
    };
    const startSearch = function(cm, state) {
        state.query = parseQuery(state.queryText);
        if (state.overlay !== void 0) {
        cm.removeOverlay(state.overlay, queryCaseInsensitive(state.query));
        }
        state.overlay = searchOverlay(state.query, queryCaseInsensitive(state.query));
      cm.addOverlay(state.overlay);
      if (state.dirty || searchThread.needHaystack()) {
        searchThread.setHaystack(cm.getValue());
        state.dirty = false;
      }
      searchThread.search(state.query).then((lines) => {
          if (Array.isArray(lines) === false) {
              return;
          }
          state.lines = lines;
          const count = lines.length;
          updateCount(cm);
          if (state.annotate !== void 0) {
          state.annotate.clear();
          state.annotate = void 0;
          }
          if (count === 0) {
              return;
          }
          state.annotate = cm.annotateScrollbar("CodeMirror-search-match");
          const annotations = [];
          let lineBeg = -1;
          let lineEnd = -1;
          for (const line of lines) {
              if (lineBeg === -1) {
                  lineBeg = line;
                  lineEnd = line + 1;
                  continue;
              } else if (line === lineEnd) {
                  lineEnd = line + 1;
                  continue;
              }
          annotations.push({
            from: { line: lineBeg, ch: 0 },
            to: { line: lineEnd, ch: 0 }
          });
          lineBeg = -1;
          }
          if (lineBeg !== -1) {
          annotations.push({
            from: { line: lineBeg, ch: 0 },
            to: { line: lineEnd, ch: 0 }
          });
          }
        state.annotate.update(annotations);
      });
      state.widget.setAttribute("data-query", state.queryText);
    };
    const findNext = function(cm, dir, callback) {
      cm.operation(() => {
          const state = getSearchState(cm);
          if (!state.query) {
              return;
          }
          let cursor = getSearchCursor(
              cm,
          state.query,
          dir <= 0 ? cm.getCursor("from") : cm.getCursor("to")
          );
          const previous = dir < 0;
          if (!cursor.find(previous)) {
              cursor = getSearchCursor(
                  cm,
            state.query,
            previous ? CodeMirror.Pos(cm.lastLine()) : CodeMirror.Pos(cm.firstLine(), 0)
              );
              if (!cursor.find(previous)) return;
          }
        cm.setSelection(cursor.from(), cursor.to());
        const { clientHeight } = cm.getScrollInfo();
        cm.scrollIntoView(
            { from: cursor.from(), to: cursor.to() },
            clientHeight >>> 1
        );
        if (callback) callback(cursor.from(), cursor.to());
      });
    };
    const findNextError = function(cm, dir) {
        const doc = cm.getDoc();
        const cursor = cm.getCursor("from");
        const cursorLine = cursor.line;
        const start = dir < 0 ? 0 : cursorLine + 1;
        const end = dir < 0 ? cursorLine : doc.lineCount();
        let found = -1;
      doc.eachLine(start, end, (lineHandle) => {
          const markers = lineHandle.gutterMarkers || null;
          if (markers === null) {
              return;
          }
          const marker = markers["CodeMirror-lintgutter"];
          if (marker === void 0) {
              return;
          }
          if (marker.dataset.error !== "y") {
              return;
          }
          const line = lineHandle.lineNo();
          if (dir < 0) {
              found = line;
              return;
          }
          found = line;
          return true;
      });
      if (found === -1 || found === cursorLine) {
          return;
      }
      cm.getDoc().setCursor(found);
      const { clientHeight } = cm.getScrollInfo();
      cm.scrollIntoView({ line: found, ch: 0 }, clientHeight >>> 1);
    };
    const clearSearch = function(cm, hard) {
      cm.operation(() => {
          const state = getSearchState(cm);
          if (state.query) {
              state.query = state.queryText = null;
          }
          state.lines = [];
          if (state.overlay !== void 0) {
          cm.removeOverlay(state.overlay);
          state.overlay = void 0;
          }
          if (state.annotate) {
          state.annotate.clear();
          state.annotate = void 0;
          }
        state.widget.removeAttribute("data-query");
        if (hard) {
          state.panel.clear();
          state.panel = null;
          state.widget = null;
          cm.state.search = null;
        }
      });
    };
    const findCommit = function(cm, dir) {
        const state = getSearchState(cm);
      state.queryTimer.off();
      const queryText = queryTextFromSearchWidget(cm);
      if (queryText === state.queryText) {
          return;
      }
      state.queryText = queryText;
      if (state.queryText === "") {
          clearSearch(cm);
      } else {
        cm.operation(() => {
            startSearch(cm, state);
            findNext(cm, dir);
        });
      }
    };
    const findCommand = function(cm) {
        let queryText = cm.getSelection() || void 0;
        if (!queryText) {
            const word = cm.findWordAt(cm.getCursor());
            queryText = cm.getRange(word.anchor, word.head);
            if (/^\W|\W$/.test(queryText)) {
                queryText = void 0;
            }
        cm.setCursor(word.anchor);
        }
        queryTextToSearchWidget(cm, queryText);
        findCommit(cm, 1);
    };
    const findNextCommand = function(cm) {
        const state = getSearchState(cm);
        if (state.query) {
            return findNext(cm, 1);
        }
    };
    const findPrevCommand = function(cm) {
        const state = getSearchState(cm);
        if (state.query) {
            return findNext(cm, -1);
        }
    };
    {
        const searchWidgetTemplate = [
        '<div class="cm-search-widget-template" style="display:none;">',
        '<div class="cm-search-widget">',
        '<span class="cm-maximize"><svg viewBox="0 0 40 40"><path d="M4,16V4h12M24,4H36V16M4,24V36H16M36,24V36H24" /><path d="M14 2.5v12h-12M38 14h-12v-12M14 38v-12h-12M26 38v-12h12" /></svg></span>&ensp;',
        '<span class="cm-search-widget-input">',
        '<span class="searchfield">',
        '<input type="search" spellcheck="false" placeholder="">',
        '<span class="fa-icon">search</span>',
        "</span>&ensp;",
        '<span class="cm-search-widget-up cm-search-widget-button fa-icon">angle-up</span>&nbsp;',
        '<span class="cm-search-widget-down cm-search-widget-button fa-icon fa-icon-vflipped">angle-up</span>&ensp;',
        '<span class="cm-search-widget-count"></span>',
        "</span>",
        '<span class="cm-linter-widget" data-lint="0">',
        '<span class="cm-linter-widget-count"></span>&ensp;',
        '<span class="cm-linter-widget-up cm-search-widget-button fa-icon">angle-up</span>&nbsp;',
        '<span class="cm-linter-widget-down cm-search-widget-button fa-icon fa-icon-vflipped">angle-up</span>&ensp;',
        "</span>",
        "<span>",
        '<a class="fa-icon sourceURL" href>external-link</a>',
        "</span>",
        "</div>",
        "</div>"
        ].join("\n");
        const domParser = new DOMParser();
        const doc = domParser.parseFromString(searchWidgetTemplate, "text/html");
        const widgetTemplate = document.adoptNode(doc.body.firstElementChild);
      document.body.appendChild(widgetTemplate);
    }
    CodeMirror.commands.find = findCommand;
    CodeMirror.commands.findNext = findNextCommand;
    CodeMirror.commands.findPrev = findPrevCommand;
    CodeMirror.defineInitHook((cm) => {
        getSearchState(cm);
      cm.on("linterDone", (details) => {
          const linterWidget = qs$(".cm-linter-widget");
          const count = details.errorCount;
          if (linterWidget.dataset.lint === `${count}`) {
              return;
          }
          linterWidget.dataset.lint = `${count}`;
        dom.text(
            qs$(linterWidget, ".cm-linter-widget-count"),
          i18n$("linterMainReport").replace("{{count}}", count.toLocaleString())
        );
      });
    });
  }
})();
