/**
 * src/js/runtime/observer-budget.ts
 *
 * Shared observer budget primitive (P1.10).
 * Policy maps page profile to observer budget.
 * Each runtime layer checks the budget before starting observers.
 *
 * Usage:
 *   import { getObserverBudget, checkObserverBudget } from "./observer-budget.js";
 *
 *   const budget = getObserverBudget("app-shell");
 *   if (checkObserverBudget(budget, currentObservers + 1)) {
 *     startObserver();
 *   }
 */

export type ObserverBudget = {
    maxObservers: number;
    maxNodesPerCycle: number;
    maxMsPerCycle: number;
    allowAttributeObservers: boolean;
};

const DEFAULT_BUDGETS: Record<string, ObserverBudget> = {
    "default-web": {
        maxObservers: 3,
        maxNodesPerCycle: 500,
        maxMsPerCycle: 50,
        allowAttributeObservers: true,
    },
    "app-shell": {
        maxObservers: 1,
        maxNodesPerCycle: 100,
        maxMsPerCycle: 20,
        allowAttributeObservers: false,
    },
    "auth-sensitive": {
        maxObservers: 0,
        maxNodesPerCycle: 0,
        maxMsPerCycle: 0,
        allowAttributeObservers: false,
    },
    "payment-sensitive": {
        maxObservers: 0,
        maxNodesPerCycle: 0,
        maxMsPerCycle: 0,
        allowAttributeObservers: false,
    },
    "video-site": {
        maxObservers: 2,
        maxNodesPerCycle: 300,
        maxMsPerCycle: 30,
        allowAttributeObservers: true,
    },
};

const budgetOverrides = new Map<string, ObserverBudget>();

export function getObserverBudget(profile = "default-web"): ObserverBudget {
    return budgetOverrides.get(profile) ?? DEFAULT_BUDGETS[profile] ?? DEFAULT_BUDGETS["default-web"];
}

export function checkObserverBudget(budget: ObserverBudget, currentObservers: number): boolean {
    return currentObservers < budget.maxObservers;
}

export function setObserverBudget(profile: string, budget: ObserverBudget): void {
    budgetOverrides.set(profile, budget);
}
