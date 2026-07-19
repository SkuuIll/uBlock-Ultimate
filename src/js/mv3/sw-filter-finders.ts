/*******************************************************************************

    uBlock Origin - MV3 Filter List Finders
    Helper functions to find filter lists by filter content

*******************************************************************************/

export const findFilterListFromNetFilter = async (rawFilter: string): Promise<any[]> => {
    const results: any[] = [];
    if (!rawFilter || rawFilter.trim() === '') {
        return results;
    }
    
    // Normalize the filter for searching
    const normalizedFilter = rawFilter.trim().toLowerCase();
    const isWhitelist = normalizedFilter.startsWith('@@');
    const filterPattern = isWhitelist ? normalizedFilter.slice(2) : normalizedFilter;
    
    try {
        const stored = await chrome.storage.local.get([
            'filterLists',
            'selectedFilterLists',
            'userFilters',
            'user-filters',
        ]);
        const selectedFilterLists: string[] = (stored.selectedFilterLists as string[]) || [];
        const filterLists = (stored.filterLists as Record<string, any>) || {};
        
        // Also check user filters
        const userFiltersContent = typeof stored.userFilters === 'string'
            ? stored.userFilters
            : typeof stored['user-filters'] === 'string'
                ? stored['user-filters']
                : '';
        
        // Check user filters first
        if (userFiltersContent.toLowerCase().includes(filterPattern)) {
            results.push({
                assetKey: 'user',
                title: 'My filters',
                supportURL: '',
                type: 'user',
            });
        }
        
        // Check selected filter lists
        for (const listKey of selectedFilterLists) {
            const listInfo = filterLists[listKey as string] as any;
            if (listInfo && listInfo.title && listInfo.content) {
                const content = listInfo.content.toLowerCase();
                // Check for exact match or partial match
                if (content.includes(filterPattern) || content.includes(normalizedFilter)) {
                    results.push({
                        assetKey: listKey,
                        title: listInfo.title,
                        supportURL: listInfo.supportURL || '',
                        description: listInfo.description || '',
                        type: 'list',
                    });
                }
            }
        }
        
    } catch (e) {
        console.error('[MV3] findFilterListFromNetFilter error:', e);
    }
    return results;
};

export const findFilterListFromCosmeticFilter = async (_rawFilter: string): Promise<any[]> => {
    return [];
};
