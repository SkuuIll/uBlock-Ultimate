/**
 * platform/chromium/js/dnr-registry.js
 *
 * Central registry for DNR rule ID ranges and priority bands.
 * All DNR rule creation in sw.js must reference these constants.
 *
 * Usage:
 *   import { DNR_ID_RANGES, DNR_PRIORITY_BANDS } from "./dnr-registry.js";
 */
export const DNR_ID_RANGES = {
    staticCore: [1, 99999],
    whitelistSession: [100000, 199999],
    dynamicCompiled: [200000, 4999999],
    sessionOverflow: [23000000, 23004999],
    stealthSurrogates: [90000000, 90009999],
};

export const DNR_PRIORITY_BANDS = {
    allowCritical: 2_450_000,
    allowUser: 500000,
    blockImportant: 100001,
    blockDefault: 1,
};
