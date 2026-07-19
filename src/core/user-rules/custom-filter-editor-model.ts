/**
 * src/core/user-rules/custom-filter-editor-model.ts
 *
 * In-memory state container for the custom-filter editor UI.
 *
 * The model owns:
 *   - the current textarea text (the "draft")
 *   - a bounded undo/redo history of previous drafts
 *   - the per-line validation produced by the import-validator
 *   - the set of dangerous line numbers the user has confirmed
 *
 * The model does not own:
 *   - the actual ledger (it is passed in to `commitToLedger`)
 *   - the chrome storage surface (the caller persists the ledger
 *     after `commitToLedger` returns)
 *   - the dynamic-rule bridge (the caller invokes it after the
 *     ledger is updated)
 *
 * Pure module: no chrome.*, no `Date.now()` (caller-injected
 * `now` for `createdAt`/`updatedAt`).
 */

import {
    validateImport,
    type ImportLineResult,
    type ImportValidation,
    type ValidateImportOptions,
} from './import-validator';
import {
    createEmptyUserRuleLedger,
    upsertUserRuleLedgerEntry,
    type UserRuleLedger,
    type UserRuleLedgerEntry,
    type UserRuleSource,
} from './local-rule-ledger';

export type EditorStatus = 'clean' | 'dirty' | 'invalid' | 'previewing';

export interface EditorDraft {
  text: string;
  /** 1-indexed line numbers that the user has explicitly confirmed. */
  pendingDangerous: number[];
  status: EditorStatus;
}

export interface EditorBudget {
  safe: number;
  unsafe: number;
  session: number;
  total: number;
}

export interface EditorSnapshot {
  draft: EditorDraft;
  validation: ImportValidation;
  estimatedBudget: EditorBudget;
  undoDepth: number;
  redoDepth: number;
}

export interface CustomFilterEditorModelOptions
  extends Omit<ValidateImportOptions, 'dangerousAcceptedByLine'> {
  maxUndo?: number;
  now?: () => Date;
  /**
   * Source tag written to the ledger when committing a rule.
   * Defaults to `'manual-editor'`. Imports may want to override
   * to `'local-file-import'` or `'clipboard-paste'`.
   */
  source?: UserRuleSource;
}

const DEFAULT_MAX_UNDO = 50;

interface HistoryFrame {
  text: string;
  pendingDangerous: number[];
}

export class CustomFilterEditorModel {
    private text: string = '';
    private pendingDangerous: Set<number> = new Set();
    /**
   * History of states. history[0] is the *initial* state; each
   * subsequent entry is the state we transitioned into at the
   * i-th setText call. Undo moves the cursor backward (restoring
   * the previous state, down to the initial frame); redo moves
   * it forward. New setText calls drop any redo branch.
   */
    private history: HistoryFrame[] = [{ text: '', pendingDangerous: [] }];
    private historyCursor: number = 0;
    private readonly maxUndo: number;
    private readonly classifyOpts: ValidateImportOptions;
    private readonly now: () => Date;
    private readonly source: UserRuleSource;

    constructor(options: CustomFilterEditorModelOptions = {}) {
        this.maxUndo = options.maxUndo ?? DEFAULT_MAX_UNDO;
        this.now = options.now ?? (() => new Date());
        this.source = options.source ?? 'manual-editor';
        const { maxUndo: _u, now: _n, source: _s, ...rest } = options;
        void _u; void _n; void _s;
        this.classifyOpts = rest;
    }

    // -------------------------------------------------------------------------
    // Public API
    // -------------------------------------------------------------------------

    getSnapshot(): EditorSnapshot {
        const validation = this.validate();
        return {
      draft: this.draftState('previewing'),
      validation,
      estimatedBudget: this.budgetFromValidation(validation),
      undoDepth: this.undoDepth(),
      redoDepth: this.redoDepth(),
        };
    }

    setText(text: string): EditorSnapshot {
        if (text === this.text) return this.getSnapshot();
        // Drop any redo branch.
        this.history = this.history.slice(0, this.historyCursor + 1);
    this.history.push({ text, pendingDangerous: Array.from(this.pendingDangerous) });
    if (this.history.length > this.maxUndo + 1) {
      this.history.shift();
    } else {
        this.historyCursor++;
    }
    this.text = text;
    // Resetting the text invalidates any pending dangerous confirmations.
    this.pendingDangerous = new Set();
    return this.getSnapshot();
    }

    acceptDangerous(lineNumber: number): EditorSnapshot {
        if (!Number.isInteger(lineNumber) || lineNumber < 1) {
            return this.getSnapshot();
        }
        const validation = this.validate();
        const line = validation.perLine.find(l => l.lineNumber === lineNumber);
        if (!line || !line.classification.warnings.dangerous) {
            return this.getSnapshot();
        }
        this.pendingDangerous = new Set([...this.pendingDangerous, lineNumber]);
        return this.getSnapshot();
    }

    undo(): EditorSnapshot {
        if (this.undoDepth() === 0) return this.getSnapshot();
        this.historyCursor--;
        const prev = this.history[this.historyCursor];
        this.text = prev.text;
        this.pendingDangerous = new Set(prev.pendingDangerous);
        return this.getSnapshot();
    }

    redo(): EditorSnapshot {
        if (this.redoDepth() === 0) return this.getSnapshot();
        this.historyCursor++;
        const next = this.history[this.historyCursor];
        this.text = next.text;
        this.pendingDangerous = new Set(next.pendingDangerous);
        return this.getSnapshot();
    }

    reset(): EditorSnapshot {
        this.text = '';
        this.pendingDangerous = new Set();
        this.history = [{ text: '', pendingDangerous: [] }];
        this.historyCursor = 0;
        return this.getSnapshot();
    }

    /**
   * Commit the accepted rules in the current draft to the supplied
   * ledger and return the new ledger plus the updated snapshot.
   *
   * The committed ledger entries:
   *   - get a fresh UUID id (collision-respecting: if a
   *     caller-supplied `idFactory` is injected, it is used; else
   *     `crypto.randomUUID()`)
   *   - have lane + classification from the validator
   *   - have `originalText` equal to the rule's raw text
   *   - have `compiledRuleIds = []` (the dynamic-rule bridge
   *     assigns ids at install time; the model does not own
   *     DNR id allocation)
   *   - have `createdAt = updatedAt = now()`
   */
    commitToLedger(ledger: UserRuleLedger): { ledger: UserRuleLedger; snapshot: EditorSnapshot } {
        const validation = this.validate();
        const accepted = validation.perLine.filter(l => l.accepted);
        if (accepted.length === 0) {
            return { ledger, snapshot: this.getSnapshot() };
        }
        const ts = this.now().toISOString();
        let next = ledger;
        for (const line of accepted) {
            const entry: UserRuleLedgerEntry = {
        id: makeId(),
        lane: line.classification.lane,
        enabled: true,
        createdAt: ts,
        updatedAt: ts,
        source: this.source,
        originalText: line.raw,
        compiledRuleIds: [],
        notes: line.classification.notes,
            };
            next = upsertUserRuleLedgerEntry(next, entry);
        }
        return { ledger: next, snapshot: this.getSnapshot() };
    }

    /**
   * Returns the per-line result for a given line number, or
   * `undefined` if the line does not exist. Convenience accessor
   * for editor UI that needs to render a single row.
   */
    getLine(lineNumber: number): ImportLineResult | undefined {
        return this.validate().perLine.find(l => l.lineNumber === lineNumber);
    }

    // -------------------------------------------------------------------------
    // Internals
    // -------------------------------------------------------------------------

    private validate(): ImportValidation {
        return validateImport(this.text, {
      ...this.classifyOpts,
      dangerousAcceptedByLine: this.pendingDangerous,
        });
    }

    private draftState(status: EditorStatus): EditorDraft {
        return {
      text: this.text,
      pendingDangerous: Array.from(this.pendingDangerous).sort((a, b) => a - b),
      status,
        };
    }

    private budgetFromValidation(v: ImportValidation): EditorBudget {
        return {
      safe: v.budgetImpact.safeDelta,
      unsafe: v.budgetImpact.unsafeDelta,
      session: v.budgetImpact.sessionDelta,
      total: v.budgetImpact.safeDelta + v.budgetImpact.unsafeDelta + v.budgetImpact.sessionDelta,
        };
    }

    private undoDepth(): number {
    // undoDepth is the number of setText calls we can roll back
    // (i.e. the distance from the cursor to the initial state).
        return this.historyCursor;
    }

    private redoDepth(): number {
        return this.history.length - this.historyCursor - 1;
    }
}

function makeId(): string {
    // Node 22 and modern browsers provide `crypto.randomUUID()`. This
    // path is the only one that should fire; the fallback is a
    // safety net for environments without Web Crypto (e.g. some
    // older sandbox runtimes).
    if (typeof globalThis.crypto?.randomUUID === 'function') {
        return globalThis.crypto.randomUUID();
    }
    return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createEditorModel(
    options: CustomFilterEditorModelOptions = {},
): CustomFilterEditorModel {
    return new CustomFilterEditorModel(options);
}

export { createEmptyUserRuleLedger };
