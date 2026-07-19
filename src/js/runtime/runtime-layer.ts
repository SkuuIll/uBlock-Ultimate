/**
 * src/js/runtime/runtime-layer.ts
 *
 * Runtime activation protocol (P2.7).
 * Every runtime layer implements this interface.
 * No content runtime may self-start outside the activation protocol.
 *
 * Usage:
 *   import { registerLayer, activateLayersForTab, deactivateLayersForTab }
 *     from "./runtime-layer.js";
 */

const registeredLayers = new Map();

export function registerLayer(layer) {
    registeredLayers.set(layer.id, layer);
}

export function getRegisteredLayer(id) {
    return registeredLayers.get(id);
}

export function getRegisteredLayers() {
    return Array.from(registeredLayers.values());
}

export async function activateLayersForTab(tabId, policy, context) {
    const activated = [];
    for (const layer of registeredLayers.values()) {
        if (layer.canStart(policy)) {
            try {
                await layer.start({ tabId, ...context });
                activated.push(layer.id);
            } catch (err) {
                console.warn(`[uBR] Layer ${layer.id} failed to start:`, err);
            }
        }
    }
    return activated;
}

export async function deactivateLayersForTab(tabId, reason) {
    const deactivated = [];
    for (const layer of registeredLayers.values()) {
        try {
            await layer.stop(reason);
            deactivated.push(layer.id);
        } catch (err) {
            console.warn(`[uBR] Layer ${layer.id} failed to stop:`, err);
        }
    }
    return deactivated;
}
