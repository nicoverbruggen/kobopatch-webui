import './dom-harness.js'; // for the patched <dialog> and the real document

import test from 'node:test';
import assert from 'node:assert/strict';

import { CustomizationDialog } from '../../src/js/nickelmenu/CustomizationDialog.js';

// The base class owns dialog mechanics and no feature behavior, so it is tested
// against a stub subclass on synthetic markup rather than against any of the
// three real dialogs. If a test here needs to know which feature it is looking
// at, the base has grown something that belongs in a subclass.

document.body.insertAdjacentHTML(
    'beforeend',
    `<dialog id="stub-dialog">
        <p id="stub-status"></p>
        <input id="stub-input" type="text">
        <button id="btn-stub-close"></button>
        <button id="btn-stub-cancel"></button>
        <button id="btn-stub-reset"></button>
        <button id="btn-stub-save"></button>
     </dialog>
     <div id="stub-summary"><span class="nm-config-summary-icon"></span><span class="nm-config-summary-label"></span></div>
     <button id="stub-trigger"></button>`,
);

class StubDialog extends CustomizationDialog {
    constructor({ signal, commitValue = { name: 'saved' }, summaryValue = { label: 'chip' } } = {}) {
        super({
            type: 'stub',
            dialogId: 'stub-dialog',
            statusId: 'stub-status',
            closeId: 'btn-stub-close',
            cancelId: 'btn-stub-cancel',
            resetId: 'btn-stub-reset',
            saveId: 'btn-stub-save',
            summaryContainerId: 'stub-summary',
            selection: {},
            drafts: {},
            signal,
        });
        this.commitValue = commitValue;
        this.summaryValue = summaryValue;
        this.seeded = [];
        this.focused = 0;
        this.afterCommitCalls = 0;
        this._draft = null;
        this._committed = { name: 'initial' };
    }

    seed(customization) {
        this.seeded.push(customization);
        return { from: customization };
    }
    focusInitial() {
        this.focused += 1;
    }
    createDefault() {
        return { name: 'default' };
    }
    summary() {
        return this.summaryValue;
    }
    commit() {
        return this.commitValue;
    }
    afterCommit() {
        this.afterCommitCalls += 1;
    }
    get committed() {
        return this._committed;
    }
    set committed(value) {
        this._committed = value;
    }
    get draft() {
        return this._draft;
    }
    set draft(value) {
        this._draft = value;
    }
}

/** Build a stub dialog that is torn down when the test ends. */
function makeDialog(t, options = {}) {
    const listeners = new AbortController();
    t.after(() => listeners.abort());
    return new StubDialog({ signal: listeners.signal, ...options });
}

test('open seeds from what is committed, shows the dialog, and moves focus', (t) => {
    const dialog = makeDialog(t);
    const trigger = document.getElementById('stub-trigger');

    dialog.open(trigger);

    assert.deepEqual(dialog.seeded, [{ name: 'initial' }], 'seeded from the committed value');
    assert.deepEqual(dialog.draft, { from: { name: 'initial' } }, 'the seeded draft is installed');
    assert.equal(dialog.dialog.open, true);
    assert.equal(dialog.focused, 1);
    assert.equal(dialog.triggerEl, trigger);
});

test('closing returns focus to the control that opened the dialog', (t) => {
    const dialog = makeDialog(t);
    const trigger = document.getElementById('stub-trigger');
    const elsewhere = document.getElementById('stub-input');

    dialog.open(trigger);
    elsewhere.focus();
    assert.notEqual(document.activeElement, trigger);

    dialog.close();

    assert.equal(document.activeElement, trigger);
});

test('the close and cancel buttons both close without committing', (t) => {
    for (const buttonId of ['btn-stub-close', 'btn-stub-cancel']) {
        const dialog = makeDialog(t);
        dialog.open(document.getElementById('stub-trigger'));

        document.getElementById(buttonId).dispatchEvent(new window.Event('click'));

        assert.equal(dialog.dialog.open, false, `${buttonId} closes`);
        assert.deepEqual(dialog.committed, { name: 'initial' }, `${buttonId} commits nothing`);
    }
});

test('save commits, runs the post-commit hook, repaints the chip, then closes', (t) => {
    const dialog = makeDialog(t, { summaryValue: { label: 'after save', iconHtml: '<svg id="saved-icon"></svg>' } });
    dialog.open(document.getElementById('stub-trigger'));

    document.getElementById('btn-stub-save').dispatchEvent(new window.Event('click'));

    assert.deepEqual(dialog.committed, { name: 'saved' });
    assert.equal(dialog.afterCommitCalls, 1);
    assert.equal(document.querySelector('#stub-summary .nm-config-summary-label').textContent, 'after save');
    assert.equal(dialog.dialog.open, false);
});

test('a commit that returns null refuses the save and leaves the dialog open', (t) => {
    // The menu refuses an invalid label and fonts an empty selection. The base
    // must not commit, must not close, and must not touch the chip.
    const dialog = makeDialog(t, { commitValue: null });
    dialog.open(document.getElementById('stub-trigger'));
    document.querySelector('#stub-summary .nm-config-summary-label').textContent = 'untouched';

    document.getElementById('btn-stub-save').dispatchEvent(new window.Event('click'));

    assert.deepEqual(dialog.committed, { name: 'initial' }, 'nothing was committed');
    assert.equal(dialog.afterCommitCalls, 0, 'the post-commit hook did not run');
    assert.equal(dialog.dialog.open, true, 'the dialog stays open so the user can fix it');
    assert.equal(document.querySelector('#stub-summary .nm-config-summary-label').textContent, 'untouched');
});

test('reset re-seeds from the defaults and writes the reset message, without reopening', (t) => {
    const dialog = makeDialog(t);
    dialog.open(document.getElementById('stub-trigger'));
    dialog.seeded.length = 0;

    document.getElementById('btn-stub-reset').dispatchEvent(new window.Event('click'));

    assert.deepEqual(dialog.seeded, [{ name: 'default' }]);
    assert.equal(dialog.status.textContent, 'Defaults restored.');
    assert.equal(dialog.dialog.open, true, 'reset must not reopen an already-open dialog');
    assert.equal(dialog.focused, 1, 'and must not move focus again');
});

test('the chip prefers iconHtml over iconSrc and clears the icon first', (t) => {
    const dialog = makeDialog(t);
    const icon = document.querySelector('#stub-summary .nm-config-summary-icon');
    icon.innerHTML = '<span id="stale">stale</span>';

    dialog.summaryValue = { label: 'both', iconHtml: '<svg id="wins"></svg>', iconSrc: 'should-not-be-used.png' };
    dialog.refreshSummaryChip();

    assert.equal(icon.querySelector('#stale'), null, 'the previous icon is cleared');
    assert.ok(icon.querySelector('#wins'), 'iconHtml wins');
    assert.equal(icon.querySelector('img'), null, 'iconSrc is not used when iconHtml is present');
});

test('the chip falls back to iconSrc as an image', (t) => {
    const dialog = makeDialog(t);
    const icon = document.querySelector('#stub-summary .nm-config-summary-icon');

    dialog.summaryValue = { label: 'src only', iconSrc: 'icon.png' };
    dialog.refreshSummaryChip();

    const img = icon.querySelector('img');
    assert.ok(img);
    assert.match(img.src, /icon\.png$/);
    assert.equal(img.alt, '');
});

test('refreshing the chip is a no-op when the feature list has not rendered it', (t) => {
    const dialog = makeDialog(t);
    dialog.summaryContainerId = 'not-in-the-document';

    assert.doesNotThrow(() => dialog.refreshSummaryChip());
});

test('summaryItem carries the container id so the feature row can mint it', (t) => {
    const dialog = makeDialog(t, { summaryValue: { label: '3 things', iconHtml: '<svg/>' } });

    assert.deepEqual(dialog.summaryItem(), {
        summaryId: 'stub-summary',
        summaryLabel: '3 things',
        summaryIconHtml: '<svg/>',
        summaryIconSrc: undefined,
    });
});

test('the base refuses to guess: every contract method throws until overridden', () => {
    // A subclass that forgets one of these fails loudly at the first use rather
    // than silently doing nothing.
    const bare = Object.create(CustomizationDialog.prototype);
    for (const method of ['seed', 'focusInitial', 'createDefault', 'summary', 'commit']) {
        assert.throws(() => bare[method](), /must implement/, `${method} must throw in the base`);
    }
    assert.throws(() => bare.committed, /must implement/);
    assert.throws(() => bare.draft, /must implement/);
});

test('a destroyed scope detaches the dialog buttons', (t) => {
    // Dialogs are given a signal and own no controller, per `Step`'s lifetime rule.
    const listeners = new AbortController();
    const dialog = new StubDialog({ signal: listeners.signal });
    t.after(() => listeners.abort());
    dialog.open(document.getElementById('stub-trigger'));

    listeners.abort();
    document.getElementById('btn-stub-close').dispatchEvent(new window.Event('click'));

    assert.equal(dialog.dialog.open, true, 'the listener should have gone with the scope');
});
