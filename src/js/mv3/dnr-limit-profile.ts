/**
 * Static DNR limit profile and budget assertion helpers.
 *
 * Pure module: no Chrome API calls. All values are sourced from the
 * DNR_LIMIT_PROFILE constant so the module is deterministic and
 * testable in Node.
 */

export interface DnrLimitProfile {
  maxEnabledStaticRulesets: number;
  maxPackagedStaticRulesets: number;
  guaranteedStaticRules: number;
  safeDynamicRulesChrome121Plus: number;
  safeDynamicRulesPre121: number;
  unsafeDynamicRules: number;
  sessionRules: number;
  regexRulesPerType: number;
  userRegexHardCap: number;
  userRegexWarnAt: number;
  sessionRulesWarnAt: number;
  domainConditionMaxChars: number;
  regexEstimatedCompiledSizeMaxBytes: number;
}

export const DNR_LIMIT_PROFILE: DnrLimitProfile = {
  maxEnabledStaticRulesets: 50,
  maxPackagedStaticRulesets: 100,
  guaranteedStaticRules: 30000,
  safeDynamicRulesChrome121Plus: 30000,
  safeDynamicRulesPre121: 5000,
  unsafeDynamicRules: 5000,
  sessionRules: 5000,
  regexRulesPerType: 1000,
  userRegexHardCap: 200,
  userRegexWarnAt: 150,
  sessionRulesWarnAt: 4000,
  domainConditionMaxChars: 2048,
  regexEstimatedCompiledSizeMaxBytes: 2048,
};

export interface BudgetCheck {
  ok: boolean;
  warning: boolean;
  message: string;
}

export function assertWithinSessionRuleBudget(count: number): BudgetCheck {
    if (!Number.isFinite(count) || count < 0) {
        return {
      ok: false,
      warning: false,
      message: `Invalid session rule count: ${count}`,
        };
    }
    const { sessionRules, sessionRulesWarnAt } = DNR_LIMIT_PROFILE;
    if (count > sessionRules) {
        return {
      ok: false,
      warning: false,
      message: `Session rule count ${count} exceeds hard cap ${sessionRules}.`,
        };
    }
    if (count >= sessionRulesWarnAt) {
        return {
      ok: true,
      warning: true,
      message: `Session rule count ${count} is at or above warning threshold ${sessionRulesWarnAt}.`,
        };
    }
    return {
    ok: true,
    warning: false,
    message: `Session rule count ${count} is within budget.`,
    };
}

export function assertWithinSafeDynamicRuleBudget(
    count: number,
    chrome121Plus = true,
): BudgetCheck {
    if (!Number.isFinite(count) || count < 0) {
        return {
      ok: false,
      warning: false,
      message: `Invalid safe dynamic rule count: ${count}`,
        };
    }
    const cap = chrome121Plus
        ? DNR_LIMIT_PROFILE.safeDynamicRulesChrome121Plus
        : DNR_LIMIT_PROFILE.safeDynamicRulesPre121;
    const warnAt = Math.floor(cap * 0.9);
    if (count > cap) {
        return {
      ok: false,
      warning: false,
      message: `Safe dynamic rule count ${count} exceeds hard cap ${cap}.`,
        };
    }
    if (count >= warnAt) {
        return {
      ok: true,
      warning: true,
      message: `Safe dynamic rule count ${count} is at or above warning threshold ${warnAt}.`,
        };
    }
    return {
    ok: true,
    warning: false,
    message: `Safe dynamic rule count ${count} is within budget.`,
    };
}

export function assertWithinUnsafeDynamicRuleBudget(count: number): BudgetCheck {
    if (!Number.isFinite(count) || count < 0) {
        return {
      ok: false,
      warning: false,
      message: `Invalid unsafe dynamic rule count: ${count}`,
        };
    }
    const cap = DNR_LIMIT_PROFILE.unsafeDynamicRules;
    const warnAt = Math.floor(cap * 0.9);
    if (count > cap) {
        return {
      ok: false,
      warning: false,
      message: `Unsafe dynamic rule count ${count} exceeds hard cap ${cap}.`,
        };
    }
    if (count >= warnAt) {
        return {
      ok: true,
      warning: true,
      message: `Unsafe dynamic rule count ${count} is at or above warning threshold ${warnAt}.`,
        };
    }
    return {
    ok: true,
    warning: false,
    message: `Unsafe dynamic rule count ${count} is within budget.`,
    };
}

export function assertWithinUserRegexBudget(count: number): BudgetCheck {
    if (!Number.isFinite(count) || count < 0) {
        return {
      ok: false,
      warning: false,
      message: `Invalid user regex count: ${count}`,
        };
    }
    const { userRegexHardCap, userRegexWarnAt } = DNR_LIMIT_PROFILE;
    if (count > userRegexHardCap) {
        return {
      ok: false,
      warning: false,
      message: `User regex count ${count} exceeds hard cap ${userRegexHardCap}.`,
        };
    }
    if (count >= userRegexWarnAt) {
        return {
      ok: true,
      warning: true,
      message: `User regex count ${count} is at or above warning threshold ${userRegexWarnAt}.`,
        };
    }
    return {
    ok: true,
    warning: false,
    message: `User regex count ${count} is within budget.`,
    };
}

export interface DomainLengthCheck {
  ok: boolean;
  message: string;
}

export function assertDomainConditionLength(
    serializedDomains: string,
): DomainLengthCheck {
    if (typeof serializedDomains !== 'string') {
        return {
      ok: false,
      message: 'Serialized domain condition must be a string.',
        };
    }
    const { domainConditionMaxChars } = DNR_LIMIT_PROFILE;
    if (serializedDomains.length > domainConditionMaxChars) {
        return {
      ok: false,
      message: `Serialized domain condition length ${serializedDomains.length} exceeds limit ${domainConditionMaxChars}.`,
        };
    }
    return {
    ok: true,
    message: `Serialized domain condition length ${serializedDomains.length} is within limit ${domainConditionMaxChars}.`,
    };
}
