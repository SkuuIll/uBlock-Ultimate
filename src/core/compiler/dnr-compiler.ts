/*******************************************************************************

    uBlock Ultimate - DNR Compiler
    Copyright (C) 2024-present Raymond Hill

    This module compiles uBlock filters to Chrome's Declarative Net Request (DNR)
    rules for MV3 compatibility.

*******************************************************************************/

/******************************************************************************/

interface Filter {
    pattern?: string;
    type?: string;
    priority?: number;
    redirect?: string;
    important?: boolean;
    types?: string[];
    methods?: string[];
    domains?: string[];
    excludedDomains?: string[];
}

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
        requestMethods?: string[];
        initiatorDomains?: string[];
        excludedInitiatorDomains?: string[];
    };
}

interface Engines {
    permanentFirewall?: any;
    sessionFirewall?: any;
    permanentURLFiltering?: any;
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

const MAX_STATIC_RULES = 30000;
const MAX_SESSION_RULES = 5000;
const MAX_DYNAMIC_RULES = 30000;

const resourceTypeMap: Record<string, string> = {
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
    'other': 'other',
    'popup': 'popup',
    'popunder': 'popup',
    'document': 'main_frame',
};

const ACTION_BLOCK = 'block';
const ACTION_ALLOW = 'allow';

/******************************************************************************/

class DNRCompiler {
    compiledRules: DNRRule[];
    ruleIdCounter: number;
    staticRules: DNRRule[];
    sessionRules: DNRRule[];
    dynamicRules: DNRRule[];

    constructor() {
        this.compiledRules = [];
        this.ruleIdCounter = 1;
        this.staticRules = [];
        this.sessionRules = [];
        this.dynamicRules = [];
    }

    async compileStaticRules(): Promise<DNRRule[]> {
        this.staticRules = [];
        this.ruleIdCounter = 1;
        
        const filters = this.extractStaticFilters();
        
        for (const filter of filters) {
            const dnrRule = this.filterToDNRRule(filter);
            if (dnrRule) {
                dnrRule.id = this.ruleIdCounter++;
                this.staticRules.push(dnrRule);
            }
            
            if (this.staticRules.length >= MAX_STATIC_RULES) {
                console.warn(`[DNRCompiler] Reached max static rules (${MAX_STATIC_RULES})`);
                break;
            }
        }
        
        console.log(`[DNRCompiler] Compiled ${this.staticRules.length} static rules`);
        return this.staticRules;
    }

    extractStaticFilters(): Filter[] {
        const filters: Filter[] = [];
        return filters;
    }

    filterToDNRRule(filter: Filter): DNRRule | null {
        if (!filter || !filter.pattern) {
            return null;
        }

        const dnrRule: DNRRule = {
            priority: filter.priority || 1,
            action: {
                type: filter.type === 'allow' ? ACTION_ALLOW : ACTION_BLOCK,
            },
            condition: {
                urlFilter: this.normalizeUrlFilter(filter.pattern),
                resourceTypes: this.getResourceTypes(filter.types),
                requestMethods: filter.methods ? filter.methods.map(m => m.toUpperCase()) : undefined,
                initiatorDomains: filter.domains ? filter.domains.filter(d => !d.startsWith('~')) : undefined,
                excludedInitiatorDomains: [
                    ...(filter.excludedDomains ?? []),
                    ...(filter.domains ?? [])
                        .filter(d => d.startsWith('~'))
                        .map(d => d.slice(1)),
                ],
            },
        };

        if (filter.redirect) {
            dnrRule.action.type = 'redirect';
            dnrRule.action.redirect = { url: filter.redirect };
        }

        if (filter.important) {
            dnrRule.priority = 2;
        }

        return dnrRule;
    }

    normalizeUrlFilter(pattern: string): string {
        if (!pattern) {
            return '';
        }

        const trimmed = pattern.trim();

        // A bare hostname with no special filter-syntax characters:
        // wrap it as a domain-anchored, separator-terminated pattern.
        if (/^[a-z0-9._-]+$/i.test(trimmed)) {
            return `||${trimmed.toLowerCase()}^`;
        }

        // Patterns already using filter-syntax anchors (||, |, ^, *)
        // are valid DNR urlFilter strings — pass through unchanged.
        return trimmed;
    }

    getResourceTypes(types: string[] | undefined): string[] | undefined {
        if (!types || types.length === 0) {
            return undefined;
        }
        
        const dnrTypes = types
            .map(t => resourceTypeMap[t])
            .filter(t => t !== undefined);
        
        return dnrTypes.length > 0 ? dnrTypes : undefined;
    }

    createBlockRule(domain: string, type: string = 'main_frame'): DNRRule {
        return {
            id: this.ruleIdCounter++,
            priority: 1,
            action: { type: ACTION_BLOCK },
            condition: {
                urlFilter: `^https?://([^/]+\\.)?${this.escapeDomain(domain)}`,
                resourceTypes: [type],
            },
        };
    }

    createAllowRule(domain: string): DNRRule {
        return {
            id: this.ruleIdCounter++,
            priority: 2,
            action: { type: ACTION_ALLOW },
            condition: {
                urlFilter: `^https?://([^/]+\\.)?${this.escapeDomain(domain)}`,
            },
        };
    }

    createRedirectRule(pattern: string, redirectUrl: string): DNRRule {
        return {
            id: this.ruleIdCounter++,
            priority: 1,
            action: {
                type: 'redirect',
                redirect: { url: redirectUrl },
            },
            condition: {
                urlFilter: this.normalizeUrlFilter(pattern),
            },
        };
    }

    escapeDomain(domain: string): string {
        return domain.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
    }

    compileDynamicRules(engines: Engines | undefined): DNRRule[] {
        const rules: DNRRule[] = [];
        
        if (!engines) {
            return rules;
        }

        if (engines.permanentFirewall) {
            const permRules = this.compileFirewallRules(engines.permanentFirewall, 'permanent');
            rules.push(...permRules);
        }

        if (engines.sessionFirewall) {
            const sessRules = this.compileFirewallRules(engines.sessionFirewall, 'session');
            rules.push(...sessRules);
        }

        if (engines.permanentURLFiltering) {
            const urlRules = this.compileURLRules(engines.permanentURLFiltering, 'permanent');
            rules.push(...urlRules);
        }

        if (rules.length > MAX_DYNAMIC_RULES) {
            console.warn(`[DNRCompiler] Dynamic rules exceed limit, truncating`);
            rules.length = MAX_DYNAMIC_RULES;
        }

        this.dynamicRules = rules;
        console.log(`[DNRCompiler] Compiled ${rules.length} dynamic rules`);
        
        return rules;
    }

    compileFirewallRules(_firewall: any, _type: 'permanent' | 'session'): DNRRule[] {
        const rules: DNRRule[] = [];
        return rules;
    }

    compileURLRules(_urlFiltering: any, _type: 'permanent' | 'session'): DNRRule[] {
        const rules: DNRRule[] = [];
        return rules;
    }

    async installRules(): Promise<void> {
        if (typeof chrome === 'undefined' || !chrome.declarativeNetRequest) {
            console.warn('[DNRCompiler] DNR API not available');
            return;
        }

        try {
            // Static rules are declared in manifest.json; they cannot be
            // added via the DNR API.  updateStaticRules only enables or
            // disables predefined rulesets by ID.

            if (this.dynamicRules.length > 0) {
                await chrome.declarativeNetRequest.updateDynamicRules({
                    addRules: this.dynamicRules,
                });
            }

            if (this.sessionRules.length > 0) {
                await chrome.declarativeNetRequest.updateSessionRules({
                    addRules: this.sessionRules,
                });
            }

            console.log('[DNRCompiler] Rules installed successfully');
        } catch (error) {
            console.error('[DNRCompiler] Failed to install rules:', error);
            throw error;
        }
    }

    async clearRules(): Promise<void> {
        if (typeof chrome === 'undefined' || !chrome.declarativeNetRequest) {
            return;
        }

        try {
            // Static rules are managed via manifest; they cannot be removed
            // through the DNR API.

            if (this.dynamicRules.length > 0) {
                await chrome.declarativeNetRequest.updateDynamicRules({
                    removeRuleIds: this.dynamicRules.map(r => r.id as number),
                });
            }

            if (this.sessionRules.length > 0) {
                await chrome.declarativeNetRequest.updateSessionRules({
                    removeRuleIds: this.sessionRules.map(r => r.id as number),
                });
            }

            this.dynamicRules = [];
            this.sessionRules = [];

            console.log('[DNRCompiler] All rules cleared');
        } catch (error) {
            console.error('[DNRCompiler] Failed to clear rules:', error);
        }
    }

    getStats(): CompilerStats {
        return {
            static: this.staticRules.length,
            dynamic: this.dynamicRules.length,
            session: this.sessionRules.length,
            total: this.staticRules.length + this.dynamicRules.length + this.sessionRules.length,
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
