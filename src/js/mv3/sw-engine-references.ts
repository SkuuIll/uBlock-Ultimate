/*******************************************************************************

    uBlock Origin - MV3 Service Worker Engine References
    Handles extracting and setting up engine references from legacy backend

*******************************************************************************/

type MV3LoggerDetails = {
    tstamp?: number;
    [key: string]: unknown;
};

const logBufferObsoleteAfter = 30 * 1000;
let logBuffer: string[] | null = null;
let lastReadTime = 0;
let writePtr = 0;
let janitorToken = 0;

const scheduleJanitor = (logger: any) => {
    const token = ++janitorToken;
    self.setTimeout(() => {
        if ( token !== janitorToken || logBuffer === null ) { return; }
        if ( lastReadTime >= (Date.now() - logBufferObsoleteAfter) ) {
            scheduleJanitor(logger);
            return;
        }
        logger.enabled = false;
        logger.ownerId = undefined;
        logBuffer = null;
        writePtr = 0;
    }, logBufferObsoleteAfter);
};

const boxEntry = (details: MV3LoggerDetails) => {
    details.tstamp = Date.now() / 1000 | 0;
    return JSON.stringify(details);
};

const fallbackLogger = {
    enabled: false,
    ownerId: undefined as number | undefined,
    writeOne(details: MV3LoggerDetails) {
        if ( logBuffer === null ) { return; }
        const box = boxEntry(details);
        if ( writePtr !== 0 && box === logBuffer[writePtr - 1] ) { return; }
        if ( writePtr === logBuffer.length ) {
            logBuffer.push(box);
        } else {
            logBuffer[writePtr] = box;
        }
        writePtr += 1;
    },
    readAll(ownerId: number) {
        this.ownerId = ownerId;
        if ( logBuffer === null ) {
            this.enabled = true;
            logBuffer = [];
            scheduleJanitor(this);
        }
        const out = logBuffer.slice(0, writePtr);
        logBuffer.fill('', 0, writePtr);
        writePtr = 0;
        lastReadTime = Date.now();
        return out;
    },
};

export const setEngineReferences = () => {
    try {
        const vAPIRef = ((globalThis as any).vAPI ??= {});
        vAPIRef.logger = vAPIRef.logger || (globalThis as any).logger || fallbackLogger;
        (globalThis as any).logger = vAPIRef.logger;

        const staticNetFilteringEngine = vAPIRef.staticNetFilteringEngine || (globalThis as any).staticNetFilteringEngine;
        const staticExtFilteringEngine = vAPIRef.staticExtFilteringEngine || (globalThis as any).staticExtFilteringEngine;
        const logger = vAPIRef.logger;
        const µb = vAPIRef.µb || (globalThis as any).µb;
        let filteringContext = vAPIRef.filteringContext || (globalThis as any).filteringContext || µb?.filteringContext;
        const filteringEngines = vAPIRef.filteringEngines || (globalThis as any).filteringEngines;
        const io = vAPIRef.io || (globalThis as any).io;
        const publicSuffixList = vAPIRef.publicSuffixList || (globalThis as any).publicSuffixList;

        const redirectEngine = vAPIRef.redirectEngine || (globalThis as any).redirectEngine;
        const staticFilteringReverseLookup = vAPIRef.staticFilteringReverseLookup;
        const scriptletFilteringEngine = vAPIRef.scriptletFilteringEngine;
        const htmlFilteringEngine = vAPIRef.htmlFilteringEngine;
        const permanentURLFiltering = vAPIRef.permanentURLFiltering;
        const sessionURLFiltering = vAPIRef.sessionURLFiltering;
        const webRequest = vAPIRef.webRequest;

        vAPIRef.redirectEngine = redirectEngine;
        vAPIRef.staticFilteringReverseLookup = staticFilteringReverseLookup;
        vAPIRef.scriptletFilteringEngine = scriptletFilteringEngine;
        vAPIRef.htmlFilteringEngine = htmlFilteringEngine;
        vAPIRef.permanentURLFiltering = permanentURLFiltering;
        vAPIRef.sessionURLFiltering = sessionURLFiltering;
        vAPIRef.webRequest = webRequest;
        vAPIRef.filteringContext = filteringContext;
        
        if (!filteringContext) {
            const createFilterContext = (init?: Partial<{
                hostname: string; url: string; origin: string; type: string; realm: string; filter: unknown;
            }>) => {
                const state = init || {};
                const ctx = {
                    duplicate: () => createFilterContext(state),
                    fromTabId: async (tabId: number) => {
                        try {
                            const tab = await chrome.tabs.get(tabId);
                            if (tab?.url) {
                                const url = new URL(tab.url);
                                const newState = { ...state, hostname: url.hostname, url: url.href, origin: url.origin };
                                return createFilterContext(newState);
                            }
                        } catch (e) {
                            console.warn('[uBR] engineRefs.fromTabId: failed', tabId, e);
                        }
                        return createFilterContext({});
                    },
                    setType: (type: string) => {
                        return createFilterContext({ ...state, type });
                    },
                    setURL: (url: string) => {
                        try {
                            const parsed = new URL(url);
                            return createFilterContext({ ...state, url: parsed.href, hostname: parsed.hostname, origin: parsed.origin });
                        } catch (e) {
                            console.warn('[uBR] engineRefs.setURL: invalid URL', url, e);
                            return ctx;
                        }
                    },
                    setDocOriginFromURL: (url: string) => {
                        try {
                            const parsed = new URL(url);
                            return createFilterContext({ ...state, origin: parsed.origin });
                        } catch (e) {
                            console.warn('[uBR] engineRefs.setDocOriginFromURL: invalid URL', url, e);
                            return ctx;
                        }
                    },
                    setRealm: (realm: string) => {
                        return createFilterContext({ ...state, realm });
                    },
                    setFilter: (filter: unknown) => {
                        return createFilterContext({ ...state, filter });
                    },
                    toLogger: () => {
                        if (logger?.enabled) {
                            logger.writeOne({
                                tabId: 0,
                                realm: state.realm || 'network',
                                type: 'filter',
                                text: state.url || '',
                                filter: state.filter,
                            });
                        }
                    },
                    get hostname() { return state.hostname || ''; },
                    get url() { return state.url || ''; },
                    get origin() { return state.origin || ''; },
                    get type() { return state.type || ''; },
                    get realm() { return state.realm || 'network'; },
                    get filter() { return state.filter; },
                };
                return ctx;
            };
            
            const createRootFilterContext = () => {
                const state: any = {};
                
                const ctx = {
                    duplicate: () => createFilterContext({ ...state }),
                    fromTabId: async (tabId: number) => {
                        try {
                            const tab = await chrome.tabs.get(tabId);
                            if (tab?.url) {
                                const url = new URL(tab.url);
                                return createFilterContext({ hostname: url.hostname, url: url.href, origin: url.origin });
                            }
                        } catch (e) {
                            console.warn('[uBR] engineRefs.fromTabId: failed for tab', tabId, e);
                        }
                        return createFilterContext({});
                    },
                    setRealm: function(this: any, realm: string) {
                        state.realm = realm;
                        return this;
                    },
                    setType: function(this: any, type: string) {
                        state.type = type;
                        return this;
                    },
                    setURL: function(this: any, url: string) {
                        state.url = url;
                        try {
                            const parsed = new URL(url);
                            state.hostname = parsed.hostname;
                            state.origin = parsed.origin;
                        } catch (e) {
                            console.warn('[uBR] engineRefs.setURL: invalid URL', url, e);
                        }
                        return this;
                    },
                    setDocOriginFromURL: function(this: any, url: string) {
                        try {
                            const parsed = new URL(url);
                            state.docOrigin = parsed.origin;
                        } catch (e) {
                            console.warn('[uBR] engineRefs.setDocOriginFromURL: invalid URL', url, e);
                        }
                        return this;
                    },
                    toLogger: function() {
                        if (logger?.log) {
                            logger.log(state);
                        }
                    },
                    get hostname() { return state.hostname || ''; },
                    get url() { return state.url || ''; },
                    get origin() { return state.origin || ''; },
                    get type() { return state.type || ''; },
                    get realm() { return state.realm || 'network'; },
                    get filter() { return state.filter; },
                };
                return ctx;
            };
            
            filteringContext = createRootFilterContext();
            vAPIRef.filteringContext = filteringContext;
            (globalThis as any).filteringContext = filteringContext;
        }

        return {
            staticNetFilteringEngine,
            staticExtFilteringEngine,
            logger,
            µb,
            filteringContext,
            filteringEngines,
            io,
            publicSuffixList,
            redirectEngine,
            staticFilteringReverseLookup,
            scriptletFilteringEngine,
            htmlFilteringEngine,
            permanentURLFiltering,
            sessionURLFiltering,
            webRequest,
        };
    } catch (e) {
        console.log('[MV3] Could not get engine references:', e);
        return null;
    }
};
