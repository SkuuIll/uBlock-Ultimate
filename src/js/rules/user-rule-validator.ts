export type UserRuleDecision = {
    normalized: string;
    risk: "safe" | "medium" | "high" | "critical";
    accepted: boolean;
    reason: string;
};

const HIGH_RISK_RESOURCE_TYPES = new Set([
    "script",
    "xmlhttprequest",
    "websocket",
    "main_frame",
]);

export function validateUserRule(raw: string): UserRuleDecision {
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith("!") || trimmed.startsWith("#")) {
        return {
            normalized: trimmed,
            risk: "safe",
            accepted: true,
            reason: "comment or empty rule",
        };
    }

    // Parse basic rule structure
    const parts = trimmed.split(/[\s,]+/);
    const action = parts[0]?.toLowerCase();
    const target = parts[1] || "";
    const type = parts[2]?.toLowerCase() || "";

    if (!["*", "http", "https", "||", "|", "@@", "0.0.0.0"].some(p => action?.startsWith(p))) {
        if (action !== "off" && action !== "true" && action !== "false") {
            return {
                normalized: trimmed,
                risk: "medium",
                accepted: false,
                reason: "Invalid or ambiguous rule syntax",
            };
        }
    }

    // Check for global high-risk blocks
    const isBlock = !trimmed.startsWith("@@");
    const isGlobal = target === "*" || target === "" || target.startsWith("*");
    const isHighRiskType = type && HIGH_RISK_RESOURCE_TYPES.has(type);

    if (isBlock && isGlobal && isHighRiskType) {
        return {
            normalized: trimmed,
            risk: "critical",
            accepted: false,
            reason: `Global ${type} block requires advanced mode and explicit confirmation`,
        };
    }

    // Site-specific high-risk block
    if (isBlock && target && isHighRiskType) {
        return {
            normalized: trimmed,
            risk: "high",
            accepted: true,
            reason: `Site-specific ${type} block accepted`,
        };
    }

    if (isBlock && isGlobal && !type) {
        return {
            normalized: trimmed,
            risk: "medium",
            accepted: true,
            reason: "Global block accepted",
        };
    }

    return {
        normalized: trimmed,
        risk: "safe",
        accepted: true,
        reason: "Rule accepted",
    };
}
