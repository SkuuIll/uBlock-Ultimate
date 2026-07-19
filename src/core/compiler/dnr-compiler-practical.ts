/*******************************************************************************

    uBlock Ultimate - Practical DNR Compiler
    Copyright (C) 2024-present Raymond Hill

    This is a practical implementation that compiles basic filter patterns
    to DNR rules. Full filter extraction from internal tries would require
    significant additional work.

*******************************************************************************/

/******************************************************************************/

interface DNRRule {
    id: number;
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

interface UserRule {
    action: 'block' | 'allow';
    pattern: string;
    types?: string[];
    domains?: string[];
    excludedDomains?: string[];
    priority?: number;
}

interface CompilerRules {
    static: DNRRule[];
    dynamic: DNRRule[];
    session: DNRRule[];
}

interface CompilerStats {
    static: number;
    dynamic: number;
    session: number;
    total: number;
    maxStatic: number;
    maxDynamic: number;
    maxSession: number;
}

/******************************************************************************/

const RESOURCE_TYPE_MAP: Record<string, string> = {
    'main_frame': 'main_frame',
    'sub_frame': 'sub_frame', 
    'stylesheet': 'stylesheet',
    'script': 'script',
    'image': 'image',
    'object': 'object',
    'xhr': 'xmlhttprequest',
    'fetch': 'fetch',
    'font': 'font',
    'media': 'media',
    'websocket': 'websocket',
    'ping': 'ping',
    'popup': 'popup',
    'other': 'other',
};

const MAX_STATIC_RULES = 30000;
const MAX_DYNAMIC_RULES = 30000;
const MAX_SESSION_RULES = 5000;

/******************************************************************************/

class DNRCompiler {
    rules: CompilerRules;
    ruleId: number;

    constructor() {
        this.rules = {
            static: [],
            dynamic: [],
            session: [],
        };
        this.ruleId = 1;
    }

    patternToRegex(pattern: string): string {
        if (!pattern || pattern === '*') return '';

        const trimmed = pattern.trim();

        if (/^[a-z0-9._-]+$/i.test(trimmed)) {
            return `||${trimmed.toLowerCase()}^`;
        }

        return trimmed;
    }

    getResourceTypes(types: string[] | undefined): string[] | undefined {
        if (!types) return undefined;
        const mapped = types
            .map(t => RESOURCE_TYPE_MAP[t])
            .filter(t => t);
        return mapped.length ? mapped : undefined;
    }

    createBlockRule(pattern: string, options: Partial<UserRule> = {}): DNRRule {
        const rule: DNRRule = {
            id: this.ruleId++,
            priority: options.priority || 1,
            action: { type: 'block' },
            condition: {
                urlFilter: this.patternToRegex(pattern),
            },
        };
        
        if (options.types) {
            rule.condition.resourceTypes = this.getResourceTypes(options.types);
        }
        if (options.domains) {
            const initiator: string[] = [];
            const excluded: string[] = [];
            for (const d of options.domains) {
                if (d.startsWith('~')) {
                    excluded.push(d.slice(1));
                } else {
                    initiator.push(d);
                }
            }
            if (initiator.length > 0) rule.condition.initiatorDomains = initiator;
            if (excluded.length > 0) rule.condition.excludedInitiatorDomains = excluded;
        }
        if (options.excludedDomains) {
            rule.condition.excludedInitiatorDomains = options.excludedDomains;
        }
        
        return rule;
    }

    createAllowRule(pattern: string, options: Partial<UserRule> = {}): DNRRule {
        const rule: DNRRule = {
            id: this.ruleId++,
            priority: options.priority || 2,
            action: { type: 'allow' },
            condition: {
                urlFilter: this.patternToRegex(pattern),
            },
        };
        
        if (options.types) {
            rule.condition.resourceTypes = this.getResourceTypes(options.types);
        }
        
        return rule;
    }

    createRedirectRule(pattern: string, targetUrl: string): DNRRule {
        return {
            id: this.ruleId++,
            priority: 1,
            action: {
                type: 'redirect',
                redirect: { url: targetUrl },
            },
            condition: {
                urlFilter: this.patternToRegex(pattern),
            },
        };
    }

    compileUserRules(userRules: UserRule[]): void {
        for (const rule of userRules) {
            if (rule.action === 'block') {
                this.rules.dynamic.push(
                    this.createBlockRule(rule.pattern, rule)
                );
            } else if (rule.action === 'allow') {
                this.rules.dynamic.push(
                    this.createAllowRule(rule.pattern, rule)
                );
            }
            
            if (this.rules.dynamic.length >= MAX_DYNAMIC_RULES) {
                console.warn('[DNRCompiler] Dynamic rule limit reached');
                break;
            }
        }
    }

    compileWhitelist(rules: { pattern: string }[]): void {
        for (const rule of rules) {
            this.rules.dynamic.push(
                this.createAllowRule(rule.pattern, { priority: 3 })
            );
        }
    }

    async install(): Promise<void> {
        if (typeof chrome === 'undefined') {
            console.log('[DNRCompiler] No chrome API - running in test mode');
            return;
        }

        const dnr = chrome.declarativeNetRequest;
        if (!dnr) {
            console.warn('[DNRCompiler] DNR API not available');
            return;
        }

        try {
            if (this.rules.dynamic.length > 0) {
                await dnr.updateDynamicRules({
                    addRules: this.rules.dynamic,
                });
            }
            
            if (this.rules.session.length > 0) {
                await dnr.updateSessionRules({
                    addRules: this.rules.session,
                });
            }
            
            console.log(`[DNRCompiler] Installed: ${this.rules.dynamic.length} dynamic, ${this.rules.session.length} session`);
        } catch (e) {
            console.error('[DNRCompiler] Install failed:', e);
        }
    }

    async clear(): Promise<void> {
        if (typeof chrome === 'undefined') return;
        
        const dnr = chrome.declarativeNetRequest;
        if (!dnr) return;

        try {
            const dynamicIds = this.rules.dynamic.map(r => r.id);
            const sessionIds = this.rules.session.map(r => r.id);
            
            if (dynamicIds.length > 0) {
                await dnr.updateDynamicRules({ removeRuleIds: dynamicIds });
            }
            if (sessionIds.length > 0) {
                await dnr.updateSessionRules({ removeRuleIds: sessionIds });
            }
            
            this.rules = { static: [], dynamic: [], session: [] };
            console.log('[DNRCompiler] Cleared all rules');
        } catch (e) {
            console.error('[DNRCompiler] Clear failed:', e);
        }
    }

    getStats(): CompilerStats {
        return {
            static: this.rules.static.length,
            dynamic: this.rules.dynamic.length,
            session: this.rules.session.length,
            total: this.rules.static.length + this.rules.dynamic.length + this.rules.session.length,
            maxStatic: MAX_STATIC_RULES,
            maxDynamic: MAX_DYNAMIC_RULES,
            maxSession: MAX_SESSION_RULES,
        };
    }
}

/******************************************************************************/

const dnrCompiler = new DNRCompiler();

export { dnrCompiler, DNRCompiler, MAX_STATIC_RULES, MAX_DYNAMIC_RULES, MAX_SESSION_RULES };
export default dnrCompiler;
