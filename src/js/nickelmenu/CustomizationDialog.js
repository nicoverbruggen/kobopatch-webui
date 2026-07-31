/**
 * CustomizationDialog.js — Base class for a feature's "customize" dialog.
 *
 * Owns the mechanics every one of them repeats: trapping focus, returning focus
 * to the control that opened the dialog, the modal open/close, the four standard
 * buttons, handing the draft to and from `CustomizationDrafts`, and painting the
 * summary chip in the feature list.
 *
 * **It owns no feature behavior.** What fields a dialog has, what it validates,
 * how it previews and what its summary says all live in the subclass, inside
 * that feature's own directory (`AGENTS.md` line 11). Adding a fourth
 * customizable feature must not require editing this file — if this class ever
 * grows an `if (type === …)`, the design has failed.
 *
 * Lifetime: a sub-component in the sense `Step` describes. It is *given* a
 * signal and owns no `AbortController`.
 */

import { requireButton, requireDialog, requireElement, trapFocus, $ } from '../shell/dom.js';

export class CustomizationDialog {
    /**
     * @param {object} config
     * @param {string} config.type - registry key, matching the feature's `customization.type`
     * @param {string} config.dialogId
     * @param {string} config.statusId - the dialog's status line
     * @param {string} config.closeId
     * @param {string} config.cancelId
     * @param {string} config.resetId
     * @param {string} config.saveId
     * @param {string} config.summaryContainerId - id of the chip container in the feature list
     * @param {import('../flows/nickelmenu/NickelMenuSelection.js').NickelMenuSelection} config.selection
     * @param {import('../flows/nickelmenu/CustomizationDrafts.js').CustomizationDrafts} config.drafts
     * @param {AbortSignal} config.signal - the owner's signal; see `Step`
     */
    constructor(config) {
        const { type, dialogId, statusId, closeId, cancelId, resetId, saveId, summaryContainerId, selection, drafts, signal } = config;
        this.type = type;
        this.summaryContainerId = summaryContainerId;
        this.selection = selection;
        this.drafts = drafts;

        this.dialog = requireDialog(dialogId);
        this.status = requireElement(statusId);
        this.btnClose = requireButton(closeId);
        this.btnCancel = requireButton(cancelId);
        this.btnReset = requireButton(resetId);
        this.btnSave = requireButton(saveId);

        /** @type {HTMLElement|null} the control that opened the dialog, for focus return */
        this.triggerEl = null;

        trapFocus(this.dialog);
        this.dialog.addEventListener(
            'close',
            () => {
                if (this.triggerEl && typeof this.triggerEl.focus === 'function') {
                    this.triggerEl.focus({ preventScroll: true });
                }
            },
            { signal },
        );

        this.btnClose.addEventListener('click', () => this.close(), { signal });
        this.btnCancel.addEventListener('click', () => this.close(), { signal });
        this.btnReset.addEventListener('click', () => this.reset(), { signal });
        this.btnSave.addEventListener('click', () => this.save(), { signal });

        // The base owns the order: elements first, then listeners. Both run
        // inside `super()`, which is why a subclass constructor is nothing but a
        // `super()` call — a field assigned after it would not exist yet for
        // `wire()`. Anything else a subclass needs arrives through `config`.
        this.bindElements(config);
        this.wire(signal);
    }

    /**
     * Look up this dialog's own elements and store any extra configuration.
     * Called during construction, before `wire()`.
     *
     * @param {object} _config - the same config object the constructor received
     */
    bindElements(_config) {}

    // ---- the subclass contract ----

    /**
     * Fill this dialog's inputs from `customization` and return a matching draft.
     * Called on open and on reset, so it must not call `showModal()`.
     *
     * @param {object} _customization
     * @returns {object} the new draft
     */
    seed(_customization) {
        throw new Error(`${this.constructor.name} must implement seed()`);
    }

    /** Move focus into the dialog once it is open. */
    focusInitial() {
        throw new Error(`${this.constructor.name} must implement focusInitial()`);
    }

    /** This feature's default customization. */
    createDefault() {
        throw new Error(`${this.constructor.name} must implement createDefault()`);
    }

    /**
     * The chip content for a customization.
     *
     * @param {object} _customization
     * @returns {{label: string, iconHtml?: string, iconSrc?: string}}
     */
    summary(_customization) {
        throw new Error(`${this.constructor.name} must implement summary()`);
    }

    /**
     * The value to commit on save, or `null` to refuse the save and leave the
     * dialog open. Reads the dialog's own inputs, not just the draft.
     *
     * @returns {object|null}
     */
    commit() {
        throw new Error(`${this.constructor.name} must implement commit()`);
    }

    /** The customization currently committed on the selection. */
    get committed() {
        throw new Error(`${this.constructor.name} must implement get committed`);
    }

    set committed(_value) {
        throw new Error(`${this.constructor.name} must implement set committed`);
    }

    /**
     * This dialog's slot in the shared drafts store.
     *
     * An accessor pair rather than a plain field, so the menu subclass can route
     * its setter through `CustomizationDrafts.setMenu()` and leave the tested
     * generation counter untouched. See `CustomizationDrafts`.
     */
    get draft() {
        throw new Error(`${this.constructor.name} must implement get draft`);
    }

    set draft(_value) {
        throw new Error(`${this.constructor.name} must implement set draft`);
    }

    /**
     * Adopt this feature's slice of a previous on-device configuration.
     *
     * Each dialog gates this differently and that asymmetry is real behavior, so
     * it is a subclass decision rather than a uniform rule applied by the caller.
     *
     * @param {object|null} previous - the previous configuration read off the device
     * @param {Set<string>} previousIds - the feature ids that configuration selected
     */
    adoptPrevious(_previous, _previousIds) {}

    /** Status text after "Reset defaults". */
    resetMessage() {
        return 'Defaults restored.';
    }

    /** Runs after a successful save has been committed, before the chip refresh. */
    afterCommit() {}

    /** Attach the subclass's own input listeners. Called during construction, after `bindElements`. */
    wire(_signal) {}

    // ---- the mechanics the base provides ----

    /**
     * Seed the dialog from what is committed and show it.
     *
     * @param {HTMLElement} triggerEl - the control that opened it, for focus return
     */
    open(triggerEl) {
        this.draft = this.seed(this.committed);
        this.triggerEl = triggerEl;
        this.dialog.showModal();
        this.focusInitial();
    }

    close() {
        this.dialog.close();
    }

    /** Re-seed from this feature's defaults, without reopening the dialog. */
    reset() {
        this.draft = this.seed(this.createDefault());
        this.status.textContent = this.resetMessage();
    }

    /**
     * Commit the draft, refresh the chip, and close.
     *
     * A `commit()` that returns `null` refuses the save and leaves the dialog
     * open — the menu refuses an invalid label, fonts an empty selection.
     */
    save() {
        const value = this.commit();
        if (value === null) return;
        this.committed = value;
        this.afterCommit();
        this.refreshSummaryChip();
        this.close();
    }

    /**
     * Repaint this feature's summary chip in the feature list.
     *
     * A no-op when the chip is not on screen: the feature list is rebuilt from
     * scratch on every render and computes its chips from `summaryItem()`, so
     * there is nothing to repaint until it exists.
     */
    refreshSummaryChip() {
        const container = $(this.summaryContainerId);
        if (!container) return;
        const summary = this.summary(this.committed);
        const icon = container.querySelector('.nm-config-summary-icon');
        const label = container.querySelector('.nm-config-summary-label');

        if (icon) {
            // Cleared first, and `iconHtml` wins over `iconSrc`: the menu sets
            // markup for a preset SVG and a src for an uploaded image, and the
            // other two only ever set markup.
            icon.innerHTML = '';
            if (summary.iconHtml) {
                icon.innerHTML = summary.iconHtml;
            } else if (summary.iconSrc) {
                const img = document.createElement('img');
                img.alt = '';
                img.src = summary.iconSrc;
                icon.appendChild(img);
            }
        }

        if (label) label.textContent = summary.label;
    }

    /** The chip fields `renderNmCheckboxList` spreads into this feature's row. */
    summaryItem() {
        const summary = this.summary(this.committed);
        return {
            summaryId: this.summaryContainerId,
            summaryLabel: summary.label,
            summaryIconHtml: summary.iconHtml,
            summaryIconSrc: summary.iconSrc,
        };
    }
}
