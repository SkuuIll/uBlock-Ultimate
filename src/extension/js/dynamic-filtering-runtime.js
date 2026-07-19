/*
 * Canonical dynamic-filtering runtime used by platform/chromium/js/sw.js.
 * This mirrors uBlock Origin's dynamic host-rule lookup model while compiling
 * only enforceable MV3 DNR rules for the manifest-selected service worker.
 */

export const FIREWALL_RULE_ID_MIN = 9_000_000;
export const FIREWALL_RULE_ID_MAX = 9_099_999;

export const firewallRuleTypes = [
    "*",
    "image",
    "3p",
    "inline-script",
    "1p-script",
    "3p-script",
    "3p-frame",
];

export const firewallTypeBitOffsets = {
    "*": 0,
    "inline-script": 2,
    "1p-script": 4,
    "3p-script": 6,
    "3p-frame": 8,
    "image": 10,
    "3p": 12,
};

export const firewallActionNames = {
    1: "block",
    2: "allow",
    3: "noop",
};

export const firewallActionValues = {
    block: 1,
    allow: 2,
    noop: 3,
};

const supportedDynamicTypes = new Set([
    "3p",
    "image",
    "inline-script",
    "1p-script",
    "3p-script",
    "3p-frame",
]);

const SUBRESOURCE_TYPES = [
    "image",
    "script",
    "sub_frame",
    "stylesheet",
    "xmlhttprequest",
    "media",
    "font",
    "object",
    "other",
    "ping",
    "websocket",
];

const reIPv4 = /^(?:\d{1,3}\.){3}\d{1,3}$/;
const reIPv6 = /^\[[0-9a-f:]+\]$/i;

export function normalizeHostname(hostname) {
    return String(hostname || "").trim().toLowerCase().replace(/\.$/, "");
}

export function registrableDomainFromHostname(hostname) {
    const hn = normalizeHostname(hostname);
    if (hn === "" || hn === "*" || hn === "localhost" || reIPv4.test(hn) || reIPv6.test(hn)) {
        return hn;
    }
    const parts = hn.split(".").filter(Boolean);
    if (parts.length <= 2) return hn;
    return parts.slice(-2).join(".");
}

export function decomposeHostname(hostname) {
    const hn = normalizeHostname(hostname);
    if (hn === "" || hn === "*") return ["*"];
    const out = [];
    const parts = hn.split(".").filter(Boolean);
    for (let i = 0; i < parts.length; i += 1) {
        out.push(parts.slice(i).join("."));
    }
    out.push("*");
    return out;
}

export function isThirdParty(srcHostname, desHostname) {
    const src = registrableDomainFromHostname(srcHostname);
    const des = registrableDomainFromHostname(desHostname);
    if (src === "" || des === "" || src === "*" || des === "*") return false;
    return src !== des;
}

export function isDnrInitiatorDomain(hostname) {
    const hn = normalizeHostname(hostname);
    if (hn === "" || hn === "*") return true;
    if (hn === "localhost" || hn.endsWith(".localhost")) return false;
    if (reIPv4.test(hn) || reIPv6.test(hn)) return false;
    return hn.includes(".");
}

export function parseFirewallRuleLine(line) {
    const text = String(line || "").trim();
    if (text === "" || text.startsWith("#")) return null;
    const parts = text.split(/\s+/);
    if (parts.length < 4) return null;
    const [rawSrc, rawDes, type, rawAction] = parts;
    const src = normalizeHostname(rawSrc) || "*";
    const des = normalizeHostname(rawDes) || "*";
    const action = normalizeAction(rawAction);
    if (action === 0) return null;
    if (firewallTypeBitOffsets[type] === undefined) return null;
    if (des !== "*" && type !== "*") return null;
    return { src, des, type, action };
}

export function normalizeAction(action) {
    if (typeof action === "number") return action >= 1 && action <= 3 ? action : 0;
    const text = String(action || "").trim();
    if (/^[123]$/.test(text)) return Number(text);
    return firewallActionValues[text] || 0;
}

export function ruleKey(src, des, type) {
    return `${normalizeHostname(src) || "*"} ${normalizeHostname(des) || "*"} ${type || "*"}`;
}

export class DynamicFirewallRules {
    constructor() {
        this.rules = new Map();
        this.r = 0;
        this.type = "";
        this.y = "";
        this.z = "";
        this.changed = false;
    }

    reset() {
        this.rules.clear();
        this.clearRegisters();
        this.changed = false;
    }

    clearRegisters() {
        this.r = 0;
        this.type = "";
        this.y = "";
        this.z = "";
        return this;
    }

    assign(other) {
        for (const key of [...this.rules.keys()]) {
            if (other.rules.has(key) === false) {
                this.rules.delete(key);
                this.changed = true;
            }
        }
        for (const [key, value] of other.rules) {
            if (this.rules.get(key) !== value) {
                this.rules.set(key, value);
                this.changed = true;
            }
        }
        return this.changed;
    }

    copyRules(from, srcHostname, desHostnames = {}) {
        let changed = false;
        const src = normalizeHostname(srcHostname);
        const copyKey = key => {
            const thisBits = this.rules.get(key);
            const fromBits = from.rules.get(key);
            if (fromBits === thisBits) return;
            if (fromBits !== undefined) this.rules.set(key, fromBits);
            else this.rules.delete(key);
            changed = true;
        };

        copyKey("* *");
        if (src) copyKey(`${src} *`);
        for (const desHostname of Object.keys(desHostnames || {})) {
            const des = normalizeHostname(desHostname);
            if (des === "") continue;
            copyKey(`* ${des}`);
            if (src) copyKey(`${src} ${des}`);
        }
        this.changed = this.changed || changed;
        return changed;
    }

    hasSameRules(other, srcHostname, desHostnames = {}) {
        const src = normalizeHostname(srcHostname);
        const keys = new Set(["* *"]);
        if (src) keys.add(`${src} *`);
        for (const desHostname of Object.keys(desHostnames || {})) {
            const des = normalizeHostname(desHostname);
            if (des === "") continue;
            keys.add(`* ${des}`);
            if (src) keys.add(`${src} ${des}`);
        }
        for (const key of keys) {
            if (this.rules.get(key) !== other.rules.get(key)) return false;
        }
        return true;
    }

    setCell(srcHostname, desHostname, type, state) {
        const bitOffset = firewallTypeBitOffsets[type];
        const action = normalizeAction(state);
        if (bitOffset === undefined) return false;
        if ((normalizeHostname(desHostname) || "*") !== "*" && type !== "*") return false;
        const key = `${normalizeHostname(srcHostname) || "*"} ${normalizeHostname(desHostname) || "*"}`;
        const oldBitmap = this.rules.get(key) || 0;
        const newBitmap = (oldBitmap & ~(3 << bitOffset)) | (action << bitOffset);
        if (newBitmap === oldBitmap) return false;
        if (newBitmap === 0) this.rules.delete(key);
        else this.rules.set(key, newBitmap);
        this.changed = true;
        return true;
    }

    unsetCell(srcHostname, desHostname, type) {
        return this.setCell(srcHostname, desHostname, type, 0);
    }

    evaluateCell(srcHostname, desHostname, type) {
        const bitOffset = firewallTypeBitOffsets[type];
        if (bitOffset === undefined) return 0;
        const bitmap = this.rules.get(`${normalizeHostname(srcHostname) || "*"} ${normalizeHostname(desHostname) || "*"}`);
        if (bitmap === undefined) return 0;
        return (bitmap >>> bitOffset) & 3;
    }

    evaluateCellZ(srcHostname, desHostname, type) {
        const bitOffset = firewallTypeBitOffsets[type];
        if (bitOffset === undefined) return 0;
        this.type = type;
        for (const srchn of decomposeHostname(srcHostname)) {
            this.z = srchn;
            const bitmap = this.rules.get(`${srchn} ${normalizeHostname(desHostname) || "*"}`);
            if (bitmap === undefined) continue;
            const value = (bitmap >>> bitOffset) & 3;
            if (value === 0) continue;
            this.r = value;
            return value;
        }
        this.r = 0;
        return 0;
    }

    evaluateCellZY(srcHostname, desHostname, type) {
        const des = normalizeHostname(desHostname);
        if (des === "") {
            this.r = 0;
            this.type = "";
            return 0;
        }

        for (const deshn of decomposeHostname(des)) {
            if (deshn === "*") break;
            this.y = deshn;
            if (this.evaluateCellZ(srcHostname, deshn, "*") !== 0) return this.r;
        }

        const thirdParty = isThirdParty(srcHostname, des);
        this.y = "*";

        if (thirdParty) {
            if (type === "script") {
                if (this.evaluateCellZ(srcHostname, "*", "3p-script") !== 0) return this.r;
            } else if (type === "sub_frame" || type === "object") {
                if (this.evaluateCellZ(srcHostname, "*", "3p-frame") !== 0) return this.r;
            }
            if (this.evaluateCellZ(srcHostname, "*", "3p") !== 0) return this.r;
        } else if (type === "script") {
            if (this.evaluateCellZ(srcHostname, "*", "1p-script") !== 0) return this.r;
        }

        if (supportedDynamicTypes.has(type)) {
            if (this.evaluateCellZ(srcHostname, "*", type) !== 0) return this.r;
            if (type.startsWith("3p-")) {
                if (this.evaluateCellZ(srcHostname, "*", "3p") !== 0) return this.r;
            }
        }

        if (this.evaluateCellZ(srcHostname, "*", "*") !== 0) return this.r;

        this.r = 0;
        this.type = "";
        return 0;
    }

    lookupRuleData(srcHostname, desHostname, type) {
        const value = this.evaluateCellZY(srcHostname, desHostname, type);
        if (value === 0 || this.type === "") return undefined;
        return `${this.z} ${this.y} ${this.type} ${value}`;
    }

    toArray(options = {}) {
        const numeric = options.numeric === true;
        const out = [];
        for (const key of [...this.rules.keys()].sort()) {
            const [src, des] = key.split(" ");
            for (const type of firewallRuleTypes) {
                const value = this.evaluateCell(src, des, type);
                if (value === 0) continue;
                out.push(`${src} ${des} ${type} ${numeric ? value : firewallActionNames[value]}`);
            }
        }
        return out;
    }

    toObject(options = {}) {
        const out = {};
        for (const line of this.toArray({ numeric: options.numeric !== false })) {
            const parts = line.split(/\s+/);
            out[`${parts[0]} ${parts[1]} ${parts[2]}`] = line;
        }
        return out;
    }

    fromString(text, append = false) {
        if (append !== true) this.reset();
        for (const line of String(text || "").split(/\n/)) {
            const parsed = parseFirewallRuleLine(line);
            if (parsed === null) continue;
            this.setCell(parsed.src, parsed.des, parsed.type, parsed.action);
        }
        this.changed = false;
        return this;
    }

    fromObject(object, append = false) {
        if (append !== true) this.reset();
        for (const value of Object.values(object || {})) {
            const parsed = parseFirewallRuleLine(value);
            if (parsed === null) continue;
            this.setCell(parsed.src, parsed.des, parsed.type, parsed.action);
        }
        this.changed = false;
        return this;
    }

    addFromRuleParts(parts) {
        if (!Array.isArray(parts) || parts.length < 4) return false;
        const parsed = parseFirewallRuleLine(parts.join(" "));
        if (parsed === null) return false;
        return this.setCell(parsed.src, parsed.des, parsed.type, parsed.action);
    }

    removeFromRuleParts(parts) {
        if (!Array.isArray(parts) || parts.length < 3) return false;
        const [src, des, type] = parts;
        if (firewallTypeBitOffsets[type] === undefined) return false;
        return this.setCell(src, des, type, 0);
    }

    toString() {
        return this.toArray().join("\n");
    }
}

export function getFirewallRulesForPopup(firewall, srcHostname, hostnameDict = {}) {
    const rules = {};
    for (const type of firewallRuleTypes) {
        const globalRule = firewall.lookupRuleData("*", "*", type);
        if (globalRule !== undefined) rules[`/ * ${type}`] = globalRule;
        const localRule = firewall.lookupRuleData(srcHostname, "*", type);
        if (localRule !== undefined) rules[`. * ${type}`] = localRule;
    }
    for (const desHostname of Object.keys(hostnameDict || {})) {
        const globalRule = firewall.lookupRuleData("*", desHostname, "*");
        if (globalRule !== undefined) rules[`/ ${desHostname} *`] = globalRule;
        const localRule = firewall.lookupRuleData(srcHostname, desHostname, "*");
        if (localRule !== undefined) rules[`. ${desHostname} *`] = localRule;
    }
    return rules;
}

function resourceTypesForRuleType(type) {
    switch (type) {
    case "image":
        return ["image"];
    case "3p-script":
    case "1p-script":
        return ["script"];
    case "3p-frame":
        return ["sub_frame", "object"];
    case "3p":
    case "*":
        return SUBRESOURCE_TYPES;
    default:
        return [];
    }
}

function appliesToRuleType(broaderType, narrowerType) {
    if (broaderType === "*") return true;
    if (broaderType === narrowerType) return true;
    if (broaderType === "3p" && (narrowerType === "3p-script" || narrowerType === "3p-frame")) return true;
    return false;
}

function sameOrBroaderSource(broaderSrc, narrowerSrc) {
    const broad = normalizeHostname(broaderSrc) || "*";
    const narrow = normalizeHostname(narrowerSrc) || "*";
    if (broad === "*") return true;
    return decomposeHostname(narrow).includes(broad);
}

function sameOrBroaderDestination(broaderDes, narrowerDes) {
    const broad = normalizeHostname(broaderDes) || "*";
    const narrow = normalizeHostname(narrowerDes) || "*";
    if (broad === "*") return true;
    return decomposeHostname(narrow).includes(broad);
}

function priorityForRule(src, des, type, action) {
    let precedence = 1000;
    if (des !== "*" && type === "*") precedence = 7000;
    else if (type === "3p-script" || type === "1p-script" || type === "3p-frame") precedence = 5000;
    else if (type === "3p") precedence = 4000;
    else if (type === "image" || type === "inline-script") precedence = 3000;
    if (src !== "*") precedence += 500;
    if (des !== "*") precedence += 250;
    const actionRank = action === 2 ? 40 : 10;
    return 2_000_000 + precedence * 10 + actionRank;
}

function ruleConditionFor(src, des, type, resourceType, options = {}) {
    const condition = { resourceTypes: [resourceType] };
    if (Number.isInteger(options.tabId)) {
        condition.tabIds = [options.tabId];
    } else if (src !== "*") {
        condition.initiatorDomains = [src];
    }
    if (des !== "*") condition.requestDomains = [des];
    if (type === "3p" || type === "3p-script" || type === "3p-frame") {
        condition.domainType = "thirdParty";
    } else if (type === "1p-script") {
        condition.domainType = "firstParty";
    }
    return condition;
}

function collectNeutralizingRules(rules, blockRule) {
    const excludedInitiators = new Set();
    const excludedRequests = new Set();
    for (const rule of rules) {
        if (rule.action !== 3) continue;
        if (rule.src === blockRule.src && rule.des === blockRule.des && rule.type === blockRule.type) continue;
        if (sameOrBroaderSource(blockRule.src, rule.src) === false) continue;
        if (sameOrBroaderDestination(blockRule.des, rule.des) === false) continue;
        if (appliesToRuleType(blockRule.type, rule.type) === false) continue;
        if (blockRule.src === "*" && rule.src !== "*" && rule.des === "*") {
            excludedInitiators.add(rule.src);
        } else if (blockRule.des === "*" && rule.des !== "*" && rule.src === "*") {
            excludedRequests.add(rule.des);
        }
    }
    return { excludedInitiators, excludedRequests };
}

function compileInlineScriptRule(id, src, action, ruleAction) {
    const condition = { resourceTypes: ["main_frame", "sub_frame"] };
    if (src !== "*") condition.requestDomains = [src];
    return {
        id,
        priority: priorityForRule(src, "*", "inline-script", ruleAction),
        action: {
            type: "modifyHeaders",
            responseHeaders: [
                {
                    header: "content-security-policy",
                    operation: "set",
                    value: action === "block"
                        ? "script-src 'self' 'unsafe-eval' http: https: data: blob:; object-src 'none'; base-uri 'self'"
                        : "script-src 'self' 'unsafe-inline' 'unsafe-eval' http: https: data: blob:; object-src 'none'; base-uri 'self'",
                },
            ],
        },
        condition,
    };
}

export function compileFirewallRulesToDnr(firewall, options = {}) {
    const baseId = Number(options.baseId) || FIREWALL_RULE_ID_MIN;
    const maxId = Number(options.maxId) || FIREWALL_RULE_ID_MAX;
    const tabScopedSource = normalizeHostname(options.sourceHostname || "");
    const tabId = Number.isInteger(options.tabId) ? options.tabId : undefined;
    const addRules = [];
    const parsedRules = firewall.toArray({ numeric: true })
        .map(parseFirewallRuleLine)
        .filter(Boolean);
    const needsLoopbackThirdPartyFallback = parsedRules.some(rule =>
        rule.src !== "*" &&
        isDnrInitiatorDomain(rule.src) === false &&
        rule.action === 2
    );
    let nextRuleId = baseId;

    for (const rule of parsedRules) {
        if (nextRuleId > maxId) break;
        if (rule.action === 3) continue;
        if (tabScopedSource) {
            if (rule.src !== tabScopedSource) continue;
        }

        if (rule.type === "inline-script") {
            addRules.push(compileInlineScriptRule(
                nextRuleId++,
                rule.src,
                rule.action === 1 ? "block" : "allow",
                rule.action,
            ));
            continue;
        }

        const resourceTypes = resourceTypesForRuleType(rule.type);
        if (resourceTypes.length === 0) continue;
        const neutralized = rule.action === 1
            ? collectNeutralizingRules(parsedRules, rule)
            : { excludedInitiators: new Set(), excludedRequests: new Set() };
        for (const resourceType of resourceTypes) {
            if (nextRuleId > maxId) break;
            const condition = ruleConditionFor(rule.src, rule.des, rule.type, resourceType, { tabId });
            if (condition === null) continue;
            if (neutralized.excludedInitiators.size !== 0) {
                condition.excludedInitiatorDomains = [...neutralized.excludedInitiators].sort();
            }
            if (neutralized.excludedRequests.size !== 0) {
                condition.excludedRequestDomains = [...neutralized.excludedRequests].sort();
            }
            addRules.push({
                id: nextRuleId++,
                priority: priorityForRule(rule.src, rule.des, rule.type, rule.action),
                action: { type: rule.action === 1 ? "block" : "allow" },
                condition,
            });
        }

        if (
            needsLoopbackThirdPartyFallback &&
            tabScopedSource === "" &&
            rule.action === 1 &&
            rule.src === "*" &&
            rule.des === "*" &&
            (rule.type === "3p" || rule.type === "3p-script" || rule.type === "3p-frame")
        ) {
            for (const resourceType of resourceTypes) {
                if (nextRuleId > maxId) break;
                addRules.push({
                    id: nextRuleId++,
                    priority: priorityForRule(rule.src, rule.des, rule.type, rule.action) + 1,
                    action: { type: "block" },
                    condition: {
                        regexFilter: "^https?://127\\.",
                        resourceTypes: [resourceType],
                    },
                });
            }
        }
    }

    return addRules;
}

export function firewallRuleIdsInRange(rules) {
    return (rules || [])
        .map(rule => rule && rule.id)
        .filter(id => Number.isInteger(id) && id >= FIREWALL_RULE_ID_MIN && id <= FIREWALL_RULE_ID_MAX);
}
