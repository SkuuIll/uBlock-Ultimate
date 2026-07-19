import { startVideoAdBlocker, stopVideoAdBlocker } from "./video-engine";
import { setMutationCapabilities, restoreAll, getMutationLedger, getCssInjectionInventory } from "./safe-actions";
import { isVideoAuthorized } from "./safe-actions";
import { debugLog } from "./diagnostics";

interface VideoPolicy {
    genericVideo?: string;
    video?: {
        allowMutation?: boolean;
        allowSkipClick?: boolean;
        domMarking?: boolean;
    };
    contentScript?: {
        domMarking?: boolean;
    };
}

interface VideoRuntimeController {
    stop(): void;
    applyPolicy(policy: VideoPolicy): void;
}

(async () => {
    const videoRuntimeKey = Symbol.for("uBlockUltimate.videoRuntime");
    const root = globalThis as typeof globalThis & { [videoRuntimeKey]?: VideoRuntimeController };
    if ( root[videoRuntimeKey] !== undefined ) {
        return;
    }

    let channel: BroadcastChannel | null = null;
    let authCheckTimer: ReturnType<typeof setInterval> | null = null;

    const runtimeListener = (msg: any, sender: any, sendResponse: any) => {
        if (msg.what === "getMutationLedger") {
            sendResponse({ ledger: getMutationLedger() });
            return true;
        }
        if (msg.what === "getCssInjectionInventory") {
            sendResponse({ inventory: getCssInjectionInventory() });
            return true;
        }
        if (msg.what === "rollbackMutations") {
            restoreAll();
            sendResponse({ ok: true });
            return true;
        }
        return false;
    };

    const deactivateListener = (msg: any, _sender: any, _sendResponse: any) => {
        if (msg?.what === "ubor:deactivate") {
            debugLog("Received ubor:deactivate — shutting down video runtime");
            shutDown();
        }
    };

    const releaseGuard = (): void => { delete root[videoRuntimeKey]; };

    const stopAuthCheckTimer = () => {
        if (authCheckTimer) { clearInterval(authCheckTimer); authCheckTimer = null; }
    };

    const shutDown = () => {
        stopAuthCheckTimer();
        stopVideoAdBlocker();
        // Roll back every mutation the runtime applied before tearing down, so
        // a SW-ordered revocation (ubor:deactivate) does not leave removed
        // elements, marks, or click-neutralization handlers on the page.
        try { restoreAll(); } catch {}
        try { chrome.runtime.onMessage.removeListener(runtimeListener); } catch {}
        try { chrome.runtime.onMessage.removeListener(deactivateListener); } catch {}
        if (channel) { try { channel.close(); } catch {} channel = null; }
        (self as any).__ubrVideoRuntimeActive = false;
        releaseGuard();
    };

    const startAuthCheckTimer = () => {
        stopAuthCheckTimer();
        authCheckTimer = setInterval(async () => {
            // Periodically re-validate video authorization.  Prefer the
            // authoritative SW validate() (available in the ISOLATED world
            // where this runtime lives) which renews the token; fall back to
            // the synchronous local check() otherwise.  Either path enforces
            // token expiry, so a one-minute lease cannot silently become a
            // document-lifetime lease.
            const cap = (self as any).__ubrCapability;
            let authorized = false;
            if (cap && typeof cap.validate === "function") {
                authorized = await cap.validate("video", "hide");
            } else if (cap) {
                authorized = cap.check("video");
            }
            if (!authorized) {
                debugLog("Video authorization lost — shutting down");
                shutDown();
            }
        }, 30000); // check every 30s
    };

    const startWithPolicy = (policy: VideoPolicy) => {
        if (!policy || policy.genericVideo === "off") {
            shutDown();
            return;
        }
        // DOM marking policy comes from the page policy's contentScript block
        // (e.g. `"domMarking": false`).  It must be applied explicitly; the
        // default of `true` in FULL_MUTATION_CAPABILITIES is only a fallback
        // when the policy is silent, never a way to override an explicit false.
        const domMarking =
            policy.video?.domMarking ??
            policy.contentScript?.domMarking ??
            true;
        setMutationCapabilities({
            hideElement: policy.video?.allowMutation === true,
            removeElement: policy.video?.allowMutation === true,
            neutralizeClick: policy.video?.allowMutation === true,
            skipClick: policy.video?.allowSkipClick === true,
            domMarking: domMarking === true,
        });
        startVideoAdBlocker();
        startAuthCheckTimer();
        (self as any).__ubrVideoRuntimeActive = true;
    };

    root[videoRuntimeKey] = {
        stop(): void {
            shutDown();
        },
        applyPolicy(policy: VideoPolicy): void {
            if (root[videoRuntimeKey] === undefined) return;
            stopVideoAdBlocker();
            restoreAll();
            startWithPolicy(policy);
        },
    };

    try {
        // In MAIN world, policy is pre-seeded by the SW into self.__uborPagePolicy.
        // In ISOLATED world, fetch via vAPI messaging.
        // Fallback: request policy via postMessage bridge from ISOLATED world.
        let policy: VideoPolicy = self.__uborPagePolicy
            ?? (typeof vAPI === "object" && vAPI !== null
                ? await vAPI.messaging.send("contentscript", {
                    what: "getPagePolicy",
                    url: location.href,
                    hostname: location.hostname,
                }).catch(() => null)
                : null);

        if (!policy) {
            // Try postMessage bridge (ISOLATED world has the policy)
            policy = await new Promise<any>((resolve) => {
                const handler = (event: MessageEvent) => {
                    if (event.source !== window) return;
                    if (event.data?.ubrPolicyResponse?.policy) {
                        window.removeEventListener("message", handler);
                        resolve(event.data.ubrPolicyResponse.policy);
                    }
                };
                window.addEventListener("message", handler);
                window.postMessage({ ubrPolicyRequest: true }, location.origin);
                setTimeout(() => { window.removeEventListener("message", handler); resolve(null); }, 2000);
            });
        }

        // Register listeners
        try { chrome.runtime.onMessage.addListener(runtimeListener); } catch {}
        try { channel = new BroadcastChannel("uBR"); channel.onmessage = (event) => {
            const msg = event.data || {};
            if (msg.what === "rollbackMutations") { restoreAll(); }
        }; } catch {}

        // Handle SW revocation message (ubor:deactivate)
        try {
            chrome.runtime.onMessage.addListener(deactivateListener);
        } catch {}

        startWithPolicy(policy);
    } catch (error) {
        console.warn("[uBR] video-adblock failed to start", error);
        releaseGuard();
    }
})();
