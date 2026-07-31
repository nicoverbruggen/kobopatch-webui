/**
 * app.js — Entry point.
 *
 * Builds the shared Session with its services, kicks off the async resource
 * loads, constructs the Wizard, and boots it. Everything about *what leads
 * where* lives in `Wizard`; everything about a single screen lives in that
 * screen's class. This file only wires the two together.
 */

import { KoboDevice } from './kobo/device.js';
import { loadSoftwareUrls, getSoftwareUrl } from './kobo/software-urls.js';
import { PatchUI } from './patches/ui.js';
import { scanAvailablePatches } from './patches/catalog.js';
import { KoboPatchRunner } from './patches/runner.js';
import { NickelMenuInstaller } from './nickelmenu/installer.js';
import { Session } from './shell/session.js';
import { $ } from './shell/dom.js';
import { initGlobalUI } from './shell/global-ui.js';
import { Wizard } from './Wizard.js';

const patchUI = new PatchUI();
const session = new Session({
    device: new KoboDevice(),
    patchUI,
    runner: new KoboPatchRunner(),
    nmInstaller: new NickelMenuInstaller(),
    getSoftwareUrl,
    softwareUrlsReady: loadSoftwareUrls(),
    blacklistReady: patchUI.loadBlacklist(),
});
session.startAvailablePatchesLoad(scanAvailablePatches);

const wizard = new Wizard(session);
initGlobalUI();

const loader = $('initial-loader');
if (loader) loader.remove();

wizard.start();
