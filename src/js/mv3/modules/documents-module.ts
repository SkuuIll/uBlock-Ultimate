/*******************************************************************************

    uBlock Origin - MV3 Documents Handler Module
    https://github.com/gorhill/uBlock

*******************************************************************************/

import type { HandlerModule } from "../handler-registry.js";
import type { SWContext } from "../sw-context.js";

export type DocumentBlockedHandler = (_request: any, _callback?: (_result: any) => void) => any;
export type ContentScriptParamsHandler = (_payload: any, _callback?: any) => any;
export type GenericCosmeticHandler = (_payload: any, _callback?: any) => any;
export type DevToolsHandler = (_request: any) => any;

export function createDocumentsModule(deps: {
    documentBlockedHandler: DocumentBlockedHandler;
    contentScriptParamsHandler: ContentScriptParamsHandler;
    genericCosmeticHandler: GenericCosmeticHandler;
    devToolsHandler: DevToolsHandler;
}): HandlerModule<SWContext> {
    return {
        domain: "documents",
        handlers: [
            {
                channel: "documentBlocked",
                what: "*",
                handler: async (request) => deps.documentBlockedHandler(request),
            },
            {
                channel: "retrieveContentScriptParameters",
                what: "*",
                handler: async (request) => deps.contentScriptParamsHandler(request),
            },
            {
                channel: "retrieveGenericCosmeticSelectors",
                what: "*",
                handler: async (request) => deps.genericCosmeticHandler(request),
            },
            {
                channel: "devTools",
                what: "*",
                handler: async (request) => deps.devToolsHandler(request),
            },
        ],
    };
}
