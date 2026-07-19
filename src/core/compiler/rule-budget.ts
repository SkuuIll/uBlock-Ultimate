/*******************************************************************************

    uBlock Ultimate - Rule Budget Manager
    Copyright (C) 2024-present Raymond Hill

    This module handles rule budget management for DNR,
    ensuring we stay within Chrome's limits.

*******************************************************************************/

/******************************************************************************/

type RuleType = 'static' | 'dynamic' | 'session';

interface BudgetUsage {
    static: number;
    dynamic: number;
    session: number;
}

interface Allocation {
    static: number;
    dynamic: number;
    session: number;
}

interface BudgetStatus {
    used: number;
    max: number;
    percentage: number;
}

interface BudgetExceededCallback {
    (_type: RuleType, _current: number, _max: number): void;
}

interface CanAddResult {
    allowed: boolean;
    reason?: string;
}

/******************************************************************************/

const MAX_STATIC_RULES = 30000;
const MAX_DYNAMIC_RULES = 30000;
const MAX_SESSION_RULES = 5000;

const DEFAULT_ALLOCATION: Allocation = {
    static: 0.80,
    dynamic: 0.15,
    session: 0.05,
};

/******************************************************************************/

class RuleBudget {
    usage: BudgetUsage;
    allocation: Allocation;
    ruleAccessTime: Map<string, number>;
    onBudgetExceeded: BudgetExceededCallback | null;
    warningThreshold: number;

    constructor() {
        this.usage = {
            static: 0,
            dynamic: 0,
            session: 0,
        };

        this.allocation = { ...DEFAULT_ALLOCATION };
        
        this.ruleAccessTime = new Map();
        
        this.onBudgetExceeded = null;
        
        this.warningThreshold = 0.90;
    }

    setBudgetExceededCallback(callback: BudgetExceededCallback): void {
        this.onBudgetExceeded = callback;
    }

    getMaxRules(type: RuleType): number {
        switch (type) {
        case 'static': return MAX_STATIC_RULES;
        case 'dynamic': return MAX_DYNAMIC_RULES;
        case 'session': return MAX_SESSION_RULES;
        default: return 0;
        }
    }

    getBudgetLimit(type: RuleType): number {
        const max = this.getMaxRules(type);
        const alloc = this.allocation[type] || 0;
        return Math.floor(max * alloc);
    }

    canAdd(type: RuleType, count: number = 1): CanAddResult {
        const current = this.usage[type] || 0;
        const max = this.getBudgetLimit(type);
        
        if (current + count > max) {
            return {
                allowed: false,
                reason: `Would exceed ${type} limit (${current}/${max})`,
            };
        }
        
        if ((current + count) / max >= this.warningThreshold) {
            console.warn(`[RuleBudget] ${type} rules at ${Math.round((current + count) / max * 100)}% capacity`);
        }
        
        return { allowed: true };
    }

    addRules(type: RuleType, count: number, ruleId: string | null = null): void {
        this.usage[type] = (this.usage[type] || 0) + count;
        
        if (ruleId) {
            this.ruleAccessTime.set(ruleId, Date.now());
        }
        
        console.log(`[RuleBudget] Added ${count} ${type} rules (total: ${this.usage[type]})`);
        
        const max = this.getMaxRules(type);
        if (this.usage[type] > max) {
            if (this.onBudgetExceeded) {
                this.onBudgetExceeded(type, this.usage[type], max);
            }
        }
    }

    removeRules(type: RuleType, count: number, ruleId: string | null = null): void {
        this.usage[type] = Math.max(0, (this.usage[type] || 0) - count);
        
        if (ruleId) {
            this.ruleAccessTime.delete(ruleId);
        }
        
        console.log(`[RuleBudget] Removed ${count} ${type} rules (total: ${this.usage[type]})`);
    }

    getRulesToPrune(type: RuleType, count: number): string[] {
        const max = this.getMaxRules(type);
        const current = this.usage[type] || 0;
        
        if (current <= max) {
            return [];
        }
        
        const toPrune = current - max + count;
        
        const sorted = Array.from(this.ruleAccessTime.entries())
            .sort((a, b) => a[1] - b[1]);
        
        return sorted.slice(0, toPrune).map(([id]) => id);
    }

    markAccessed(ruleId: string): void {
        this.ruleAccessTime.set(ruleId, Date.now());
    }

    getStatus(): { static: BudgetStatus; dynamic: BudgetStatus; session: BudgetStatus; total: { used: number; max: number } } {
        return {
            static: {
                used: this.usage.static || 0,
                max: MAX_STATIC_RULES,
                percentage: Math.round((this.usage.static || 0) / MAX_STATIC_RULES * 100),
            },
            dynamic: {
                used: this.usage.dynamic || 0,
                max: MAX_DYNAMIC_RULES,
                percentage: Math.round((this.usage.dynamic || 0) / MAX_DYNAMIC_RULES * 100),
            },
            session: {
                used: this.usage.session || 0,
                max: MAX_SESSION_RULES,
                percentage: Math.round((this.usage.session || 0) / MAX_SESSION_RULES * 100),
            },
            total: {
                used: (this.usage.static || 0) + (this.usage.dynamic || 0) + (this.usage.session || 0),
                max: MAX_STATIC_RULES + MAX_DYNAMIC_RULES + MAX_SESSION_RULES,
            },
        };
    }

    reset(): void {
        this.usage = {
            static: 0,
            dynamic: 0,
            session: 0,
        };
        this.ruleAccessTime.clear();
    }

    setAllocation(allocation: Partial<Allocation>): void {
        const total = (allocation.static || 0) + (allocation.dynamic || 0) + (allocation.session || 0);
        if (Math.abs(total - 1.0) > 0.01) {
            console.warn('[RuleBudget] Allocation should sum to 1.0, got', total);
        }
        
        this.allocation = {
            static: Math.min(1, Math.max(0, allocation.static ?? DEFAULT_ALLOCATION.static)),
            dynamic: Math.min(1, Math.max(0, allocation.dynamic ?? DEFAULT_ALLOCATION.dynamic)),
            session: Math.min(1, Math.max(0, allocation.session ?? DEFAULT_ALLOCATION.session)),
        };
        
        console.log('[RuleBudget] Allocation updated:', this.allocation);
    }

    getAvailableSlots(type: RuleType): number {
        const max = this.getBudgetLimit(type);
        const current = this.usage[type] || 0;
        return Math.max(0, max - current);
    }

    isNearCapacity(type: RuleType, threshold: number = 0.9): boolean {
        const max = this.getBudgetLimit(type);
        if (max === 0) return (this.usage[type] || 0) > 0;
        const current = this.usage[type] || 0;
        return current / max >= threshold;
    }
}

/******************************************************************************/

const ruleBudget = new RuleBudget();

export { ruleBudget, RuleBudget, MAX_STATIC_RULES, MAX_DYNAMIC_RULES, MAX_SESSION_RULES, DEFAULT_ALLOCATION };
export default ruleBudget;
