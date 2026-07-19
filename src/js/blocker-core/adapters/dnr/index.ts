// @ts-nocheck
interface DNRRule {
    id: number;
    priority?: number;
    action: unknown;
    condition: unknown;
}

interface UpdateRulesOptions {
    addRules?: DNRRule[];
    removeRuleIds?: number[];
}

interface MatchedRulesOptions {
    tabId?: number;
    initiator?: string;
}

interface DNRAdapter {
    getDynamicRules(): Promise<DNRRule[]>;
    updateDynamicRules(options: UpdateRulesOptions): Promise<void>;
    getSessionRules(): Promise<DNRRule[]>;
    updateSessionRules(options: UpdateRulesOptions): Promise<void>;
    getAvailableStaticRuleCount(): Promise<number>;
    getMatchedRules(options?: MatchedRulesOptions): Promise<DNRRule[]>;
    installDynamicRules(dynamicRules: DNRRule[], sessionRules?: DNRRule[]): Promise<void>;
    clearDynamicRules(site: string): Promise<void>;
}

export class FirefoxDNRAdapter implements DNRAdapter {
    async getDynamicRules(): Promise<DNRRule[]> {
        if (typeof browser !== 'undefined' && browser.declarativeNetRequest) {
            return browser.declarativeNetRequest.getDynamicRules();
        }
        return [];
    }
    
    async updateDynamicRules(options: UpdateRulesOptions): Promise<void> {
        const addRules = options.addRules?.map(rule => ({
            id: rule.id,
            priority: rule.priority,
            action: rule.action,
            condition: rule.condition,
        })) ?? [];
        
        if (typeof browser !== 'undefined' && browser.declarativeNetRequest) {
            await browser.declarativeNetRequest.updateDynamicRules({
                addRules: addRules,
                removeRuleIds: options.removeRuleIds ?? [],
            });
        } else {
            console.warn('[FirefoxDNRAdapter] DNR API not available in MV2 mode');
        }
    }
    
    async getSessionRules(): Promise<DNRRule[]> {
        if (typeof browser !== 'undefined' && browser.declarativeNetRequest) {
            return browser.declarativeNetRequest.getSessionRules();
        }
        return [];
    }
    
    async updateSessionRules(options: UpdateRulesOptions): Promise<void> {
        const addRules = options.addRules?.map(rule => ({
            id: rule.id,
            priority: rule.priority,
            action: rule.action,
            condition: rule.condition,
        })) ?? [];
        
        if (typeof browser !== 'undefined' && browser.declarativeNetRequest) {
            await browser.declarativeNetRequest.updateSessionRules({
                addRules: addRules,
                removeRuleIds: options.removeRuleIds ?? [],
            });
        }
    }
    
    async getAvailableStaticRuleCount(): Promise<number> {
        if (typeof browser !== 'undefined' && browser.declarativeNetRequest) {
            return browser.declarativeNetRequest.getAvailableStaticRuleCount();
        }
        return 0;
    }
    
    async getMatchedRules(options?: MatchedRulesOptions): Promise<DNRRule[]> {
        const filterOptions: Record<string, unknown> = {};
        if (options?.tabId !== undefined) {
            filterOptions.tabId = options.tabId;
        }
        if (options?.initiator) {
            filterOptions.initiator = options.initiator;
        }
        
        if (typeof browser !== 'undefined' && browser.declarativeNetRequest) {
            const result = await browser.declarativeNetRequest.getMatchedRules(filterOptions);
            return result.rules ?? [];
        }
        return [];
    }
    
    async installDynamicRules(dynamicRules: DNRRule[], sessionRules: DNRRule[] = []): Promise<void> {
        const allRules = [...dynamicRules, ...sessionRules];
        
        if (allRules.length === 0) return;
        
        if (typeof browser !== 'undefined' && browser.declarativeNetRequest) {
            await browser.declarativeNetRequest.updateDynamicRules({
                addRules: allRules.map(rule => ({
                    id: rule.id,
                    priority: rule.priority,
                    action: rule.action,
                    condition: rule.condition,
                })),
                removeRuleIds: [],
            });
            console.log(`[FirefoxDNRAdapter] Installed ${allRules.length} DNR rules`);
        } else {
            console.log(`[FirefoxDNRAdapter] Would install ${allRules.length} rules (webRequest mode)`);
        }
    }
    
    async clearDynamicRules(site: string): Promise<void> {
        if (typeof browser !== 'undefined' && browser.declarativeNetRequest) {
            const rules = await browser.declarativeNetRequest.getDynamicRules();
            const siteRules = rules.filter(r => 
                r.condition && typeof r.condition === 'object' && 
                'initiatorDomains' in r.condition &&
                Array.isArray((r.condition as Record<string, unknown>).initiatorDomains) &&
                (r.condition as Record<string, unknown>).initiatorDomains?.includes(site)
            );
            if (siteRules.length > 0) {
                await browser.declarativeNetRequest.updateDynamicRules({
                    removeRuleIds: siteRules.map(r => r.id)
                });
            }
        }
    }
}

export class ChromeDNRAdapter implements DNRAdapter {
    async getDynamicRules(): Promise<DNRRule[]> {
        return chrome.declarativeNetRequest.getDynamicRules();
    }
    
    async updateDynamicRules(options: UpdateRulesOptions): Promise<void> {
        const addRules = options.addRules?.map(rule => ({
            id: rule.id,
            priority: rule.priority,
            action: rule.action,
            condition: rule.condition,
        })) ?? [];
        await chrome.declarativeNetRequest.updateDynamicRules({
            addRules: addRules,
            removeRuleIds: options.removeRuleIds ?? [],
        });
    }
    
    async getSessionRules(): Promise<DNRRule[]> {
        return chrome.declarativeNetRequest.getSessionRules();
    }
    
    async updateSessionRules(options: UpdateRulesOptions): Promise<void> {
        const addRules = options.addRules?.map(rule => ({
            id: rule.id,
            priority: rule.priority,
            action: rule.action,
            condition: rule.condition,
        })) ?? [];
        await chrome.declarativeNetRequest.updateSessionRules({
            addRules: addRules,
            removeRuleIds: options.removeRuleIds ?? [],
        });
    }
    
    async getAvailableStaticRuleCount(): Promise<number> {
        return chrome.declarativeNetRequest.getAvailableStaticRuleCount();
    }
    
    async getMatchedRules(options?: MatchedRulesOptions): Promise<DNRRule[]> {
        const filterOptions: Record<string, unknown> = {};
        if (options?.tabId !== undefined) {
            filterOptions.tabId = options.tabId;
        }
        if (options?.initiator) {
            filterOptions.initiator = options.initiator;
        }
        const result = await chrome.declarativeNetRequest.getMatchedRules(filterOptions);
        return result.rules ?? [];
    }
    
    async installDynamicRules(dynamicRules: DNRRule[], sessionRules: DNRRule[] = []): Promise<void> {
        const allRules = [...dynamicRules, ...sessionRules];
        
        if (allRules.length === 0) return;
        
        const existingRules = await chrome.declarativeNetRequest.getDynamicRules();
        const existingIds = new Set(existingRules.map(r => r.id));
        
        const newRules = allRules.filter(r => !existingIds.has(r.id));
        
        if (newRules.length > 0) {
            await chrome.declarativeNetRequest.updateDynamicRules({
                addRules: newRules.map(rule => ({
                    id: rule.id,
                    priority: rule.priority,
                    action: rule.action,
                    condition: rule.condition,
                })),
                removeRuleIds: [],
            });
            console.log(`[ChromeDNRAdapter] Installed ${newRules.length} new rules`);
        }
    }
    
    async clearDynamicRules(site: string): Promise<void> {
        const rules = await chrome.declarativeNetRequest.getDynamicRules();
        const siteRules = rules.filter(r => 
            r.condition && typeof r.condition === 'object' && 
            'initiatorDomains' in r.condition &&
            Array.isArray((r.condition as Record<string, unknown>).initiatorDomains) &&
            (r.condition as Record<string, unknown>).initiatorDomains?.includes(site)
        );
        if (siteRules.length > 0) {
            await chrome.declarativeNetRequest.updateDynamicRules({
                removeRuleIds: siteRules.map(r => r.id)
            });
        }
    }
}

let instance: DNRAdapter | null = null;

export function getDNRAdapter(): DNRAdapter {
    if (instance) return instance;
    
    const isFirefox = typeof browser !== 'undefined' && 
                     typeof browser.runtime !== 'undefined' && 
                     typeof (browser.runtime as Record<string, unknown>).getBrowserInfo === 'function';
    const isChromeMV3 = typeof chrome !== 'undefined' && 
                       typeof chrome.runtime !== 'undefined' && 
                       typeof (chrome.runtime as Record<string, unknown>).getManifest === 'function' &&
                       ((chrome.runtime as Record<string, unknown>).getManifest() as Record<string, unknown>)?.manifest_version === 3;
    
    if (isFirefox || isChromeMV3) {
        if (typeof browser !== 'undefined' && browser.declarativeNetRequest) {
            instance = new FirefoxDNRAdapter();
        } else if (typeof chrome !== 'undefined' && chrome.declarativeNetRequest) {
            instance = new ChromeDNRAdapter();
        } else {
            console.warn('[DNR] DNR API not available, using fallback');
            instance = new FirefoxDNRAdapter();
        }
    } else {
        instance = new ChromeDNRAdapter();
    }
    
    return instance;
}

export function createFirefoxDNRAdapter(): DNRAdapter {
    return new FirefoxDNRAdapter();
}

export function createChromeDNRAdapter(): DNRAdapter {
    return new ChromeDNRAdapter();
}

export function setDNRAdapter(adapter: DNRAdapter): void {
    instance = adapter;
}
