/*******************************************************************************

    uBlock Ultimate - Filtering Core
    Copyright (C) 2014-present Raymond Hill

    This module re-exports the filtering core from src/js/
    The actual implementation lives in src/js/ to maintain compatibility
    with the existing build system.

*******************************************************************************/

// Re-export filtering engines
export {
    permanentFirewall,
    sessionFirewall,
    permanentURLFiltering,
    sessionURLFiltering,
    permanentSwitches,
    sessionSwitches,
} from '../js/filtering-engines.js';

// Re-export static filtering engines
export { default as staticNetFilteringEngine } from '../js/static-net-filtering.js';
export { default as staticExtFilteringEngine } from '../js/static-ext-filtering.js';
export { default as staticDnrFilteringEngine } from '../js/static-dnr-filtering.js';

// Re-export dynamic filtering engines
export { default as dynamicNetFilteringEngine } from '../js/dynamic-net-filtering.js';
export { default as urlNetFilteringEngine } from '../js/url-net-filtering.js';

// Re-export cosmetic filtering
export { default as htmlFilteringEngine } from '../js/html-filtering.js';
export { default as httpheaderFilteringEngine } from '../js/httpheader-filtering.js';

// Re-export scriptlet filtering
export { default as scriptletFilteringEngine } from '../js/scriptlet-filtering.js';

// Re-export redirect engine
export { redirectEngine } from '../js/redirect-engine.js';

// Re-export storage/asset management
export { default as io } from '../js/assets.js';
export { default as storage } from '../js/storage.js';
export { default as cacheStorage } from '../js/cachestorage.js';

// Re-export filter parser
export * as sfp from '../js/static-filtering-parser.js';
export { FilteringContext } from '../js/filtering-context.js';

// Re-export compiler modules for DNR compilation
export { dnrCompiler, DNRCompiler } from './compiler/dnr-compiler.js';
export { ruleManager, RuleManager } from './compiler/rule-manager.js';
export { ruleBudget, RuleBudget } from './compiler/rule-budget.js';

// Re-export filtering compiler extensions
import '../js/filtering-compiler.js';
