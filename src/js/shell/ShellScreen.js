/**
 * ShellScreen.js — Base class for a screen the step machine does not own.
 *
 * The six shell screens — connect, connect instructions, device, manual version,
 * mode, error — are shown with `showStep()` from `navigation.js`, not with
 * `flow.go()`. They have no step id, no breadcrumb index of their own, no
 * `onEnter`, no back target and no recovery step, because nothing consumes
 * those: `step-machine.js`'s `SHELL_STEP_IDS` lists their DOM ids only so a flow
 * transition hides them. It is a hide-list, not a step registry.
 *
 * So this is a **sibling** of `Step`, not a subclass. A shell screen carrying
 * `id`/`domId`/`navIndex`/`onEnter` would be claiming the step-machine
 * descriptor contract while never being handed to `createFlow` — under
 * TypeScript it would satisfy the interface and still be unusable as one.
 *
 * The two classes share about four lines (an owner reference, a controller and
 * `destroy()`). That is deliberately not extracted: an inheritance level saving
 * four lines while deepening both hierarchies is the ceremony CONVENTIONS §3
 * warns against.
 *
 * The listener-lifetime rule is the one `Step`'s JSDoc documents, and that is
 * where it is written down: this class owns one `AbortController`, sub-components
 * borrow its signal, and nothing else owns a controller.
 */

import { requireElement } from './dom.js';
import { showStep } from './navigation.js';

export class ShellScreen {
    /**
     * @param {import('../Wizard.js').Wizard} nav - the wizard, for navigation and `showError`
     * @param {string} domId - the id of this screen's element in the markup
     */
    constructor(nav, domId) {
        this.nav = nav;
        this.root = requireElement(domId);

        // Every listener a subclass attaches must take `{ signal: this.listeners.signal }`.
        // Same reasoning as `Step`: the markup outlives the screen, so a second
        // instance without a teardown leaves both sets attached.
        this.listeners = new AbortController();
    }

    /** The shared wizard session. */
    get session() {
        return this.nav.session;
    }

    /**
     * Make this the visible screen.
     *
     * Deliberately does not touch the breadcrumb. Every caller sets
     * `setNavLabels`/`setNavStep` around `showStep` with different values — the
     * mode screen's Back sets step 1 then shows connect *or* device,
     * `goToModeSelection` sets `NAV_DEFAULT` and step 2, and `showError` calls
     * `hideNav()` first. Folding a default in here would change one of them, so
     * each screen's entry method keeps its own calls in its own order.
     *
     * @param {boolean} [push] - false for transient screens that skip the back-stack
     */
    show(push = true) {
        showStep(this.root, push);
    }

    /**
     * Detach every listener this screen attached. After this the instance is
     * done: nothing may navigate to it again.
     */
    destroy() {
        this.listeners.abort();
    }
}
