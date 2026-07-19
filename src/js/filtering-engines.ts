/*******************************************************************************

    uBlock Ultimate - a comprehensive, efficient content blocker
    Copyright (C) 2014-present Raymond Hill

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU General Public License for more details.

    You should have received a copy of the GNU General Public License
    along with this program.  If not, see {http://www.gnu.org/licenses/}.

    Home: https://github.com/gorhill/uBlock
*/

import DynamicHostRuleFiltering from './dynamic-net-filtering.js';
import DynamicSwitchRuleFiltering from './hnswitches.js';
import DynamicURLRuleFiltering from './url-net-filtering.js';

// Import filtering compiler extensions to add compile() methods
import './filtering-compiler.js';

/******************************************************************************/

const permanentFirewall = new DynamicHostRuleFiltering();
const sessionFirewall = new DynamicHostRuleFiltering();

const permanentURLFiltering = new DynamicURLRuleFiltering();
const sessionURLFiltering = new DynamicURLRuleFiltering();

const permanentSwitches = new DynamicSwitchRuleFiltering();
const sessionSwitches = new DynamicSwitchRuleFiltering();

/******************************************************************************/

export {
    permanentFirewall,
    sessionFirewall,
    permanentURLFiltering,
    sessionURLFiltering,
    permanentSwitches,
    sessionSwitches,
};

/******************************************************************************/

/**
 * Compile all filtering engines to DNR rules
 * @returns {Object} Object with static, dynamic, session rules
 */
export async function compileAllEngines() {
    const results = {
        static: [],
        dynamic: [],
        session: [],
        errors: [],
    };
    
    console.log('[compileAllEngines] Starting compilation...');
    
    try {
        // Compile static network filters
        if (typeof (globalThis as any).staticNetFilteringEngine !== 'undefined') {
            const engine = (globalThis as any).staticNetFilteringEngine;
            if (typeof engine.dnrFromCompiled === 'function') {
                const staticRules = await engine.dnrFromCompiled();
                results.static.push(...staticRules);
            }
        }
        
        // Compile static extension filters
        if (typeof (globalThis as any).staticExtFilteringEngine !== 'undefined') {
            const engine = (globalThis as any).staticExtFilteringEngine;
            if (typeof engine.compile === 'function') {
                const extRules = await engine.compile();
                results.static.push(...extRules);
            }
        }
        
        // Compile dynamic rules (user-created)
        // These would come from permanentFirewall, sessionFirewall, etc.
        // For MVP, we'll handle these separately through ruleManager
        
    } catch (error) {
        console.error('[compileAllEngines] Error:', error);
        results.errors.push((error as any).message);
    }
    
    console.log(`[compileAllEngines] Compiled: ${results.static.length} static, ${results.dynamic.length} dynamic`);
    
    return results;
}
