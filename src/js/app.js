/**
 * app.js — Orchestrator.
 *
 * Assembles the shared Session and long-lived services, kicks off the async
 * resource loads, wires up the flows and shell screens, then boots the wizard.
 * Per-step behavior lives in the flow/screen modules, not here.
 */

import { KoboDevice } from './kobo/device.js';
import { loadSoftwareUrls, getSoftwareUrl } from './kobo/software-urls.js';
import { PatchUI } from './patches/ui.js';
import { scanAvailablePatches } from './patches/catalog.js';
import { KoboPatchRunner } from './patches/runner.js';
import { NickelMenuInstaller } from './nickelmenu/installer.js';
import { Session } from './shell/session.js';
import { $ } from './shell/dom.js';
import { initErrorScreen } from './shell/error-screen.js';
import { initGlobalUI } from './shell/global-ui.js';
import { initNickelMenu } from './flows/nickelmenu-flow.js';
import { initPatchesFlow } from './flows/patches-flow.js';
import { initConnectFlow } from './flows/connect-flow.js';
import { initManualFlow } from './flows/manual-flow.js';
import { initModeFlow } from './flows/mode-flow.js';

const state = Object.assign(new Session(), {
    device: new KoboDevice(),
    patchUI: new PatchUI(),
    runner: new KoboPatchRunner(),
    nmInstaller: new NickelMenuInstaller(),
    getSoftwareUrl,
});

// Async resources shared across flows; awaited where needed.
state.softwareUrlsReady = loadSoftwareUrls();
state.availablePatchesReady = scanAvailablePatches().then((p) => {
    state.availablePatches = p;
});
state.blacklistReady = state.patchUI.loadBlacklist();

// Flows and shell screens. Order matters only for the explicit dependency
// injection below; all cross-flow navigation goes through `state.*` callbacks.
const patches = initPatchesFlow(state);
const nm = initNickelMenu(state);
initErrorScreen(state);
const manual = initManualFlow(state, { patches });
initModeFlow(state, { patches, nm, manual });
const connect = initConnectFlow(state, { patches });
initGlobalUI();

const loader = $('initial-loader');
if (loader) loader.remove();

connect.start();
