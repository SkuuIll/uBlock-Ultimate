/*******************************************************************************

    uBlock Origin - MV3 Dashboard Handler Module
    https://github.com/gorhill/uBlock

*******************************************************************************/

import type { HandlerModule, Handler } from "../handler-registry.js";
import type { SWContext } from "../sw-context.js";

export type DashboardMessageHandler = (_request: any) => Promise<any>;
export type LoggerUIMessageHandler = (_request: any) => Promise<any>;

export function createDashboardModule(deps: {
    dashboardHandler: DashboardMessageHandler;
    loggerUIHandler: LoggerUIMessageHandler;
}): HandlerModule<SWContext> {
    const handlers: Handler<SWContext>[] = [
        {
            channel: "dashboard",
            what: "*",
            handler: async (request) => deps.dashboardHandler(request),
        },
        {
            channel: "loggerUI",
            what: "*",
            handler: async (request) => deps.loggerUIHandler(request),
        },
        {
            channel: "cloudWidget",
            what: "*",
            handler: async (request) => deps.dashboardHandler(request),
        },
    ];

    return { domain: "dashboard", handlers };
}
