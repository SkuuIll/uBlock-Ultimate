// @ts-nocheck
export interface MatchedRule {
    ruleId: number;
    rule: {
        id: number;
        priority: number;
        action: {
            type: string;
        };
        condition: Record<string, unknown>;
    };
    matchedOn: {
        url: string;
        tabId: number;
        timeStamp: string;
    };
}
export interface AggregatedDiagnostic {
    domain: string;
    resourceType: string;
    action: "allow" | "block";
    count: number;
    ruleOrigin: "profile" | "user-permanent" | "user-temporary" | "static";
}
export interface DiagnosticsState {
    matchedRules: MatchedRule[];
    aggregated: AggregatedDiagnostic[];
    lastRefresh: number;
    isRefreshing: boolean;
    error: string | null;
    isReducedMode?: boolean;
}
export declare const REFRESH_DEBOUNCE_MS = 1000;
export declare const MAX_BUFFER_SIZE = 500;
export declare const QUOTA_WARNING_THRESHOLD = 20;
export declare const QUOTA_RESET_INTERVAL_MS = 600000;
export declare const SESSION_RULE_THRESHOLD = 1000000;
export declare function setDiagnosticsUiOpen(open: boolean): void;
export declare function isDiagnosticsUiOpen(): boolean;
export declare function deriveRuleOrigin(ruleId: number): "profile" | "user-permanent" | "user-temporary" | "static";
export declare function canRefresh(): boolean;
export declare function recordRefresh(): void;
export declare function recordFailedRefresh(): void;
export declare function resetQuota(): void;
export declare function aggregateMatches(rules: MatchedRule[]): AggregatedDiagnostic[];
export declare function deduplicateRules(rules: MatchedRule[]): MatchedRule[];
export declare function trimBuffer(rules: MatchedRule[], maxSize?: number): MatchedRule[];
export declare function createEmptyDiagnosticsState(): DiagnosticsState;
export declare function createReducedModeState(): DiagnosticsState;
export declare function mergeDiagnostics(existing: DiagnosticsState, newRules: MatchedRule[]): DiagnosticsState;
