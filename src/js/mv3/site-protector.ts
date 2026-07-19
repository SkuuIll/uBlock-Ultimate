/*******************************************************************************

    uBlock Origin - MV3 Site Protector Registry
    https://github.com/gorhill/uBlock

    Generic hook registry for site-specific cosmetic filter protection.
    Sites register pre-hooks (called before serving cosmetic filters to a page)
    and selector exclusions (filters that should be excluded for that site).

    YouTube is the primary consumer; other sites can register their own
    protectors without modifying any generic code paths.

******************************************************************************/

export type CosmeticPreHook = (_hostname: string) => Promise<void>;
export type SelectorExclusion = (_pageHostname: string, _selector: string) => boolean;

const preHooks: CosmeticPreHook[] = [];
const selectorExclusions: SelectorExclusion[] = [];

export function registerPreHook(hook: CosmeticPreHook): void {
    preHooks.push(hook);
}

export function registerSelectorExclusion(exclusion: SelectorExclusion): void {
    selectorExclusions.push(exclusion);
}

export async function runPreHooks(hostname: string): Promise<void> {
    if (hostname === "") return;
    await Promise.all(preHooks.map(hook => hook(hostname)));
}

export function isSelectorExcluded(pageHostname: string, selector: string): boolean {
    if (pageHostname === "" || selector === "") return false;
    return selectorExclusions.some(exclusion => exclusion(pageHostname, selector));
}
