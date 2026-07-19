// @ts-nocheck
export interface CosmeticSelector {
    selector: string;
    site: string;
    createdAt: number;
    isActive: boolean;
    status: "saved" | "active" | "permission-missing" | "stale";
}
export interface CosmeticRule {
    site: string;
    selectors: CosmeticSelector[];
}
export interface CosmeticState {
    rules: Record<string, CosmeticRule>;
}
export declare function normalizeSelector(selector: string): string;
export declare function proposeSelector(element: {
    id: string | null;
    className: string | null;
    tagName: string;
    parentElement: unknown;
}): string;
export declare function createCosmeticSelector(site: string, selector: string, isAutoApply?: boolean): CosmeticSelector;
export declare function addSelectorToRule(state: CosmeticState, site: string, selector: string, isAutoApply?: boolean): CosmeticState;
export declare function removeSelectorFromRule(state: CosmeticState, site: string, selector: string): CosmeticState;
export declare function getSelectorsForSite(state: CosmeticState, site: string): CosmeticSelector[];
export declare function createEmptyCosmeticState(): CosmeticState;
export declare function serializeCosmeticState(state: CosmeticState): string;
export declare function deserializeCosmeticState(json: string): CosmeticState;
export declare function generateCSS(selectors: CosmeticSelector[]): string;
export declare function snapshotState(state: CosmeticState): CosmeticState;
export declare function restoreFromSnapshot(snapshot: CosmeticState): CosmeticState;
