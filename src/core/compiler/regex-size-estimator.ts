/**
 * src/core/compiler/regex-size-estimator.ts
 *
 * Conservative heuristic estimator for the compiled size of a
 * regular expression. The intent is to flag potentially expensive
 * regex patterns before they are handed to the DNR engine.
 *
 * This module analyzes strings only. It never constructs a
 * RegExp and therefore never throws on malformed input.
 */

export interface RegexEstimate {
  pattern: string;
  estimatedBytes: number;
  reasons: string[];
}

const LARGE_PATTERN_LENGTH = 256;
const MANY_ALTERNATIONS = 5;
const MANY_GROUPS = 5;
const MANY_QUANTIFIERS = 5;
const MANY_CHAR_CLASSES = 5;

/**
 * Estimate the compiled size of a regex pattern.
 *
 * @param pattern - raw regex pattern text (without delimiters)
 */
export function estimateRegexCompiledSize(pattern: string): RegexEstimate {
    if (typeof pattern !== 'string') {
        return { pattern: String(pattern), estimatedBytes: 0, reasons: [] };
    }

    const reasons: string[] = [];

    const alternationCount = countUnescapedPipes(pattern);
    const groupCount = countUnescapedParens(pattern);
    const quantifierCount = countQuantifiers(pattern);
    const characterClassCount = countCharacterClasses(pattern);
    const lookaroundCount = countLookaround(pattern);
    const nestedQuantifierCount = countNestedQuantifiers(pattern);

    const estimatedBytes =
    pattern.length * 8 +
    alternationCount * 64 +
    groupCount * 48 +
    quantifierCount * 32 +
    characterClassCount * 32 +
    lookaroundCount * 128 +
    nestedQuantifierCount * 256;

    if (pattern.length >= LARGE_PATTERN_LENGTH) reasons.push('large pattern');
    if (alternationCount >= MANY_ALTERNATIONS) reasons.push('many alternations');
    if (groupCount >= MANY_GROUPS) reasons.push('many groups');
    if (quantifierCount >= MANY_QUANTIFIERS) reasons.push('many quantifiers');
    if (characterClassCount >= MANY_CHAR_CLASSES) reasons.push('many character classes');
    if (lookaroundCount > 0) reasons.push('lookaround');
    if (nestedQuantifierCount > 0) reasons.push('nested quantifier');

    return { pattern, estimatedBytes, reasons };
}

/**
 * Count unescaped `|` characters that act as alternation operators.
 * Ignores `|` inside character classes.
 */
function countUnescapedPipes(pattern) {
    let count = 0;
    let inClass = false;
    let escaped = false;
    for (let i = 0; i < pattern.length; i++) {
        const c = pattern[i];
        if (escaped) { escaped = false; continue; }
        if (c === '\\') { escaped = true; continue; }
        if (c === '[' && !inClass) { inClass = true; continue; }
        if (c === ']' && inClass) { inClass = false; continue; }
        if (c === '|' && !inClass) count++;
    }
    return count;
}

/**
 * Count unescaped `(` characters that open a group, ignoring
 * character classes and non-capturing/lookaround group forms.
 */
function countUnescapedParens(pattern) {
    let count = 0;
    let inClass = false;
    let escaped = false;
    for (let i = 0; i < pattern.length; i++) {
        const c = pattern[i];
        if (escaped) { escaped = false; continue; }
        if (c === '\\') { escaped = true; continue; }
        if (c === '[' && !inClass) { inClass = true; continue; }
        if (c === ']' && inClass) { inClass = false; continue; }
        if (inClass) continue;
        if (c !== '(') continue;
        // Skip group modifiers: (?:, (?=, (?!, (?<=
        const next = pattern[i + 1];
        if (next === '?') {
            // Check if this is a named capturing group: (?<name>...)
            // Skip non-capturing: (?:, lookahead: (?= (?!, lookbehind: (?<= (?<!
            const rest = pattern.slice(i + 2);
            if (/^[:=]/.test(rest) || /^<[=!]/.test(rest)) {
                // Non-capturing, lookahead, or lookbehind — skip
            } else {
                count++; // Named capturing group (?<name>...) or (?(condition)...)
            }
            continue;
        }
        count++;
    }
    return count;
}

/**
 * Count quantifier characters (* + ? {n,m}) that are not part of
 * an escape or character class and not preceded by another
 * quantifier (a heuristic for "real" quantifiers).
 */
function countQuantifiers(pattern) {
    let count = 0;
    let inClass = false;
    let escaped = false;
    for (let i = 0; i < pattern.length; i++) {
        const c = pattern[i];
        if (escaped) { escaped = false; continue; }
        if (c === '\\') { escaped = true; continue; }
        if (c === '[' && !inClass) { inClass = true; continue; }
        if (c === ']' && inClass) { inClass = false; continue; }
        if (inClass) continue;
        if (c === '{') {
            // Count {n,m} quantifiers
            const rest = pattern.slice(i);
            if (/^\{(\d+)(,\d*)?\}/.test(rest)) {
                count++;
            }
            continue;
        }
        if (c !== '*' && c !== '+' && c !== '?') continue;
        // Skip if at start (e.g. literal "?")
        if (i === 0) continue;
        const prev = pattern[i - 1];
        if (prev === '(' || prev === '|') continue;
        count++;
    }
    return count;
}

/**
 * Count `[` characters that open a character class.
 */
function countCharacterClasses(pattern) {
    let count = 0;
    let escaped = false;
    for (let i = 0; i < pattern.length; i++) {
        const c = pattern[i];
        if (escaped) { escaped = false; continue; }
        if (c === '\\') { escaped = true; continue; }
        if (c === '[') count++;
    }
    return count;
}

/**
 * Count lookaround groups: (?=, (?!, (?<=, (?<!
 */
function countLookaround(pattern) {
    const re = /\(\?[=!][^)]*\)|\(\?<[=!][^)]*\)/g;
    const m = pattern.match(re);
    return m ? m.length : 0;
}

/**
 * Detect nested quantifiers like (a+)+, (a*)*
 */
function countNestedQuantifiers(pattern) {
    const re = /\([^()]*[*+][^()]*\)[*+?{]/;
    return re.test(pattern) ? 1 : 0;
}
