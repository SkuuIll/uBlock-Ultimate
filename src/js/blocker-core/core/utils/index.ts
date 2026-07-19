// @ts-nocheck
export function extractHostname(url: string): string | null {
    try {
        if (!url.startsWith("http://") && !url.startsWith("https://")) {
            url = `https://${  url}`;
        }
        return new URL(url).hostname.toLowerCase();
    } catch (e) {
        console.warn('[uBR] utils: extractHostname failed', e);
        return null;
    }
}

export function extractRootDomain(hostname: string): string {
    const parts = hostname.split(".");
    if (parts.length >= 2) {
        return parts.slice(-2).join(".");
    }
    return hostname;
}

export function isValidDomain(domain: string): boolean {
    if (!domain || domain.length === 0) return false;
    if (domain.length > 253) return false;
    const domainRegex = /^([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/;
    return domainRegex.test(domain);
}

export function normalizeUrl(url: string): string {
    try {
        if (!url.startsWith("http://") && !url.startsWith("https://")) {
            url = `https://${  url}`;
        }
        const parsed = new URL(url);
        return parsed.origin + parsed.pathname;
    } catch (e) {
        console.warn('[uBR] utils: normalizeUrl failed', e);
        return url;
    }
}

export function getResourceTypeFromTag(tagName: string): string {
    const tag = tagName.toLowerCase();
    const mapping: Record<string, string> = {
        script: "script",
        img: "image",
        link: "stylesheet",
        iframe: "sub_frame",
        frame: "sub_frame",
        video: "media",
        audio: "media",
        source: "media",
        object: "other",
        embed: "other",
    };
    return mapping[tag] || "other";
}

export function debounce<T extends (...args: unknown[]) => unknown>(
    func: T,
    waitMs: number
): (...args: Parameters<T>) => void {
    let timeout: ReturnType<typeof setTimeout> | null = null;
    return (...args: Parameters<T>) => {
        if (timeout) {
            clearTimeout(timeout);
        }
        timeout = setTimeout(() => {
            func(...args);
        }, waitMs);
    };
}

export function throttle<T extends (...args: unknown[]) => unknown>(
    func: T,
    limitMs: number
): (...args: Parameters<T>) => void {
    let lastRun = 0;
    return (...args: Parameters<T>) => {
        const now = Date.now();
        if (now - lastRun >= limitMs) {
            lastRun = now;
            func(...args);
        }
    };
}

export function chunkArray<T>(array: T[], chunkSize: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += chunkSize) {
        chunks.push(array.slice(i, i + chunkSize));
    }
    return chunks;
}

export function uniqueBy<T extends Record<string, unknown>>(array: T[], key: keyof T): T[] {
    const seen = new Set<unknown>();
    return array.filter((item) => {
        const k = item[key];
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
    });
}

export function groupBy<T extends Record<string, unknown>>(
    array: T[],
    key: keyof T
): Record<string, T[]> {
    const groups: Record<string, T[]> = {};
    for (const item of array) {
        const k = String(item[key]);
        if (!groups[k]) groups[k] = [];
        groups[k].push(item);
    }
    return groups;
}

export async function retry<T>(
    fn: () => Promise<T>,
    maxRetries: number,
    delayMs: number
): Promise<T> {
    try {
        return await fn();
    } catch (error) {
        if (maxRetries <= 0) throw error;
        return new Promise<T>((resolve) =>
            setTimeout(() => {
                resolve(retry(fn, maxRetries - 1, delayMs));
            }, delayMs)
        );
    }
}

export function safeJSONParse<T>(json: string, fallback: T): T {
    try {
        return JSON.parse(json);
    } catch (e) {
        console.warn('[uBR] utils: safeJSONParse failed', e);
        return fallback;
    }
}

export function generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

export function clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
}

export function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
