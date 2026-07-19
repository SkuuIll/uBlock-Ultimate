// @ts-nocheck
export const MAX_SELECTOR_LENGTH = 2048;

export const PROHIBITED_PATTERNS: readonly string[] = [
  'javascript:',
  'expression(',
  '-moz-binding',
  'behavior:',
  'url(javascript:',
];

export function isSelectorLengthSafe(selector: string, cap: number = MAX_SELECTOR_LENGTH): boolean {
    return selector.length <= cap;
}

export function isSelectorProhibited(selector: string): boolean {
    const lower = selector.toLowerCase();
    return PROHIBITED_PATTERNS.some(p => lower.includes(p));
}

export function validateSelector(selector: string): { ok: boolean; reason?: string } {
    if (isSelectorProhibited(selector)) {
        return { ok: false, reason: 'prohibited pattern detected' };
    }
    if (!isSelectorLengthSafe(selector)) {
        return { ok: false, reason: `selector exceeds max length ${MAX_SELECTOR_LENGTH}` };
    }
    return { ok: true };
}
