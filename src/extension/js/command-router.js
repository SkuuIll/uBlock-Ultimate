/**
 * platform/chromium/js/command-router.js
 *
 * Command router for service-worker message dispatch.
 *
 * Routes incoming extension commands (from popup, dashboard, logger,
 * content scripts, and extension pages) to registered handlers.
 * Each command is validated against the message contract registry
 * before execution.
 *
 * Usage:
 *   import { CommandRouter } from "./command-router.js";
 *   CommandRouter.register("toggleFilterList", handler);
 *   const result = await CommandRouter.dispatch(message, sender);
 */

import { MessageContracts } from "./message-contracts.js";

const _handlers = new Map();

export const CommandRouter = Object.freeze({
    /**
     * Register a command handler.
     * @param {string} what
     * @param {(msg: object, sender: object) => Promise<any>} handler
     */
    register(what, handler) {
        if (_handlers.has(what)) throw new Error(`Duplicate handler: ${what}`);
        _handlers.set(what, handler);
    },

    /**
     * Dispatch a message to its registered handler.
     * @param {object} msg - { what, ...payload }
     * @param {object} sender - runtime.MessageSender
     * @returns {Promise<{ ok: boolean, result?: any, reason?: string }>}
     */
    async dispatch(msg, sender) {
        const contract = MessageContracts.get(msg.what);
        if (contract) {
            const auth = MessageContracts.authorize(msg, sender?.origin || "content", true);
            if (!auth.ok) return { ok: false, reason: auth.reason };
        }

        const handler = _handlers.get(msg.what);
        if (!handler) return { ok: false, reason: `no-handler: ${msg.what}` };

        try {
            const result = await handler(msg, sender);
            return { ok: true, result };
        } catch (err) {
            return { ok: false, reason: err.message || String(err) };
        }
    },

    /**
     * Check if a handler is registered for a command.
     * @param {string} what
     * @returns {boolean}
     */
    has(what) {
        return _handlers.has(what);
    },

    /**
     * Unregister a command handler.
     * @param {string} what
     */
    unregister(what) {
        _handlers.delete(what);
    },
});
