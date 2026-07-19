/*******************************************************************************

    uBlock Ultimate - Scripting Manager for MV3
    Copyright (C) 2024-present Raymond Hill

    This module handles dynamic content script registration using
    chrome.scripting.registerContentScripts API.

******************************************************************************/

import { redirectEngine } from '../redirect-engine.js';
import '../background.js';
import '../static-net-filtering.js';
import '../scriptlet-filtering.js';
import '../storage.js';

const webextAPI = chrome;

interface ContentScriptDirective {
    id: string;
    matches: string[];
    excludeMatches?: string[];
    js: string[];
    runAt: 'document_start' | 'document_idle' | 'document_end';
}

const SCRIPT_ID_PREFIX = 'ubo-';

const SCRIPTLET_URLS: string[] = [];
if (typeof redirectEngine !== 'undefined' && redirectEngine.getResourceDetails) {
    const details = redirectEngine.getResourceDetails();
    for (const [token] of details) {
        SCRIPTLET_URLS.push(`/js/scriptlets/${token}.js`);
    }
}

class ScriptingManager {
    private registeredScripts: Map<string, any> = new Map();
    private filteringModeCache: Map<string, string> = new Map();

    async initialize() {
        console.log('[ScriptingManager] Initializing...');
        await this.registerInjectables();
    }

    async registerInjectables() {
        if (typeof webextAPI.scripting === 'undefined') {
            console.log('[ScriptingManager] scripting API not available');
            return;
        }

        try {
            const directives = await this.buildContentScriptDirectives();
            
            if (directives.length === 0) {
                console.log('[ScriptingManager] No directives to register');
                return;
            }

            await webextAPI.scripting.registerContentScripts(directives);
            console.log('[ScriptingManager] Registered', directives.length, 'content scripts');
        } catch (e) {
            console.error('[ScriptingManager] Failed to register content scripts:', e);
        }
    }

    private async buildContentScriptDirectives(): Promise<ContentScriptDirective[]> {
        const directives: ContentScriptDirective[] = [];

        const scriptletsDirective = this.buildScriptletsDirective();
        if (scriptletsDirective) {
            directives.push(scriptletsDirective);
        }

        const cosmeticDirectives = await this.buildCosmeticDirectives();
        directives.push(...cosmeticDirectives);

        return directives;
    }

    private buildScriptletsDirective(): ContentScriptDirective | null {
        if (SCRIPTLET_URLS.length === 0) {
            return null;
        }

        return {
            id: `${SCRIPT_ID_PREFIX}scriptlets`,
            matches: ['<all_urls>'],
            js: SCRIPTLET_URLS,
            runAt: 'document_start',
        };
    }

    private async buildCosmeticDirectives(): Promise<ContentScriptDirective[]> {
        const directives: ContentScriptDirective[] = [];

        directives.push({
            id: `${SCRIPT_ID_PREFIX}cosmetic-specific`,
            matches: ['<all_urls>'],
            js: ['/js/contentscript/04-dom-filterer.js'],
            runAt: 'document_start',
        });

        directives.push({
            id: `${SCRIPT_ID_PREFIX}cosmetic-generic`,
            matches: ['<all_urls>'],
            js: ['/js/contentscript/05-dom-collapser.js'],
            runAt: 'document_idle',
        });

        return directives;
    }

    async getRegisteredContentScripts(): Promise<string[]> {
        if (typeof webextAPI.scripting?.getRegisteredContentScripts !== 'function') {
            return [];
        }

        try {
            const scripts = await webextAPI.scripting.getRegisteredContentScripts();
            return scripts.map(s => s.id);
        } catch (e) {
            console.error('[ScriptingManager] Failed to get registered scripts:', e);
            return [];
        }
    }

    async unregisterAllContentScripts() {
        if (typeof webextAPI.scripting?.unregisterContentScripts !== 'function') {
            return;
        }

        try {
            await webextAPI.scripting.unregisterContentScripts({});
            console.log('[ScriptingManager] Unregistered all content scripts');
        } catch (e) {
            console.error('[ScriptingManager] Failed to unregister scripts:', e);
        }
    }

    async reRegisterContentScripts() {
        await this.unregisterAllContentScripts();
        await this.registerInjectables();
    }
}

const scriptingManager = new ScriptingManager();

export { scriptingManager, ScriptingManager };
export default scriptingManager;
