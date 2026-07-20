(() => {
  // src/js/contentscript-extra.ts
  if (typeof vAPI === "object" && typeof vAPI.DOMProceduralFilterer !== "object") {
    const nonVisualElements = {
      head: true,
      link: true,
      meta: true,
      script: true,
      style: true
    };
    const regexFromString = (s, exact = false) => {
      if (s === "") {
        return /^/;
      }
      const match = /^\/(.+)\/([imu]*)$/.exec(s);
      if (match !== null) {
        return new RegExp(match[1], match[2] || void 0);
      }
      const reStr = s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return new RegExp(exact ? `^${reStr}$` : reStr);
    };
    const youtubeProtectedUISelector = [
      "ytd-masthead",
      "ytd-masthead *"
    ].join(",");
    const isYouTubeHostname = (hostname) => hostname === "youtube.com" || hostname.endsWith(".youtube.com") || hostname === "youtu.be";
    const isYouTubeProtectedUINode = (node) => isYouTubeHostname(self.location.hostname) && node instanceof Element && node.matches(youtubeProtectedUISelector);
    class PSelectorTask {
      begin() {
      }
      end() {
      }
    }
    class PSelectorVoidTask extends PSelectorTask {
      constructor(task) {
        super();
        console.info(`uBR: :${task[0]}() operator does not exist`);
      }
      transpose() {
      }
    }
    class PSelectorHasTextTask extends PSelectorTask {
      constructor(task) {
        super();
        this.needle = regexFromString(task[1]);
      }
      transpose(node, output) {
        if (this.needle.test(node.textContent)) {
          output.push(node);
        }
      }
    }
    class PSelectorIfTask extends PSelectorTask {
      constructor(task) {
        super();
        this.pselector = new PSelector(task[1]);
      }
      transpose(node, output) {
        if (this.pselector.test(node) === this.target) {
          output.push(node);
        }
      }
    }
    PSelectorIfTask.prototype.target = true;
    class PSelectorIfNotTask extends PSelectorIfTask {
    }
    PSelectorIfNotTask.prototype.target = false;
    class PSelectorMatchesAttrTask extends PSelectorTask {
      constructor(task) {
        super();
        this.reAttr = regexFromString(task[1].attr, true);
        this.reValue = regexFromString(task[1].value, true);
      }
      transpose(node, output) {
        if (typeof node.getAttributeNames !== "function") {
          return;
        }
        const attrs = node.getAttributeNames();
        for (const attr of attrs) {
          if (this.reAttr.test(attr) === false) {
            continue;
          }
          if (this.reValue.test(node.getAttribute(attr)) === false) {
            continue;
          }
          output.push(node);
        }
      }
    }
    class PSelectorMatchesCSSTask extends PSelectorTask {
      constructor(task) {
        super();
        this.name = task[1].name;
        this.pseudo = task[1].pseudo ? `::${task[1].pseudo}` : null;
        let arg0 = task[1].value, arg1;
        if (Array.isArray(arg0)) {
          arg1 = arg0[1];
          arg0 = arg0[0];
        }
        this.value = new RegExp(arg0, arg1);
      }
      transpose(node, output) {
        const style = window.getComputedStyle(node, this.pseudo);
        if (style !== null && this.value.test(style[this.name])) {
          output.push(node);
        }
      }
    }
    class PSelectorMatchesCSSAfterTask extends PSelectorMatchesCSSTask {
      constructor(task) {
        super(task);
        this.pseudo = "::after";
      }
    }
    class PSelectorMatchesCSSBeforeTask extends PSelectorMatchesCSSTask {
      constructor(task) {
        super(task);
        this.pseudo = "::before";
      }
    }
    class PSelectorMatchesMediaTask extends PSelectorTask {
      constructor(task) {
        super();
        this.mql = window.matchMedia(task[1]);
        if (this.mql.media === "not all") {
          return;
        }
        this.mql.addEventListener("change", () => {
          if (typeof vAPI !== "object") {
            return;
          }
          if (vAPI === null) {
            return;
          }
          const filterer = vAPI.domFilterer && vAPI.domFilterer.proceduralFilterer;
          if (filterer instanceof Object === false) {
            return;
          }
          filterer.onDOMChanged([null]);
        });
      }
      transpose(node, output) {
        if (this.mql.matches === false) {
          return;
        }
        output.push(node);
      }
    }
    class PSelectorMatchesPathTask extends PSelectorTask {
      constructor(task) {
        super();
        this.needle = regexFromString(
          task[1].replace(new RegExp("\\P{ASCII}", "gu"), (s) => encodeURIComponent(s))
        );
      }
      transpose(node, output) {
        if (this.needle.test(self.location.pathname + self.location.search)) {
          output.push(node);
        }
      }
    }
    class PSelectorMatchesPropTask extends PSelectorTask {
      constructor(task) {
        super();
        this.props = task[1].attr.split(".");
        this.reValue = task[1].value !== "" ? regexFromString(task[1].value, true) : null;
      }
      transpose(node, output) {
        let value = node;
        for (const prop of this.props) {
          if (value === void 0) {
            return;
          }
          if (value === null) {
            return;
          }
          value = value[prop];
        }
        if (this.reValue === null) {
          if (value === void 0) {
            return;
          }
        } else if (this.reValue.test(value) === false) {
          return;
        }
        output.push(node);
      }
    }
    class PSelectorMinTextLengthTask extends PSelectorTask {
      constructor(task) {
        super();
        this.min = task[1];
      }
      transpose(node, output) {
        if (node.textContent.length >= this.min) {
          output.push(node);
        }
      }
    }
    class PSelectorOthersTask extends PSelectorTask {
      constructor() {
        super();
        this.targets = /* @__PURE__ */ new Set();
      }
      begin() {
        this.targets.clear();
      }
      end(output) {
        const toKeep = new Set(this.targets);
        const toDiscard = /* @__PURE__ */ new Set();
        const body = document.body;
        const head = document.head;
        let discard = null;
        for (let keep of this.targets) {
          while (keep !== null && keep !== body && keep !== head) {
            toKeep.add(keep);
            toDiscard.delete(keep);
            discard = keep.previousElementSibling;
            while (discard !== null) {
              if (nonVisualElements[discard.localName] !== true) {
                if (toKeep.has(discard) === false) {
                  toDiscard.add(discard);
                }
              }
              discard = discard.previousElementSibling;
            }
            discard = keep.nextElementSibling;
            while (discard !== null) {
              if (nonVisualElements[discard.localName] !== true) {
                if (toKeep.has(discard) === false) {
                  toDiscard.add(discard);
                }
              }
              discard = discard.nextElementSibling;
            }
            keep = keep.parentElement;
          }
        }
        for (discard of toDiscard) {
          output.push(discard);
        }
        this.targets.clear();
      }
      transpose(candidate) {
        for (const target of this.targets) {
          if (target.contains(candidate)) {
            return;
          }
          if (candidate.contains(target)) {
            this.targets.delete(target);
          }
        }
        this.targets.add(candidate);
      }
    }
    class PSelectorShadowTask extends PSelectorTask {
      constructor(task) {
        super();
        this.selector = task[1];
      }
      transpose(node, output) {
        const root = this.openOrClosedShadowRoot(node);
        if (root === null) {
          return;
        }
        const nodes = root.querySelectorAll(this.selector);
        output.push(...nodes);
      }
      get openOrClosedShadowRoot() {
        if (PSelectorShadowTask.openOrClosedShadowRoot !== void 0) {
          return PSelectorShadowTask.openOrClosedShadowRoot;
        }
        if (typeof chrome === "object" && chrome !== null) {
          const domApi = chrome["dom"];
          if (domApi instanceof Object) {
            if (typeof domApi["openOrClosedShadowRoot"] === "function") {
              PSelectorShadowTask.openOrClosedShadowRoot = domApi["openOrClosedShadowRoot"];
              return PSelectorShadowTask.openOrClosedShadowRoot;
            }
          }
        }
        PSelectorShadowTask.openOrClosedShadowRoot = (node) => node.openOrClosedShadowRoot || null;
        return PSelectorShadowTask.openOrClosedShadowRoot;
      }
    }
    class PSelectorSpathTask extends PSelectorTask {
      constructor(task) {
        super();
        this.spath = task[1];
        this.nth = /^(?:\s*[+~]|:)/.test(this.spath);
        if (this.nth) {
          return;
        }
        if (/^\s*>/.test(this.spath)) {
          this.spath = `:scope ${this.spath.trim()}`;
        }
      }
      transpose(node, output) {
        const nodes = this.nth ? PSelectorSpathTask.qsa(node, this.spath) : node.querySelectorAll(this.spath);
        for (const node2 of nodes) {
          output.push(node2);
        }
      }
      // Helper method for other operators.
      static qsa(node, selector) {
        const parent = node.parentElement;
        if (parent === null) {
          return [];
        }
        let pos = 1;
        for (; ; ) {
          node = node.previousElementSibling;
          if (node === null) {
            break;
          }
          pos += 1;
        }
        return parent.querySelectorAll(
          `:scope > :nth-child(${pos})${selector}`
        );
      }
    }
    class PSelectorUpwardTask extends PSelectorTask {
      constructor(task) {
        super();
        const arg = task[1];
        if (typeof arg === "number") {
          this.i = arg;
        } else {
          this.s = arg;
        }
      }
      transpose(node, output) {
        if (this.s !== "" && this.s !== void 0) {
          const parent = node.parentElement;
          if (parent === null) {
            return;
          }
          node = parent.closest(this.s);
          if (node === null) {
            return;
          }
        } else {
          let nth = this.i;
          for (; ; ) {
            node = node.parentElement;
            if (node === null) {
              return;
            }
            nth -= 1;
            if (nth === 0) {
              break;
            }
          }
        }
        output.push(node);
      }
    }
    PSelectorUpwardTask.prototype.i = 0;
    PSelectorUpwardTask.prototype.s = "";
    class PSelectorWatchAttrs extends PSelectorTask {
      constructor(task) {
        super();
        this.observer = null;
        this.observed = /* @__PURE__ */ new WeakSet();
        this.observerOptions = {
          attributes: true,
          subtree: true
        };
        const attrs = task[1];
        if (Array.isArray(attrs) && attrs.length !== 0) {
          this.observerOptions.attributeFilter = task[1];
        }
      }
      // TODO: Is it worth trying to re-apply only the current selector?
      handler() {
        const filterer = vAPI.domFilterer && vAPI.domFilterer.proceduralFilterer;
        if (filterer instanceof Object) {
          filterer.onDOMChanged([null]);
        }
      }
      transpose(node, output) {
        output.push(node);
        if (this.observed.has(node)) {
          return;
        }
        if (this.observer === null) {
          this.observer = new MutationObserver(this.handler);
        }
        this.observer.observe(node, this.observerOptions);
        this.observed.add(node);
      }
    }
    class PSelectorXpathTask extends PSelectorTask {
      constructor(task) {
        super();
        this.xpe = document.createExpression(task[1], null);
        this.xpr = null;
      }
      transpose(node, output) {
        this.xpr = this.xpe.evaluate(
          node,
          XPathResult.UNORDERED_NODE_SNAPSHOT_TYPE,
          this.xpr
        );
        let j = this.xpr.snapshotLength;
        while (j--) {
          const node2 = this.xpr.snapshotItem(j);
          if (node2.nodeType === 1) {
            output.push(node2);
          }
        }
      }
    }
    class PSelector {
      constructor(o) {
        this.selector = o.selector;
        this.tasks = [];
        const tasks = [];
        if (Array.isArray(o.tasks) === false) {
          return;
        }
        for (const task of o.tasks) {
          const ctor = this.operatorToTaskMap.get(task[0]) || PSelectorVoidTask;
          tasks.push(new ctor(task));
        }
        this.tasks = tasks;
      }
      prime(input) {
        const root = input || document;
        if (this.selector === "") {
          return [root];
        }
        if (input !== document) {
          const c0 = this.selector.charCodeAt(0);
          if (c0 === 43 || c0 === 126) {
            return Array.from(PSelectorSpathTask.qsa(input, this.selector));
          } else if (c0 === 62) {
            return Array.from(input.querySelectorAll(`:scope ${this.selector}`));
          }
        }
        return Array.from(root.querySelectorAll(this.selector));
      }
      exec(input) {
        let nodes = this.prime(input);
        for (const task of this.tasks) {
          if (nodes.length === 0) {
            break;
          }
          const transposed = [];
          task.begin();
          for (const node of nodes) {
            task.transpose(node, transposed);
          }
          task.end(transposed);
          nodes = transposed;
        }
        return nodes;
      }
      test(input) {
        const nodes = this.prime(input);
        for (const node of nodes) {
          let output = [node];
          for (const task of this.tasks) {
            const transposed = [];
            task.begin();
            for (const node2 of output) {
              task.transpose(node2, transposed);
            }
            task.end(transposed);
            output = transposed;
            if (output.length === 0) {
              break;
            }
          }
          if (output.length !== 0) {
            return true;
          }
        }
        return false;
      }
    }
    PSelector.prototype.operatorToTaskMap = /* @__PURE__ */ new Map([
      ["has", PSelectorIfTask],
      ["has-text", PSelectorHasTextTask],
      ["if", PSelectorIfTask],
      ["if-not", PSelectorIfNotTask],
      ["matches-attr", PSelectorMatchesAttrTask],
      ["matches-css", PSelectorMatchesCSSTask],
      ["matches-css-after", PSelectorMatchesCSSAfterTask],
      ["matches-css-before", PSelectorMatchesCSSBeforeTask],
      ["matches-media", PSelectorMatchesMediaTask],
      ["matches-path", PSelectorMatchesPathTask],
      ["matches-prop", PSelectorMatchesPropTask],
      ["min-text-length", PSelectorMinTextLengthTask],
      ["not", PSelectorIfNotTask],
      ["others", PSelectorOthersTask],
      ["shadow", PSelectorShadowTask],
      ["spath", PSelectorSpathTask],
      ["upward", PSelectorUpwardTask],
      ["watch-attr", PSelectorWatchAttrs],
      ["xpath", PSelectorXpathTask]
    ]);
    class PSelectorRoot extends PSelector {
      constructor(o) {
        super(o);
        this.budget = 200;
        this.raw = o.raw;
        this.cost = 0;
        this.lastAllowanceTime = 0;
        this.action = o.action;
      }
      prime(input) {
        try {
          return super.prime(input);
        } catch (e) {
          console.warn("[uBlock Ultimate] contentscript-extra: PSelectorRoot.prime failed", e);
        }
        return [];
      }
    }
    PSelectorRoot.prototype.hit = false;
    class ProceduralFilterer {
      constructor(domFilterer) {
        this.domFilterer = domFilterer;
        this.mustApplySelectors = false;
        this.selectors = /* @__PURE__ */ new Map();
        this.masterToken = vAPI.randomToken();
        this.styleTokenMap = /* @__PURE__ */ new Map();
        this.styledNodes = /* @__PURE__ */ new Set();
        this.mutationObserver = null;
        if (vAPI.domWatcher instanceof Object) {
          vAPI.domWatcher.addListener(this);
        }
        if (vAPI.shutdown instanceof Object) {
          vAPI.shutdown.add(() => {
            this.stopMutationObserver();
          });
        }
      }
      addProceduralSelectors(selectors) {
        const addedSelectors = [];
        let mustCommit = false;
        for (const selector of selectors) {
          if (this.selectors.has(selector.raw)) {
            continue;
          }
          const pselector = new PSelectorRoot(selector);
          this.primeProceduralSelector(pselector);
          this.selectors.set(selector.raw, pselector);
          addedSelectors.push(pselector);
          mustCommit = true;
        }
        if (mustCommit === false) {
          return;
        }
        this.mustApplySelectors = this.selectors.size !== 0;
        this.startMutationObserver();
        this.domFilterer.commit(true);
        if (this.domFilterer.hasListeners()) {
          this.domFilterer.triggerListeners({
            procedural: addedSelectors
          });
        }
      }
      // This allows to perform potentially expensive initialization steps
      // before the filters are ready to be applied.
      primeProceduralSelector(pselector) {
        if (pselector.action === void 0) {
          this.styleTokenFromStyle(vAPI.hideStyle);
        } else if (pselector.action[0] === "style") {
          this.styleTokenFromStyle(pselector.action[1]);
        }
        return pselector;
      }
      commitNow() {
        if (this.selectors.size === 0) {
          return;
        }
        this.mustApplySelectors = false;
        const toUnstyle = this.styledNodes;
        this.styledNodes = /* @__PURE__ */ new Set();
        let t0 = Date.now();
        for (const pselector of this.selectors.values()) {
          const allowance = Math.floor((t0 - pselector.lastAllowanceTime) / 2e3);
          if (allowance >= 1) {
            pselector.budget += allowance * 50;
            if (pselector.budget > 200) {
              pselector.budget = 200;
            }
            pselector.lastAllowanceTime = t0;
          }
          if (pselector.budget <= 0) {
            continue;
          }
          const nodes = pselector.exec();
          const t1 = Date.now();
          pselector.budget += t0 - t1;
          if (pselector.budget < -500) {
            console.info("uBR: disabling %s", pselector.raw);
            pselector.budget = -2147483647;
          }
          t0 = t1;
          if (nodes.length === 0) {
            continue;
          }
          pselector.hit = true;
          this.processNodes(nodes, pselector.action);
        }
        this.unprocessNodes(toUnstyle);
      }
      styleTokenFromStyle(style) {
        if (style === void 0) {
          return;
        }
        let styleToken = this.styleTokenMap.get(style);
        if (styleToken !== void 0) {
          return styleToken;
        }
        styleToken = vAPI.randomToken();
        this.styleTokenMap.set(style, styleToken);
        this.domFilterer.addCSS(
          `[${this.masterToken}][${styleToken}]
{${style}}`,
          { silent: true, mustInject: true }
        );
        this.refreshMutationObserver();
        return styleToken;
      }
      mutationObserverOptions() {
        return {
          attributes: true,
          attributeFilter: [
            this.masterToken,
            ...this.styleTokenMap.values()
          ],
          characterData: true,
          childList: true,
          subtree: true
        };
      }
      startMutationObserver() {
        if (this.mutationObserver !== null) {
          return;
        }
        this.mutationObserver = new MutationObserver(
          (mutations) => {
            this.onProceduralMutations(mutations);
          }
        );
        this.mutationObserver.observe(document, this.mutationObserverOptions());
      }
      refreshMutationObserver() {
        if (this.mutationObserver === null) {
          return;
        }
        this.mutationObserver.disconnect();
        this.mutationObserver.observe(document, this.mutationObserverOptions());
      }
      stopMutationObserver() {
        if (this.mutationObserver === null) {
          return;
        }
        this.mutationObserver.disconnect();
        this.mutationObserver = null;
      }
      mutationTouchesElementList(nodeList) {
        for (const node of nodeList) {
          if (node.nodeType === 1) {
            return true;
          }
          if (node.nodeType === 3) {
            return true;
          }
        }
        return false;
      }
      onProceduralMutations(mutations) {
        if (this.selectors.size === 0) {
          return;
        }
        for (const mutation of mutations) {
          if (mutation.type === "attributes") {
            const name = mutation.attributeName || "";
            if (name === this.masterToken || Array.from(this.styleTokenMap.values()).includes(name)) {
              if (mutation.target.hasAttribute(name)) {
                continue;
              }
              this.commitNow();
              return;
            }
            continue;
          }
          if (mutation.type === "characterData") {
            this.commitNow();
            return;
          }
          if (this.mutationTouchesElementList(mutation.addedNodes) || this.mutationTouchesElementList(mutation.removedNodes)) {
            this.commitNow();
            return;
          }
        }
      }
      processNodes(nodes, action) {
        if (isYouTubeHostname(self.location.hostname)) {
          nodes = nodes.filter((node) => isYouTubeProtectedUINode(node) === false);
          if (nodes.length === 0) {
            return;
          }
        }
        const op = action && action[0] || "";
        const arg = op !== "" ? action[1] : "";
        switch (op) {
          case "":
          /* fall through */
          case "style": {
            const styleToken = this.styleTokenFromStyle(
              arg === "" ? vAPI.hideStyle : arg
            );
            for (const node of nodes) {
              node.setAttribute(this.masterToken, "");
              node.setAttribute(styleToken, "");
              this.styledNodes.add(node);
            }
            break;
          }
          case "remove": {
            for (const node of nodes) {
              node.remove();
              node.textContent = "";
            }
            break;
          }
          case "remove-attr": {
            const reAttr = regexFromString(arg, true);
            for (const node of nodes) {
              for (const name of node.getAttributeNames()) {
                if (reAttr.test(name) === false) {
                  continue;
                }
                node.removeAttribute(name);
              }
            }
            break;
          }
          case "remove-class": {
            const reClass = regexFromString(arg, true);
            for (const node of nodes) {
              const cl = node.classList;
              for (const name of cl.values()) {
                if (reClass.test(name) === false) {
                  continue;
                }
                cl.remove(name);
              }
            }
            break;
          }
          default:
            break;
        }
      }
      // TODO: Current assumption is one style per hit element. Could be an
      //       issue if an element has multiple styling and one styling is
      //       brought back. Possibly too rare to care about this for now.
      unprocessNodes(nodes) {
        for (const node of nodes) {
          if (this.styledNodes.has(node)) {
            continue;
          }
          node.removeAttribute(this.masterToken);
        }
      }
      createProceduralFilter(o) {
        return this.primeProceduralSelector(
          new PSelectorRoot(typeof o === "string" ? JSON.parse(o) : o)
        );
      }
      onDOMCreated() {
      }
      onDOMChanged(addedNodes, removedNodes) {
        if (this.selectors.size === 0) {
          return;
        }
        this.mustApplySelectors = this.mustApplySelectors || addedNodes.length !== 0 || removedNodes;
        this.domFilterer.commit();
      }
    }
    vAPI.DOMProceduralFilterer = ProceduralFilterer;
    if (vAPI.domFilterer instanceof Object) {
      try {
        vAPI.domFilterer.commitNow();
      } catch (e) {
        console.warn("[uBlock Ultimate] contentscript-extra: procedural startup commit failed", e);
      }
    }
  }
})();
