/**
 * src/js/runtime/page-classifier.ts
 *
 * App-like page classification from cheap structural signals (P2.2).
 * No private content is read. Only structural booleans/counts are used.
 *
 * Usage:
 *   import { classifyPageProfile } from "./page-classifier.js";
 *
 *   const profile = classifyPageProfile(signals);
 *   // "default-web" | "app-shell" | "auth-sensitive" | "payment-sensitive" | "video-site"
 */

export type PageSignals = {
    hasContentEditable?: boolean;
    hasLargeAppRoot?: boolean;
    hasAuthForm?: boolean;
    hasPaymentForm?: boolean;
    hasPrimaryVideo?: boolean;
    hasKnownVideoPlayerSignal?: boolean;
};

export type PageProfile = "default-web" | "app-shell" | "auth-sensitive" | "payment-sensitive" | "video-site";

export function classifyPageProfile(signals: PageSignals): PageProfile {
    if (signals.hasPaymentForm) return "payment-sensitive";
    if (signals.hasAuthForm) return "auth-sensitive";
    if (signals.hasContentEditable || signals.hasLargeAppRoot) return "app-shell";
    if (signals.hasPrimaryVideo && signals.hasKnownVideoPlayerSignal) return "video-site";
    return "default-web";
}

export function profileToPolicyMapping(profile: PageProfile): Record<string, unknown> {
    switch (profile) {
        case "app-shell":
            return {
                genericCosmetic: false,
                proceduralCosmetic: false,
                smartCosmetic: false,
                genericVideo: "off",
                mainWorldHooks: "off",
                network: { highRiskResources: "specific-only" },
            };
        case "auth-sensitive":
        case "payment-sensitive":
            return {
                genericCosmetic: false,
                proceduralCosmetic: false,
                smartCosmetic: false,
                genericVideo: "off",
                mainWorldHooks: "off",
                network: { firstPartyResponseMutation: false },
            };
        case "video-site":
            return {
                genericVideo: "known-adapter-only",
                genericCosmetic: true,
            };
        default:
            return {};
    }
}
