const webextAPI = chrome;

export const storage = {
    async readUserFilters(): Promise<{ content: string }> {
        const data = await webextAPI.storage.local.get('user-filters');
        const value = data['user-filters'];
        if ( typeof value === 'string' ) {
            return { content: value };
        }
        return { content: '' };
    },

    async readFilteringMode(): Promise<{ [hostname: string]: string }> {
        const data = await webextAPI.storage.local.get('filtering-modes');
        return (data['filtering-modes'] as { [hostname: string]: string }) || {};
    },

    async writeFilteringMode(hostname: string, mode: string): Promise<void> {
        const data = await webextAPI.storage.local.get('filtering-modes');
        const modes = data['filtering-modes'] || {};
        modes[hostname] = mode;
        await webextAPI.storage.local.set({ 'filtering-modes': modes });
    },

    async deleteFilteringMode(hostname: string): Promise<void> {
        const data = await webextAPI.storage.local.get('filtering-modes');
        const modes = data['filtering-modes'] || {};
        delete modes[hostname];
        await webextAPI.storage.local.set({ 'filtering-modes': modes });
    },
};
