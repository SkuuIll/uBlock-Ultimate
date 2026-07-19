export interface SkipControlCandidate {
    element: HTMLElement;
    confidence: "medium" | "high";
    reason: string;
}

const SKIP_TEXT_PATTERNS = [
    /\bskip\b/i,
    /skip\s+ad/i,
    /skip\s+ads/i,
    /skip\s+in/i,
    /ad\s+ends/i,
    /seconds?/i,
    /sec\.?/i,
    /überspringen/i,
    /anzeige\s+überspringen/i,
    /werbung\s+überspringen/i,
    /weiter/i,
    /continue/i,
    /saltar/i,
    /omitir/i,
    /ignorar/i,
    /passer/i,
    /passer\s+l['']annonce/i,
    /salta/i,
    /preskoč/i,
    /přeskočit/i,
    /preskocit/i,
    /^skip$/i,
    /^skip\s*>$/i,
];

const SKIP_CLASS_ID_SIGNALS = [
    "skip", "skipad", "skip-ad", "adskip", "ad-skip",
    "vast-skip", "ima-skip", "preroll-skip", "video-ad-skip",
];

const AD_STATE_SIGNALS = [
    "ad", "ads", "advert", "advertisement", "preroll", "midroll",
    "postroll", "vast", "vmap", "ima", "sponsor", "sponsored",
];

function looksLikeCountdownOnly(el: HTMLElement): boolean {
    const text = [
        el.textContent || "",
        el.getAttribute("aria-label") || "",
        el.getAttribute("title") || "",
    ].join(" ").trim().toLowerCase();

    if (/^\d+$/.test(text)) return true;
    if (/skip\s+in\s+\d+/.test(text)) return true;
    if (/\d+\s*(s|sec|seconds)/.test(text) && /skip|ad|wait/.test(text)) return true;

    return false;
}

function visibleEnough(el: HTMLElement): boolean {
    if (!el.isConnected) return false;

    const rect = el.getBoundingClientRect();
    if (rect.width < 20 || rect.height < 10) return false;

    const style = getComputedStyle(el);
    if (style.display === "none") return false;
    if (style.visibility === "hidden") return false;
    if (style.pointerEvents === "none") return false;
    if (Number(style.opacity || "1") < 0.1) return false;

    return true;
}

function classOrIdLooksDisabled(el: HTMLElement): boolean {
    const cls = typeof el.className === "string" ? el.className : "";
    const id = el.id || "";
    const aria = el.getAttribute("aria-label") || "";
    const title = el.getAttribute("title") || "";
    const combined = `${cls} ${id} ${aria} ${title}`.toLowerCase().replace(/_/g, "-");

    return (
        combined.includes("disabled") ||
        combined.includes("disable") ||
        combined.includes("inactive") ||
        combined.includes("not-ready") ||
        combined.includes("notready") ||
        combined.includes("countdown") ||
        combined.includes("wait")
    );
}

function enabledEnough(el: HTMLElement): boolean {
    if (el.hasAttribute("disabled")) return false;
    if (el.getAttribute("aria-disabled") === "true") return false;
    if (el.classList.contains("disabled")) return false;
    if (classOrIdLooksDisabled(el)) return false;
    return true;
}

function textLooksLikeSkip(el: HTMLElement): boolean {
    const text = [
        el.textContent || "",
        el.getAttribute("aria-label") || "",
        el.getAttribute("title") || "",
        el.getAttribute("value") || "",
    ].join(" ").trim();

    return SKIP_TEXT_PATTERNS.some(re => re.test(text));
}

function classOrIdLooksLikeSkip(el: HTMLElement): boolean {
    const cls = typeof el.className === "string" ? el.className : "";
    const id = el.id || "";
    const combined = `${cls} ${id}`.toLowerCase().replace(/_/g, "-");
    return SKIP_CLASS_ID_SIGNALS.some(signal => combined.includes(signal));
}

function elementNearVideo(el: HTMLElement, video: HTMLVideoElement): boolean {
    const er = el.getBoundingClientRect();
    const vr = video.getBoundingClientRect();

    if (vr.width < 200 || vr.height < 100) return false;

    const padX = vr.width * 0.45;
    const padY = vr.height * 0.45;

    const left = vr.left - padX;
    const right = vr.right + padX;
    const top = vr.top - padY;
    const bottom = vr.bottom + padY;

    return er.right >= left && er.left <= right && er.bottom >= top && er.top <= bottom;
}

function playerLooksAdLike(video: HTMLVideoElement): boolean {
    let current: Element | null = video.parentElement;
    let depth = 0;

    while (current && depth < 8) {
        const cls = typeof current.className === "string" ? current.className : "";
        const id = current.id || "";
        const aria = current.getAttribute("aria-label") || "";
        const combined = `${cls} ${id} ${aria}`.toLowerCase();

        if (AD_STATE_SIGNALS.some(signal => combined.includes(signal))) return true;

        current = current.parentElement;
        depth++;
    }

    return false;
}

export function findVisibleSkipControlsForVideo(
    video: HTMLVideoElement,
    doc: Document,
): SkipControlCandidate[] {
    const candidates: SkipControlCandidate[] = [];

    const controls = Array.from(
        doc.querySelectorAll<HTMLElement>(
            "button, a, [role='button'], .skip, [class*='skip'], [id*='skip'], [aria-label*='skip' i]",
        ),
    );

    for (const el of controls) {
        if (!visibleEnough(el)) continue;
        if (!enabledEnough(el)) continue;
        if (!elementNearVideo(el, video)) continue;
        if (looksLikeCountdownOnly(el)) continue;

        const textSkip = textLooksLikeSkip(el);
        const classSkip = classOrIdLooksLikeSkip(el);
        const adLikePlayer = playerLooksAdLike(video);

        if (textSkip && classSkip) {
            candidates.push({
                element: el,
                confidence: "high",
                reason: "visible-enabled-skip-control-text-and-class",
            });
            continue;
        }

        if (textSkip && adLikePlayer) {
            candidates.push({
                element: el,
                confidence: "high",
                reason: "visible-enabled-skip-control-in-ad-like-player",
            });
            continue;
        }

        if (textSkip || classSkip) {
            candidates.push({
                element: el,
                confidence: "medium",
                reason: "visible-enabled-skip-control-near-video",
            });
        }
    }

    return candidates;
}
