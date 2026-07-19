/*******************************************************************************

    uBlock Ultimate — Content Script Bootstrap

    Lightweight entry point injected into every page. Requests page policy
    from the service worker and dynamically loads the full module suite only
    when the page requires cosmetic filtering, video interception, or
    heuristic interceptors.

******************************************************************************/

interface VAPI {
    contentScript?: boolean;
    messaging: {
        send(channel: string, msg: Record<string, unknown>): Promise<any>;
    };
    randomToken(): string;
    domFilterer?: unknown;
    domWatcher?: unknown;
    domCollapser?: unknown;
    domSurveyor?: unknown;
}

declare const vAPI: VAPI;

import "./01-vapi-extensions.ts";

if ( typeof vAPI !== 'object' ) {
} else {
    vAPI.contentScript = true;

    const CLOAK_ATTR = 'data-ubr-cosmetic-startup-cloak';
    const CLOAK_ID = 'ublock-resurrected-cosmetic-startup-cloak';

    document.documentElement.setAttribute(CLOAK_ATTR, '1');
    let cloakStyle = document.getElementById(CLOAK_ID) as HTMLStyleElement | null;
    if ( cloakStyle === null ) {
        cloakStyle = document.createElement('style');
        cloakStyle.id = CLOAK_ID;
        document.documentElement.appendChild(cloakStyle);
    }
    cloakStyle.textContent = `html[${CLOAK_ATTR}="1"] { opacity: 0 !important; pointer-events: none !important; transition: none !important; }`;

    const releaseCloak = (): void => {
        document.documentElement.removeAttribute(CLOAK_ATTR);
        document.getElementById(CLOAK_ID)?.remove();
    };

    const safetyTimeout = setTimeout(releaseCloak, 1500);

    void (async () => {
        let policy: any;

        const pageSignals = {
            hasContentEditable: document.querySelector("[contenteditable]") !== null,
            hasLargeAppRoot: document.querySelector("#root, #app, #__next, main, .shell") !== null,
            hasAuthForm: document.querySelector('input[type="password"], form[action*="login"], form[action*="auth"]') !== null,
            hasPaymentForm: document.querySelector('input[autocomplete="cc-number"]') !== null,
            isArticle: document.querySelector("article") !== null || document.querySelector('[role="article"]') !== null,
            isVideoPage: document.querySelector("video") !== null && (document.querySelector("video") as HTMLVideoElement).clientWidth >= 320,
            metaViewport: document.querySelector('meta[name="viewport"]') !== null,
        };

        try {
            const raw = await vAPI.messaging.send("contentscript", {
                what: "getPageActivation",
                url: location.href,
                hostname: location.hostname,
                pageSignals,
            });
            policy = raw && raw.policy ? raw.policy : raw;
        } catch (_) {}

        if (!policy) {
            clearTimeout(safetyTimeout);
            releaseCloak();
            return;
        }

        (self as any).__uborPagePolicy = policy;

        const cs = typeof policy.contentScript === "object" ? policy.contentScript : {};
        const cosmetic = typeof policy.cosmetic === "object" ? policy.cosmetic : { specific: policy.cosmetic !== "off", generic: policy.genericCosmetic === true };
        const video = typeof policy.video === "object" ? policy.video : { mode: policy.genericVideo || "off" };

        const cosmeticAllowed = cosmetic.specific !== false || cosmetic.generic === true;
        const videoPolicyAllowed = video.mode !== "off";
        const smartCosmeticAllowed = cs.loadSmartRuntime === true;
        const interceptorAllowed = cs.loadInterceptors === true;

        if (cosmeticAllowed || videoPolicyAllowed || interceptorAllowed) {
            try {
                const modulesUrl = typeof chrome !== "undefined" && chrome.runtime?.getURL
                    ? chrome.runtime.getURL("/js/contentscript-modules.js")
                    : "/js/contentscript-modules.js";
                const mod = await import(modulesUrl);
                clearTimeout(safetyTimeout);
                mod.loadModules(policy, { cosmeticAllowed, videoPolicyAllowed, smartCosmeticAllowed, interceptorAllowed });
            } catch (e) {
                console.warn("[uBR] Failed to load content script modules:", e);
                clearTimeout(safetyTimeout);
                releaseCloak();
            }
        } else {
            clearTimeout(safetyTimeout);
            releaseCloak();
        }

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
            };
            console.log(`[UBR-RUNTIME] layers: ${JSON.stringify(diag)}`);
        }, 2000);

        window.addEventListener("beforeunload", () => {
            const d = (self as any).__uborFirstPartyDetector;
            if (d && typeof d.destroy === "function") d.destroy();
        });
    })();
}
