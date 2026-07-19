/**
 * src/mv3/static-ruleset-packager.ts
 *
 * Pure-Node helper that writes a StaticRulesetArtifact to disk
 * under a target base directory. Layout:
 *
 *   <baseDir>/<rulesetId>.rules.json
 *   <baseDir>/<rulesetId>.source-map.json
 *   <baseDir>/<rulesetId>.unsupported.json
 *   <baseDir>/<rulesetId>.budget.json
 *
 * All writes are atomic (write to <file>.tmp, then rename).
 *
 * No Chrome API calls.
 */

import { renameSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { StaticRulesetArtifact } from '../core/compiler/static-ruleset-compiler';

export interface WriteStaticRulesetOptions {
  baseDir?: string;
  /** Pretty-print JSON output. Default: true. */
  pretty?: boolean;
}

export interface WriteStaticRulesetResult {
  rulesetId: string;
  rulesPath: string;
  sourceMapPath: string;
  unsupportedPath: string;
  budgetPath: string;
}

/**
 * Default base directory for static ruleset artifacts. Lives
 * inside the chrome platform dir so the manifest can reference
 * the artifacts with a clean relative path (Chrome rejects
 * `..` in `declarative_net_request.rule_resources[].path`).
 */
const DEFAULT_BASE_DIR = 'platform/chromium/dnr';

export function writeStaticRulesetArtifact(
    artifact: StaticRulesetArtifact,
    options: WriteStaticRulesetOptions = {},
): WriteStaticRulesetResult {
    const baseDir = resolve(options.baseDir ?? DEFAULT_BASE_DIR);
    if (!existsSync(baseDir)) {
        mkdirSync(baseDir, { recursive: true });
    }
    const pretty = options.pretty !== false;
    const indent = pretty ? 2 : 0;
    const newline = pretty ? '\n' : '';

    const rulesPath = join(baseDir, `${artifact.rulesetId}.rules.json`);
    const sourceMapPath = join(baseDir, `${artifact.rulesetId}.source-map.json`);
    const unsupportedPath = join(baseDir, `${artifact.rulesetId}.unsupported.json`);
    const budgetPath = join(baseDir, `${artifact.rulesetId}.budget.json`);

    const sourceMapPayload = {
    rulesetId: artifact.rulesetId,
    sourceList: artifact.sourceList,
    entries: artifact.sourceMap,
    };
    const unsupportedPayload = artifact.unsupported;
    const budgetPayload = artifact.budget;

    writeJsonAtomic(rulesPath, JSON.stringify(artifact.rules, null, indent) + newline);
    writeJsonAtomic(sourceMapPath, JSON.stringify(sourceMapPayload, null, indent) + newline);
    writeJsonAtomic(unsupportedPath, JSON.stringify(unsupportedPayload, null, indent) + newline);
    writeJsonAtomic(budgetPath, JSON.stringify(budgetPayload, null, indent) + newline);

    return {
    rulesetId: artifact.rulesetId,
    rulesPath,
    sourceMapPath,
    unsupportedPath,
    budgetPath,
    };
}

function writeJsonAtomic(targetPath: string, body: string): void {
    const tmp = `${targetPath}.tmp`;
    writeFileSync(tmp, body, 'utf8');
    renameSync(tmp, targetPath);
}
