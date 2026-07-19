/**
 * src/core/compiler/unsupported-syntax-report.ts
 *
 * Static knowledge table describing uBlock filter syntax that is
 * not fully supported (or supported only in limited form) by the
 * current DNR-based blocker.
 *
 * The report is generated synchronously and contains no network
 * access. It accepts an optional `Date` so tests can be
 * deterministic.
 */

export type UnsupportedSyntaxStatus =
  | 'UNSUPPORTED_RECOGNIZED'
  | 'LIMITED_SUPPORTED'
  | 'SUPPORTED';

export interface UnsupportedSyntaxEntry {
  token: string;
  status: UnsupportedSyntaxStatus;
  reason: string;
  replacement?: string;
}

export interface UnsupportedSyntaxReport {
  generatedAt: string;
  entries: UnsupportedSyntaxEntry[];
}

export function getKnownUnsupportedSyntaxEntries(): UnsupportedSyntaxEntry[] {
    return [
    {
      token: '$replace',
      status: 'UNSUPPORTED_RECOGNIZED',
      reason: 'Response-body rewriting is not available in DNR.',
      replacement: 'Use a content-script cosmetic override.',
    },
    {
      token: '$csp',
      status: 'UNSUPPORTED_RECOGNIZED',
      reason: 'Per-response CSP injection is not available in DNR.',
    },
    {
      token: '$removeparam (static-key)',
      status: 'LIMITED_SUPPORTED',
      reason:
        'Static-key removeparam works only when the key is a literal string with no regex/value form.',
    },
    {
      token: '$removeparam (regex/value-based)',
      status: 'UNSUPPORTED_RECOGNIZED',
      reason: 'Regex- or value-based removeparam is not supported by DNR.',
    },
    {
      token: '$redirect (arbitrary)',
      status: 'UNSUPPORTED_RECOGNIZED',
      reason: 'Arbitrary redirect targets are not supported in DNR.',
    },
    {
      token: '$redirect (packaged extensionPath)',
      status: 'LIMITED_SUPPORTED',
      reason:
        'Redirect to an extensionPath resource is supported only for packaged resources declared in the manifest.',
    },
    {
      token: 'scriptlet injection',
      status: 'UNSUPPORTED_RECOGNIZED',
      reason: 'Scriptlet injection is not available in this V1 build.',
    },
    {
      token: 'unsupported procedural cosmetic syntax',
      status: 'UNSUPPORTED_RECOGNIZED',
      reason: 'Procedural cosmetic filters are not supported in V1.',
    },
    {
      token: '$popup',
      status: 'UNSUPPORTED_RECOGNIZED',
      reason:
        'Popup blocking via the tabs API is not implemented in this foundation PR.',
    },
    ];
}

export function createUnsupportedSyntaxReport(now?: Date): UnsupportedSyntaxReport {
    const d = now instanceof Date && !Number.isNaN(now.getTime())
        ? now
        : new Date();
    return {
    generatedAt: d.toISOString(),
    entries: getKnownUnsupportedSyntaxEntries(),
    };
}
