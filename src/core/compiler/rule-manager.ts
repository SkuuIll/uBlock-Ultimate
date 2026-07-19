/*******************************************************************************

    uBlock Ultimate - Rule Manager
    Copyright (C) 2024-present Raymond Hill

    This module manages the lifecycle of DNR rules, including
    add, remove, update operations and state management.

*******************************************************************************/

/******************************************************************************/

interface DNRRule {
    id?: number;
    priority: number;
    action: {
        type: string;
        redirect?: {
            url: string;
        };
    };
    condition: {
        urlFilter: string;
        resourceTypes?: string[];
        initiatorDomains?: string[];
        excludedInitiatorDomains?: string[];
    };
}

interface RuleState {
    key: string;
    rule: DNRRule;
}

interface ManagerState {
    dynamic: RuleState[];
    session: RuleState[];
}

interface RulesOutput {
    static: DNRRule[];
    dynamic: DNRRule[];
    session: DNRRule[];
}

interface RuleCounts {
    static: number;
    dynamic: number;
    session: number;
    total: number;
    maxStatic: number;
    maxDynamic: number;
    maxSession: number;
}

interface RuleOptions {
    priority?: number;
    resourceTypes?: string[];
    domains?: string[];
    excludedDomains?: string[];
}

interface InitOptions {
    onRulesChanged?: () => void;
}

/******************************************************************************/

const MAX_STATIC_RULES = 30000;
const MAX_DYNAMIC_RULES = 30000;
const MAX_SESSION_RULES = 5000;

/******************************************************************************/

class RuleManager {
    initialized: boolean;
    isDirty: boolean;
    staticRules: Map<string, DNRRule[]>;
    dynamicRules: Map<string, DNRRule>;
    sessionRules: Map<string, DNRRule>;
    onRulesChanged: (() => void) | null;
    pendingUpdates: any[];

    constructor() {
        this.initialized = false;
        this.isDirty = false;
        
        this.staticRules = new Map<string, DNRRule[]>();
        this.dynamicRules = new Map<string, DNRRule>();
        this.sessionRules = new Map<string, DNRRule>();
        
        this.onRulesChanged = null;
        
        this.pendingUpdates = [];
    }

    async initialize(options: InitOptions = {}): Promise<void> {
        if (this.initialized) {
            return;
        }

        this.onRulesChanged = options.onRulesChanged || (() => {});
        
        this.initialized = true;
        console.log('[RuleManager] Initialized');
    }

    addStaticRule(listId: string, rule: DNRRule): void {
        if (!this.staticRules.has(listId)) {
            this.staticRules.set(listId, []);
        }
        
        const rules = this.staticRules.get(listId);
        if (rules) {
            rules.push(rule);
        }
        
        this.isDirty = true;
    }

    removeStaticRules(listId: string): void {
        if (this.staticRules.has(listId)) {
            this.staticRules.delete(listId);
            this.isDirty = true;
        }
    }

    addDynamicRule(rule: DNRRule, key: string): void {
        this.dynamicRules.set(key, rule);
        this.isDirty = true;
    }

    removeDynamicRule(key: string): void {
        if (this.dynamicRules.has(key)) {
            this.dynamicRules.delete(key);
            this.isDirty = true;
        }
    }

    addSessionRule(rule: DNRRule, key: string): void {
        this.sessionRules.set(key, rule);
        this.isDirty = true;
    }

    removeSessionRule(key: string): void {
        if (this.sessionRules.has(key)) {
            this.sessionRules.delete(key);
            this.isDirty = true;
        }
    }

    getAllRules(): RulesOutput {
        const staticArr: DNRRule[] = [];
        for (const rules of this.staticRules.values()) {
            staticArr.push(...rules);
        }
        
        const dynamicArr = Array.from(this.dynamicRules.values());
        const sessionArr = Array.from(this.sessionRules.values());
        
        return {
            static: staticArr,
            dynamic: dynamicArr,
            session: sessionArr,
        };
    }

    canAddRules(type: 'static' | 'dynamic' | 'session'): boolean {
        const rules = this.getAllRules();
        
        switch (type) {
        case 'static':
            return rules.static.length < MAX_STATIC_RULES;
        case 'dynamic':
            return rules.dynamic.length < MAX_DYNAMIC_RULES;
        case 'session':
            return rules.session.length < MAX_SESSION_RULES;
        default:
            return false;
        }
    }

    getRuleCounts(): RuleCounts {
        const rules = this.getAllRules();
        return {
            static: rules.static.length,
            dynamic: rules.dynamic.length,
            session: rules.session.length,
            total: rules.static.length + rules.dynamic.length + rules.session.length,
            maxStatic: MAX_STATIC_RULES,
            maxDynamic: MAX_DYNAMIC_RULES,
            maxSession: MAX_SESSION_RULES,
        };
    }

    async applyChanges(): Promise<void> {
        if (!this.isDirty) {
            return;
        }

        const rules = this.getAllRules();
        
        try {
            if (typeof chrome !== 'undefined' && chrome.declarativeNetRequest && rules.dynamic.length > 0) {
                await chrome.declarativeNetRequest.updateDynamicRules({
                    addRules: rules.dynamic,
                });
            }
            
            if (typeof chrome !== 'undefined' && chrome.declarativeNetRequest && rules.session.length > 0) {
                await chrome.declarativeNetRequest.updateSessionRules({
                    addRules: rules.session,
                });
            }
            
            this.isDirty = false;
            if (this.onRulesChanged) {
                this.onRulesChanged();
            }
            
            console.log('[RuleManager] Changes applied:', this.getRuleCounts());
        } catch (error) {
            console.error('[RuleManager] Failed to apply changes:', error);
            throw error;
        }
    }

    createBlockRule(pattern: string, options: RuleOptions = {}): string {
        const rule: DNRRule = {
            priority: options.priority || 1,
            action: { type: 'block' },
            condition: {
                urlFilter: this.normalizePattern(pattern),
            },
        };
        
        if (options.resourceTypes) {
            rule.condition.resourceTypes = options.resourceTypes;
        }
        if (options.domains) {
            rule.condition.initiatorDomains = options.domains;
        }
        if (options.excludedDomains) {
            rule.condition.excludedInitiatorDomains = options.excludedDomains;
        }
        
        const key = `block_${pattern}_${Date.now()}`;
        this.addDynamicRule(rule, key);
        
        return key;
    }

    createAllowRule(pattern: string): string {
        const rule: DNRRule = {
            priority: 2,
            action: { type: 'allow' },
            condition: {
                urlFilter: this.normalizePattern(pattern),
            },
        };
        
        const key = `allow_${pattern}_${Date.now()}`;
        this.addDynamicRule(rule, key);
        
        return key;
    }

    createRedirectRule(pattern: string, targetUrl: string): string {
        const rule: DNRRule = {
            priority: 1,
            action: {
                type: 'redirect',
                redirect: { url: targetUrl },
            },
            condition: {
                urlFilter: this.normalizePattern(pattern),
            },
        };
        
        const key = `redirect_${pattern}_${Date.now()}`;
        this.addDynamicRule(rule, key);
        
        return key;
    }

    removeRule(key: string): void {
        this.removeDynamicRule(key);
    }

    normalizePattern(pattern: string): string {
        if (!pattern) {
            return '.*';
        }

        let normalized = pattern;
        
        // Replace filter list anchors BEFORE escaping special chars
        normalized = normalized.replace(/^\|\|/, '^https?://([^/]+\\\\.)?');
        normalized = normalized.replace(/^\|/, '^');
        normalized = normalized.replace(/\|$/, '$');
        // Now escape remaining regex-special chars (but not anchors or backslashes from above)
        normalized = normalized.replace(/[\*\+\?\!]/g, '\\$&');
        normalized = normalized.replace(/\.\*/g, '.*');
        normalized = normalized.replace(/\./g, '\\.');

        return normalized || '.*';
    }

    async clearAll(): Promise<void> {
        this.staticRules.clear();
        this.dynamicRules.clear();
        this.sessionRules.clear();
        
        this.isDirty = true;
        await this.applyChanges();
    }

    getState(): ManagerState {
        const state: ManagerState = {
            dynamic: [],
            session: [],
        };
        
        for (const [key, rule] of this.dynamicRules) {
            state.dynamic.push({ key, rule });
        }
        
        for (const [key, rule] of this.sessionRules) {
            state.session.push({ key, rule });
        }
        
        return state;
    }

    async restoreState(state: ManagerState): Promise<void> {
        this.dynamicRules.clear();
        this.sessionRules.clear();
        
        if (state.dynamic) {
            for (const { key, rule } of state.dynamic) {
                this.dynamicRules.set(key, rule);
            }
        }
        
        if (state.session) {
            for (const { key, rule } of state.session) {
                this.sessionRules.set(key, rule);
            }
        }
        
        this.isDirty = true;
        await this.applyChanges();
    }
}

/******************************************************************************/

const ruleManager = new RuleManager();

export { ruleManager, RuleManager };
export default ruleManager;
