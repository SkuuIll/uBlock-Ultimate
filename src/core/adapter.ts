/*******************************************************************************

    uBlock Ultimate - Blocker Adapter
    Copyright (C) 2014-present Raymond Hill

    This adapter provides the interface between the Blocker extension
    and the uBlock Ultimate filtering core.

*******************************************************************************/

import {
    permanentFirewall,
    sessionFirewall,
    staticNetFilteringEngine,
    staticExtFilteringEngine,
    scriptletFilteringEngine,
    redirectEngine,
    io as assetsIO,
    storage as filterStorage,
} from './index.js';
import { FilteringContext } from '../js/filtering-context.js';

interface RequestDetails {
    url: string;
    originUrl?: string;
    documentUrl?: string;
    type?: string;
    method?: string;
    tabId?: number;
    frameId?: number;
    frameUrl?: string;
    tabHostname?: string;
    [key: string]: unknown;
}

interface BlockResult {
    blocked: boolean;
    filter?: unknown;
    redirect?: string;
    type?: 'dynamic' | 'session';
}

interface PageDetails {
    url: string;
    documentUrl?: string;
    tabId?: number;
    frameId?: number;
    [key: string]: unknown;
}

interface AdapterOptions {
    onFilterChanged?: () => void;
    onWhitelistChanged?: () => void;
}

interface FilterStats {
    allowed: number;
    blocked: number;
    userFilters: number;
}

function buildFilteringContext(details: RequestDetails): FilteringContext {
    const fctxt = new FilteringContext();
    fctxt.setURL(details.url);
    fctxt.setType(details.type || 'other');
    if ( details.method ) {
        fctxt.setMethod(details.method);
    }
    if ( details.tabId !== undefined ) {
        fctxt.tabId = details.tabId;
    }
    if ( details.frameId !== undefined ) {
        fctxt.frameId = details.frameId;
    }
    if ( details.documentUrl ) {
        fctxt.setDocOriginFromURL(details.documentUrl);
    } else if ( details.originUrl ) {
        fctxt.setDocOriginFromURL(details.originUrl);
    }
    if ( details.tabHostname ) {
        fctxt.setTabHostname(details.tabHostname);
    }
    return fctxt;
}

function firewallTypeToEvalType(type: string): string {
    if ( type === 'sub_frame' ) { return '3p-frame'; }
    if ( type === 'script' ) { return 'script'; }
    if ( type === 'image' ) { return 'image'; }
    if ( type === 'object' ) { return 'object'; }
    return '*';
}

/**
 * BlockerAdapter - Interface between Blocker and uBlock core
 */
class BlockerAdapter {
    private initialized: boolean = false;
    private initializing: Promise<void> | null = null;
    private onFilterChanged: () => void = () => {};
    private onWhitelistChanged: () => void = () => {};

    constructor() {
        this.initialized = false;
    }

    /**
     * Initialize the filtering core
     * @param options - Initialization options
     */
    async initialize(options: AdapterOptions = {}): Promise<void> {
        if ( this.initialized ) {
            return;
        }
        if ( this.initializing ) {
            return this.initializing;
        }

        this.initializing = (async () => {
            this.onFilterChanged = options.onFilterChanged || (() => {});
            this.onWhitelistChanged = options.onWhitelistChanged || (() => {});

            // Initialize static filtering engines
            await staticNetFilteringEngine.freeze();
            await staticExtFilteringEngine.freeze();

            // Initialize scriptlet filtering
            scriptletFilteringEngine.init();

            // Initialize redirect engine
            redirectEngine.init();

            // Initialize asset storage
            await assetsIO.init();

            // Initialize filter storage
            await filterStorage.init();

            this.initialized = true;
            this.initializing = null;

            console.log('[BlockerAdapter] Core initialized');
        })();

        try {
            return await this.initializing;
        } catch ( e ) {
            this.initializing = null;
            console.error('[BlockerAdapter] Init failed:', e);
            throw e;
        }
    }

    /**
     * Check if a request should be blocked
     * @param details - Request details
     * @returns Block decision or null
     */
    shouldBlock(details: RequestDetails): BlockResult | null {
        if ( !this.initialized ) {
            console.warn('[BlockerAdapter] Not initialized');
            return null;
        }

        // Static network filtering (returns 0=no match, 1=block, 2=allow)
        const fctxt = buildFilteringContext(details);
        const result = staticNetFilteringEngine.matchRequest(fctxt);

        if ( result === 1 ) {
            return { blocked: true, filter: fctxt.filter };
        }
        if ( result === 2 ) {
            return { blocked: false };
        }

        // Dynamic hostname/type filtering
        const srcHostname = details.tabHostname || '';
        const desHostname = fctxt.getHostname();
        const evalType = firewallTypeToEvalType(details.type || '*');

        const firewallResult = permanentFirewall.evaluateCellZY(srcHostname, desHostname, evalType);
        if ( firewallResult !== 0 ) {
            return { blocked: firewallResult === 1, type: 'dynamic' };
        }

        const sessionResult = sessionFirewall.evaluateCellZY(srcHostname, desHostname, evalType);
        if ( sessionResult !== 0 ) {
            return { blocked: sessionResult === 1, type: 'session' };
        }

        return { blocked: false };
    }

    /**
     * Check if cosmetic filters match
     * @param details - Page details
     * @returns Array of cosmetic filters
     */
    getCosmeticFilters(_details: PageDetails): unknown[] {
        if ( !this.initialized ) {
            return [];
        }

        return [];
    }

    /**
     * Get scriptlet injections for a page
     * @param details - Page details
     * @returns Array of scriptlet injections
     */
    getScriptlets(details: PageDetails): unknown[] {
        if ( !this.initialized ) {
            return [];
        }

        return scriptletFilteringEngine.getMatches(details);
    }

    /**
     * Add a user filter rule
     * @param filter - Filter string
     */
    async addUserFilter(filter: string): Promise<void> {
        if ( !this.initialized ) {
            return;
        }
        await filterStorage.addUserFilter(filter);
        this.onFilterChanged();
    }

    /**
     * Remove a user filter rule
     * @param filter - Filter string
     */
    async removeUserFilter(filter: string): Promise<void> {
        if ( !this.initialized ) {
            return;
        }
        await filterStorage.removeUserFilter(filter);
        this.onFilterChanged();
    }

    /**
     * Get all user filters
     * @returns Array of user filter strings
     */
    getUserFilters(): string[] {
        if ( !this.initialized ) {
            return [];
        }
        return filterStorage.getUserFilters();
    }

    /**
     * Check if a URL is whitelisted
     * @param url - URL to check
     * @param documentURL - Document URL
     * @returns Whether whitelisted
     */
    isWhitelisted(url: string, documentURL: string): boolean {
        if ( !this.initialized ) {
            return false;
        }
        return staticExtFilteringEngine.matchString(url, documentURL);
    }

    /**
     * Get the current filter lists
     * @returns Filter list status
     */
    getFilterLists(): unknown {
        if ( !this.initialized ) {
            return [];
        }
        return filterStorage.getFilterLists();
    }

    /**
     * Enable/disable a filter list
     * @param listId - List ID
     * @param enabled - Enable or disable
     */
    async toggleFilterList(listId: string, enabled: boolean): Promise<void> {
        if ( !this.initialized ) {
            return;
        }
        await filterStorage.toggleFilterList(listId, enabled);
        this.onFilterChanged();
    }

    /**
     * Get statistics
     * @returns Filtering statistics
     */
    getStats(): FilterStats {
        if ( !this.initialized ) {
            return { allowed: 0, blocked: 0, userFilters: 0 };
        }
        return {
            allowed: staticNetFilteringEngine.getAllowedCount(),
            blocked: staticNetFilteringEngine.getBlockedCount(),
            userFilters: filterStorage.getUserFilters().length,
        };
    }

    /**
     * Shutdown the core
     */
    shutdown(): void {
        if ( !this.initialized ) {
            return;
        }

        staticNetFilteringEngine.release();
        staticExtFilteringEngine.release();
        scriptletFilteringEngine.destroy();

        this.initialized = false;
        console.log('[BlockerAdapter] Core shutdown');
    }
}

// Export singleton instance
export default new BlockerAdapter();
