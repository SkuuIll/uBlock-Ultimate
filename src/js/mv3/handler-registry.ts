/*******************************************************************************

    uBlock Origin - MV3 Handler Registry
    https://github.com/gorhill/uBlock

    Generalized handler registry for typed, explicit message dispatch.
    Eliminates per-channel if/switch chains and per-handler factory functions.
    
    A HandlerModule exports an array of Handler<C> descriptors. The registry
    collects all modules and dispatches messages by channel+what. Registration
    is explicit (one call per module), not auto-discovered.

*******************************************************************************/

export interface Handler<C = any> {
    channel: string;
    what: string;
    handler: (_request: any, _context: C) => any;
}

export interface HandlerModule<C = any> {
    domain: string;
    handlers: Handler<C>[];
}

export type MessageCallback = (_response?: any) => void;
export type ChannelHandler = (_payload: any, _callback?: MessageCallback) => any;

/**
 * Registry central for all message handlers. Maintains a channel→what→handler
 * tree. Each handler is a typed descriptor, not a raw callback, so the dispatch
 * path is inspectable at runtime.
 */
export class HandlerRegistry<C> {
    private channels = new Map<string, Map<string, Handler<C>[]>>();

    register(handler: Handler<C>): void {
        let whatMap = this.channels.get(handler.channel);
        if (!whatMap) {
            whatMap = new Map();
            this.channels.set(handler.channel, whatMap);
        }
        let handlers = whatMap.get(handler.what);
        if (!handlers) {
            handlers = [];
            whatMap.set(handler.what, handlers);
        }
        handlers.push(handler);
    }

    registerModule(module: HandlerModule<C>): void {
        for (const handler of module.handlers) {
            this.register(handler);
        }
    }

    channelNames(): IterableIterator<string> {
        return this.channels.keys();
    }

    /**
     * Dispatch a channel-structured message (channel + what → handler).
     * Falls back to a "*" wildcard handler if no exact what-match is found.
     */
    dispatch(channel: string, what: string, request: any, context: C): any {
        const whatMap = this.channels.get(channel);
        if (!whatMap) return undefined;
        const handlers = whatMap.get(what);
        if (handlers && handlers.length > 0) {
            return handlers[handlers.length - 1].handler(request, context);
        }
        const wildcard = whatMap.get("*");
        if (wildcard && wildcard.length > 0) {
            return wildcard[wildcard.length - 1].handler(request, context);
        }
        return undefined;
    }

    /**
     * Look up all handlers for a channel + what and return whether any exist.
     */
    hasHandler(channel: string, what?: string): boolean {
        const whatMap = this.channels.get(channel);
        if (!whatMap) return false;
        if (what === undefined) return whatMap.size > 0;
        return whatMap.has(what);
    }

    /**
     * Wrap dispatch in a callback-style handler for the legacy Messaging router.
     * Bridges flat messaging.on() calls with the typed registry.
     * - If payload has a `what` field, dispatches (channel, what, payload).
     * - If payload has no `what` field, dispatches (channel, "*", payload)
     *   so wildcard handlers on that channel pick it up.
     * Apply safeHandler() around this result for error boundaries.
     */
    toChannelHandler(channel: string, context: C): ChannelHandler {
        return (payload: any, callback?: MessageCallback) => {
            const what = payload?.what;
            if (typeof what === "string") {
                return this.dispatch(channel, what, payload, context);
            }
            return this.dispatch(channel, "*", payload ?? {}, context);
        };
    }

    /**
     * Install all registered modules onto a MessagingRouterAPI. One call
     * replaces dozens of individual messaging.on() registrations.
     *
     * Each channel gets a callback-style handler that:
     *  - extracts `what` from payload
     *  - dispatches to the registered Handler<C>
     *  - calls the messaging callback with the result
     *  - catches errors and routes them to the callback
     */
    installOn(
        router: { on: (_topic: string, _handler: ChannelHandler) => void },
        context: C,
        safeHandler?: (_fn: (_payload: any) => any) => ChannelHandler,
    ): void {
        for (const channel of this.channelNames()) {
            router.on(channel, this.channelHandler(channel, context, safeHandler));
        }
    }

    /**
     * Build a single callback-style handler for a given channel.
     * Combines dispatch + safeHandler logic.
     */
    channelHandler(
        channel: string,
        context: C,
        safeHandler?: (_fn: (_payload: any) => any) => ChannelHandler,
    ): ChannelHandler {
        const dispatch = this.toChannelHandler(channel, context);
        if (safeHandler) {
            return safeHandler((payload: any) => dispatch(payload));
        }
        return dispatch;
    }
}
