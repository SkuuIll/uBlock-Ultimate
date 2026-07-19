let debugEnabled = false;

export function enableDebug(): void {
    debugEnabled = true;
}

export function disableDebug(): void {
    debugEnabled = false;
}

export function debugLog(...args: unknown[]): void {
    if (debugEnabled) {
        console.log("[uBR-video-adblock]", ...args);
    }
}

export function warnLog(...args: unknown[]): void {
    console.warn("[uBR-video-adblock]", ...args);
}
