/**
 * platform/chromium/js/flood-control.js
 *
 * Per-sender, per-document, and per-channel flood control.
 *
 * A broken page, stale content script, hostile main-world bridge, noisy
 * logger, or repeated UI refresh can flood the service worker with
 * messages.  This module provides budget-based rate limiting by sender,
 * document, message type, and channel.
 *
 * Usage:
 *   import { floodControl } from "./flood-control.js";
 *   const decision = floodControl.check({ senderKind: "content-script", senderTabId: 42, messageType: "cosmetic" });
 *   // decision: "allow" | "coalesce" | "debounce" | "drop" | "quarantine"
 */

// ---------------------------------------------------------------------------
// Default rate limits
// ---------------------------------------------------------------------------

const _defaultLimits = {
    "content-script": { maxPerSecond: 20, maxPerMinute: 200, burstSize: 10 },
    "popup": { maxPerSecond: 50, maxPerMinute: 500, burstSize: 25 },
    "dashboard": { maxPerSecond: 30, maxPerMinute: 300, burstSize: 15 },
    "logger": { maxPerSecond: 100, maxPerMinute: 1000, burstSize: 50 },
    "extension-page": { maxPerSecond: 20, maxPerMinute: 200, burstSize: 10 },
    "main-world-bridge": { maxPerSecond: 10, maxPerMinute: 60, burstSize: 5 },
    "command": { maxPerSecond: 5, maxPerMinute: 30, burstSize: 3 },
    "context-menu": { maxPerSecond: 5, maxPerMinute: 30, burstSize: 3 },
    "default": { maxPerSecond: 10, maxPerMinute: 100, burstSize: 5 },
};

const _messageTypeLimits = {
    "cosmetic": { maxPerMinute: 300 },
    "video": { maxPerMinute: 120 },
    "scriptlets": { maxPerMinute: 60 },
    "diagnostic": { maxPerMinute: 600 },
    "storage": { maxPerMinute: 30 },
};

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

let _limits = JSON.parse(JSON.stringify(_defaultLimits));
let _typeLimits = JSON.parse(JSON.stringify(_messageTypeLimits));

// ---------------------------------------------------------------------------
// Token bucket
// ---------------------------------------------------------------------------

class TokenBucket {
    constructor(maxPerSecond, maxPerMinute, burstSize) {
        this.maxPerSecond = maxPerSecond;
        this.maxPerMinute = maxPerMinute;
        this.burstSize = burstSize || maxPerSecond;
        this._tokens = burstSize || maxPerSecond;
        this._lastRefill = Date.now();
        this._minuteTokens = maxPerMinute;
        this._minuteStart = Date.now();
    }

    consume() {
        const now = Date.now();
        const elapsed = (now - this._lastRefill) / 1000;

        // Refill per-second tokens
        this._tokens = Math.min(
            this.burstSize,
            this._tokens + elapsed * this.maxPerSecond
        );
        this._lastRefill = now;

        // Refill per-minute tokens
        const minuteElapsed = now - this._minuteStart;
        if (minuteElapsed >= 60_000) {
            this._minuteTokens = this.maxPerMinute;
            this._minuteStart = now;
        }

        if (this._tokens < 1 || this._minuteTokens < 1) {
            return false;
        }

        this._tokens -= 1;
        this._minuteTokens -= 1;
        return true;
    }
}

// ---------------------------------------------------------------------------
// Sender state
// ---------------------------------------------------------------------------

const _buckets = new Map();  // key: `${senderKind}:${senderId}` → TokenBucket

function _getBucket(senderKind, senderId) {
    const key = `${senderKind}:${senderId}`;
    let bucket = _buckets.get(key);
    if (!bucket) {
        const limits = _limits[senderKind] || _limits.default;
        bucket = new TokenBucket(limits.maxPerSecond, limits.maxPerMinute, limits.burstSize);
        _buckets.set(key, bucket);
    }
    return bucket;
}

const _quarantined = new Map();  // key: `${senderKind}:${senderId}` → { until, reason }

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export const floodControl = {
    /**
     * Check whether a message/event should be allowed, coalesced, dropped,
     * or whether the sender should be quarantined.
     *
     * @param {object} msg
     * @param {string} msg.senderKind
     * @param {number} [msg.senderTabId]
     * @param {string} [msg.senderDocumentId]
     * @param {string} [msg.messageType]
     * @returns {string} "allow" | "coalesce" | "debounce" | "drop" | "quarantine"
     */
    check(msg) {
        const { senderKind, senderTabId, senderDocumentId, messageType } = msg;
        const senderId = senderTabId !== undefined ? String(senderTabId) : (senderDocumentId || "global");

        // Check quarantine
        const quarantineKey = `${senderKind}:${senderId}`;
        const quarantined = _quarantined.get(quarantineKey);
        if (quarantined && Date.now() < quarantined.until) {
            return "quarantine";
        }

        // Check sender-level limits
        const bucket = _getBucket(senderKind, senderId);
        if (!bucket.consume()) {
            // Rate exceeded — escalate to quarantine if repeated
            const violations = _quarantined.get(quarantineKey + ":violations") || 0;
            const newViolations = violations + 1;
            _quarantined.set(quarantineKey + ":violations", newViolations);

            if (newViolations >= 5) {
                // Quarantine for 60 seconds
                _quarantined.set(quarantineKey, {
                    until: Date.now() + 60_000,
                    reason: `Rate limit exceeded (${newViolations} violations)`,
                });
                return "quarantine";
            }

            return "drop";
        }

        // Clear violations on successful pass
        _quarantined.delete(quarantineKey + ":violations");

        // Check message-type specific limits
        if (messageType) {
            const typeLimit = _typeLimits[messageType];
            if (typeLimit) {
                const typeBucket = _getBucket(`type:${messageType}`, "global");
                if (!typeBucket.consume()) {
                    return "coalesce";  // allow but batch
                }
            }
        }

        return "allow";
    },

    /**
     * Reset rate limits for a sender (e.g. after tab close).
     */
    resetSender(senderKind, senderId) {
        const key = `${senderKind}:${senderId}`;
        _buckets.delete(key);
        _quarantined.delete(key);
        _quarantined.delete(key + ":violations");
    },

    /**
     * Reset all rate limits.
     */
    resetAll() {
        _buckets.clear();
        _quarantined.clear();
    },

    /**
     * Override limits for a sender kind.
     */
    setLimits(senderKind, limits) {
        _limits[senderKind] = { ..._limits[senderKind], ...limits };
    },

    /**
     * Override limits for a message type.
     */
    setMessageTypeLimits(messageType, limits) {
        _typeLimits[messageType] = { ..._typeLimits[messageType], ...limits };
    },

    /**
     * Return diagnostic snapshot.
     */
    getSnapshot() {
        const senders = [];
        for (const [key] of _buckets) {
            const [senderKind, senderId] = key.split(":");
            const q = _quarantined.get(key);
            senders.push({
                key,
                senderKind,
                senderId,
                quarantined: q ? { until: q.until, reason: q.reason } : null,
            });
        }
        return {
            limits: _limits,
            messageTypeLimits: _typeLimits,
            activeSenders: senders,
            quarantinedCount: _quarantined.size,
        };
    },
};
