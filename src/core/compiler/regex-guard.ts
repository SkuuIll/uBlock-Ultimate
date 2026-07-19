/**
 * src/core/compiler/regex-guard.ts
 *
 * Validates a regex pattern for use with declarativeNetRequest.
 * Combines a size estimate (regex-size-estimator) with a syntax
 * check and an optional runtime probe.
 */

import {
    estimateRegexCompiledSize,
} from './regex-size-estimator';

export interface RegexGuardResult {
  ok: boolean;
  estimatedBytes: number;
  reason: string;
  warnings: string[];
}

export interface RegexSupportProbe {
  isRegexSupported?: (
    _pattern: string,
    _isCaseSensitive?: boolean,
  ) => Promise<boolean>;
}

export interface RegexGuardOptions {
  isCaseSensitive?: boolean;
  probe?: RegexSupportProbe;
  maxEstimatedBytes?: number;
}

const DEFAULT_MAX_ESTIMATED_BYTES = 2048;

export async function validateRegexForDnr(
    pattern: string,
    options: RegexGuardOptions = {},
): Promise<RegexGuardResult> {
    const maxEstimatedBytes = options.maxEstimatedBytes ?? DEFAULT_MAX_ESTIMATED_BYTES;

    if (typeof pattern !== 'string' || pattern.length === 0) {
        return {
      ok: false,
      estimatedBytes: 0,
      reason: 'Pattern is empty.',
      warnings: [],
        };
    }

    // JavaScript syntax check.
    try {
        new RegExp(pattern);
    } catch (err) {
    console.warn('[uBR] regex-guard: invalid regex syntax', pattern, err);
    return {
      ok: false,
      estimatedBytes: 0,
      reason: `Invalid regex syntax: ${(err as Error).message}`,
      warnings: [],
    };
    }

    // Size estimate check.
    const estimate = estimateRegexCompiledSize(pattern);
    if (estimate.estimatedBytes > maxEstimatedBytes) {
        return {
      ok: false,
      estimatedBytes: estimate.estimatedBytes,
      reason: `Estimated compiled size ${estimate.estimatedBytes} exceeds limit ${maxEstimatedBytes}.`,
      warnings: estimate.reasons,
        };
    }

    // Optional runtime probe.
    if (options.probe && typeof options.probe.isRegexSupported === 'function') {
        try {
            const result = await options.probe.isRegexSupported(
                pattern,
        options.isCaseSensitive,
            );
            const isSupported = typeof result === 'boolean' ? result : result?.isSupported === true;
            if (isSupported === false) {
                return {
          ok: false,
          estimatedBytes: estimate.estimatedBytes,
          reason: 'Probe reported the pattern is not supported.',
          warnings: estimate.reasons,
                };
            }
        } catch (err) {
      console.warn('[uBR] regex-guard: probe isRegexSupported threw', pattern, err);
      return {
        ok: false,
        estimatedBytes: estimate.estimatedBytes,
        reason: `Probe threw: ${(err as Error).message}`,
        warnings: estimate.reasons,
      };
        }
    }

    return {
    ok: true,
    estimatedBytes: estimate.estimatedBytes,
    reason: 'Pattern accepted.',
    warnings: estimate.reasons,
    };
}
