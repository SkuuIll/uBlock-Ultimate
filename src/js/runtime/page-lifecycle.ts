/**
 * src/js/runtime/page-lifecycle.ts
 *
 * Per-tab layer lifecycle cleanup for SPA navigation, BFCache, tab discard,
 * frame removal, and extension reload. Each runtime layer registers
 * cleanup handlers for the lifecycle events it cares about.
 *
 * Usage:
 *   import { onPageLifecycle, emitPageLifecycle, PageLifecycleEvent }
 *     from "./page-lifecycle.ts";
 *
 *   const unsub = onPageLifecycle("tab-removed", (tabId) => {
 *     cleanupTabState(tabId);
 *   });
 *
 *   emitPageLifecycle("spa-navigation", tabId, frameId);
 */

export type PageLifecycleEvent =
  | "document-start"
  | "policy-ready"
  | "spa-navigation"
  | "pagehide"
  | "pageshow"
  | "frame-detached"
  | "tab-discarded"
  | "tab-removed"
  | "extension-updated";

type LifecycleHandler = (tabId: number, frameId?: number, data?: Record<string, unknown>) => void;

const handlers = new Map<PageLifecycleEvent, Set<LifecycleHandler>>();

export function onPageLifecycle(
    event: PageLifecycleEvent,
    handler: LifecycleHandler,
): () => void {
    if (!handlers.has(event)) {
        handlers.set(event, new Set());
    }
    handlers.get(event)!.add(handler);
    return () => {
        handlers.get(event)?.delete(handler);
    };
}

export function emitPageLifecycle(
    event: PageLifecycleEvent,
    tabId: number,
    frameId?: number,
    data?: Record<string, unknown>,
): void {
    const eventHandlers = handlers.get(event);
    if (!eventHandlers) return;
    for (const handler of eventHandlers) {
        try {
            handler(tabId, frameId, data);
        } catch (err) {
            console.warn(`[uBR] lifecycle handler error for ${event}:`, err);
        }
    }
}
