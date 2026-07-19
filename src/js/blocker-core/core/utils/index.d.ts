// @ts-nocheck
export declare function extractHostname(url: string): string | null;
export declare function extractRootDomain(hostname: string): string;
export declare function isValidDomain(domain: string): boolean;
export declare function normalizeUrl(url: string): string;
export declare function getResourceTypeFromTag(tagName: string): string;
export declare function debounce<T extends (...args: unknown[]) => void>(func: T, waitMs: number): (...args: Parameters<T>) => void;
export declare function throttle<T extends (...args: unknown[]) => void>(func: T, limitMs: number): (...args: Parameters<T>) => void;
export declare function chunkArray<T>(array: T[], chunkSize: number): T[][];
export declare function uniqueBy<T>(array: T[], key: keyof T): T[];
export declare function groupBy<T>(array: T[], key: keyof T): Record<string, T[]>;
export declare function retry<T>(fn: () => Promise<T>, maxRetries: number, delayMs: number): Promise<T>;
export declare function safeJSONParse<T>(json: string, fallback: T): T;
export declare function generateId(): string;
export declare function clamp(value: number, min: number, max: number): number;
export declare function sleep(ms: number): Promise<void>;
