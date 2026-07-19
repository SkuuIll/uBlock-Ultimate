/*******************************************************************************

    uBlock Ultimate - Content Script Module
    Bootstrap

    Bootstrapping allows all components of the content script
    to be launched if/when needed.

*******************************************************************************/

import { initDOMSurveyor } from "./06-dom-surveyor.ts";
import { initDOMFilterer } from "./04-dom-filterer.ts";
import { initDOMCollapser } from "./05-dom-collapser.ts";

var authorizeCosmetic = async (action: string): Promise<boolean> => {
    try {
        return (self as any).__ubrCapability ? await (self as any).__ubrCapability.validate("cosmetic", action) : false;
    } catch { return false; }
};

interface Messaging {
  send(channel: string, message: object): Promise<unknown>;
}

interface DOMFilterer {
  commitNow(): void;
  exceptions: string[];
  stylesheets: string[];
  addCSS(
    css: string,
    details?: { mustInject?: boolean; silent?: boolean },
  ): void;
  addProceduralSelectors(selectors: unknown[]): void;
  exceptCSSRules(exceptions: string[]): void;
  convertedProceduralFilters: unknown[];
  proceduralFilterer: unknown | null;
  pendingProceduralSelectors: unknown[];
  exceptedCSSRules: string[];
  toggle?(state: boolean): void | Promise<void>;
}

interface DOMWatcher {
  start(): void;
  addListener?(listener: unknown): void;
  removeListener?(listener: unknown): void;
}

interface DOMCollapser {
  start(): void;
}

interface DOMSurveyor {
  start(details: { hostname: string }): void;
  addHashes(hashes: number[]): void;
  stop(): void;
}

interface ShutdownCallbacks {
  add(callback: () => void): void;
}

interface UserStylesheet {
  apply(callback?: () => void): Promise<void>;
  add(cssText: string, now?: boolean): void;
  remove(cssText: string, now?: boolean): void;
  added: Set<string>;
  removed: Set<string>;
  installed: Set<string>;
  desired: Set<string>;
}

interface MouseClick {
  x: number;
  y: number;
}

interface VAPI {
  messaging: Messaging;
  domFilterer: DOMFilterer | null;
  domWatcher: DOMWatcher | null;
  domCollapser: DOMCollapser | null;
  domSurveyor: DOMSurveyor | null;
  domIsLoaded: boolean | null;
  shutdown: ShutdownCallbacks;
  userStylesheet: UserStylesheet;
  effectiveSelf: Window;
  mouseClick: MouseClick;
  noSpecificCosmeticFiltering: boolean;
  noGenericCosmeticFiltering: boolean;
  bootstrap: (() => void) | undefined;
  sanitizeCosmeticCSSForPage?: (css: string) => string;
  sanitizeProceduralSelectorsForPage?: (selectors: unknown[]) => unknown[];
  randomToken(): string;
  contentScript?: boolean;
  DOMFilterer?: new () => {
    addCSS(css: string, options?: { mustInject?: boolean }): void;
    addProceduralSelectors(selectors: unknown[]): void;
    exceptCSSRules(selectors: string[]): void;
    commitNow(): void;
    exceptions: string[];
    stylesheets: string[];
    convertedProceduralFilters: unknown[];
    proceduralFilterer: unknown | null;
    pendingProceduralSelectors: unknown[];
    exceptedCSSRules: string[];
    toggle?(state: boolean, filterer?: unknown): void | Promise<void>;
  };
  pickerURL?: string;
  zap?: boolean;
  eprom?: { eprom?: unknown; [key: string]: unknown };
  getURL?(path: string): string;
  localStorage?: {
    getItemAsync(key: string): Promise<unknown>;
    setItemAsync(key: string, value: unknown): Promise<void>;
  };
  tabs?: {
    query(queryInfo: Record<string, unknown>): Promise<Array<{ id?: number; url?: string; [key: string]: unknown }>>;
    open(details: { url: string; [key: string]: unknown }): void;
    getCurrent(): Promise<{ id?: number; url?: string; [key: string]: unknown }>;
    insertCSS(tabId: number, details: { file?: string; css?: string; [key: string]: unknown }): Promise<void>;
  };
  closePopup(): void;
  hideStyle?: string;
  setTimeout?(fn: () => void, delay: number): number;
  createProceduralFilter?: (o: unknown) => { exec(): Element[]; };
}

declare const vAPI: VAPI;
declare const chrome: typeof globalThis.chrome;

interface CFEDetails {
  ready: boolean;
  hostname?: string;
  injectedCSS?: string;
  proceduralFilters?: unknown[];
  exceptionFilters?: string[];
  exceptedFilters?: string[];
  convertedProceduralFilters?: unknown[];
  genericCosmeticHashes?: number[];
  disableSurveyor?: boolean;
}

interface BootstrapResponse {
  specificCosmeticFilters?: CFEDetails;
  hostname?: string;
  noSpecificCosmeticFiltering?: boolean;
  noGenericCosmeticFiltering?: boolean;
  experimentalHeuristicInterceptorsEnabled?: boolean;
}

type StorageBin = {
  userFilters?: string;
  "user-filters"?: string;
  cosmeticFiltersData?: string;
  selectedFilterLists?: string[];
  perSiteFiltering?: Record<string, boolean>;
  hostnameSwitches?: Record<string, Record<string, boolean>>;
};

type ExtensionStorageLocal = {
  get?: (
    keys: string[],
    callback?: (bin: StorageBin) => void,
  ) => Promise<StorageBin> | void;
  set?: (
    items: Record<string, unknown>,
    callback?: () => void,
  ) => Promise<void> | void;
  remove?: (
    keys: string | string[],
    callback?: () => void,
  ) => Promise<void> | void;
};

type ExtensionGlobal = {
  storage?: {
    local?: ExtensionStorageLocal;
  };
};

type PickerBootArgs = {
  pickerURL?: string;
  zap?: boolean;
  eprom?: unknown;
};

const extensionGlobals = (): {
  browser?: ExtensionGlobal;
  chrome?: ExtensionGlobal;
} => globalThis as unknown as {
  browser?: ExtensionGlobal;
  chrome?: ExtensionGlobal;
};

const isPromiseLike = <T>(value: unknown): value is Promise<T> =>
    value instanceof Object &&
    typeof (value as { then?: unknown }).then === "function";

type ContextMenuTargetDetails = {
  selector: string;
};

const blockLikeTags = new Set([
  "article",
  "aside",
  "div",
  "li",
  "main",
  "section",
]);

const userFilterStyleId = "ublock-resurrected-user-filters";
const cosmeticStartupCloakId = "ublock-resurrected-cosmetic-startup-cloak";
const cosmeticStartupCloakAttr = "data-ubr-cosmetic-startup-cloak";
let cosmeticStartupCloakTimer: ReturnType<typeof setTimeout> | undefined;

export const releaseCosmeticStartupCloak = (): void => {
    if (cosmeticStartupCloakTimer !== undefined) {
        clearTimeout(cosmeticStartupCloakTimer);
        cosmeticStartupCloakTimer = undefined;
    }
    document.documentElement.removeAttribute(cosmeticStartupCloakAttr);
    document.getElementById(cosmeticStartupCloakId)?.remove();
};

export const installCosmeticStartupCloak = (): void => {
    if (document.documentElement.hasAttribute(cosmeticStartupCloakAttr)) {
        return;
    }
    document.documentElement.setAttribute(cosmeticStartupCloakAttr, "1");
    let style = document.getElementById(cosmeticStartupCloakId) as HTMLStyleElement | null;
    if (style === null) {
        style = document.createElement("style");
        style.id = cosmeticStartupCloakId;
        (document.head || document.documentElement).append(style);
    }
    style.textContent = [
        `html[${cosmeticStartupCloakAttr}="1"]`,
        "{opacity:0!important;pointer-events:none!important;transition:none!important;}",
    ].join("\n");
    cosmeticStartupCloakTimer = setTimeout(
        releaseCosmeticStartupCloak,
        1500,
    );
};

const reportStoredUserCosmeticBlockCount = (
    selectors: string[],
    clear = false,
): void => {
    const matched = new Set<Element>();
    for (const selector of selectors) {
        try {
            for (const element of document.querySelectorAll(selector)) {
                matched.add(element);
            }
        } catch (e) {
            console.warn('[uBR] bootstrap: querySelectorAll failed for selector', selector, e);
        }
    }
    try {
        void vAPI.messaging.send("contentscript", {
            what: "cosmeticBlockCount",
            count: matched.size,
            clear,
        });
    } catch (e) {
        console.warn('[uBR] bootstrap: cosmeticBlockCount send failed', e);
    }
};

const removeStoredUserFilterStyle = async (): Promise<void> => {
    if (!(await authorizeCosmetic("remove-style"))) return;
    document.getElementById(userFilterStyleId)?.remove();
    reportStoredUserCosmeticBlockCount([], true);
};

const storageGet = (keys: string[]): Promise<StorageBin> => {
    const browserAPI = extensionGlobals().browser;
    if (browserAPI?.storage?.local?.get instanceof Function) {
        const result = browserAPI.storage.local.get(keys);
        if (isPromiseLike<StorageBin>(result)) {
            return result.then(bin => bin || {});
        }
    }
    const chromeAPI = extensionGlobals().chrome;
    if (chromeAPI?.storage?.local?.get instanceof Function) {
        return new Promise((resolve) => {
            const result = chromeAPI.storage!.local!.get!(keys, (bin: StorageBin) =>
                resolve(bin || {}),
            );
            if (isPromiseLike<StorageBin>(result)) {
                void result.then(bin => resolve(bin || {}));
            }
        });
    }
    return Promise.resolve({});
};

const storageSet = (items: Record<string, unknown>): Promise<void> => {
    const browserAPI = extensionGlobals().browser;
    if (browserAPI?.storage?.local?.set instanceof Function) {
        const result = browserAPI.storage.local.set(items);
        if (isPromiseLike<void>(result)) {
            return result;
        }
        return Promise.resolve();
    }
    const chromeAPI = extensionGlobals().chrome;
    if (chromeAPI?.storage?.local?.set instanceof Function) {
        return new Promise((resolve) => {
            const result = chromeAPI.storage!.local!.set!(items, () => resolve());
            if (isPromiseLike<void>(result)) {
                void result.then(() => resolve());
            }
        });
    }
    return Promise.resolve();
};

const storageRemove = (keys: string | string[]): Promise<void> => {
    const browserAPI = extensionGlobals().browser;
    if (browserAPI?.storage?.local?.remove instanceof Function) {
        const result = browserAPI.storage.local.remove(keys);
        if (isPromiseLike<void>(result)) {
            return result;
        }
        return Promise.resolve();
    }
    const chromeAPI = extensionGlobals().chrome;
    if (chromeAPI?.storage?.local?.remove instanceof Function) {
        return new Promise((resolve) => {
            const result = chromeAPI.storage!.local!.remove!(keys, () => resolve());
            if (isPromiseLike<void>(result)) {
                void result.then(() => resolve());
            }
        });
    }
    return Promise.resolve();
};

const matchesFilterHostname = (
    filterHostname: string,
    pageHostname: string,
): boolean => {
    if (filterHostname === "") {
        return true;
    }
    return (
        pageHostname === filterHostname ||
    pageHostname.endsWith(`.${filterHostname}`)
    );
};

const cosmeticFilterApplies = (
    scope: string,
    pageHostname: string,
): boolean => {
    const tokens = scope
        .split(",")
        .map(token => token.trim())
        .filter(Boolean);
    if (tokens.length === 0) {
        return true;
    }
    let hasInclude = false;
    let included = false;
    for (const token of tokens) {
        const negated = token.startsWith("~");
        const hostname = negated ? token.slice(1) : token;
        const matched = hostname === "*" || matchesFilterHostname(hostname, pageHostname);
        if (negated && matched) {
            return false;
        }
        if (negated === false) {
            hasInclude = true;
            included = included || matched;
        }
    }
    return hasInclude ? included : true;
};

const hasSafeCosmeticFilterScope = (scope: string): boolean => {
    if (scope === "" || scope === "*") {
        return false;
    }
    return scope.split(",").every((rawToken) => {
        const token = rawToken.trim();
        return (
            token !== "" &&
            token.startsWith("~") === false &&
            token.includes("*") === false &&
            /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9-]+$/i.test(token)
        );
    });
};

const youtubeUIProtectedIds = [
  "container",
  "center",
  "start",
  "end",
  "guide-button",
  "logo",
  "search-button-narrow",
  "voice-search-button",
];

const isYouTubeHostname = (hostname: string): boolean =>
    hostname === "youtube.com" ||
  hostname.endsWith(".youtube.com") ||
  hostname === "youtu.be";

let youtubeProtectedProbeElements: Element[] | undefined;

const getYouTubeProtectedProbeElements = (): Element[] => {
    if (youtubeProtectedProbeElements !== undefined) {
        return youtubeProtectedProbeElements;
    }
    const probeDocument = document.implementation.createHTMLDocument("");
    const masthead = document.createElement("ytd-masthead");
    masthead.className = "style-scope ytd-app";
    const container = document.createElement("div");
    container.id = "container";
    container.className = "style-scope ytd-masthead";
    const start = document.createElement("div");
    start.id = "start";
    start.className = "style-scope ytd-masthead";
    const center = document.createElement("div");
    center.id = "center";
    center.className = "style-scope ytd-masthead";
    const end = document.createElement("div");
    end.id = "end";
    end.className = "style-scope ytd-masthead";
    const searchbox = document.createElement("yt-searchbox");
    searchbox.className = "ytSearchboxComponentHost ytd-masthead";
    const guideButton = document.createElement("yt-icon-button");
    guideButton.id = "guide-button";
    guideButton.className = "style-scope ytd-masthead";
    const logo = document.createElement("ytd-topbar-logo-renderer");
    logo.id = "logo";
    logo.className = "style-scope ytd-masthead";
    const narrowSearch = document.createElement("yt-icon-button");
    narrowSearch.id = "search-button-narrow";
    narrowSearch.className = "style-scope ytd-masthead";
    const voiceSearch = document.createElement("div");
    voiceSearch.id = "voice-search-button";
    voiceSearch.className = "style-scope ytd-masthead";
  center.append(searchbox, narrowSearch, voiceSearch);
  start.append(guideButton, logo);
  container.append(start, center, end);
  masthead.append(container);
  probeDocument.body.append(masthead);
  youtubeProtectedProbeElements = [
    masthead,
    container,
    start,
    center,
    end,
    searchbox,
    guideButton,
    logo,
    narrowSearch,
    voiceSearch,
  ];
  return youtubeProtectedProbeElements;
};

const selectorMatchesAny = (selector: string, elements: Element[]): boolean => {
    for (const element of elements) {
        try {
            if (element.matches(selector)) {
                return true;
            }
        } catch {
            return false;
        }
    }
    return false;
};

const selectorMatchesYouTubeProtectedUI = (selector: string): boolean => {
    const actual = Array.from(
    document.querySelectorAll(
      [
        "ytd-masthead",
        "ytd-masthead #container",
        "ytd-masthead #start",
        "ytd-masthead #center",
        "ytd-masthead #end",
        "ytd-masthead yt-searchbox",
        "ytd-masthead #guide-button",
        "ytd-masthead #logo",
        "ytd-masthead #search-button-narrow",
        "ytd-masthead #voice-search-button",
      ].join(","),
    ),
    );
    return (
        selectorMatchesAny(selector, actual) ||
    selectorMatchesAny(selector, getYouTubeProtectedProbeElements())
    );
};

const selectorTargetsYouTubeMasthead = (selector: string): boolean => {
    const normalized = selector.toLowerCase();
    const compact = normalized.replace(/\s+/g, "");
    if (
    normalized.includes("ytd-masthead") ||
    normalized.includes("ytd-topbar") ||
    normalized.includes("yt-searchbox")
    ) {
        return true;
    }
    if (
        compact === ".style-scope" ||
    compact === "*.style-scope" ||
    compact === "div.style-scope" ||
    /\[class[*~|^$]?=(["'])?style-scope\1?\]/.test(compact)
    ) {
        return true;
    }
    const idGroup = youtubeUIProtectedIds.join("|");
    return (
    new RegExp(`(^|[^\\w-])#(?:${idGroup})(?:$|[^\\w-])`).test(normalized) ||
    new RegExp(`\\[id\\s*=\\s*["']?(?:${idGroup})["']?\\]`).test(normalized) ||
    selectorMatchesYouTubeProtectedUI(selector)
    );
};

const removeStaleYouTubeMastheadRules = (
    text: string,
    _pageHostname: string,
): { content: string; removed: string[] } => ({
    content: text.trimEnd(),
    removed: [],
});

const cleanupStoredYouTubeMastheadFilters = async (
    bin: StorageBin,
    pageHostname: string,
): Promise<string[]> => {
    if (isYouTubeHostname(pageHostname) === false) {
        return [];
    }
    const sources = [
    typeof bin.userFilters === "string" ? bin.userFilters : "",
    typeof bin["user-filters"] === "string" ? bin["user-filters"] : "",
    ].filter((value) => value !== "");
    if (sources.length === 0) {
        return [];
    }
    const removed: string[] = [];
    const seen = new Set<string>();
    const mergedLines: string[] = [];
    for (const source of sources) {
        const cleaned = removeStaleYouTubeMastheadRules(source, pageHostname);
    removed.push(...cleaned.removed);
    for (const line of cleaned.content.split(/\r?\n/)) {
        const key = line.trim();
        if (key === "" || seen.has(key)) {
            continue;
        }
      seen.add(key);
      mergedLines.push(line);
    }
    }
    if (removed.length === 0) {
        return [];
    }
    const content = mergedLines.join("\n").trimEnd();
    bin.userFilters = content;
    bin["user-filters"] = content;
    await storageSet({
    userFilters: content,
    "user-filters": content,
    });
    await storageRemove("cosmeticFiltersData");
    try {
    new BroadcastChannel("uBR").postMessage({ what: "userFiltersUpdated" });
    } catch (e) {
    console.warn('[uBR] bootstrap: BroadcastChannel userFiltersUpdated failed', e);
    }
    return removed;
};

const splitSelectorList = (selectorList: string): string[] => {
    const selectors: string[] = [];
    let current = "";
    let quote = "";
    let escape = false;
    let depth = 0;
    for (const char of selectorList) {
        if (escape) {
            current += char;
            escape = false;
            continue;
        }
        if (char === "\\") {
            current += char;
            escape = true;
            continue;
        }
        if (quote !== "") {
            current += char;
            if (char === quote) {
                quote = "";
            }
            continue;
        }
        if (char === '"' || char === "'") {
            current += char;
            quote = char;
            continue;
        }
        if (char === "(" || char === "[") {
            depth += 1;
            current += char;
            continue;
        }
        if ((char === ")" || char === "]") && depth > 0) {
            depth -= 1;
            current += char;
            continue;
        }
        if (char === "," && depth === 0) {
            const selector = current.trim();
            if (selector !== "") {
        selectors.push(selector);
            }
            current = "";
            continue;
        }
        current += char;
    }
    const selector = current.trim();
    if (selector !== "") {
    selectors.push(selector);
    }
    return selectors;
};

const watchStoredUserFilters = (): void => {
    const onChanged = globalThis.chrome?.storage?.onChanged;
    if (onChanged?.addListener instanceof Function === false) {
        return;
    }
    const listener = (
        changes: Record<string, unknown>,
        areaName: string,
    ): void => {
        if (
            areaName !== "local" ||
            [
                "userFilters",
                "user-filters",
                "selectedFilterLists",
            ].some((key) => Object.hasOwn(changes, key)) === false
        ) {
            return;
        }
        void applyStoredUserFilters();
    };
    onChanged.addListener(listener);
    vAPI.shutdown.add(() => onChanged.removeListener(listener));
};

const sanitizeYouTubeCosmeticCSS = (
    css: string,
    pageHostname: string,
): { css: string; removed: string[] } => {
    if (isYouTubeHostname(pageHostname) === false || css.trim() === "") {
        return { css, removed: [] };
    }
    const blockStart = css.lastIndexOf("{");
    const blockEnd = css.lastIndexOf("}");
    if (blockStart === -1 || blockEnd === -1 || blockEnd < blockStart) {
        return { css, removed: [] };
    }
    const body = css.slice(blockStart, blockEnd + 1);
    if (/display\s*:\s*none\s*!important/i.test(body) === false) {
        return { css, removed: [] };
    }
    const kept: string[] = [];
    const removed: string[] = [];
    for (const selector of splitSelectorList(css.slice(0, blockStart))) {
        if (selectorTargetsYouTubeMasthead(selector)) {
      removed.push(selector);
        } else {
      kept.push(selector);
        }
    }
    return {
    css: kept.length === 0 ? "" : `${kept.join(",\n")}\n${body}`,
    removed,
    };
};

const proceduralInputSelector = (raw: unknown): string => {
    if (typeof raw === "string") {
        return raw;
    }
    if (
        raw !== null &&
    typeof raw === "object" &&
    typeof (raw as { selector?: unknown }).selector === "string"
    ) {
        return (raw as { selector: string }).selector;
    }
    return "";
};

const proceduralSelectorTargetsYouTubeMasthead = (raw: unknown): boolean => {
    let parsed: {
        selector?: unknown;
        raw?: unknown;
        tasks?: unknown;
        action?: unknown;
    };
    if (raw !== null && typeof raw === "object") {
        parsed = raw as typeof parsed;
    } else {
        try {
            parsed = JSON.parse(String(raw || ""));
        } catch {
            return selectorTargetsYouTubeMasthead(proceduralInputSelector(raw));
        }
    }
    const selectors = [
    proceduralInputSelector(raw),
    typeof parsed.selector === "string" ? parsed.selector : "",
    typeof parsed.raw === "string" ? parsed.raw : "",
    ];
    if (Array.isArray(parsed.tasks)) {
        for (const task of parsed.tasks) {
            if (Array.isArray(task) && typeof task[1] === "string") {
        selectors.push(task[1]);
            }
            if (
        Array.isArray(task) &&
        task[1] !== null &&
        typeof task[1] === "object" &&
        typeof (task[1] as { selector?: unknown }).selector === "string"
            ) {
        selectors.push((task[1] as { selector: string }).selector);
            }
        }
    }
    return selectors.some(
        (selector) =>
            selector !== "" && selectorTargetsYouTubeMasthead(selector),
    );
};

const sanitizeYouTubeProceduralSelectors = (
    selectors: unknown[],
    pageHostname: string,
): { selectors: unknown[]; removed: string[] } => {
    if (isYouTubeHostname(pageHostname) === false || selectors.length === 0) {
        return { selectors, removed: [] };
    }
    const kept: unknown[] = [];
    const removed: string[] = [];
    for (const selector of selectors) {
        if (proceduralSelectorTargetsYouTubeMasthead(selector)) {
      removed.push(proceduralInputSelector(selector));
        } else {
      kept.push(selector);
        }
    }
    return { selectors: kept, removed };
};

const proceduralPrehideOperatorNames = [
    "has-text",
    "matches-path",
    "matches-css-after",
    "matches-css-before",
    "matches-css",
    "matches-attr",
    "matches-prop",
    "matches-media",
    "min-text-length",
    "watch-attr",
    "remove-class",
    "remove-attr",
    "upward",
    "xpath",
    "spath",
    "shadow",
    "others",
    "if-not",
    "has",
    "if",
    "not",
    "remove",
];

const topLevelProceduralOperatorIndex = (selector: string): number => {
    let quote = "";
    let escaped = false;
    let squareDepth = 0;
    let parenDepth = 0;
    for (let i = 0; i < selector.length; i += 1) {
        const ch = selector[i];
        if (escaped) {
            escaped = false;
            continue;
        }
        if (ch === "\\") {
            escaped = true;
            continue;
        }
        if (quote !== "") {
            if (ch === quote) {
                quote = "";
            }
            continue;
        }
        if (ch === '"' || ch === "'") {
            quote = ch;
            continue;
        }
        if (ch === "[") {
            squareDepth += 1;
            continue;
        }
        if (ch === "]" && squareDepth !== 0) {
            squareDepth -= 1;
            continue;
        }
        if (squareDepth !== 0) {
            continue;
        }
        if (ch === "(") {
            parenDepth += 1;
            continue;
        }
        if (ch === ")" && parenDepth !== 0) {
            parenDepth -= 1;
            continue;
        }
        if (ch !== ":" || parenDepth !== 0) {
            continue;
        }
        for (const operator of proceduralPrehideOperatorNames) {
            if (selector.startsWith(`${operator}(`, i + 1)) {
                return i;
            }
        }
    }
    return -1;
};

const isProceduralCosmeticSelector = (selector: string): boolean =>
    selector.trim().startsWith("{") ||
    topLevelProceduralOperatorIndex(selector) !== -1;

const hasSpecificPrehideAnchor = (selector: string): boolean =>
    selector !== "" &&
    selector !== "*" &&
    (selector.includes("#") || selector.includes(".") || selector.includes("[")) &&
    /[>+~]$/.test(selector) === false;

const topLevelProceduralOperatorArgument = (
    selector: string,
    wantedOperator: string,
): string => {
    let quote = "";
    let escaped = false;
    let squareDepth = 0;
    let parenDepth = 0;
    for (let i = 0; i < selector.length; i += 1) {
        const ch = selector[i];
        if (escaped) {
            escaped = false;
            continue;
        }
        if (ch === "\\") {
            escaped = true;
            continue;
        }
        if (quote !== "") {
            if (ch === quote) {
                quote = "";
            }
            continue;
        }
        if (ch === '"' || ch === "'") {
            quote = ch;
            continue;
        }
        if (ch === "[") {
            squareDepth += 1;
            continue;
        }
        if (ch === "]" && squareDepth !== 0) {
            squareDepth -= 1;
            continue;
        }
        if (squareDepth !== 0) {
            continue;
        }
        if (ch === "(") {
            parenDepth += 1;
            continue;
        }
        if (ch === ")" && parenDepth !== 0) {
            parenDepth -= 1;
            continue;
        }
        if (ch !== ":" || parenDepth !== 0) {
            continue;
        }
        if (selector.startsWith(`${wantedOperator}(`, i + 1) === false) {
            continue;
        }
        const argStart = i + wantedOperator.length + 2;
        const argEnd = selector.indexOf(")", argStart);
        return argEnd === -1 ? "" : selector.slice(argStart, argEnd).trim();
    }
    return "";
};

const ancestorPrehideSelectorFromUpward = (
    selector: string,
    anchorSelector: string,
): string => {
    const upwardArg = topLevelProceduralOperatorArgument(selector, "upward");
    if (/^\d+$/.test(upwardArg) === false) {
        return "";
    }
    const distance = parseInt(upwardArg, 10);
    if (distance < 1 || distance > 8) {
        return "";
    }
    const chain = [
        ...Array.from({ length: distance - 1 }, () => "*"),
        anchorSelector,
    ].join(" > ");
    return `:is(article,aside,div,li,main,nav,section):has(> ${chain})`;
};

const prehideSelectorFromProceduralSelector = (raw: string): string => {
    const selector = proceduralInputSelector(raw).trim();
    if (selector === "" || selector.startsWith("{")) {
        return "";
    }
    const operatorIndex = topLevelProceduralOperatorIndex(selector);
    if (operatorIndex === -1) {
        return "";
    }
    const prehide = selector.slice(0, operatorIndex).trim();
    if (hasSpecificPrehideAnchor(prehide) === false) {
        return "";
    }
    const ancestorPrehide = ancestorPrehideSelectorFromUpward(selector, prehide);
    const selectors = ancestorPrehide === ""
        ? prehide
        : `${ancestorPrehide},\n${prehide}`;
    try {
        document.querySelector(selectors);
    } catch {
        return "";
    }
    return selectors;
};

const cosmeticCacheEntrySelector = (entry: unknown): string => {
    if (typeof entry === "string") {
        return entry;
    }
    if (Array.isArray(entry)) {
        return typeof entry[0] === "string" ? entry[0] : "";
    }
    if (
        entry !== null &&
    typeof entry === "object" &&
    typeof (entry as { selector?: unknown }).selector === "string"
    ) {
        return (entry as { selector: string }).selector;
    }
    return "";
};

const scrubStoredCosmeticCacheSelectors = async (
    selectors: string[],
): Promise<void> => {
    const removeSet = new Set(selectors);
    if (removeSet.size === 0) {
        return;
    }
    const stored = await storageGet(["cosmeticFiltersData"]);
    if (typeof stored.cosmeticFiltersData !== "string" || stored.cosmeticFiltersData === "") {
        return;
    }
    let data: {
    genericCosmeticFilters?: unknown[];
    genericCosmeticExceptions?: unknown[];
    specificCosmeticFilters?: unknown[];
    scriptletFilters?: unknown[];
  };
    try {
        data = JSON.parse(stored.cosmeticFiltersData);
    } catch (e) {
        console.warn('[uBR] bootstrap: JSON.parse cosmeticFiltersData failed', e);
        return;
    }
    const generic = Array.isArray(data.genericCosmeticFilters)
        ? data.genericCosmeticFilters
        : [];
    const specific = Array.isArray(data.specificCosmeticFilters)
        ? data.specificCosmeticFilters
        : [];
    const nextGeneric = generic.filter(
        (entry) => removeSet.has(cosmeticCacheEntrySelector(entry)) === false,
    );
    const nextSpecific = specific.filter(
        (entry) => removeSet.has(cosmeticCacheEntrySelector(entry)) === false,
    );
    if (nextGeneric.length === generic.length && nextSpecific.length === specific.length) {
        return;
    }
    await storageSet({
    cosmeticFiltersData: JSON.stringify({
      ...data,
      genericCosmeticFilters: nextGeneric,
      specificCosmeticFilters: nextSpecific,
    }),
    });
    try {
    new BroadcastChannel("uBR").postMessage({ what: "userFiltersUpdated" });
    } catch (e) {
    console.warn('[uBR] bootstrap: BroadcastChannel userFiltersUpdated failed', e);
    }
};

if (typeof vAPI === "object") {
  vAPI.sanitizeCosmeticCSSForPage = (css: string): string => {
      const sanitized = sanitizeYouTubeCosmeticCSS(css, self.location.hostname);
      if (sanitized.removed.length !== 0) {
          void scrubStoredCosmeticCacheSelectors(sanitized.removed);
      }
      return sanitized.css;
  };
  vAPI.sanitizeProceduralSelectorsForPage = (selectors: unknown[]): unknown[] => {
      const sanitized = sanitizeYouTubeProceduralSelectors(
          selectors,
      self.location.hostname,
      );
      if (sanitized.removed.length !== 0) {
          void scrubStoredCosmeticCacheSelectors(sanitized.removed);
      }
      return sanitized.selectors;
  };
}

const cleanupOwnedYouTubeMastheadStyles = (): void => {
    if (isYouTubeHostname(self.location.hostname) === false) {
        return;
    }
    const ownedStyles = document.querySelectorAll<HTMLStyleElement>(
        `style[data-ubr-cosmetic], style#${userFilterStyleId}`,
    );
    for (const style of ownedStyles) {
        const sanitized = sanitizeYouTubeCosmeticCSS(
            style.textContent || "",
      self.location.hostname,
        );
        if (sanitized.removed.length === 0) {
            continue;
        }
        void scrubStoredCosmeticCacheSelectors(sanitized.removed);
        if (sanitized.css === "") {
      style.remove();
        } else {
            style.textContent = sanitized.css;
        }
    }
};

const collectStoredCosmeticSelectors = (
    rawFilters: string,
    pageHostname: string,
): string[] => {
    const selectors: string[] = [];
    const seen = new Set<string>();
    for (const line of rawFilters.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (trimmed === "" || trimmed.startsWith("!")) {
            continue;
        }
        if (trimmed.includes("#@#")) {
            continue;
        }
        const sep = trimmed.indexOf("##");
        if (sep === -1) {
            continue;
        }
        const scope = trimmed.slice(0, sep).trim();
        const selector = trimmed.slice(sep + 2).trim();
        if (selector === "" || cosmeticFilterApplies(scope, pageHostname) === false) {
            continue;
        }
        const cssSelector = isProceduralCosmeticSelector(selector)
            ? prehideSelectorFromProceduralSelector(selector)
            : selector;
        if (cssSelector === "" || seen.has(cssSelector)) {
            continue;
        }
        if (
            isYouTubeHostname(pageHostname) &&
            selectorTargetsYouTubeMasthead(cssSelector)
        ) {
            continue;
        }
        seen.add(cssSelector);
        selectors.push(cssSelector);
    }
    return selectors;
};

const cssEscape = (value: string): string => {
    if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
        return CSS.escape(value);
    }
    return value.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
};

const nthOfTypeIndex = (elem: Element): number => {
    let index = 1;
    let prev = elem.previousElementSibling;
    while (prev !== null) {
        if (prev.localName === elem.localName) {
            index += 1;
        }
        prev = prev.previousElementSibling;
    }
    return index;
};

const distanceToAncestor = (
    start: Element,
    matcher: string,
): { element: Element; distance: number } | undefined => {
    let current: Element | null = start;
    let distance = 0;
    while (current !== null && current !== document.documentElement) {
        if (current.matches(matcher)) {
            return { element: current, distance };
        }
        current = current.parentElement;
        distance += 1;
    }
};

const buildContextMenuTargetSelector = (elem: Element | null): string => {
    if (elem === null) {
        return "";
    }

    const parts: string[] = [];
    let current: Element | null = elem;
    let depth = 0;

    while (
        current !== null &&
    current !== document.documentElement &&
    depth < 5
    ) {
        let part = current.localName || "*";
        const id = current.getAttribute("id") || "";
        if (id !== "") {
            part += `#${cssEscape(id)}`;
      parts.unshift(part);
      break;
        }

        const classAttr = current.getAttribute("class") || "";
        const classes = classAttr
      .split(/\s+/)
      .map((token) => token.trim())
      .filter(Boolean)
      .slice(0, 6);
        if (classes.length !== 0) {
            part += classes.map((name) => `.${cssEscape(name)}`).join("");
        }

        const href = current.getAttribute("href");
        if (href) {
            part += `[href="${cssEscape(href)}"]`;
        }
        const src = current.getAttribute("src");
        if (src) {
            part += `[src="${cssEscape(src)}"]`;
        }
        const eventAction = current.getAttribute("data-event-action");
        if (eventAction) {
            part += `[data-event-action="${cssEscape(eventAction)}"]`;
        }

        if (classes.length === 0 && !href && !src && !eventAction) {
            part += `:nth-of-type(${nthOfTypeIndex(current)})`;
        }

    parts.unshift(part);
    current = current.parentElement;
    depth += 1;
    }

    return parts.join(" > ");
};

const getContextMenuTargetDetails = (
    ev: MouseEvent,
): ContextMenuTargetDetails | undefined => {
    const rawTarget = ev.target;
    const element =
    rawTarget instanceof Element
        ? rawTarget
        : rawTarget instanceof Node
            ? rawTarget.parentElement
            : null;
    if (element === null) {
        return;
    }

    const actionable = distanceToAncestor(
        element,
        "a[href], img[src], iframe[src], video[src], audio[src], [data-event-action], [href], [src]",
    );
    const identifiable = distanceToAncestor(element, "[id]");
    const actionableElement = actionable?.element;
    const actionableTag = actionableElement?.localName || "";
    const actionableEvent =
    actionableElement?.getAttribute("data-event-action") || "";
    const identifiableElement = identifiable?.element;
    const identifiableTag = identifiableElement?.localName || "";

    // Prefer the nearest meaningful exact element:
    // - if the click landed directly on an element with an id, use it
    // - if the actionable target is an explicit "title", keep it
    // - if a nearby block-like id container wraps an actionable link, prefer the container
    // - otherwise use the closer actionable/id ancestor
    const preferred =
    identifiable?.distance === 0
        ? identifiable.element
        : actionableEvent === "title"
            ? actionableElement
            : identifiable && actionable
                ? actionableTag === "a" &&
            blockLikeTags.has(identifiableTag) &&
            identifiable.distance <= actionable.distance + 2
                    ? identifiable.element
                    : identifiable.distance <= actionable.distance + 1
                        ? identifiable.element
                        : actionable.element
                : actionable?.element ||
            identifiable?.element ||
            element.closest("[class]") ||
            element;
    const selector = buildContextMenuTargetSelector(preferred);
    if (selector === "") {
        return;
    }
    return { selector };
};

const removeAllCosmeticCSS = (): void => {
    const df = vAPI.domFilterer;
    if (df instanceof Object) {
        // Remove old CSS individually from userStylesheet
        for (const css of df.stylesheets || []) {
            vAPI.userStylesheet.remove(css);
        }
        df.stylesheets = [];

        // Destroy procedural filterer properly
        if (df.proceduralFilterer instanceof Object) {
            if (typeof (df.proceduralFilterer as any).destroy === "function") {
                (df.proceduralFilterer as any).destroy();
            } else {
                // Fallback: disconnect mutation observer
                if (typeof (df.proceduralFilterer as any).stopMutationObserver === "function") {
                    (df.proceduralFilterer as any).stopMutationObserver();
                }
                if (vAPI.domWatcher instanceof Object && typeof vAPI.domWatcher.removeListener === "function") {
                    vAPI.domWatcher.removeListener(df.proceduralFilterer);
                }
            }
        }
        df.proceduralFilterer = null;
        df.pendingProceduralSelectors = [];
        df.exceptions = [];
        df.exceptedCSSRules = [];
        df.convertedProceduralFilters = [];
    }

    // Stop surveyor properly
    if (vAPI.domSurveyor instanceof Object) {
        if (typeof vAPI.domSurveyor.stop === "function") {
            vAPI.domSurveyor.stop();
        }
        vAPI.domSurveyor = null;
    }

};

const ensureCosmeticRuntime = (): void => {
    if (typeof vAPI.DOMFilterer !== "function") {
        initDOMFilterer();
    }
    if (vAPI.domCollapser instanceof Object === false) {
        initDOMCollapser();
    }
};

const collectPageSignals = () => ({
    hasContentEditable:
        document.querySelector("[contenteditable]") !== null,
    hasLargeAppRoot:
        document.querySelector(
            "#root, #app, #__next, main, .shell",
        ) !== null,
    hasAuthForm:
        document.querySelector(
            'input[type="password"], form[action*="login"], form[action*="auth"]',
        ) !== null,
    hasPaymentForm:
        document.querySelector(
            'input[autocomplete="cc-number"]',
        ) !== null,
    isArticle:
        document.querySelector(
            'article, [role="article"]',
        ) !== null,
    isVideoPage:
        Array.from(
            document.querySelectorAll("video"),
        ).some(video => (video as HTMLVideoElement).clientWidth >= 320),
});

const validatePolicyResponse = (response: unknown): response is BootstrapResponse => {
    if (response === null || typeof response !== "object") return false;
    const r = response as Record<string, unknown>;
    if (r.error !== undefined) return false;
    const cfe = r.specificCosmeticFilters;
    if (!cfe || typeof cfe !== "object") return false;
    return (cfe as Record<string, unknown>).ready === true;
};

export const reconcilePolicyResponse = async (response: unknown): Promise<void> => {
    if (validatePolicyResponse(response) === false) return;
    const res = response as BootstrapResponse;

    // Authorization gates at actual mutation points
    if (!(await authorizeCosmetic("remove-style"))) return;
    removeAllCosmeticCSS();
    cleanupOwnedYouTubeMastheadStyles();

    const cfeDetails = res.specificCosmeticFilters!;
    if (!cfeDetails.ready) {
        await vAPI.userStylesheet.apply();
        return;
    }

    ensureCosmeticRuntime();

    if (vAPI.domCollapser instanceof Object) {
        vAPI.domCollapser.start();
    }

    const { noSpecificCosmeticFiltering, noGenericCosmeticFiltering } = res;
    vAPI.noSpecificCosmeticFiltering = noSpecificCosmeticFiltering || false;
    vAPI.noGenericCosmeticFiltering = noGenericCosmeticFiltering || false;

    if (noSpecificCosmeticFiltering && noGenericCosmeticFiltering) {
        vAPI.domFilterer = null;
        vAPI.domSurveyor = null;
        await vAPI.userStylesheet.apply();
    } else {
        const domFilterer = new vAPI.DOMFilterer();
        vAPI.domFilterer = domFilterer;
        if (noGenericCosmeticFiltering || cfeDetails.disableSurveyor) {
            vAPI.domSurveyor = null;
        }
        const sanitized = sanitizeYouTubeCosmeticCSS(
            cfeDetails.injectedCSS || "",
            self.location.hostname,
        );
        if (sanitized.removed.length !== 0) {
            cfeDetails.injectedCSS = sanitized.css;
            void scrubStoredCosmeticCacheSelectors(sanitized.removed);
        }
        const sanitizedProcedural = sanitizeYouTubeProceduralSelectors(
            cfeDetails.proceduralFilters || [],
            self.location.hostname,
        );
        if (sanitizedProcedural.removed.length !== 0) {
            cfeDetails.proceduralFilters = sanitizedProcedural.selectors;
            void scrubStoredCosmeticCacheSelectors(sanitizedProcedural.removed);
        }
        domFilterer.exceptions = cfeDetails.exceptionFilters || [];
        if (!(await authorizeCosmetic("inject-css"))) return;
        domFilterer.addCSS(cfeDetails.injectedCSS || "", { mustInject: true });
        if (!(await authorizeCosmetic("dom-remove"))) return;
        domFilterer.addProceduralSelectors(cfeDetails.proceduralFilters || []);
        domFilterer.exceptCSSRules(cfeDetails.exceptedFilters || []);
        domFilterer.convertedProceduralFilters = cfeDetails.convertedProceduralFilters || [];
        await vAPI.userStylesheet.apply();
        domFilterer.commitNow();

        if (vAPI.domSurveyor === null && (noGenericCosmeticFiltering !== true && cfeDetails.disableSurveyor !== true)) {
            initDOMSurveyor();
        }
    }

    if (vAPI.domSurveyor) {
        if (Array.isArray(cfeDetails.genericCosmeticHashes)) {
            vAPI.domSurveyor.addHashes(cfeDetails.genericCosmeticHashes);
        }
        if (typeof cfeDetails.hostname !== "string" || cfeDetails.hostname === "") {
            cfeDetails.hostname = typeof res.hostname === "string" && res.hostname !== ""
                ? res.hostname
                : self.location.hostname;
        }
        vAPI.domSurveyor.start({ ...cfeDetails, hostname: cfeDetails.hostname });
    }
};

const applyStoredUserFilters = async (): Promise<void> => {
    if (!(await authorizeCosmetic("inject-css"))) return;
    await removeStoredUserFilterStyle();
    if (typeof vAPI?.messaging?.send !== "function") {
        return;
    }
    try {
        const response = await vAPI.messaging.send("contentscript", {
            what: "retrieveContentScriptParameters",
            url: self.location.href,
            needScriptlets: false,
        });
        await reconcilePolicyResponse(response);
    } catch (e) {
        console.warn('[uBR] bootstrap: re-request failed', e);
    }
};

const applyImmediatePowerSwitchState = async (
    enabled: boolean,
): Promise<void> => {
    const style = document.getElementById(userFilterStyleId);
    if (enabled) {
        await applyStoredUserFilters();
    await vAPI.domFilterer?.toggle?.(true);
    vAPI.domFilterer?.commitNow?.();
    return;
    }

  style?.remove();
  vAPI.domFilterer?.toggle?.(false);
  vAPI.domFilterer?.commitNow?.();
};

const hostnameSwitchStyleIds: Record<string, string> = {
  "no-remote-fonts": "ublock-resurrected-no-remote-fonts",
};

const LARGE_MEDIA_MIN_DIM = 200;

let noLargeMediaObserver: MutationObserver | null = null;
const noLargeMediaPlaceholderId = "ublock-resurrected-no-large-media";

const restoreLargeMediaElements = () => {
    document.querySelectorAll(`[data-ubr-no-large-media-saved]`).forEach(el => {
        const saved = (el as HTMLElement).dataset.ubrNoLargeMediaSaved;
        if (!saved) return;
        try {
            el.outerHTML = saved;
        } catch {}
    });
};

const replaceLargeMediaWithPlaceholder = (el: HTMLVideoElement | HTMLAudioElement) => {
    if (el.dataset.ubrNoLargeMediaProcessed === "true") return;
    el.dataset.ubrNoLargeMediaProcessed = "true";
    const rect = el.getBoundingClientRect();
    if (rect.width < LARGE_MEDIA_MIN_DIM && rect.height < LARGE_MEDIA_MIN_DIM) return;
    const placeholder = document.createElement("div");
    placeholder.style.cssText = `display:flex;align-items:center;justify-content:center;min-width:${Math.max(rect.width || 320, 160)}px;min-height:${Math.max(rect.height || 180, 90)}px;background:#f0f0f0;border:1px solid #ccc;cursor:pointer;font-family:system-ui,sans-serif;font-size:14px;color:#555;`;
    placeholder.textContent = "Click to load media";
    placeholder.dataset.ubrNoLargeMediaSaved = el.outerHTML;
    placeholder.addEventListener("click", function clickHandler() {
        const saved = this.dataset.ubrNoLargeMediaSaved;
        if (saved) {
            this.outerHTML = saved;
        }
    });
    el.parentNode?.replaceChild(placeholder, el);
};

const scanAndReplaceLargeMedia = () => {
    const mediaElements = document.querySelectorAll<HTMLVideoElement | HTMLAudioElement>("video, audio");
    for (const el of mediaElements) {
        replaceLargeMediaWithPlaceholder(el);
    }
};

const enableNoLargeMedia = () => {
    const placeholderEl = document.getElementById(noLargeMediaPlaceholderId) as HTMLStyleElement | null;
    if (placeholderEl) return;
    const style = document.createElement("style");
    style.id = noLargeMediaPlaceholderId;
    style.textContent = `[data-ubr-no-large-media-processed="true"] { display: none; }`;
    (document.head || document.documentElement).append(style);
    scanAndReplaceLargeMedia();
    if (noLargeMediaObserver === null) {
        noLargeMediaObserver = new MutationObserver(() => {
            if (document.querySelector(`#${noLargeMediaPlaceholderId}`) === null) {
                noLargeMediaObserver?.disconnect();
                noLargeMediaObserver = null;
                return;
            }
            scanAndReplaceLargeMedia();
        });
        noLargeMediaObserver.observe(document.documentElement, { childList: true, subtree: true });
    }
};

const disableNoLargeMedia = () => {
    if (noLargeMediaObserver !== null) {
        noLargeMediaObserver.disconnect();
        noLargeMediaObserver = null;
    }
    document.getElementById(noLargeMediaPlaceholderId)?.remove();
    restoreLargeMediaElements();
};

const upsertStyle = async (id: string, css: string, enabled: boolean): Promise<void> => {
    if (enabled) {
        if (!(await authorizeCosmetic("inject-css"))) return;
    } else {
        if (!(await authorizeCosmetic("remove-style"))) return;
    }
    let style = document.getElementById(id) as HTMLStyleElement | null;
    if (enabled) {
        if (style === null) {
            style = document.createElement("style");
            style.id = id;
      (document.head || document.documentElement).append(style);
        }
        style.textContent = css;
        return;
    }
  style?.remove();
};

const applyImmediateHostnameSwitchState = async (
    name: string,
    enabled: boolean,
): Promise<void> => {
    switch (name) {
    case "no-cosmetic-filtering":
        await applyImmediatePowerSwitchState(!enabled);
        break;
    case "no-large-media":
        if (enabled) {
            enableNoLargeMedia();
        } else {
            disableNoLargeMedia();
        }
        break;
    case "no-remote-fonts":
        await upsertStyle(
        hostnameSwitchStyleIds["no-remote-fonts"],
        "html, body, body * { font-family: system-ui, sans-serif !important; }",
        enabled,
        );
        break;
    default:
        break;
    }
};

export function initBootstrap(policy?: any): void {
    watchStoredUserFilters();
    const activePolicy = policy || {};
    const onDomReady = (): void => {
        if (window.location === null) {
            return;
        }
        if (vAPI instanceof Object === false) {
            return;
        }

    vAPI.messaging.send("contentscript", {
      what: "shouldRenderNoscriptTags",
    });

    if (vAPI.domFilterer instanceof Object) {
      vAPI.domFilterer.commitNow();
    }

    if (vAPI.domWatcher instanceof Object) {
      vAPI.domWatcher.start();
    }

    if (window !== window.top || vAPI.domFilterer instanceof Object === false) {
        return;
    }

    vAPI.mouseClick = { x: -1, y: -1 };

    const onMouseClick = function (ev: MouseEvent): void {
        if (ev.isTrusted === false) {
            return;
        }
        vAPI.mouseClick.x = ev.clientX;
        vAPI.mouseClick.y = ev.clientY;

        const elem = ev.target?.closest("a[href]");
        if (
            elem === null ||
        typeof (elem as HTMLAnchorElement).href !== "string"
        ) {
            return;
        }
      vAPI.messaging.send("contentscript", {
        what: "maybeGoodPopup",
        url: (elem as HTMLAnchorElement).href || "",
      });
    };

    let pickerContextMenuPointUnavailable = false;

    const isExtensionContextInvalidated = function (error: unknown): boolean {
        const message = error instanceof Error
            ? error.message
            : String(error || '');
        return message.includes('Extension context invalidated');
    };

    const disablePickerContextMenuPoint = function (): void {
        pickerContextMenuPointUnavailable = true;
        document.removeEventListener("contextmenu", onContextMenu, true);
    };

    const warnPickerContextMenuPointFailure = function (error: unknown): void {
        if (isExtensionContextInvalidated(error)) {
            disablePickerContextMenuPoint();
            return;
        }
        console.warn('[uBR] bootstrap: pickerContextMenuPoint sendMessage failed', error);
    };

    function onContextMenu(ev: MouseEvent): void {
        if (pickerContextMenuPointUnavailable) {
            return;
        }
        if (ev.isTrusted === false) {
            return;
        }
        if (chrome?.runtime?.sendMessage instanceof Function === false) {
            return;
        }
        vAPI.mouseClick.x = ev.clientX;
        vAPI.mouseClick.y = ev.clientY;
        const target = getContextMenuTargetDetails(ev);
        try {
            const result = chrome.runtime.sendMessage({
                topic: "pickerContextMenuPoint",
                payload: {
                    x: ev.clientX,
                    y: ev.clientY,
                    pageURL: window.location.href,
                    target,
                },
            }) as Promise<unknown> | undefined;
            result?.catch((e: unknown) => {
                warnPickerContextMenuPointFailure(e);
            });
        } catch (e: unknown) {
            warnPickerContextMenuPointFailure(e);
        }
    }

    document.addEventListener("mousedown", onMouseClick, true);
    document.addEventListener("contextmenu", onContextMenu, true);

    vAPI.shutdown.add((): void => {
      document.removeEventListener("mousedown", onMouseClick, true);
      document.removeEventListener("contextmenu", onContextMenu, true);
    });
    };

    const onResponseReady = async (response: unknown): Promise<void> => {
        if (response instanceof Object === false) {
            releaseCosmeticStartupCloak();
            return;
        }
        vAPI.bootstrap = undefined;

        if (!(await authorizeCosmetic("remove-style"))) return;
        cleanupOwnedYouTubeMastheadStyles();

        const res = response as BootstrapResponse;
        const cfeDetails = res && res.specificCosmeticFilters;
        if (!cfeDetails || !cfeDetails.ready) {
            vAPI.domFilterer = null;
            vAPI.domSurveyor?.stop();
            vAPI.domSurveyor = null;
            releaseCosmeticStartupCloak();
            return;
        }

    ensureCosmeticRuntime();

    if (vAPI.domCollapser instanceof Object) {
        vAPI.domCollapser.start();
    }

    const { noSpecificCosmeticFiltering, noGenericCosmeticFiltering } = res;

    vAPI.noSpecificCosmeticFiltering = noSpecificCosmeticFiltering || false;
    vAPI.noGenericCosmeticFiltering = noGenericCosmeticFiltering || false;

    if (noSpecificCosmeticFiltering && noGenericCosmeticFiltering) {
        vAPI.domFilterer = null;
        vAPI.domSurveyor = null;
    } else {
        const domFilterer = new vAPI.DOMFilterer();
        vAPI.domFilterer = domFilterer;
        if (noGenericCosmeticFiltering || cfeDetails.disableSurveyor) {
            vAPI.domSurveyor = null;
        }
        const sanitized = sanitizeYouTubeCosmeticCSS(
            cfeDetails.injectedCSS || "",
        self.location.hostname,
        );
        if (sanitized.removed.length !== 0) {
            cfeDetails.injectedCSS = sanitized.css;
            void scrubStoredCosmeticCacheSelectors(sanitized.removed);
        }
        const sanitizedProcedural = sanitizeYouTubeProceduralSelectors(
            cfeDetails.proceduralFilters || [],
        self.location.hostname,
        );
        if (sanitizedProcedural.removed.length !== 0) {
            cfeDetails.proceduralFilters = sanitizedProcedural.selectors;
            void scrubStoredCosmeticCacheSelectors(sanitizedProcedural.removed);
        }
        if (await authorizeCosmetic("inject-css")) {
            domFilterer.addCSS(cfeDetails.injectedCSS || "", { mustInject: true });
        }
        if (await authorizeCosmetic("dom-remove")) {
            domFilterer.addProceduralSelectors(cfeDetails.proceduralFilters || []);
        }
        domFilterer.exceptions = cfeDetails.exceptionFilters || [];
      domFilterer.exceptCSSRules(cfeDetails.exceptedFilters || []);
      domFilterer.convertedProceduralFilters =
        cfeDetails.convertedProceduralFilters || [];
      void vAPI.userStylesheet.apply(releaseCosmeticStartupCloak).catch((error: unknown) => {
          console.warn('[uBR] Initial cosmetic CSS application failed', error);
      });

      if (vAPI.domSurveyor === null && noGenericCosmeticFiltering !== true && cfeDetails.disableSurveyor !== true) {
          initDOMSurveyor();
      }
    }
    if (noSpecificCosmeticFiltering && noGenericCosmeticFiltering) {
        releaseCosmeticStartupCloak();
    }

    if (vAPI.domSurveyor) {
        if (Array.isArray(cfeDetails.genericCosmeticHashes)) {
        vAPI.domSurveyor.addHashes(cfeDetails.genericCosmeticHashes);
        }
        if (typeof cfeDetails.hostname !== "string" || cfeDetails.hostname === "") {
            cfeDetails.hostname = typeof res.hostname === "string" && res.hostname !== ""
                ? res.hostname
                : self.location.hostname;
        }
        vAPI.domSurveyor.start({ ...cfeDetails, hostname: cfeDetails.hostname });
    }

    const readyState = document.readyState;
    if (readyState === "interactive" || readyState === "complete") {
        return onDomReady();
    }
    document.addEventListener("DOMContentLoaded", onDomReady, { once: true });
    };

    vAPI.bootstrap = function (): void {
        console.log("########################################");
    console.log("[MV3-CS] ★★★ BOOTSTRAP STARTING ★★★");
    console.log("[MV3-CS] Page URL:", vAPI.effectiveSelf.location.href);
    console.log("[MV3-CS] Policy:", JSON.stringify(activePolicy));

    // Listen for MV3 "tool" messages from the service worker.
    // Important: do NOT `return true` unless we will actually call sendResponse,
    // otherwise the sender callback may never fire.
    if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
      chrome.runtime.onMessage.addListener(
          (message: unknown, _sender: unknown, sendResponse: unknown) => {
              const raw = message as { topic?: string; what?: string; payload?: unknown };
              const topic = raw?.topic ?? (raw?.what === "launchElementPicker" ? "pickerActivate" : undefined);
              const msg = { topic, payload: raw?.payload };
          console.log("[MV3-CS] Message received:", msg?.topic);
          if (msg?.topic === "pickerActivate") {
            console.log("[MV3-CS] pickerActivate received, launching picker");
            // Launch the picker by calling vAPI.messaging to get args and then creating iframe
            launchPickerInContentScript();
          }
          if (msg?.topic === "pickerDeactivate") {
            console.log("[MV3-CS] pickerDeactivate received");
          }
          if (msg?.topic === "zapperActivate") {
            console.log("[MV3-CS] zapperActivate received, launching zapper");
            launchPickerInContentScript();
          }
          if (msg?.topic === "zapperDeactivate") {
            console.log("[MV3-CS] zapperDeactivate received");
          }
          if (msg?.topic === "uBlockPowerSwitch") {
              const enabled =
              (msg.payload as { enabled?: boolean } | undefined)?.enabled ===
              true;
              void applyImmediatePowerSwitchState(enabled);
          }
          if (msg?.topic === "uBlockHostnameSwitch") {
              const payload =
              (msg.payload as
                | { name?: string; enabled?: boolean }
                | undefined) || {};
              if (typeof payload.name === "string") {
                  void applyImmediateHostnameSwitchState(
                payload.name,
                payload.enabled === true,
                  );
              }
          }
          if (msg?.topic === "uBlockPolicyRefresh") {
              removeStoredUserFilterStyle();
              if (typeof vAPI?.messaging?.send !== "function") {
                  if (typeof sendResponse === "function") {
                      (sendResponse as (response?: unknown) => void)({ ok: false, error: "Messaging unavailable" });
                  }
                  return;
              }
              void (async (): Promise<void> => {
                  const activation = await vAPI.messaging.send("contentscript", {
                      what: "reconcileHeuristicInterceptor",
                      url: self.location.href,
                      hostname: self.location.hostname,
                      pageSignals: collectPageSignals(),
                  });
                  if ( activation === null || typeof activation !== "object" || (activation as { ok?: unknown }).ok !== true ) {
                      const result = activation && typeof activation === "object" ? activation as { error?: unknown; errors?: unknown } : null;
                      const message = typeof result?.error === "string"
                          ? result.error
                          : Array.isArray(result?.errors)
                              ? (result.errors as string[]).join("; ")
                              : "Page activation failed";
                      throw new Error(message);
                  }
                  const parameters = await vAPI.messaging.send("contentscript", {
                      what: "retrieveContentScriptParameters",
                      url: self.location.href,
                      needScriptlets: false,
                  });
                  if ( parameters === null || typeof parameters !== "object" ) {
                      throw new Error("Invalid content-script parameter response");
                  }
                  await reconcilePolicyResponse(parameters);
              })().then(() => {
                  if (typeof sendResponse === "function") {
                      try {
                          (sendResponse as (response?: unknown) => void)({ ok: true });
                      } catch (e) {
                          console.warn('[uBR] bootstrap: sendResponse failed', e);
                      }
                  }
              }).catch((error: unknown) => {
                  console.warn("[MV3-CS] Policy refresh failed:", error);
                  if (typeof sendResponse === "function") {
                      try {
                          (sendResponse as (response?: unknown) => void)({ ok: false, error: String(error) });
                      } catch (e) {
                          console.warn('[uBR] bootstrap: sendResponse failed', e);
                      }
                  }
              });
              return true;
          }

          // For messages that did not return true above, acknowledge promptly.
          if (typeof sendResponse === "function") {
              try {
                  (sendResponse as (response?: unknown) => void)({ ok: true });
              } catch (e) {
                  console.warn('[uBR] bootstrap: sendResponse failed', e);
              }
          }
          return;
          },
      );
    }

    const cs = activePolicy.contentScript || {};
    const network = activePolicy.network || {};
    const cosmetic = activePolicy.cosmetic || {};
    const cosmeticSpecific = typeof cosmetic === 'object' ? cosmetic.specific : cosmetic;
    const cosmeticGeneric = typeof cosmetic === 'object' ? cosmetic.generic : activePolicy.genericCosmetic;
    const cosmeticAllowed = cosmeticSpecific !== false || cosmeticGeneric === true;

    if (cosmeticAllowed) {
        vAPI.messaging
                .send("contentscript", {
                    what: "retrieveContentScriptParameters",
                    url: vAPI.effectiveSelf.location.href,
                    needScriptlets:
                    (self as unknown as Record<string, unknown>).uBR_scriptletsInjected ===
                    undefined,
                })
                .then((response) => {
                    if (
                        response &&
                    (response as BootstrapResponse).specificCosmeticFilters
                    ) {
                        const scf = (response as BootstrapResponse)
                            .specificCosmeticFilters!;
                        if (scf.injectedCSS && scf.injectedCSS.length > 0) {
                        }
                    }
                    return onResponseReady(response);
                })
                .catch((err) => {
                    console.error("[MV3-CS] Promise error:", err);
                    releaseCosmeticStartupCloak();
                });
          }
          try {
              const bc = new BroadcastChannel("uBR");
              bc.onmessage = (ev) => {
                  if ((ev.data as Record<string, unknown>)?.what === "userFiltersUpdated") {
                      vAPI.messaging.send("contentscript", {
                          what: "retrieveContentScriptParameters",
                          url: vAPI.effectiveSelf.location.href,
                          needScriptlets: false
                      }).then(async (response) => {
                          await reconcilePolicyResponse(response);
                      }).catch((err) => {
                          console.warn("[MV3-CS] BroadcastChannel re-request failed:", err);
                      });
                  }
              };
          } catch (e) {
          console.warn("[MV3-CS] BroadcastChannel setup failed:", e);
        }
    };

    // Function to launch picker in content script context
    // This creates an iframe pointing to epicker-ui.html from web_accessible_resources
    const launchPickerInContentScript = async (): Promise<void> => {
        if (!(await authorizeCosmetic("picker-launch"))) return;
    console.log("[MV3-CS] launchPickerInContentScript called");

    try {
        // Get picker arguments from background
        const pickerBootArgsResponse = await vAPI.messaging.send("elementPicker", {
        what: "elementPickerArguments",
        });

        if (!pickerBootArgsResponse || typeof pickerBootArgsResponse !== "object") {
        console.error("[MV3-CS] No pickerBootArgs received");
        return;
        }
        const pickerBootArgs = pickerBootArgsResponse as PickerBootArgs;

      console.log("[MV3-CS] pickerBootArgs received:", pickerBootArgs);

      // Create unique ID for picker
      const pickerUniqueId = vAPI.randomToken();

      // Build picker URL with any necessary params
      let pickerURL =
        pickerBootArgs.pickerURL || "/web_accessible_resources/epicker-ui.html";
      if (pickerBootArgs.zap) {
          pickerURL += `${pickerURL.includes("?") ? "&" : "?"  }zap=1`;
      }

      const epickerUrl = chrome.runtime.getURL(pickerURL);
      console.log("[MV3-CS] epicker URL:", epickerUrl);

      // Create iframe
      const iframe = document.createElement("iframe");
      iframe.setAttribute(pickerUniqueId, "");
      iframe.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100vw;
        height: 100vh;
        z-index: 2147483647;
        border: none;
        background: transparent;
      `;

      // Set up MessageChannel for communication
      const channel = new MessageChannel();
      const port1 = channel.port1;
      const port2 = channel.port2;

      // Handle messages from iframe
      port1.onmessage = async (ev) => {
          const msg = ev.data;
        console.log("[MV3-CS] Picker message received:", msg);

        if (msg.what === "pickerCreateFilter") {
            if (!(await authorizeCosmetic("picker-create-filter"))) return;
            // Send filter to background
            await vAPI.messaging.send("elementPicker", {
            ...msg,
            what: "elementPickerCreateFilter",
            });
        } else if (msg.what === "pickerQuit") {
          // Cleanup
          port1.close();
          iframe.remove();
        }
      };

      // Append iframe to page
      (document.documentElement || document.head || document.body)?.appendChild(
          iframe,
      );

      // Wait for iframe to load, then send port
      iframe.addEventListener(
          "load",
          () => {
          console.log("[MV3-CS] epicker iframe loaded");
          iframe.contentWindow?.postMessage(
              {
                what: "epickerStart",
                eprom: pickerBootArgs.eprom,
              },
              "*",
              [port2],
          );
          },
          { once: true },
      );

      // Navigate iframe to picker URL
      iframe.src = epickerUrl;

      console.log("[MV3-CS] Picker iframe created and navigated");
    } catch (e) {
      console.error("[MV3-CS] Error launching picker:", e);
    }
    };
}

export function startBootstrap(): void {
  vAPI.bootstrap?.();
}

/******************************************************************************/
