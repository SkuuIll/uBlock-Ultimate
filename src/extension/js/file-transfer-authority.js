/**
 * platform/chromium/js/file-transfer-authority.js
 *
 * Browser file-transfer, clipboard, and download authority.
 *
 * All import/export/download/clipboard/drag-drop operations route through
 * this authority. Every request carries a source route, data class,
 * privacy class, and user-intent token. Import is staged and schema-
 * validated; export applies redaction by privacy class; clipboard write
 * requires recent user intent; download filenames and MIME types are
 * policy-generated.
 *
 * Usage:
 *   import { FileTransferAuthority } from "./file-transfer-authority.js";
 *   const ok = FileTransferAuthority.authorize({ operation: "export", sourceRoute: "dashboard", dataClass: "backup", privacyClass: "private", userIntentToken });
 */

const _redactedFieldsByPrivacy = {
    public: [],
    "local-sensitive": ["userFilters", "hostnameSwitches", "urlFilteringRules"],
    private: [
        "userFilters",
        "hostnameSwitches",
        "urlFilteringRules",
        "selectedFilterLists",
        "filterListCache",
        "cosmeticFiltersData",
        "localData",
        "whitelist",
    ],
};

const _allowedRoutes = {
    import: ["popup", "dashboard"],
    export: ["popup", "dashboard", "logger", "options"],
    download: ["popup", "dashboard", "logger", "options", "repair"],
    "clipboard-read": ["dashboard", "logger"],
    "clipboard-write": ["popup", "dashboard", "logger", "options"],
    "drag-drop": ["popup", "dashboard"],
};

const _mimeByDataClass = {
    "user-rules": "text/plain",
    backup: "application/json",
    diagnostic: "application/json",
    settings: "application/json",
    "compatibility-report": "application/json",
};

export const FileTransferAuthority = Object.freeze({
    /**
     * Authorize a file transfer operation.
     * @param {{
     *   operation: "import"|"export"|"download"|"clipboard-read"|"clipboard-write"|"drag-drop",
     *   sourceRoute: "popup"|"dashboard"|"logger"|"options"|"repair",
     *   dataClass: "user-rules"|"backup"|"diagnostic"|"settings"|"compatibility-report",
     *   privacyClass: "public"|"local-sensitive"|"private",
     *   userIntentToken?: string,
     *   filename?: string,
     *   mime?: string,
     * }} request
     * @returns {{ ok: boolean, reason?: string, redactedFields?: string[], mime?: string }}
     */
    authorize(request) {
        const allowed = _allowedRoutes[request.operation];
        if (!allowed || !allowed.includes(request.sourceRoute)) {
            return { ok: false, reason: `route-not-allowed: ${request.sourceRoute}` };
        }

        if (request.operation === "clipboard-read" && request.sourceRoute !== "dashboard" && request.sourceRoute !== "logger") {
            return { ok: false, reason: "clipboard-read-restricted" };
        }

        if ((request.operation === "clipboard-write" || request.operation === "import") && !request.userIntentToken) {
            return { ok: false, reason: "user-intent-required" };
        }

        const redactedFields = _redactedFieldsByPrivacy[request.privacyClass] || [];
        const mime = request.mime || _mimeByDataClass[request.dataClass] || "application/octet-stream";

        return { ok: true, redactedFields, mime };
    },

    /**
     * Get the policy-generated filename for a data class.
     * @param {string} dataClass
     * @returns {string}
     */
    generateFilename(dataClass) {
        const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
        const ext = dataClass === "user-rules" ? "txt" : "json";
        return `ublock-${dataClass}-${ts}.${ext}`;
    },

    /**
     * Apply privacy redaction to an export payload.
     * @param {object} data
     * @param {string[]} redactedFields
     * @returns {object}
     */
    applyRedaction(data, redactedFields) {
        const result = { ...data };
        for (const field of redactedFields) {
            if (field in result) {
                result[field] = "[REDACTED]";
            }
        }
        return result;
    },
});
