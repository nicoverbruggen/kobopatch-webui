/**
 * AdditionalFilesList.js — The "Additional Files" table inside the patches
 * screen's Advanced section.
 *
 * Owns the two elements it renders into and nothing else: the empty-state note
 * and the list of rows. Each row carries a destination input and a remove
 * button, both wired to `patchUI`. The rows are rebuilt from scratch on every
 * render, so their listeners die with the nodes they were attached to and there
 * is nothing to detach — unlike a `Step`, this needs no `destroy()`.
 *
 * Validation and the error message live on `PatchesStep`, which owns that
 * element and decides when to show it.
 */

import { formatBytes, requireElement } from '../../shell/DOM.js';

const DESTINATION_PLACEHOLDER = 'usr/local/Trolltech/QtEmbedded-4.6.2-arm/lib/fonts/Font.ttf';

export class AdditionalFilesList {
    /** @param {object} session - the shared wizard session */
    constructor(session) {
        this.session = session;
        this.empty = requireElement('patch-additional-files-empty');
        this.list = requireElement('patch-additional-files-list');
    }

    /** Rebuild the list from `patchUI`'s current additional files. */
    render() {
        const files = this.session.patchUI.getAdditionalFiles();
        this.empty.hidden = files.length > 0;
        this.list.innerHTML = '';

        for (const file of files) {
            this.list.appendChild(this.#buildRow(file));
        }
    }

    /**
     * One row: name + size, a destination input, and a remove button.
     *
     * @param {object} file - an entry from `patchUI.getAdditionalFiles()`
     * @returns {HTMLElement}
     */
    #buildRow(file) {
        const row = document.createElement('div');
        row.className = 'patch-additional-file-row';

        const name = document.createElement('div');
        name.className = 'patch-additional-file-name';
        name.textContent = file.name;

        const size = document.createElement('span');
        size.className = 'patch-additional-file-size';
        size.textContent = formatBytes(file.size);
        name.appendChild(size);

        const target = document.createElement('div');
        target.className = 'patch-additional-file-target';

        const label = document.createElement('label');
        label.setAttribute('for', `patch-additional-file-destination-${file.id}`);
        label.textContent = 'Destination';

        const input = document.createElement('input');
        input.id = `patch-additional-file-destination-${file.id}`;
        input.value = file.destination;
        input.placeholder = DESTINATION_PLACEHOLDER;
        input.autocomplete = 'off';
        input.spellcheck = false;
        input.setAttribute('aria-invalid', file.validation.ok ? 'false' : 'true');
        if (!file.validation.ok) input.setAttribute('aria-describedby', `patch-additional-file-error-${file.id}`);
        input.addEventListener('change', () => this.session.patchUI.updateAdditionalFileDestination(file.id, input.value));
        target.append(label, input);

        if (!file.validation.ok) {
            const error = document.createElement('p');
            error.id = `patch-additional-file-error-${file.id}`;
            error.className = 'patch-additional-file-error';
            error.textContent = file.validation.message;
            target.appendChild(error);
        }

        const remove = document.createElement('button');
        remove.className = 'secondary patch-additional-file-remove';
        remove.type = 'button';
        remove.setAttribute('aria-label', `Remove ${file.name}`);
        remove.title = `Remove ${file.name}`;
        remove.textContent = '\u00d7';
        remove.addEventListener('click', () => this.session.patchUI.removeAdditionalFile(file.id));

        row.append(name, target, remove);
        return row;
    }
}
