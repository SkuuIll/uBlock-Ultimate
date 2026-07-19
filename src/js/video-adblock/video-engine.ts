import { debugLog, warnLog } from "./diagnostics";
import { isKnownVideoAdapterHost, shouldEnableGenericVideoEngine, markEngineDisabled, isEngineDisabled } from "./breakage-guard";
import { selectVideoSiteAdapters } from "./site-adapters/index";
import { applySafeActionPlan, restoreHiddenVideoAds } from "./safe-actions";
import {
    markVideoPlay,
    markContentTick,
    markAdSignal,
    markSkipClicked,
    markUserPlayGesture,
    shouldKeepScanningAggressively,
} from "./video-ad-lifecycle";
import { installPlayerGestureArm, resetPlayerGestureArm } from "./player-gesture-arm";

const SCAN_INTERVAL = 250;
const MAX_NODES_PER_SCAN = 150;
const MAX_ERRORS = 5;
const MAX_EMPTY_SCANS_BEFORE_BACKOFF = 40;
const SLOW_SCAN_INTERVAL = 1500;

let observer: MutationObserver | null = null;
let scanTimer: ReturnType<typeof setTimeout> | null = null;
let errorCount = 0;
let emptyScanCount = 0;
let currentScanInterval = SCAN_INTERVAL;
const instrumentedVideos = new WeakSet<HTMLVideoElement>();
let fastScanTimer: ReturnType<typeof setInterval> | null = null;
let lastKnownPlayers: HTMLVideoElement[] = [];

function stopEngine(reason: string): void {
    markEngineDisabled(reason);
    restoreHiddenVideoAds();
    resetPlayerGestureArm();
    errorCount = 0;
    emptyScanCount = 0;
    currentScanInterval = SCAN_INTERVAL;

    if (observer) {
        observer.disconnect();
        observer = null;
    }

    if (scanTimer) {
        clearTimeout(scanTimer);
        scanTimer = null;
    }

    if (fastScanTimer) {
        clearInterval(fastScanTimer);
        fastScanTimer = null;
    }

    debugLog("Engine stopped:", reason);
}

function instrumentVideo(video: HTMLVideoElement): void {
    if (instrumentedVideos.has(video)) return;
    instrumentedVideos.add(video);

    video.addEventListener("play", () => {
        markVideoPlay(video);
        ensureFastScanLoop();
    }, true);

    video.addEventListener("playing", () => {
        markContentTick(video);
        ensureFastScanLoop();
    }, true);

    video.addEventListener("timeupdate", () => {
        markContentTick(video);
    }, true);

    video.addEventListener("loadedmetadata", () => {
        ensureFastScanLoop();
    }, true);

    video.addEventListener("durationchange", () => {
        ensureFastScanLoop();
    }, true);

    video.addEventListener("waiting", () => {
        ensureFastScanLoop();
    }, true);

    video.addEventListener("pause", () => {
        ensureFastScanLoop();
    }, true);
}

function ensureFastScanLoop(): void {
    if (fastScanTimer !== null) return;

    fastScanTimer = window.setInterval(() => {
        const active = lastKnownPlayers.some(video =>
            video.isConnected && shouldKeepScanningAggressively(video)
        );

        if (!active) {
            if (fastScanTimer !== null) {
                clearInterval(fastScanTimer);
                fastScanTimer = null;
            }
            return;
        }

        try {
            scan();
        } catch (err) {
            warnLog("Fast scan error:", err);
        }
    }, 250);
}

function scan(): void {
    if (isEngineDisabled()) return;

    const hostname = location.hostname.toLowerCase();

    const adapters = selectVideoSiteAdapters(hostname);
    if (adapters.length === 0) {
        emptyScanCount++;
        if (emptyScanCount >= MAX_EMPTY_SCANS_BEFORE_BACKOFF) {
            currentScanInterval = SLOW_SCAN_INTERVAL;
        }
        debugLog("No adapter matched for host; keeping observer alive");
        return;
    }

    if (!shouldEnableGenericVideoEngine(document, hostname)) {
        emptyScanCount++;
        if (emptyScanCount >= MAX_EMPTY_SCANS_BEFORE_BACKOFF) {
            currentScanInterval = SLOW_SCAN_INTERVAL;
        }
        debugLog("No video found yet; keeping observer alive");
        return;
    }

    const activeAdapters = adapters.filter(adapter => !adapter.shouldDisableForBreakage(document));
    if (activeAdapters.length === 0) {
        stopEngine("all-adapters-requested-disable");
        return;
    }

    const players = Array.from(
        new Set(activeAdapters.flatMap(adapter => adapter.detectPlayer(document))),
    );

    if (players.length === 0) {
        emptyScanCount++;
        if (emptyScanCount >= MAX_EMPTY_SCANS_BEFORE_BACKOFF) {
            currentScanInterval = SLOW_SCAN_INTERVAL;
        }
        debugLog("No primary video players found yet; keeping observer alive");
        return;
    }

    lastKnownPlayers = players;

    emptyScanCount = 0;
    currentScanInterval = SCAN_INTERVAL;

    if (players.length > MAX_NODES_PER_SCAN) {
        markEngineDisabled("too-many-videos");
        return;
    }

    for (const video of players) {
        instrumentVideo(video);
    }

    for (const video of players) {
        for (const adapter of activeAdapters) {
            const detection = adapter.detectAdState(document, video);
            if (!detection.isAd || detection.confidence === "none") continue;

            markAdSignal(video, detection.reason);

            const plan = adapter.getSafeActions(document, detection);
            const actionResult = applySafeActionPlan(plan);

            if (actionResult.clickedSkips > 0) {
                markSkipClicked(video);
            }

            debugLog("Applied action for:", adapter.id, detection.reason);

            if (detection.confidence === "high") break;
        }
    }
}

export function startVideoAdBlocker(): void {
    if (isEngineDisabled()) return;

    debugLog("Starting video ad blocker");

    scan();

    try {
        observer = new MutationObserver(() => {
            if (scanTimer !== null) return;

            scanTimer = setTimeout(() => {
                scanTimer = null;

                try {
                    scan();
                } catch (err) {
                    errorCount++;
                    warnLog("Scan error:", err);

                    if (errorCount >= MAX_ERRORS) {
                        stopEngine("too-many-errors");
                    }
                }
            }, currentScanInterval);
        });

        observer.observe(document, {
            childList: true,
            subtree: true,
            attributes: true,
            characterData: true,
            attributeFilter: ["src", "class", "id", "style", "disabled", "aria-disabled", "aria-label", "title"],
        });
    } catch (err) {
        warnLog("Failed to start observer:", err);
        stopEngine("observer-failed");
    }

    installPlayerGestureArm({
        getVideos: () => lastKnownPlayers.filter(video => video.isConnected),
        onArmed: (video, reason) => {
            markUserPlayGesture(video);
            ensureFastScanLoop();
        },
    });
}

export function stopVideoAdBlocker(): void {
    stopEngine("explicit-stop");
}
