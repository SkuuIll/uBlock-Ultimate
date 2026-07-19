import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

interface DnrRule {
    id: number;
    action: {
        type: string;
        redirect?: {
            transform?: {
                queryTransform?: {
                    removeParams?: string[];
                };
            };
        };
    };
    condition: {
        domainType?: string;
        regexFilter?: string;
    };
}

function readRuleset(name: string): DnrRule[] {
    return JSON.parse(readFileSync(
        resolve(import.meta.dirname, `../src/extension/dnr/${name}.rules.json`),
        'utf8',
    )) as DnrRule[];
}

describe('optional packaged protections', () => {
    it('removes only an explicit set of campaign parameters', () => {
        const [rule] = readRuleset('privacy-url-cleanup');
        expect(rule.action.type).toBe('redirect');
        expect(rule.condition.regexFilter).toMatch(/utm_/);
        expect(rule.action.redirect?.transform?.queryTransform?.removeParams)
            .toEqual(expect.arrayContaining([
                'utm_source',
                'utm_campaign',
                'fbclid',
                'gclid',
                'msclkid',
            ]));
    });

    it('keeps social tracking blocks third-party scoped', () => {
        const rules = readRuleset('privacy-social-trackers');
        expect(rules).toHaveLength(7);
        expect(rules.every(rule => rule.action.type === 'block')).toBe(true);
        expect(rules.every(rule => rule.condition.domainType === 'thirdParty'))
            .toBe(true);
        expect(new Set(rules.map(rule => rule.id)).size).toBe(rules.length);
    });
});
