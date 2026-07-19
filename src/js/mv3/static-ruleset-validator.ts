/**
 * src/js/mv3/static-ruleset-validator.ts
 *
 * Validates a static DNR ruleset JSON array against the shape and
 * budget constraints documented in the Rev15 plan. Pure module,
 * no Chrome API calls.
 */

export interface StaticRulesetValidationResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
  ruleCount: number;
  regexRuleCount: number;
}

const REGEX_RULE_WARN_THRESHOLD = 900;
const RULE_COUNT_WARN_THRESHOLD = 27000;
const DOMAIN_CONDITION_MAX_CHARS = 2048;

export function validateStaticRulesetJson(
    input: unknown,
): StaticRulesetValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!Array.isArray(input)) {
        return {
      ok: false,
      errors: ['Input is not an array.'],
      warnings: [],
      ruleCount: 0,
      regexRuleCount: 0,
        };
    }

    const ruleCount = input.length;
    let regexRuleCount = 0;
    const seenIds = new Map<number, number>();

    for (let i = 0; i < input.length; i++) {
        const item = input[i];
        const prefix = `Rule[${i}]`;

        if (item === null || typeof item !== 'object' || Array.isArray(item)) {
      errors.push(`${prefix} is not an object.`);
      continue;
        }

        const rule = item as Record<string, unknown>;

        if (!('id' in rule) || !Number.isInteger(rule.id) || (rule.id as number) <= 0) {
      errors.push(`${prefix} is missing a valid positive integer id.`);
        } else {
            const id = rule.id as number;
      seenIds.set(id, (seenIds.get(id) ?? 0) + 1);
        }

        if ('priority' in rule) {
            if (
                !Number.isInteger(rule.priority) ||
        (rule.priority as number) <= 0
            ) {
        errors.push(`${prefix} has an invalid priority.`);
            }
        }

        if (!('action' in rule) || !isPlainObject(rule.action)) {
      errors.push(`${prefix} is missing a valid action object.`);
        }

        if (!('condition' in rule) || !isPlainObject(rule.condition)) {
      errors.push(`${prefix} is missing a valid condition object.`);
        } else {
            const cond = rule.condition as Record<string, unknown>;
            if (typeof cond.regexFilter === 'string' && cond.regexFilter.length > 0) {
                regexRuleCount++;
            }

            const domains = Array.isArray(cond.domains) ? cond.domains : [];
            const excludedDomains = Array.isArray(cond.excludedDomains) ? cond.excludedDomains : [];
            const initiatorDomains = Array.isArray(cond.initiatorDomains) ? cond.initiatorDomains : [];
            const excludedInitiatorDomains = Array.isArray(cond.excludedInitiatorDomains) ? cond.excludedInitiatorDomains : [];
            const requestDomains = Array.isArray(cond.requestDomains) ? cond.requestDomains : [];
            const excludedRequestDomains = Array.isArray(cond.excludedRequestDomains) ? cond.excludedRequestDomains : [];
            const serialized =
        JSON.stringify(domains)
        + JSON.stringify(excludedDomains)
        + JSON.stringify(initiatorDomains)
        + JSON.stringify(excludedInitiatorDomains)
        + JSON.stringify(requestDomains)
        + JSON.stringify(excludedRequestDomains);
            if (serialized.length > DOMAIN_CONDITION_MAX_CHARS) {
        errors.push(
            `${prefix} domain condition length ${serialized.length} exceeds limit ${DOMAIN_CONDITION_MAX_CHARS}.`,
        );
            }
        }
    }

    for (const [id, count] of seenIds) {
        if (count > 1) {
      errors.push(`Duplicate id ${id} appears ${count} times.`);
        }
    }

    if (regexRuleCount >= REGEX_RULE_WARN_THRESHOLD) {
    warnings.push(
        `regexRuleCount ${regexRuleCount} is at or above warning threshold ${REGEX_RULE_WARN_THRESHOLD}.`,
    );
    }

    if (ruleCount >= RULE_COUNT_WARN_THRESHOLD) {
    warnings.push(
        `ruleCount ${ruleCount} is at or above warning threshold ${RULE_COUNT_WARN_THRESHOLD}.`,
    );
    }

    return {
    ok: errors.length === 0,
    errors,
    warnings,
    ruleCount,
    regexRuleCount,
    };
}

function isPlainObject(v: unknown): boolean {
    return v !== null && typeof v === 'object' && !Array.isArray(v);
}
