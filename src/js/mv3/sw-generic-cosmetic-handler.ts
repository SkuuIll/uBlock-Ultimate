/*******************************************************************************

    uBlock Origin - MV3 Generic Cosmetic Selectors Handler
    https://github.com/gorhill/uBlock

    Processes generic and specific cosmetic selectors for content scripts,
    matching element hashes against stored filter data.

******************************************************************************/

import { runPreHooks, isSelectorExcluded } from "./site-protector.js";

export interface GenericCosmeticHandlerDeps {
    parseStoredCosmeticFilterData: (_data: any) => any;
}

export const createGenericCosmeticHandler = (deps: GenericCosmeticHandlerDeps) => {
    const { parseStoredCosmeticFilterData } = deps;

    return async (payload: any, callback?: any) => {
        try {
            const hostname = payload?.hostname || "";
            const pageURL = payload?.url || "";
            const hashes = payload?.hashes || [];
            await runPreHooks(hostname);
            const storedFiltering = await chrome.storage.local.get("perSiteFiltering");
            const perSiteFiltering: Record<string, boolean> =
                (storedFiltering?.perSiteFiltering as Record<string, boolean>) || {};
            const pageScopeKey =
                hostname !== "" && pageURL !== "" ? `${hostname}:${pageURL}` : "";
            const netFilteringEnabled =
                hostname === ""
                    ? true
                    : (perSiteFiltering[pageScopeKey] ??
                    perSiteFiltering[hostname] ??
                    true);
            if (netFilteringEnabled === false) {
                const result = { injectedCSS: "", excepted: [] };
                if (callback) callback({ result });
                return;
            }

            const stored = await chrome.storage.local.get("cosmeticFiltersData");
            const cosmeticData = parseStoredCosmeticFilterData(
                stored.cosmeticFiltersData,
            );

            const selectors: string[] = [];

            const genericFilters = cosmeticData.genericCosmeticFilters || [];
            for (const filter of genericFilters) {
                if (filter.key && hashes.includes(filter.key)) {
                    selectors.push(filter.selector);
                }
            }

            const specificFilters = cosmeticData.specificCosmeticFilters || [];
            const pageHostname = payload?.hostname || "";

            for (const entry of specificFilters) {
                const selector = Array.isArray(entry) ? entry[0] : entry;
                const details = Array.isArray(entry) ? entry[1] : {};
                const matches = details?.matches || [];

                let appliesToHostname = false;
                if (matches.length === 0) {
                    appliesToHostname = true;
                } else if (matches.includes("*") || matches.includes(pageHostname)) {
                    appliesToHostname = true;
                } else if (pageHostname) {
                    for (const match of matches) {
                        if (pageHostname === match || pageHostname.endsWith(`.${match}`)) {
                            appliesToHostname = true;
                            break;
                        }
                    }
                }

                if (appliesToHostname && details.key && hashes.includes(details.key)) {
                    selectors.push(selector);
                }
            }

            const excepted: string[] = [];
            const genericExceptions = cosmeticData.genericCosmeticExceptions || [];

            const filteredSelectors = selectors.filter((selector) => {
                if (typeof selector === "string" && isSelectorExcluded(pageHostname, selector)) {
                    excepted.push(selector);
                    return false;
                }
                for (const exc of genericExceptions) {
                    if (exc.selector === selector) {
                        excepted.push(selector);
                        return false;
                    }
                }
                return true;
            });

            if (filteredSelectors.length === 0 && excepted.length === 0) {
                if (callback) callback({ result: undefined });
                return;
            }

            const injectedCSS =
                `${filteredSelectors.join(",\n")}\n{display:none!important;}`;

            const result = {
                injectedCSS,
                excepted,
            };

            if (callback) callback({ result });
        } catch (e) {
            if (callback) callback({ error: (e as Error).message });
        }
    };
};
