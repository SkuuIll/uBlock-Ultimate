/**
 * src/core/compiler/safe-network-rule-compiler.ts
 *
 * v0 safe compiler for the small supported subset of network
 * filters:
 *   ||domain^  (block or allow)
 *   @@||domain^
 *   plain urlFilter (block or allow)
 *
 * Supports:
 *   - resourceTypes: script, image, stylesheet, xmlhttprequest,
 *     main_frame
 *   - third-party boolean (third-party / ~third-party)
 *   - match-case via isUrlFilterCaseSensitive
 *
 * Supports:
 *   - $redirect=<token> and $redirect-rule=<token> for known
 *     packaged resources (noopjs, 1x1.gif, etc.)
 *   - $removeparam with static key
 *
 * Does NOT support:
 *   - regexFilter
 *   - $replace, $csp, arbitrary $redirect to external URLs, scriptlets
 *   - response filtering
 *
 * Output: DNR candidate rule objects (caller decides which
 * ruleset to install them in).
 */

import { resolveRedirectToken } from './redirect-resolver';

export type SupportedResourceType =
  | 'main_frame'
  | 'sub_frame'
  | 'stylesheet'
  | 'script'
  | 'image'
  | 'font'
  | 'object'
  | 'xmlhttprequest'
  | 'ping'
  | 'csp_report'
  | 'media'
  | 'websocket'
  | 'webtransport'
  | 'webbundle'
  | 'other';

export const SUPPORTED_RESOURCE_TYPES:
ReadonlyArray<SupportedResourceType> = [
  'main_frame',
  'sub_frame',
  'script',
  'image',
  'stylesheet',
  'font',
  'object',
  'xmlhttprequest',
  'ping',
  'csp_report',
  'media',
  'websocket',
  'webtransport',
  'webbundle',
  'other',
];

export interface SafeDnrRule {
  id: number;
  priority: number;
  action:
    | { type: 'block' }
    | { type: 'allow' }
    | {
      type: 'redirect';
      redirect: {
        extensionPath?: string;
        transform?: {
          queryTransform: {
            removeParams: string[];
          };
        };
      };
    };
  condition: {
    urlFilter?: string;
    regexFilter?: string;
    isUrlFilterCaseSensitive?: boolean;
    initiatorDomains?: string[];
    excludedInitiatorDomains?: string[];
    requestDomains?: string[];
    excludedRequestDomains?: string[];
    resourceTypes?: SupportedResourceType[];
    excludedResourceTypes?: SupportedResourceType[];
    domainType?: 'firstParty' | 'thirdParty';
  };
}

export interface CompileOptions {
  idStart?: number;
  priority?: number;
  resourceTypes?: SupportedResourceType[];
  excludedResourceTypes?: SupportedResourceType[];
  domainType?: 'firstParty' | 'thirdParty';
  isCaseSensitive?: boolean;
  initiatorDomains?: string[];
  excludedInitiatorDomains?: string[];
  requestDomains?: string[];
  excludedRequestDomains?: string[];
}

export interface CompileResult {
  ok: boolean;
  rule?: SafeDnrRule;
  reason?: string;
}

const NETWORK_HOST_RE = /^\|\|([a-z0-9._-]+)\^?/i;
const STATIC_REMOVEPARAM_RE = /(?:^|,)\s*removeparam=([\w-]+)\s*(?:,|$)/i;

function splitFilterAndOptions(line: string): {
    pattern: string;
    options: string[];
} {
    const index = line.lastIndexOf('$');

    if (index === -1) {
        return {
            pattern: line,
            options: [],
        };
    }

    return {
        pattern: line.slice(0, index),
        options: line
            .slice(index + 1)
            .split(',')
            .map(value => value.trim())
            .filter(Boolean),
    };
}

function normalizeUrlFilterPattern(pattern: string): string {
    const value = pattern.trim();

    if (/^[a-z0-9._-]+$/i.test(value)) {
        return `||${value.toLowerCase()}^`;
    }

    const hostAnchored = /^\|\|([a-z0-9._-]+)(.*)$/i.exec(value);
    if (hostAnchored !== null) {
        return `||${hostAnchored[1].toLowerCase()}${hostAnchored[2]}`;
    }

    return value;
}

const RESOURCE_TYPE_OPTION_ALIASES = new Map<string, SupportedResourceType>([
    ['script', 'script'],
    ['image', 'image'],
    ['stylesheet', 'stylesheet'],
    ['xhr', 'xmlhttprequest'],
    ['xmlhttprequest', 'xmlhttprequest'],
    ['document', 'main_frame'],
    ['main_frame', 'main_frame'],
    ['frame', 'sub_frame'],
    ['subdocument', 'sub_frame'],
    ['sub_frame', 'sub_frame'],
    ['font', 'font'],
    ['media', 'media'],
    ['websocket', 'websocket'],
    ['webtransport', 'webtransport'],
    ['webbundle', 'webbundle'],
    ['ping', 'ping'],
    ['csp_report', 'csp_report'],
    ['object', 'object'],
    ['other', 'other'],
]);

function parseDomainList(value: string): {
    include: string[];
    exclude: string[];
} {
    const include: string[] = [];
    const exclude: string[] = [];

    for (const raw of value.split('|')) {
        const domain = raw.trim().toLowerCase();
        if (domain === '') continue;
        if (domain.startsWith('~')) {
            const excluded = domain.slice(1);
            if (excluded !== '') exclude.push(excluded);
        } else {
            include.push(domain);
        }
    }

    return { include, exclude };
}

function mergeUnique<T>(left: T[] | undefined, right: T[]): T[] | undefined {
    if (right.length === 0) return left;
    return Array.from(new Set([...(left ?? []), ...right]));
}

function applyFilterOption(
    target: Partial<CompileOptions>,
    option: string,
): string | null {
    const lower = option.toLowerCase();

    if (lower === '3p' || lower === 'third-party') {
        target.domainType = 'thirdParty';
        return null;
    }
    if (lower === '1p' || lower === 'first-party' || lower === '~third-party') {
        target.domainType = 'firstParty';
        return null;
    }
    if (lower === 'match-case') {
        target.isCaseSensitive = true;
        return null;
    }
    if (lower === '~match-case') {
        target.isCaseSensitive = false;
        return null;
    }
    if (lower === 'important') {
        return null;
    }
    if (lower.startsWith('domain=') || lower.startsWith('from=')) {
        const parsed = parseDomainList(
            lower.startsWith('domain=')
                ? lower.slice('domain='.length)
                : lower.slice('from='.length),
        );
        target.initiatorDomains = mergeUnique(target.initiatorDomains, parsed.include);
        target.excludedInitiatorDomains = mergeUnique(
            target.excludedInitiatorDomains,
            parsed.exclude,
        );
        return null;
    }
    if (lower.startsWith('to=')) {
        const parsed = parseDomainList(lower.slice('to='.length));
        target.requestDomains = mergeUnique(target.requestDomains, parsed.include);
        target.excludedRequestDomains = mergeUnique(
            target.excludedRequestDomains,
            parsed.exclude,
        );
        return null;
    }

    const negated = lower.startsWith('~');
    const resourceType = RESOURCE_TYPE_OPTION_ALIASES.get(
        negated ? lower.slice(1) : lower,
    );
    if (resourceType !== undefined) {
        if (negated) {
            target.excludedResourceTypes = mergeUnique(
                target.excludedResourceTypes,
                [resourceType],
            );
        } else {
            target.resourceTypes = mergeUnique(
                target.resourceTypes,
                [resourceType],
            );
        }
        return null;
    }

    return `Unsupported option: ${option}`;
}

export function compileSafeNetworkFilter(
    filter: string,
    options: CompileOptions = {},
): CompileResult {
    if (typeof filter !== 'string') {
        return { ok: false, reason: 'Filter is not a string.' };
    }
    const line = filter.trim();
    if (line.length === 0 || line.startsWith('!')) {
        return { ok: false, reason: 'Empty line or comment.' };
    }
    const isException = line.startsWith('@@');
    const withoutException = isException
        ? line.slice(2)
        : line;

    const parsed =
        splitFilterAndOptions(withoutException);

    const loweredOptions: Partial<CompileOptions> = {};
    for (const option of parsed.options) {
        const error = applyFilterOption(loweredOptions, option);
        if (error !== null) {
            return { ok: false, reason: error };
        }
    }

    const urlFilter =
        normalizeUrlFilterPattern(parsed.pattern);

    if (
        urlFilter === '' ||
        urlFilter.includes('##') ||
        urlFilter.includes('#@#') ||
        urlFilter.includes('#?#') ||
        urlFilter.includes('#@?#') ||
        urlFilter.includes('#$#')
    ) {
        return {
            ok: false,
            reason: 'Not a network URL pattern.',
        };
    }

    const id = options.idStart ?? 1;
    const priority = options.priority ?? (isException ? 500000 : 400000);

    const condition: SafeDnrRule['condition'] = {
    urlFilter,
    };
    const effectiveOptions = {
        ...loweredOptions,
        ...options,
    };

    if (effectiveOptions.isCaseSensitive === true) {
        condition.isUrlFilterCaseSensitive = true;
    }
    if (effectiveOptions.initiatorDomains && effectiveOptions.initiatorDomains.length > 0) {
        condition.initiatorDomains = effectiveOptions.initiatorDomains.slice();
    }
    if (effectiveOptions.excludedInitiatorDomains && effectiveOptions.excludedInitiatorDomains.length > 0) {
        condition.excludedInitiatorDomains =
            effectiveOptions.excludedInitiatorDomains.slice();
    }
    if (effectiveOptions.requestDomains && effectiveOptions.requestDomains.length > 0) {
        condition.requestDomains = effectiveOptions.requestDomains.slice();
    }
    if (effectiveOptions.excludedRequestDomains && effectiveOptions.excludedRequestDomains.length > 0) {
        condition.excludedRequestDomains =
            effectiveOptions.excludedRequestDomains.slice();
    }
    if (effectiveOptions.resourceTypes && effectiveOptions.resourceTypes.length > 0) {
        condition.resourceTypes = effectiveOptions.resourceTypes.filter(t =>
      SUPPORTED_RESOURCE_TYPES.indexOf(t) !== -1,
        );
        if (condition.resourceTypes.length === 0) {
            delete condition.resourceTypes;
        }
    }
    if (effectiveOptions.excludedResourceTypes && effectiveOptions.excludedResourceTypes.length > 0) {
        condition.excludedResourceTypes =
            effectiveOptions.excludedResourceTypes.filter(t =>
                SUPPORTED_RESOURCE_TYPES.indexOf(t) !== -1,
            );
        if (condition.excludedResourceTypes.length === 0) {
            delete condition.excludedResourceTypes;
        }
    }
    if (effectiveOptions.domainType !== undefined) {
        condition.domainType = effectiveOptions.domainType;
    }

    return {
    ok: true,
    rule: {
      id,
      priority,
      action: { type: isException ? 'allow' : 'block' },
      condition,
    },
    };
}

export function compileStaticRemoveparamFilter(
    filter: string,
    options: CompileOptions = {},
): CompileResult {
    if (typeof filter !== 'string') {
        return { ok: false, reason: 'Filter is not a string.' };
    }
    const line = filter.trim();
    if (line.startsWith('@@')) {
        return { ok: false, reason: 'Exception removeparam rules are not supported.' };
    }

    const optIdx = line.lastIndexOf('$');
    if (optIdx < 0) {
        return { ok: false, reason: 'Missing $removeparam option.' };
    }
    const body = line.slice(0, optIdx);
    const optionsText = line.slice(optIdx + 1);
    const paramMatch = STATIC_REMOVEPARAM_RE.exec(optionsText);
    if (!paramMatch) {
        return { ok: false, reason: 'Only static plain $removeparam names are supported.' };
    }
    const paramName = paramMatch[1];
    if (!/^[\w-]+$/.test(paramName)) {
        return { ok: false, reason: 'Only static plain $removeparam names are supported.' };
    }

    const hostMatch = NETWORK_HOST_RE.exec(body);
    if (!hostMatch) {
        return { ok: false, reason: '$removeparam requires a supported ||domain^ network pattern.' };
    }

    const id = options.idStart ?? 1;
    const priority = options.priority ?? 400000;
    return {
    ok: true,
    rule: {
      id,
      priority,
      action: {
        type: 'redirect',
        redirect: {
          transform: {
            queryTransform: {
              removeParams: [paramName],
            },
          },
        },
      },
      condition: {
        urlFilter: `||${hostMatch[1].toLowerCase()}^`,
      },
    },
    };
}

const REDIRECT_OPT_RE = /(?:^|,)\s*redirect(?:-rule)?=([^,]+)\s*(?:,|$)/i;

export function compileRedirectFilter(
    filter: string,
    options: CompileOptions = {},
): CompileResult {
    if (typeof filter !== 'string') {
        return { ok: false, reason: 'Filter is not a string.' };
    }
    const line = filter.trim();
    if (line.startsWith('@@')) {
        return { ok: false, reason: 'Exception redirect rules are not supported.' };
    }

    const optIdx = line.lastIndexOf('$');
    if (optIdx < 0) {
        return { ok: false, reason: 'Missing $redirect option.' };
    }
    const body = line.slice(0, optIdx);
    const optionsText = line.slice(optIdx + 1);
    const redirectMatch = REDIRECT_OPT_RE.exec(optionsText);
    if (!redirectMatch) {
        return { ok: false, reason: 'Could not parse redirect token from options.' };
    }
    const token = redirectMatch[1];

    // Look up the token in the packaged redirect resource catalog
    const extensionPath = resolveRedirectToken(token);
    if (extensionPath === null) {
        return { ok: false, reason: `Unknown redirect resource: ${token}` };
    }

    const urlFilter = normalizeUrlFilterPattern(body);
    if (urlFilter === '') {
        return { ok: false, reason: '$redirect requires a network URL pattern.' };
    }

    const loweredOptions: Partial<CompileOptions> = {};
    const opts = optionsText.split(',').map(o => o.trim()).filter(Boolean);
    for (const opt of opts) {
        if (/^redirect(?:-rule)?=/i.test(opt)) continue;
        const error = applyFilterOption(loweredOptions, opt);
        if (error !== null) {
            return { ok: false, reason: error };
        }
    }

    const id = options.idStart ?? 1;
    const priority = options.priority ?? 420000; // same band as block
    const condition: SafeDnrRule['condition'] = {
        urlFilter,
    };
    const effectiveOptions = {
        ...loweredOptions,
        ...options,
    };
    if (effectiveOptions.resourceTypes && effectiveOptions.resourceTypes.length > 0) {
        condition.resourceTypes = effectiveOptions.resourceTypes.filter(t =>
            SUPPORTED_RESOURCE_TYPES.indexOf(t) !== -1,
        );
        if (condition.resourceTypes.length === 0) {
            delete condition.resourceTypes;
        }
    }
    if (effectiveOptions.excludedResourceTypes && effectiveOptions.excludedResourceTypes.length > 0) {
        condition.excludedResourceTypes = effectiveOptions.excludedResourceTypes.filter(t =>
            SUPPORTED_RESOURCE_TYPES.indexOf(t) !== -1,
        );
        if (condition.excludedResourceTypes.length === 0) {
            delete condition.excludedResourceTypes;
        }
    }
    if (effectiveOptions.initiatorDomains && effectiveOptions.initiatorDomains.length > 0) {
        condition.initiatorDomains = effectiveOptions.initiatorDomains.slice();
    }
    if (effectiveOptions.excludedInitiatorDomains && effectiveOptions.excludedInitiatorDomains.length > 0) {
        condition.excludedInitiatorDomains = effectiveOptions.excludedInitiatorDomains.slice();
    }
    if (effectiveOptions.requestDomains && effectiveOptions.requestDomains.length > 0) {
        condition.requestDomains = effectiveOptions.requestDomains.slice();
    }
    if (effectiveOptions.excludedRequestDomains && effectiveOptions.excludedRequestDomains.length > 0) {
        condition.excludedRequestDomains = effectiveOptions.excludedRequestDomains.slice();
    }
    if (effectiveOptions.domainType !== undefined) {
        condition.domainType = effectiveOptions.domainType;
    }
    return {
        ok: true,
        rule: {
            id,
            priority,
            action: {
                type: 'redirect',
                redirect: { extensionPath },
            },
            condition,
        },
    };
}
