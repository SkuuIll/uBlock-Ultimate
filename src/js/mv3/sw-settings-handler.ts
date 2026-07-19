/*******************************************************************************

    uBlock Origin - MV3 Settings Handler
    Handles user setting changes

*******************************************************************************/

import { popupState, ensurePopupState, persistUserSettings } from './sw-storage.js';
import { createContextMenu } from './sw-context-menu.js';

export const setUserSetting = async (request: {
    name?: string;
    value?: unknown;
}): Promise<Record<string, unknown>> => {
    await ensurePopupState();
    if ( typeof request.name === 'string' ) {
        (popupState.userSettings as Record<string, any>)[request.name] = request.value;
        await persistUserSettings();
        if ( request.name === 'contextMenuEnabled' ) {
            createContextMenu(popupState.userSettings);
        }
    }
    
    const vAPINet = (globalThis as any).vAPI?.net;
    const canUncloakCnames = vAPINet?.canUncloakCnames === true;
    
    const response: Record<string, any> = { ...popupState.userSettings };
    
    if (!canUncloakCnames) {
        delete response.cnameUncloakEnabled;
    }
    
    if (!vAPINet?.canLeakLocalIPAddresses) {
        delete response.canLeakLocalIPAddresses;
    }
    
    return response;
};
