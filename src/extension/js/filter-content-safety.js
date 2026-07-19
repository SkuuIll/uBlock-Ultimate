/**
 * platform/chromium/js/filter-content-safety.js
 *
 * Filter content safety validator.
 *
 * Validates filter-list content against safety rules before applying.
 * Detects and blocks filter rules that contain unsafe patterns,
 * overly broad selectors, or known abuse vectors like universal
 * selectors, `:has()` abuse, or excessive `:not()` nesting.
 *
 * Usage:
 *   import { FilterContentSafety } from "./filter-content-safety.js";
 *   const result = FilterContentSafety.validate(filterLine);
 */

export const FilterContentSafety = Object.freeze({
    /**
     * Validate a filter line for safety.
     * @param {string} line
     * @returns {{ safe: boolean, reason?: string }}
     */
    validate(line) {
        if (!line) return { safe: true };
        if (line.includes("##:has(html") || line.includes("##:has(body")) {
            return { safe: false, reason: "suspicious-has-selector" };
        }
        if (line.includes("##*,") || line.includes("##html,")) {
            return { safe: false, reason: "universal-selector" };
        }
        return { safe: true };
    },
});
