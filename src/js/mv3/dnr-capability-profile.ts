/**
 * Static DNR capability profile for declarativeNetRequest.
 *
 * Pure module: does not call Chrome APIs. Profiles are derived from a
 * supplied user-agent string so behavior is deterministic and testable
 * in Node.
 */

export type DnrActionKind =
  | 'block'
  | 'allow'
  | 'allowAllRequests'
  | 'upgradeScheme'
  | 'redirect'
  | 'modifyHeaders';

export type DnrRuntimeProfileName =
  | 'chrome-121-plus'
  | 'chrome-pre-121'
  | 'unknown-or-degraded';

export interface DnrCapabilityProfile {
  profileName: DnrRuntimeProfileName;
  chromeMajorVersion: number | null;
  maxEnabledStaticRulesets: number;
  maxPackagedStaticRulesets: number;
  guaranteedStaticRules: number;
  safeDynamicRules: number;
  unsafeDynamicRules: number;
  sessionRules: number;
  regexRulesPerType: number;
  safeDynamicActions: DnrActionKind[];
  unsafeDynamicActions: DnrActionKind[];
  supportsIsRegexSupported: boolean;
  supportsStaticRuleDisable: boolean;
  notes: string[];
}

const SAFE_DYNAMIC_ACTIONS: readonly DnrActionKind[] = [
  'block',
  'allow',
  'allowAllRequests',
  'upgradeScheme',
];

const UNSAFE_DYNAMIC_ACTIONS: readonly DnrActionKind[] = [
  'redirect',
  'modifyHeaders',
];

const CHROME_MAJOR_RE = /Chrome\/(\d+)/;

export function detectChromeMajorVersion(userAgent?: string): number | null {
    if (typeof userAgent !== 'string' || userAgent.length === 0) {
        return null;
    }
    const match = CHROME_MAJOR_RE.exec(userAgent);
    if (match === null) {
        return null;
    }
    const n = Number.parseInt(match[1], 10);
    if (!Number.isFinite(n) || n <= 0) {
        return null;
    }
    return n;
}

export function getStaticDnrCapabilityProfile(
    userAgent?: string,
): DnrCapabilityProfile {
    const major = detectChromeMajorVersion(userAgent);
    const notes: string[] = [];

    if (major === null) {
    notes.push('User-agent string did not match a known Chrome version.');
    return {
      profileName: 'unknown-or-degraded',
      chromeMajorVersion: null,
      maxEnabledStaticRulesets: 50,
      maxPackagedStaticRulesets: 100,
      guaranteedStaticRules: 30000,
      safeDynamicRules: 5000,
      unsafeDynamicRules: 5000,
      sessionRules: 5000,
      regexRulesPerType: 1000,
      safeDynamicActions: [...SAFE_DYNAMIC_ACTIONS],
      unsafeDynamicActions: [...UNSAFE_DYNAMIC_ACTIONS],
      supportsIsRegexSupported: false,
      supportsStaticRuleDisable: false,
      notes,
    };
    }

    if (major >= 121) {
    notes.push(`Chrome ${major}: full safe-dynamic budget.`);
    return {
      profileName: 'chrome-121-plus',
      chromeMajorVersion: major,
      maxEnabledStaticRulesets: 50,
      maxPackagedStaticRulesets: 100,
      guaranteedStaticRules: 30000,
      safeDynamicRules: 30000,
      unsafeDynamicRules: 5000,
      sessionRules: 5000,
      regexRulesPerType: 1000,
      safeDynamicActions: [...SAFE_DYNAMIC_ACTIONS],
      unsafeDynamicActions: [...UNSAFE_DYNAMIC_ACTIONS],
      supportsIsRegexSupported: true,
      supportsStaticRuleDisable: true,
      notes,
    };
    }

  notes.push(`Chrome ${major}: pre-121 safe-dynamic budget.`);
  return {
    profileName: 'chrome-pre-121',
    chromeMajorVersion: major,
    maxEnabledStaticRulesets: 50,
    maxPackagedStaticRulesets: 100,
    guaranteedStaticRules: 30000,
    safeDynamicRules: 5000,
    unsafeDynamicRules: 5000,
    sessionRules: 5000,
    regexRulesPerType: 1000,
    safeDynamicActions: [...SAFE_DYNAMIC_ACTIONS],
    unsafeDynamicActions: [...UNSAFE_DYNAMIC_ACTIONS],
    supportsIsRegexSupported: false,
    supportsStaticRuleDisable: false,
    notes,
  };
}

export function isSafeDynamicAction(action: DnrActionKind): boolean {
    return SAFE_DYNAMIC_ACTIONS.indexOf(action) !== -1;
}
