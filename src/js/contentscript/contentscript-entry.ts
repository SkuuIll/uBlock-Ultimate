/*******************************************************************************

    uBlock Ultimate - Content Script Module
    Entry Point

    Main entry point that initializes all content script modules in the
    correct order based on their dependencies.

    Dependencies:
    - vAPI must be available (set by background script)
    - vAPI.messaging must be available

    Initialization order:
    1. vAPI extensions (self-executing)
    2. YouTube ad blocker (video ad interception for MV3)
    3. DOM filterer (sets up vAPI.DOMFilterer)
    4. DOM watcher (uses vAPI.DOMFilterer, sets up vAPI.domWatcher)
    5. DOM collapser (needs vAPI.domWatcher, sets up vAPI.domCollapser)
    6. DOM surveyor (needs vAPI.DOMFilterer, sets up vAPI.domSurveyor)
    7. Bootstrap (coordinates everything, starts at the end)

******************************************************************************/

interface VAPI {
    contentScript?: boolean;
    messaging: {
        send(channel: string, msg: Record<string, unknown>): Promise<any>;
    };
    randomToken(): string;
    userStylesheet?: {
        added: Set<string>;
        removed: Set<string>;
        installed: Set<string>;
        desired: Set<string>;
        add(cssText: string, now?: boolean): void;
        remove(cssText: string, now?: boolean): void;
        apply(callback?: () => void): void | Promise<void>;
    };
    sanitizeCosmeticCSSForPage?(css: string): string;
    DOMFilterer?: new () => {
        addCSS(css: string, options?: { mustInject?: boolean }): void;
        addProceduralSelectors(selectors: string[]): void;
        exceptCSSRules(selectors: string[]): void;
        commitNow(): void;
        exceptions: string[];
        toggle?(state: boolean, filterer?: unknown): void;
    };
    domFilterer?: unknown;
    domWatcher?: unknown;
    domCollapser?: unknown;
    domSurveyor?: unknown;
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

import "./01-vapi-extensions.ts";

import "./first-party-ad-detector.ts";
import { initDOMFilterer } from "./04-dom-filterer.ts";
import { initDOMWatcher } from "./03-dom-watcher.ts";
import { initDOMCollapser } from "./05-dom-collapser.ts";
import { initDOMSurveyor } from "./06-dom-surveyor.ts";
import {
    initBootstrap,
    releaseCosmeticStartupCloak,
    startBootstrap,
    reconcilePolicyResponse,
} from "./07-bootstrap.ts";

type FirstPartyDetector = { destroy(): void };
type FirstPartyDetectorGlobal = typeof self & {
    __uborFirstPartyAdDetectorFactory?: (policy: Record<string, unknown>) => FirstPartyDetector;
    __uborFirstPartyDetector?: FirstPartyDetector;
};

const syncFirstPartyDetector = (policy: any): void => {
    const root = self as FirstPartyDetectorGlobal;
    const shouldRun = policy?.contentScript?.firstPartyDomDetection === true;
    if ( !shouldRun ) {
        if ( root.__uborFirstPartyDetector ) { root.__uborFirstPartyDetector.destroy(); delete root.__uborFirstPartyDetector; }
        return;
    }
    if ( root.__uborFirstPartyDetector ) { return; }
    const factory = root.__uborFirstPartyAdDetectorFactory;
    if ( typeof factory !== "function" ) { return; }
    root.__uborFirstPartyDetector = factory(policy.contentScript);
};

const collectPageSignals = (): Record<string, boolean> => ({
    hasContentEditable: document.querySelector("[contenteditable]:not([contenteditable='false'])") !== null,
    hasLargeAppRoot: document.querySelector("#root > *, #app > *, #__next > *, [data-reactroot], [data-app-shell]") !== null,
    hasAuthForm: document.querySelector('input[type="password"], form[action*="login" i], form[action*="auth" i]') !== null,
    hasPaymentForm: document.querySelector('input[autocomplete="cc-number"], input[name*="card-number" i]') !== null,
    isArticle: document.querySelector("article, [role='article']") !== null,
    isVideoPage: Array.from(document.querySelectorAll("video")).some(video => {
        const rect = (video as HTMLVideoElement).getBoundingClientRect();
        return rect.width >= 320 || Number((video as HTMLVideoElement).getAttribute("width")) >= 320;
    }),
    metaViewport: document.querySelector('meta[name="viewport"]') !== null,
});

type PageActivation = {
    ok?: boolean;
    policy?: any;
    activeLayers?: string[];
    errors?: string[];
};

const requestPageActivation = async (): Promise<PageActivation | null> => {
    try {
        const response = await vAPI.messaging.send("contentscript", {
            what: "getPageActivation",
            url: location.href,
            hostname: location.hostname,
            pageSignals: collectPageSignals(),
        });
        if ( response === null || typeof response !== "object" ) { return null; }
        return response as PageActivation;
    } catch {
        return null;
    }
};

const initializeFromPolicy = (policy: any): { cosmeticAllowed: boolean; videoPolicyAllowed: boolean; interceptorAllowed: boolean } => {
    (self as any).__uborPagePolicy = policy;

    const cs = typeof policy.contentScript === "object" ? policy.contentScript : {};
    const cosmetic = typeof policy.cosmetic === "object" ? policy.cosmetic : { specific: policy.cosmetic !== "off", generic: policy.genericCosmetic === true };
    const video = typeof policy.video === "object" ? policy.video : { mode: policy.genericVideo || "off" };

    const cosmeticAllowed = cosmetic.specific !== false || cosmetic.generic === true;
    const videoPolicyAllowed = video.mode !== "off";
    const smartCosmeticAllowed = cs.loadSmartRuntime === true;
    const interceptorAllowed = cs.loadInterceptors === true;

    if (cosmeticAllowed) {
        initDOMFilterer();
        initDOMCollapser();
        initDOMSurveyor();
    } else {
        releaseCosmeticStartupCloak();
    }

    if (cosmeticAllowed || videoPolicyAllowed || interceptorAllowed) {
        initBootstrap(policy);
        initDOMWatcher();
        startBootstrap();
    }

    syncFirstPartyDetector(policy);

    setTimeout(() => {
        const diag = {
            profileId: policy.profileId || "unknown",
            cosmeticFilterer: typeof vAPI.domFilterer !== "undefined",
            domWatcher: typeof vAPI.domWatcher !== "undefined",
            domCollapser: typeof vAPI.domCollapser !== "undefined",
            domSurveyor: typeof vAPI.domSurveyor !== "undefined",
            cosmeticAllowed,
            videoPolicyAllowed,
            smartCosmeticAllowed,
            interceptorAllowed,
            cosmeticInjectedCSS: document.querySelectorAll("style[data-ubr-cosmetic]").length,
            cosmeticHiddenElements: document.querySelectorAll("[data-ubr-cosmetic-hidden]").length,
        };
        console.log(`[UBR-RUNTIME] layers: ${JSON.stringify(diag)}`);
    }, 2000);

    return { cosmeticAllowed, videoPolicyAllowed, interceptorAllowed };
};

// `vAPI` is created by `vapi.js`, but on non-HTML documents (e.g. images)
// `vapi.js` intentionally does not create it. Avoid crashing on such pages.
if ( typeof vAPI !== 'object' ) {
    // Nothing to do: the rest of the content-script pipeline depends on vAPI.
} else {
    vAPI.contentScript = true;

    const CLOAK_ATTR = 'data-ubr-cosmetic-startup-cloak';
    const CLOAK_ID = 'ublock-resurrected-cosmetic-startup-cloak';

    document.documentElement.setAttribute(CLOAK_ATTR, '1');
    let cloakStyle = document.getElementById(CLOAK_ID) as HTMLStyleElement | null;
    if ( cloakStyle === null ) {
        cloakStyle = document.createElement('style');
        cloakStyle.id = CLOAK_ID;
        (document.head || document.documentElement).appendChild(cloakStyle);
    }
    cloakStyle.textContent = `html[${CLOAK_ATTR}="1"] { opacity: 0 !important; pointer-events: none !important; transition: none !important; }`;

    const safetyTimeout = setTimeout(releaseCosmeticStartupCloak, 1500);

    const releaseCloak = (): void => {
        clearTimeout(safetyTimeout);
        releaseCosmeticStartupCloak();
    };

    // Ask the SW for page policy before booting any engine.
    // Unknown apps get safe defaults — no cosmetic mutation, no generic video.
    void (async () => {
        let currentActivation = await requestPageActivation();
        let activationOk = currentActivation && currentActivation.ok !== false && currentActivation.policy;

        if (!activationOk) {
            releaseCloak();
            return;
        }

        initializeFromPolicy(currentActivation!.policy);

        // Reconcile after DOM is ready — page signals are more accurate
        const reconcileAfterDOMReady = async (): Promise<void> => {
            const nextActivation = await requestPageActivation();
            if ( !nextActivation || !nextActivation.policy ) { return; }

            currentActivation = nextActivation;
            const nextPolicy = nextActivation.policy;
            (self as any).__uborPagePolicy = nextPolicy;
            syncFirstPartyDetector(nextPolicy);

            try {
                const parameters = await vAPI.messaging.send("contentscript", {
                    what: "retrieveContentScriptParameters",
                    url: location.href,
                    needScriptlets: false,
                });
                await reconcilePolicyResponse(parameters);
            } catch (e) {
                console.warn("[uBR] DOM-ready policy reconciliation failed:", e);
            }
        };

        if ( document.readyState === "loading" ) {
            document.addEventListener("DOMContentLoaded", () => void reconcileAfterDOMReady(), { once: true });
        } else {
            void reconcileAfterDOMReady();
        }

        // Deactivate layers on page teardown (P2.7.72)
        window.addEventListener("beforeunload", () => {
            const root = self as FirstPartyDetectorGlobal;
            if ( root.__uborFirstPartyDetector ) { root.__uborFirstPartyDetector.destroy(); delete root.__uborFirstPartyDetector; }
            const interceptorKey = Symbol.for("uBlockUltimate.universalInterceptor");
            const ic = (globalThis as any)[interceptorKey];
            if ( ic && typeof ic.destroy === "function" ) { ic.destroy(); }
        });
    })();
}

/******************************************************************************/
