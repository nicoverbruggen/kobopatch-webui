/**
 * app.js — Entry point.
 *
 * Builds the shared Session with its services, kicks off the async resource
 * loads, constructs the Wizard, and boots it. Everything about *what leads
 * where* lives in `Wizard`; everything about a single screen lives in that
 * screen's class. This file only wires the two together.
 */

import { KoboDevice } from './kobo/KoboDevice.js';
import { loadSoftwareUrls, getSoftwareUrl } from './kobo/SoftwareURLs.js';
import { PatchUI } from './patches/PatchUI.js';
import { scanAvailablePatches } from './patches/Catalog.js';
import { KoboPatchRunner } from './patches/KoboPatchRunner.js';
import { NickelMenuInstaller } from './nickelmenu/NickelMenuInstaller.js';
import { Session } from './shell/Session.js';
import { $ } from './shell/DOM.js';
import { initGlobalUI } from './shell/GlobalUI.js';
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
