import './dom-harness.js'; // must come first: installs the DOM the modules read at import time
import test from 'node:test';
import assert from 'node:assert/strict';

import { createFlow } from '../../src/js/shell/StepMachine.js';
import { historyIncludes, resetHistory, showStep, unwindHistoryTo } from '../../src/js/shell/Navigation.js';

const ctx = {};

const activated = [];
function makeFlow() {
    return createFlow({
        id: 'test',
        onActivate: (flow) => activated.push(flow),
        steps: [
            { id: 'a', domId: 'step-patches', navIndex: 1, navLabels: ['One', 'Two', 'Three'], recoveryStep: 'a' },
            { id: 'b', domId: 'step-firmware', navIndex: 2, back: () => 'a' },
            { id: 'building', domId: 'step-building', transient: true, recoveryStep: 'a' },
            { id: 'done', domId: 'step-done', navIndex: 3 },
        ],
    });
}

test('go shows only the active step and hides the rest, and marks the flow active', async () => {
    const flow = makeFlow();
    await flow.go('a', ctx);

    assert.equal(document.getElementById('step-patches').hidden, false);
    assert.equal(document.getElementById('step-firmware').hidden, true);
    assert.equal(document.getElementById('step-done').hidden, true);
    assert.equal(flow.current(), 'a');
    assert.equal(activated.at(-1), flow, 'every navigation reports the flow that is now active');
});

test('go renders the breadcrumb from navLabels and marks navIndex as the active step', async () => {
    const flow = makeFlow();
    await flow.go('a', ctx);

    const nav = document.getElementById('step-nav');
    const lis = nav.querySelectorAll('li');
    assert.equal(lis.length, 3);
    assert.equal(lis[0].textContent, 'One');
    assert.equal(lis[0].classList.contains('active'), true);
    assert.equal(lis[0].getAttribute('aria-current'), 'step');
    assert.equal(nav.hidden, false);
});

test('back returns the previous visited step (popping forward history)', async () => {
    const flow = makeFlow();
    await flow.go('a', ctx);
    await flow.go('done', ctx); // no back() override
    assert.equal(flow.back(ctx), 'a');
});

test('back honors a step-specific back() override without consuming history', async () => {
    const flow = makeFlow();
    await flow.go('a', ctx);
    await flow.go('b', ctx); // b.back = () => 'a'

    // The override short-circuits before history is popped, so it is repeatable.
    assert.equal(flow.back(ctx), 'a');
    assert.equal(flow.back(ctx), 'a');
    assert.equal(flow.current(), 'b');
});

test('revisiting an earlier step trims the forward history', async () => {
    const flow = makeFlow();
    await flow.go('a', ctx);
    await flow.go('done', ctx);
    await flow.go('a', ctx); // already visited → history rewinds to it

    assert.equal(flow.current(), 'a');
    assert.equal(flow.back(ctx), null);
});

test('transient steps do not enter the back history', async () => {
    const flow = makeFlow();
    await flow.go('a', ctx);
    await flow.go('b', ctx);
    await flow.go('building', ctx); // transient: not recorded

    assert.equal(flow.current(), 'building');
    // 'building' has no back() override, so back pops the real history (a, b → a).
    assert.equal(flow.back(ctx), 'a');
});

test('recoveryTarget resolves to the recovery step DOM id, or null', async () => {
    const flow = makeFlow();
    await flow.go('building', ctx); // building.recoveryStep = 'a'
    assert.equal(flow.recoveryTarget(), 'step-patches');

    await flow.go('done', ctx); // no recoveryStep
    assert.equal(flow.recoveryTarget(), null);
});

test('navLabels and navIndex may be functions of the session, refreshable in place', async () => {
    const flow = createFlow({
        id: 'fn',
        steps: [
            {
                id: 'a',
                domId: 'step-patches',
                navLabels: (c) => (c.removal ? ['X', 'Y'] : ['One', 'Two', 'Three']),
                navIndex: (c) => (c.removal ? 2 : 1),
            },
        ],
    });

    const session = { removal: false };
    await flow.go('a', session);
    assert.equal(document.querySelectorAll('#step-nav li').length, 3);

    session.removal = true;
    flow.refreshNav(session);
    const lis = document.querySelectorAll('#step-nav li');
    assert.equal(lis.length, 2);
    assert.equal(lis[1].classList.contains('active'), true);
});

test('navLabels and navIndex may be prototype methods that read `this`', async () => {
    // The trap this replaces: the step machine read these off the step and called
    // them detached, so a prototype method lost `this` and threw. Reverting the
    // fix must fail here with a TypeError on undefined `this`, not with a wrong
    // value — if it fails the other way this test is not testing what it claims.
    class MethodStep {
        constructor() {
            this.id = 'a';
            this.domId = 'step-patches';
            this.myLabels = ['Alpha', 'Beta'];
            this.myIndex = 2;
        }
        navLabels() {
            return this.myLabels;
        }
        navIndex() {
            return this.myIndex;
        }
    }

    const flow = createFlow({ id: 'proto', steps: [new MethodStep()] });
    await flow.go('a', ctx);

    const lis = document.querySelectorAll('#step-nav li');
    assert.deepEqual(
        [...lis].map((li) => li.textContent),
        ['Alpha', 'Beta'],
        'the labels came from `this`',
    );
    assert.equal(lis[1].getAttribute('aria-current'), 'step', 'and so did the index');
});

test('a step declaring neither navLabels nor navIndex leaves the breadcrumb alone', async () => {
    // `patches/BuildingStep` is the real instance: a transient screen with no nav
    // fields at all, so the breadcrumb keeps whatever the previous step set for
    // the whole build. `undefined` means "do not touch", and a default in the
    // step machine would silently reset it — visible only on the *next* screen,
    // which is why no screenshot would catch it.
    const flow = createFlow({
        id: 'transient',
        steps: [
            { id: 'a', domId: 'step-patches', navIndex: 2, navLabels: ['One', 'Two', 'Three'] },
            { id: 'building', domId: 'step-building', transient: true },
        ],
    });

    await flow.go('a', ctx);
    await flow.go('building', ctx);

    const lis = document.querySelectorAll('#step-nav li');
    assert.deepEqual(
        [...lis].map((li) => li.textContent),
        ['One', 'Two', 'Three'],
        'labels untouched',
    );
    assert.equal(lis[1].getAttribute('aria-current'), 'step', 'and the index still marks step 2');
});

test('the active flow is reported before onEnter runs, not after', async () => {
    // Position matters, not just presence. An `onEnter` can reach `showError`
    // through a rejecting device probe, and the error screen picks its recovery
    // affordance from whichever flow is active *at that moment*. Report late and
    // the failure is judged against the previous flow — or against null on the
    // first entry after mode selection.
    const events = [];
    const flow = createFlow({
        id: 'ordering',
        steps: [{ id: 'a', domId: 'step-patches', onEnter: () => events.push('onEnter') }],
        onActivate: () => events.push('onActivate'),
    });

    await flow.go('a', ctx);

    assert.deepEqual(events, ['onActivate', 'onEnter'], 'the flow is active before its entry hook can fail');
});

test('go throws for a step not declared in the flow', async () => {
    const flow = makeFlow();
    await assert.rejects(() => flow.go('nope', ctx), /Step "nope" not found in flow "test"/);
});

test('the back-stack unwinds until the target is on top, keeping the target', () => {
    // The error screen's recovery, now a named operation next to the stack it
    // mutates rather than raw array surgery in another file. It pops once
    // unconditionally — the error entry — then down to the target, which is
    // *kept*: this returns to that step rather than removing it.
    resetHistory();
    const patches = document.getElementById('step-patches');
    const firmware = document.getElementById('step-firmware');
    showStep(patches);
    showStep(firmware);
    showStep(document.getElementById('step-error'));

    unwindHistoryTo(patches);

    assert.equal(historyIncludes(patches), true, 'the target stays — it is where we are going');
    assert.equal(historyIncludes(firmware), false, 'everything after it is gone');
});

test('unwinding to a step that was never visited empties the stack rather than looping', () => {
    resetHistory();
    showStep(document.getElementById('step-firmware'));

    unwindHistoryTo(document.getElementById('step-nm-review'));

    assert.equal(historyIncludes(document.getElementById('step-firmware')), false);
});
