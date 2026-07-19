/*******************************************************************************

    uBlock Ultimate — Content Script Modules

    Heavy module suite loaded dynamically by the bootstrap when the page
    policy requires cosmetic filtering, video interception, or heuristic
    interceptors.

    Exports a single `loadModules()` function called by the bootstrap after
    policy resolution.

******************************************************************************/

import "./first-party-ad-detector.ts";
import { initDOMFilterer } from "./04-dom-filterer.ts";
import { initDOMWatcher } from "./03-dom-watcher.ts";
import { initDOMCollapser } from "./05-dom-collapser.ts";
import { initDOMSurveyor } from "./06-dom-surveyor.ts";
import {
    initBootstrap,
    releaseCosmeticStartupCloak,
    startBootstrap,
} from "./07-bootstrap.ts";

interface VAPI {
    contentScript?: boolean;
    messaging: {
        send(channel: string, msg: Record<string, unknown>): Promise<any>;
    };
    domFilterer?: unknown;
    domWatcher?: unknown;
    domCollapser?: unknown;
    domSurveyor?: unknown;
}

declare const vAPI: VAPI;

export function loadModules(policy: any, flags: {
    cosmeticAllowed: boolean;
    videoPolicyAllowed: boolean;
    smartCosmeticAllowed: boolean;
    interceptorAllowed: boolean;
}): void {
    const { cosmeticAllowed, videoPolicyAllowed, interceptorAllowed } = flags;

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
}

/******************************************************************************/
