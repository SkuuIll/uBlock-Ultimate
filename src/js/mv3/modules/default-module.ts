/*******************************************************************************

    uBlock Origin - MV3 Default Channel Handler Module
    https://github.com/gorhill/uBlock

*******************************************************************************/

import type { HandlerModule } from "../handler-registry.js";
import type { SWContext } from "../sw-context.js";

export type DefaultHandler = (_request: any, _callback?: (_result: any) => void) => any;

export function createDefaultModule(deps: {
    defaultHandler: DefaultHandler;
}): HandlerModule<SWContext> {
    return {
        domain: "default",
        handlers: [
            {
                channel: "default",
                what: "*",
                handler: async (request) => deps.defaultHandler(request),
            },
        ],
    };
}
