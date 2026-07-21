import './dom-harness.js'; // must come first: installs the DOM the modules read at import time
import test from 'node:test';
import assert from 'node:assert/strict';

import { createFlow, getActiveFlow, deactivateFlow } from '../../src/js/shell/step-machine.js';

const ctx = {};

function makeFlow() {
    return createFlow({
        id: 'test',
        steps: [
            { id: 'a', domId: 'step-test-a', navIndex: 1, navLabels: ['One', 'Two', 'Three'], recoveryStep: 'a' },
            { id: 'b', domId: 'step-test-b', navIndex: 2, back: () => 'a' },
            { id: 'building', domId: 'step-test-building', transient: true, recoveryStep: 'a' },
            { id: 'done', domId: 'step-test-done', navIndex: 3 },
        ],
    });
}

test('go shows only the active step and hides the rest, and marks the flow active', async () => {
    const flow = makeFlow();
    await flow.go('a', ctx);

    assert.equal(document.getElementById('step-test-a').hidden, false);
    assert.equal(document.getElementById('step-test-b').hidden, true);
    assert.equal(document.getElementById('step-test-done').hidden, true);
    assert.equal(flow.current(), 'a');
    assert.equal(getActiveFlow(), flow);
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
    assert.equal(flow.canGoBack(ctx), false);
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
    assert.equal(flow.recoveryTarget(), 'step-test-a');

    await flow.go('done', ctx); // no recoveryStep
    assert.equal(flow.recoveryTarget(), null);
});

test('navLabels and navIndex may be functions of the session, refreshable in place', async () => {
    const flow = createFlow({
        id: 'fn',
        steps: [
            {
                id: 'a',
                domId: 'step-test-a',
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

test('deactivateFlow clears the active flow', async () => {
    const flow = makeFlow();
    await flow.go('a', ctx);
    assert.equal(getActiveFlow(), flow);

    deactivateFlow();
    assert.equal(getActiveFlow(), null);
});

test('go throws for a step not declared in the flow', async () => {
    const flow = makeFlow();
    await assert.rejects(() => flow.go('nope', ctx), /Step "nope" not found in flow "test"/);
});
