/*
 * Per-tab popup request accounting for the canonical MV3 service worker.
 * This stores only compact counters and pending terminal state, not logger
 * payloads, so the popup can render accurate rows after page load.
 */

export const POPUP_LEDGER_SESSION_KEY = "ubrPopupTabLedgers";

const MAX_LEDGER_TABS = 64;
const MAX_HOSTNAMES_PER_TAB = 512;
const MAX_PENDING_PER_TAB = 1024;
const MAX_LEDGER_AGE_MS = 60 * 60 * 1000;
const reBlockedError = /(?:ERR_BLOCKED_BY_CLIENT|NS_ERROR_BLOCKED|BLOCKED_BY_CLIENT|blocked by client)/i;

const reIPv4 = /^(?:\d{1,3}\.){3}\d{1,3}$/;
const reIPv6 = /^\[[0-9a-f:]+\]$/i;

export function normalizeHostname(hostname) {
    return String(hostname || "").trim().toLowerCase().replace(/\.$/, "");
}

export function hostnameFromURL(url) {
    try {
        const parsed = new URL(String(url || ""));
        return normalizeHostname(parsed.hostname);
    } catch (_) {
        return "";
    }
}

export function registrableDomainFromHostname(hostname) {
    const hn = normalizeHostname(hostname);
    if (hn === "" || hn === "localhost" || reIPv4.test(hn) || reIPv6.test(hn)) return hn;
    const parts = hn.split(".").filter(Boolean);
    if (parts.length <= 2) return hn;
    return parts.slice(-2).join(".");
}

export function createRequestCounts() {
    return { any: 0, script: 0, frame: 0 };
}

export function cloneRequestCounts(counts) {
    return {
        any: Number(counts?.any) || 0,
        script: Number(counts?.script) || 0,
        frame: Number(counts?.frame) || 0,
    };
}

export function addRequestCounts(target, source) {
    target.any += Number(source?.any) || 0;
    target.script += Number(source?.script) || 0;
    target.frame += Number(source?.frame) || 0;
}

export function incrementCounts(counts, type) {
    counts.any += 1;
    if (type === "script") counts.script += 1;
    if (type === "sub_frame" || type === "main_frame" || type === "object") counts.frame += 1;
}

export function countBucket(count) {
    const n = Number(count) || 0;
    if (n >= 100) return 3;
    if (n >= 10) return 2;
    if (n >= 1) return 1;
    return 0;
}

export function isExtensionBlockedError(error) {
    return reBlockedError.test(String(error || ""));
}

function createCountsPair() {
    return {
        allowed: createRequestCounts(),
        blocked: createRequestCounts(),
    };
}

function cloneCountsPair(counts) {
    return {
        allowed: cloneRequestCounts(counts?.allowed),
        blocked: cloneRequestCounts(counts?.blocked),
    };
}

function emptyLedger(tabId, details = {}) {
    const pageURL = String(details.pageURL || details.url || "");
    const pageHostname = normalizeHostname(details.pageHostname || hostnameFromURL(pageURL));
    const pageDomain = normalizeHostname(details.pageDomain || registrableDomainFromHostname(pageHostname));
    return {
        tabId,
        navigationId: details.navigationId || details.documentId || details.requestId || "",
        pageURL,
        pageHostname,
        pageDomain,
        pageCounts: createCountsPair(),
        hostnameDict: {},
        pendingRequests: new Map(),
        finalizedRequestIds: new Set(),
        contentRevision: Number(details.contentRevision) || 1,
        updatedAt: Number(details.updatedAt) || Date.now(),
    };
}

function serializePending(pendingRequests) {
    const pending = {};
    let count = 0;
    for (const [requestId, request] of pendingRequests) {
        if (count >= MAX_PENDING_PER_TAB) break;
        pending[requestId] = {
            requestId: request.requestId,
            url: request.url,
            hostname: request.hostname,
            domain: request.domain,
            tabId: request.tabId,
            type: request.type,
            frameId: request.frameId,
            parentFrameId: request.parentFrameId,
            navigationId: request.navigationId,
            finalized: request.finalized === true,
            tstamp: request.tstamp,
        };
        count += 1;
    }
    return pending;
}

function serializeLedger(ledger) {
    return {
        tabId: ledger.tabId,
        navigationId: ledger.navigationId,
        pageURL: ledger.pageURL,
        pageHostname: ledger.pageHostname,
        pageDomain: ledger.pageDomain,
        pageCounts: cloneCountsPair(ledger.pageCounts),
        hostnameDict: ledger.hostnameDict,
        pendingRequests: serializePending(ledger.pendingRequests),
        finalizedRequestIds: [...ledger.finalizedRequestIds].slice(-MAX_PENDING_PER_TAB),
        contentRevision: ledger.contentRevision,
        updatedAt: ledger.updatedAt,
    };
}

function hydrateLedger(tabId, raw) {
    const ledger = emptyLedger(tabId, raw || {});
    ledger.navigationId = raw?.navigationId || "";
    ledger.pageURL = String(raw?.pageURL || "");
    ledger.pageHostname = normalizeHostname(raw?.pageHostname || hostnameFromURL(ledger.pageURL));
    ledger.pageDomain = normalizeHostname(raw?.pageDomain || registrableDomainFromHostname(ledger.pageHostname));
    ledger.pageCounts = cloneCountsPair(raw?.pageCounts);
    ledger.hostnameDict = {};
    for (const [hostname, entry] of Object.entries(raw?.hostnameDict || {})) {
        const hn = normalizeHostname(hostname);
        if (hn === "") continue;
        ledger.hostnameDict[hn] = {
            domain: normalizeHostname(entry?.domain || registrableDomainFromHostname(hn)),
            allowed: cloneRequestCounts(entry?.allowed || entry?.counts?.allowed),
            blocked: cloneRequestCounts(entry?.blocked || entry?.counts?.blocked),
        };
    }
    ledger.pendingRequests = new Map();
    for (const [requestId, pending] of Object.entries(raw?.pendingRequests || {})) {
        ledger.pendingRequests.set(String(requestId), {
            requestId: String(pending?.requestId || requestId),
            url: String(pending?.url || ""),
            hostname: normalizeHostname(pending?.hostname || hostnameFromURL(pending?.url)),
            domain: normalizeHostname(pending?.domain || registrableDomainFromHostname(pending?.hostname || hostnameFromURL(pending?.url))),
            tabId,
            type: String(pending?.type || "other"),
            frameId: Number(pending?.frameId) || 0,
            parentFrameId: Number(pending?.parentFrameId) || -1,
            navigationId: pending?.navigationId || "",
            finalized: pending?.finalized === true,
            tstamp: Number(pending?.tstamp) || Date.now(),
        });
    }
    ledger.finalizedRequestIds = new Set(Array.isArray(raw?.finalizedRequestIds)
        ? raw.finalizedRequestIds.map(String)
        : []);
    ledger.contentRevision = Number(raw?.contentRevision) || 1;
    ledger.updatedAt = Number(raw?.updatedAt) || Date.now();
    return ledger;
}

export class PopupRequestLedgerStore {
    constructor(options = {}) {
        this.ledgers = new Map();
        this.globalAllowed = createRequestCounts();
        this.globalBlocked = createRequestCounts();
        this.now = typeof options.now === "function" ? options.now : () => Date.now();
        this.revisionCounter = Number(options.revisionCounter) || 1;
    }

    hydrate(rawLedgers = {}) {
        this.ledgers.clear();
        this.globalAllowed = createRequestCounts();
        this.globalBlocked = createRequestCounts();
        const now = this.now();
        for (const [tabIdText, raw] of Object.entries(rawLedgers || {})) {
            const tabId = Number(tabIdText);
            if (Number.isInteger(tabId) === false || tabId < 0) continue;
            if (now - (Number(raw?.updatedAt) || now) > MAX_LEDGER_AGE_MS) continue;
            const ledger = hydrateLedger(tabId, raw);
            this.ledgers.set(tabId, ledger);
            addRequestCounts(this.globalAllowed, ledger.pageCounts.allowed);
            addRequestCounts(this.globalBlocked, ledger.pageCounts.blocked);
            this.revisionCounter = Math.max(this.revisionCounter, ledger.contentRevision + 1);
        }
    }

    serialize() {
        const entries = [...this.ledgers.entries()]
            .sort((a, b) => b[1].updatedAt - a[1].updatedAt)
            .slice(0, MAX_LEDGER_TABS);
        const out = {};
        for (const [tabId, ledger] of entries) {
            out[String(tabId)] = serializeLedger(ledger);
        }
        return out;
    }

    getOrCreate(tabId, details = {}) {
        if (Number.isInteger(tabId) === false || tabId < 0) return null;
        let ledger = this.ledgers.get(tabId);
        if (ledger === undefined) {
            ledger = emptyLedger(tabId, { ...details, contentRevision: this.revisionCounter++ });
            this.ledgers.set(tabId, ledger);
        }
        if (details.pageURL || details.url) this.updatePageIdentity(ledger, details.pageURL || details.url, details);
        return ledger;
    }

    updatePageIdentity(ledger, pageURL, details = {}) {
        if (!ledger) return;
        const url = String(pageURL || "");
        const hostname = normalizeHostname(details.pageHostname || hostnameFromURL(url));
        const domain = normalizeHostname(details.pageDomain || registrableDomainFromHostname(hostname));
        if (url) ledger.pageURL = url;
        if (hostname) ledger.pageHostname = hostname;
        if (domain) ledger.pageDomain = domain;
        if (details.navigationId || details.documentId) {
            ledger.navigationId = details.navigationId || details.documentId;
        }
        ledger.updatedAt = this.now();
        this.ensureHostnameEntry(ledger, ledger.pageHostname);
        this.ensureHostnameEntry(ledger, ledger.pageDomain);
    }

    beginNavigation(details) {
        const tabId = Number(details?.tabId);
        if (Number.isInteger(tabId) === false || tabId < 0) return null;
        const ledger = emptyLedger(tabId, {
            pageURL: details.url,
            navigationId: details.documentId || details.requestId || details.navigationId || "",
            contentRevision: this.revisionCounter++,
            updatedAt: this.now(),
        });
        this.ledgers.set(tabId, ledger);
        this.ensureHostnameEntry(ledger, ledger.pageHostname);
        this.ensureHostnameEntry(ledger, ledger.pageDomain);
        return ledger;
    }

    commitNavigation(details) {
        const tabId = Number(details?.tabId);
        if (Number.isInteger(tabId) === false || tabId < 0 || Number(details?.frameId) !== 0) return null;
        const current = this.ledgers.get(tabId);
        const url = String(details?.url || "");
        if (current === undefined || (url && current.pageURL !== url && current.pendingRequests.size === 0)) {
            return this.beginNavigation({
                tabId,
                url,
                documentId: details.documentId,
            });
        }
        this.updatePageIdentity(current, url, details || {});
        this.bump(current);
        return current;
    }

    ensureHostnameEntry(ledger, hostname) {
        const hn = normalizeHostname(hostname);
        if (!ledger || hn === "") return null;
        const keys = Object.keys(ledger.hostnameDict);
        if (ledger.hostnameDict[hn] === undefined && keys.length >= MAX_HOSTNAMES_PER_TAB) return null;
        if (ledger.hostnameDict[hn] === undefined) {
            ledger.hostnameDict[hn] = {
                domain: registrableDomainFromHostname(hn),
                allowed: createRequestCounts(),
                blocked: createRequestCounts(),
            };
        }
        return ledger.hostnameDict[hn];
    }

    recordBeforeRequest(details) {
        const tabId = Number(details?.tabId);
        if (Number.isInteger(tabId) === false || tabId < 0) return null;
        if (String(details?.type || "") === "main_frame") {
            this.beginNavigation(details);
        }
        const ledger = this.getOrCreate(tabId, { pageURL: details?.documentUrl || details?.initiator || details?.url });
        if (ledger === null) return null;
        const url = String(details?.url || "");
        const hostname = hostnameFromURL(url);
        if (hostname === "") return null;
        const requestId = String(details?.requestId || `${tabId}:${url}:${this.now()}`);
        const pending = {
            requestId,
            url,
            hostname,
            domain: registrableDomainFromHostname(hostname),
            tabId,
            type: String(details?.type || "other"),
            frameId: Number(details?.frameId) || 0,
            parentFrameId: Number(details?.parentFrameId) || -1,
            navigationId: ledger.navigationId,
            finalized: false,
            tstamp: Number(details?.timeStamp) || this.now(),
        };
        ledger.pendingRequests.set(requestId, pending);
        while (ledger.pendingRequests.size > MAX_PENDING_PER_TAB) {
            const firstKey = ledger.pendingRequests.keys().next().value;
            if (firstKey === undefined) break;
            ledger.pendingRequests.delete(firstKey);
        }
        this.ensureHostnameEntry(ledger, hostname);
        this.ensureHostnameEntry(ledger, pending.domain);
        this.bump(ledger);
        return pending;
    }

    finalizeCompleted(details) {
        return this.finalize(details, "allowed");
    }

    finalizeError(details) {
        if (isExtensionBlockedError(details?.error)) {
            return this.finalize(details, "blocked");
        }
        this.dropPending(details);
        return "failed";
    }

    finalize(details, disposition) {
        const tabId = Number(details?.tabId);
        if (Number.isInteger(tabId) === false || tabId < 0) return null;
        const ledger = this.ledgers.get(tabId);
        if (ledger === undefined) return null;
        const requestId = String(details?.requestId || "");
        if (requestId && ledger.finalizedRequestIds.has(requestId)) return "duplicate";
        let pending = requestId ? ledger.pendingRequests.get(requestId) : undefined;
        if (pending === undefined) {
            const url = String(details?.url || "");
            const hostname = hostnameFromURL(url);
            if (hostname === "") return null;
            pending = {
                requestId: requestId || `${tabId}:${url}:${this.now()}`,
                url,
                hostname,
                domain: registrableDomainFromHostname(hostname),
                tabId,
                type: String(details?.type || "other"),
                frameId: Number(details?.frameId) || 0,
                parentFrameId: Number(details?.parentFrameId) || -1,
                navigationId: ledger.navigationId,
                finalized: false,
                tstamp: Number(details?.timeStamp) || this.now(),
            };
        }
        if (pending.finalized === true) return "duplicate";
        pending.finalized = true;
        if (requestId) ledger.pendingRequests.delete(requestId);
        if (requestId) {
            ledger.finalizedRequestIds.add(requestId);
            while (ledger.finalizedRequestIds.size > MAX_PENDING_PER_TAB) {
                const firstKey = ledger.finalizedRequestIds.values().next().value;
                if (firstKey === undefined) break;
                ledger.finalizedRequestIds.delete(firstKey);
            }
        }

        const hostEntry = this.ensureHostnameEntry(ledger, pending.hostname);
        this.ensureHostnameEntry(ledger, pending.domain);
        const target = disposition === "blocked" ? "blocked" : "allowed";
        incrementCounts(ledger.pageCounts[target], pending.type);
        if (hostEntry) incrementCounts(hostEntry[target], pending.type);
        if (target === "blocked") incrementCounts(this.globalBlocked, pending.type);
        else incrementCounts(this.globalAllowed, pending.type);
        this.bump(ledger);
        return target;
    }

    dropPending(details) {
        const tabId = Number(details?.tabId);
        const requestId = String(details?.requestId || "");
        if (Number.isInteger(tabId) === false || tabId < 0 || requestId === "") return;
        const ledger = this.ledgers.get(tabId);
        if (ledger) {
            ledger.pendingRequests.delete(requestId);
            this.bump(ledger);
        }
    }

    bump(ledger) {
        ledger.contentRevision = this.revisionCounter++;
        ledger.updatedAt = this.now();
    }

    removeTab(tabId) {
        this.ledgers.delete(Number(tabId));
    }

    snapshotForTab(tabId, pageURL = "") {
        const id = Number(tabId);
        const ledger = this.getOrCreate(id, { pageURL });
        if (ledger === null) {
            return {
                pageCounts: createCountsPair(),
                hostnameDict: {},
                contentRevision: 0,
                globalAllowedRequestCount: this.globalAllowed.any,
                globalBlockedRequestCount: this.globalBlocked.any,
            };
        }
        if (pageURL) this.updatePageIdentity(ledger, pageURL);
        const hostnameDict = {};
        const aggregateByDomain = new Map();
        for (const [hostname, entry] of Object.entries(ledger.hostnameDict)) {
            const allowed = cloneRequestCounts(entry.allowed);
            const blocked = cloneRequestCounts(entry.blocked);
            hostnameDict[hostname] = {
                domain: entry.domain || registrableDomainFromHostname(hostname),
                counts: { allowed, blocked },
            };
            const domain = hostnameDict[hostname].domain;
            if (domain && domain !== hostname) {
                let aggregate = aggregateByDomain.get(domain);
                if (aggregate === undefined) {
                    aggregate = {
                        domain,
                        counts: {
                            allowed: createRequestCounts(),
                            blocked: createRequestCounts(),
                        },
                    };
                    aggregateByDomain.set(domain, aggregate);
                }
                addRequestCounts(aggregate.counts.allowed, allowed);
                addRequestCounts(aggregate.counts.blocked, blocked);
            }
        }
        for (const [domain, aggregate] of aggregateByDomain) {
            if (hostnameDict[domain] === undefined) {
                hostnameDict[domain] = aggregate;
            } else {
                addRequestCounts(hostnameDict[domain].counts.allowed, aggregate.counts.allowed);
                addRequestCounts(hostnameDict[domain].counts.blocked, aggregate.counts.blocked);
            }
        }
        this.ensureHostnameEntry(ledger, ledger.pageHostname);
        this.ensureHostnameEntry(ledger, ledger.pageDomain);
        for (const hostname of [ledger.pageHostname, ledger.pageDomain]) {
            const hn = normalizeHostname(hostname);
            if (hn && hostnameDict[hn] === undefined) {
                const entry = ledger.hostnameDict[hn] || {
                    domain: registrableDomainFromHostname(hn),
                    allowed: createRequestCounts(),
                    blocked: createRequestCounts(),
                };
                hostnameDict[hn] = {
                    domain: entry.domain || registrableDomainFromHostname(hn),
                    counts: {
                        allowed: cloneRequestCounts(entry.allowed),
                        blocked: cloneRequestCounts(entry.blocked),
                    },
                };
            }
        }
        return {
            pageCounts: cloneCountsPair(ledger.pageCounts),
            hostnameDict,
            contentRevision: ledger.contentRevision,
            globalAllowedRequestCount: this.globalAllowed.any,
            globalBlockedRequestCount: this.globalBlocked.any,
        };
    }
}
