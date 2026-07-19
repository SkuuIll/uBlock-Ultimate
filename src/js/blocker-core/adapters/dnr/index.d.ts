// @ts-nocheck
import type { CompiledRule } from "../../core/types/index.js";
export interface DNRAdapter {
    getDynamicRules(): Promise<chrome.declarativeNetRequest.Rule[]>;
    updateDynamicRules(options: {
        addRules?: CompiledRule[];
        removeRuleIds?: number[];
    }): Promise<void>;
    getSessionRules(): Promise<chrome.declarativeNetRequest.Rule[]>;
    updateSessionRules(options: {
        addRules?: CompiledRule[];
        removeRuleIds?: number[];
    }): Promise<void>;
    getAvailableStaticRuleCount(): Promise<number>;
    getMatchedRules(options?: {
        tabId?: number;
        initiator?: string;
    }): Promise<chrome.declarativeNetRequest.MatchedRule[]>;
}
export declare function getDNRAdapter(): DNRAdapter;
export declare function setDNRAdapter(adapter: DNRAdapter): void;
