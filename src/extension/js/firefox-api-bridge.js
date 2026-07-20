/**
 * Firefox exposes promise-based WebExtension APIs through `browser.*`.
 * The inherited runtime uses the MV3 promise form of `chrome.*`, so the
 * Firefox package loads this bridge before every extension context.
 */
(() => {
    const api = globalThis.browser;
    if (api === undefined || globalThis.chrome === api) return;

    try {
        Object.defineProperty(globalThis, 'chrome', {
            configurable: true,
            value: api,
        });
    } catch {
        try {
            globalThis.chrome = api;
        } catch {
            // Firefox normally exposes a configurable compatibility namespace.
        }
    }
})();
