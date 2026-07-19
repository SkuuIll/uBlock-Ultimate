/*******************************************************************************

    uBlock Origin - MV3 Scriptlets Handler Module
    https://github.com/gorhill/uBlock

*******************************************************************************/

import type { HandlerModule } from "../handler-registry.js";
import type { SWContext } from "../sw-context.js";

export type ScriptletsHandler = (_request: any, _callback?: (_result: any) => void) => any;

export function createScriptletsModule(deps: {
    scriptletsHandler: ScriptletsHandler;
}): HandlerModule<SWContext> {
    return {
        domain: "scriptlets",
        handlers: [
            {
                channel: "scriptlets",
                what: "*",
                handler: async (request) => deps.scriptletsHandler(request),
            },
        ],
    };
}
