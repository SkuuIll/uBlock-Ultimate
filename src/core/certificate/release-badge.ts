/**
 * Release badge.
 *
 * Maps a Certificate to one of four badge levels:
 *   - gold:    all required claims pass AND optional claims (corpus) pass
 *   - silver:  all required claims pass (no corpus)
 *   - bronze:  functional, but not public-superiority-claim eligible
 *   - none:    no required claims pass
 *
 * The plan-strict definition (Rev15 §15.5):
 *   - Gold = "Gold means all required gates pass AND the cosmetic corpus
 *     passes (with the corpus score disclosed)"
 *   - Silver = "Silver means all required gates pass but the corpus is
 *     network-only or has not yet been executed"
 *   - Bronze = "Bronze means functional evidence exists, but the build is
 *     not public-superiority-claim eligible"
 *
 * The badge emoji is intentionally text-only (no Unicode emoji) so the
 * README renders correctly in plain-text contexts.
 */

import { Certificate } from './certificate-generator';

export type Badge = 'gold' | 'silver' | 'bronze' | 'none';

export interface BadgeInfo {
    level: Badge;
    label: string;
    description: string;
    glyph: string;
}

export function determineBadge(cert: Certificate): Badge {
    if (cert.badge) {
        return cert.badge.toLowerCase() as Badge;
    }
    const v = cert.validation;
    if (v.failedRequired === 0) {
        // All required pass.
        // Gold = all required + all optional (e.g., corpus) pass.
        // Silver = all required but no optional pass, or an optional claim failed.
        if (v.optionalFailed > 0) {
            return 'silver';
        }
        if (v.optionalPassed > 0) {
            return 'gold';
        }
        return 'silver';
    }
    if (v.passedRequired > 0) {
        return 'bronze';
    }
    return 'none';
}

export function badgeInfo(cert: Certificate): BadgeInfo {
    const level = determineBadge(cert);
    switch (level) {
    case 'gold':
        return {
                level,
                label: 'Gold',
                description: 'All required gates pass and the cosmetic corpus passes.',
                glyph: '[GOLD]',
        };
    case 'silver':
        return {
                level,
                label: 'Silver',
                description: 'All required gates pass; corpus not yet executed or not all optional claims met.',
                glyph: '[SILVER]',
        };
    case 'bronze':
        return {
                level,
                label: 'Bronze',
                description: cert.validation.failedRequired === 0
                    ? 'All gates pass, but the comparator or browser profile is not pinned for a public superiority claim.'
                    : 'Some required gates pass; this is a partial build.',
                glyph: '[BRONZE]',
        };
    case 'none':
    default:
        return {
                level,
                label: 'None',
                description: 'No required gates pass; this build is not certified.',
                glyph: '[NONE]',
        };
    }
}

/**
 * Returns a one-line summary suitable for inclusion in release notes or
 * the README badge row.
 */
export function badgeSummary(cert: Certificate): string {
    const b = badgeInfo(cert);
    return `${b.glyph} ${b.label}: ${b.description}`;
}
