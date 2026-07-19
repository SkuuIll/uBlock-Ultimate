export const RUNTIME_LAYERS = {
    networkDnr: {
        risk: "medium",
        requiresPolicy: "network.mode",
        canRunGlobally: true,
    },
    genericCosmetic: {
        risk: "high",
        requiresPolicy: "cosmetic.generic",
        canRunGlobally: false,
    },
    proceduralCosmetic: {
        risk: "high",
        requiresPolicy: "cosmetic.procedural",
        canRunGlobally: false,
    },
    smartCosmetic: {
        risk: "high",
        requiresPolicy: "cosmetic.smart",
        canRunGlobally: false,
    },
    genericVideo: {
        risk: "high",
        requiresPolicy: "video.allowMutation",
        canRunGlobally: false,
    },
    mainWorldHooks: {
        risk: "critical",
        requiresPolicy: "scriptlets.mainWorldHooks",
        canRunGlobally: false,
    },
    firstPartyResponseMutation: {
        risk: "critical",
        requiresPolicy: "network.firstPartyResponseMutation",
        canRunGlobally: false,
    },
};

export type RuntimeLayerId = keyof typeof RUNTIME_LAYERS;
export type RuntimeLayerRisk = "medium" | "high" | "critical";

export function getLayerRisk(layerId: RuntimeLayerId): RuntimeLayerRisk {
    return RUNTIME_LAYERS[layerId].risk;
}

export function layerRequiresPolicy(layerId: RuntimeLayerId): string {
    return RUNTIME_LAYERS[layerId].requiresPolicy;
}

export function canLayerRunGlobally(layerId: RuntimeLayerId): boolean {
    return RUNTIME_LAYERS[layerId].canRunGlobally;
}

export function isGloballyInjectedLayer(layerId: RuntimeLayerId): boolean {
    return RUNTIME_LAYERS[layerId].canRunGlobally === true;
}
