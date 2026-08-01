/**
 * Step.js — Base class for one wizard screen.
 *
 * A subclass owns exactly one step element and everything inside it: it looks
 * its elements up in the constructor, attaches its own listeners there, and
 * overrides the hooks below. Instances are handed to `createFlow` directly, so
 * this class *is* the step descriptor the step machine consumes — there is no
 * adapter and no plain-object intermediate.
 *
 * **A step must not read a sibling step during its own construction.** The flow
 * builds its steps one after another and assigns each to a named field as it
 * goes, so `this.owner.<siblingStep>` is `undefined` until every constructor has
 * returned. Reading one from a constructor works or breaks purely on declaration
 * order. Cross-step calls belong in `onEnter`, in `reset`, or in a listener —
 * anywhere that runs after construction. `this.owner` itself is safe to capture;
 * it is only its step fields that fill in late.
 *
 * **The same rule holds one level up, in `Wizard`.** It constructs the shell
 * screens and both flows, hands each of them `this`, and lets them reach its
 * named fields at event time. So `wizard.mode` is `undefined` for the few
 * statements between the flows being built and the screens being built, and is
 * then assigned exactly once. That is what keeps every one of those fields
 * non-nullable — `ModeScreen`, never `ModeScreen | null` — and it holds only for
 * as long as no constructor reads a sibling. Every navigation edge in the app
 * fires from an event handler, so none of them do.
 *
 * **A sub-component borrows its owner's signal; it does not own a controller.**
 * A screen large enough to split — a banner, a dialog set, a table — is still
 * part of the step, and lives and dies with it. So it takes
 * `owner.listeners.signal` and passes that to its own `addEventListener` calls,
 * and needs no `destroy()` of its own. There is deliberately no cascade and no
 * child registry: a component that owned a controller would have to be chained
 * to from the owner's `destroy()`, and forgetting that chain fails silently —
 * the step goes quiet while the component keeps listening. Borrowing removes the
 * rule instead of automating it.
 *
 * There are two lifetime scopes a component can borrow from: the step, which
 * always has a controller, and the flow assembler, which creates one when it
 * owns a component directly (`NickelMenuFlow` does, for its dialogs) and
 * otherwise does not need one. A component whose lifetime is genuinely shorter
 * than its owner's is the one case that needs its own controller, and then the
 * owner has to abort it explicitly at the point the lifetime actually ends.
 * Nothing in the app is that shape today.
 */

export class Step {
    /**
     * `navIndex` and `navLabels` may be a plain value, a constructor-assigned
     * function, or a prototype method — the step machine reads and calls them in
     * one expression, so `this` binds either way. They were constructor-only
     * until Phase 6, because the machine read them into a local first and a
     * prototype method lost `this`; that was a rule which failed silently when
     * forgotten, so the machine was fixed rather than the rule restated. The
     * existing fields were left alone: changing them is churn with no gain.
     *
     * Omitting both is meaningful — the step machine leaves the breadcrumb
     * untouched, which is what the transient build screen relies on.
     *
     * @param {object} owner - the flow assembler that constructed this step
     * @param {object} config
     * @param {string} config.id - flow-local id used by `flow.go`
     * @param {string} config.domId - id of this step's element in the markup
     * @param {number | ((ctx: object) => number)} [config.navIndex]
     * @param {string[] | ((ctx: object) => string[])} [config.navLabels]
     * @param {boolean} [config.transient] - kept out of the back-stack
     * @param {string} [config.recoveryStep] - step id to return to after an error
     */
    constructor(owner, { id, domId, navIndex = undefined, navLabels = undefined, transient = false, recoveryStep = undefined }) {
        this.owner = owner;
        this.id = id;
        this.domId = domId;
        this.navIndex = navIndex;
        this.navLabels = navLabels;
        this.transient = transient;
        this.recoveryStep = recoveryStep;

        // Every listener a subclass attaches must take `{ signal: this.listeners.signal }`,
        // so `destroy()` can take them all off again. A step wires listeners onto
        // elements that outlive it — the markup is static and shared — so
        // constructing a second step without discarding the first leaves both
        // sets attached, and one user gesture then runs handlers bound to two
        // different sessions. The app builds each step once and never tears it
        // down, so this costs nothing there; it exists because anything that
        // constructs a step more than once (tests today, a future flow restart)
        // otherwise has no way to undo the wiring.
        this.listeners = new AbortController();
    }

    /** The shared wizard session. */
    get session() {
        return this.owner.session;
    }

    /** The wizard, for cross-flow navigation and `showError`. */
    get nav() {
        return this.owner.nav;
    }

    /**
     * Runs every time this step becomes visible, including on back-navigation,
     * so it must be idempotent.
     *
     * The base implementation ignores its argument; the `_` prefix is the
     * project's eslint convention for that (`argsIgnorePattern`).
     *
     * @param {object} _ctx - the session the step machine was navigated with
     */
    async onEnter(_ctx) {}

    /**
     * Explicit back target that overrides the history stack. Returning `null`
     * falls through to the history pop, which is what a step with no `back` did
     * before this class existed.
     *
     * @param {object} _ctx - the session the step machine was navigated with
     * @returns {string | null} a step id, or null to use history
     */
    back(_ctx) {
        return null;
    }

    /** Return this screen's DOM to its initial state. */
    reset() {}

    /**
     * Detach every listener this step attached. After this the instance is done:
     * the step machine must not navigate to it again.
     */
    destroy() {
        this.listeners.abort();
    }
}
