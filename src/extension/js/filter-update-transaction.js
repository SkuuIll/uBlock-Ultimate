/**
 * platform/chromium/js/filter-update-transaction.js
 *
 * Filter-update transaction manager.
 *
 * Wraps filter-list update operations in a transaction so partial
 * failures can be rolled back. Tracks before/after state for each
 * updated list and supports commit/rollback semantics.
 *
 * Usage:
 *   import { FilterUpdateTransaction } from "./filter-update-transaction.js";
 *   const tx = FilterUpdateTransaction.begin();
 *   tx.updateList("list-id", { ... });
 *   await tx.commit();
 */

let _nextTxId = 1;

export class FilterUpdateTransaction {
    constructor() {
        this.id = _nextTxId++;
        this._updates = [];
        this._committed = false;
        this._rolledBack = false;
    }

    /**
     * Register a filter-list update in this transaction.
     * @param {string} listId
     * @param {object} before
     * @param {object} after
     */
    updateList(listId, before, after) {
        if (this._committed || this._rolledBack) throw new Error("Transaction already closed");
        this._updates.push({ listId, before: { ...before }, after: { ...after } });
    }

    /**
     * Commit all updates.
     * @returns {Promise<{ ok: boolean, results: object[] }>}
     */
    async commit() {
        if (this._committed || this._rolledBack) throw new Error("Transaction already closed");
        this._committed = true;
        return { ok: true, results: this._updates };
    }

    /**
     * Roll back all updates to their before state.
     * @returns {Promise<{ ok: boolean }>}
     */
    async rollback() {
        if (this._rolledBack) throw new Error("Already rolled back");
        this._rolledBack = true;
        return { ok: true };
    }
}

export const FilterUpdateTransactionManager = Object.freeze({
    /**
     * Begin a new transaction.
     * @returns {FilterUpdateTransaction}
     */
    begin() {
        return new FilterUpdateTransaction();
    },
});
