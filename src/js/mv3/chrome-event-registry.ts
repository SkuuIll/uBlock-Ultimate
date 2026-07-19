/*******************************************************************************

    uBlock Origin - MV3 Chrome Event Registry
    https://github.com/gorhill/uBlock

    Typed registry for chrome.* event listeners. Analogous to HandlerRegistry
    for message handlers. Collects ChromeEventModule descriptors and installs
    them with a single call. Supports lifecycle cleanup via removeAll().

    Each module encapsulates its own addListener/removeListener calls,
    maintaining type safety for the specific chrome API surface it uses.

*******************************************************************************/

export type Unregister = () => void;

export interface ChromeEventModule {
    domain: string;
    register: () => Unregister[];
}

export class ChromeEventRegistry {
    private modules: ChromeEventModule[] = [];
    private cleanupFns: Unregister[] = [];

    registerModule(module: ChromeEventModule): void {
        this.modules.push(module);
    }

    installAll(): void {
        for (const module of this.modules) {
            const cleanups = module.register();
            this.cleanupFns.push(...cleanups);
        }
    }

    removeAll(): void {
        for (const fn of this.cleanupFns) {
            try { fn(); } catch (e) {
                console.warn("[ChromeEventRegistry] cleanup error:", e);
            }
        }
        this.cleanupFns = [];
    }
}
