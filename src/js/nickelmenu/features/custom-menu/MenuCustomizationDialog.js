/**
 * MenuCustomizationDialog.js — the "Customize NickelMenu preset" dialog.
 *
 * Lets the user pick or upload an icon and edit the label for the Toggle tab,
 * with a live preview. The image pipeline is next door in `MenuIconImages.js`;
 * the data model is in `nickelmenu/customization.js`, shared with the installer.
 *
 * This dialog is the one with an async draft mutation — the icon upload — so it
 * is the only subclass that talks to `CustomizationDrafts`' generation counter.
 */

import { requireElement, requireInput } from '../../../shell/DOM.js';
import { CustomizationDialog } from '../../CustomizationDialog.js';
import {
    cloneMenuCustomization,
    createDefaultMenuCustomization,
    findPresetIcon,
    isDefaultMenuCustomization,
    isValidMenuLabel,
    NM_MENU_LABEL_MAX_LENGTH,
    NM_MENU_PRESET_ICONS,
    normalizeMenuLabel,
    sanitizeMenuLabel,
} from '../../MenuCustomization.js';
import { handleNmIconUpload, renderPresetSvgToPng } from './MenuIconImages.js';
import { CUSTOM_MENU_ICON_URL } from './index.js';

const NM_DEFAULT_ICON_ASSET = CUSTOM_MENU_ICON_URL;

export function renderIconPreview(container, icon) {
    container.innerHTML = '';

    if (icon?.type === 'preset') {
        const preset = findPresetIcon(icon.id);
        if (preset) {
            container.innerHTML = preset.svg;
            return;
        }
    }

    if (icon?.type === 'upload' && icon.previewUrl) {
        const img = document.createElement('img');
        img.alt = '';
        img.src = icon.previewUrl;
        container.appendChild(img);
        return;
    }

    const img = document.createElement('img');
    img.alt = '';
    img.src = NM_DEFAULT_ICON_ASSET;
    container.appendChild(img);
}

function getGridColumns(grid) {
    if (grid.children.length < 2) return 1;
    const firstRect = grid.children[0].getBoundingClientRect();
    const secondRect = grid.children[1].getBoundingClientRect();
    return secondRect.top > firstRect.top ? 1 : grid.children.length;
}

function getGridIndex(grid, el) {
    return Array.prototype.indexOf.call(grid.children, el);
}

/**
 * Build the preset icon grid once, and (re)bind its selection callback.
 *
 * The early return keeps the buttons and their roving-focus keyboard handler,
 * but `container._onSelect` is replaced on **every** call — reopening the dialog
 * must rebind the callback to the new draft, or preset clicks mutate a stale one.
 */
export function renderNmCustomizationPresets(container, onSelect) {
    container._onSelect = onSelect;
    if (container.children.length) return;

    for (const icon of NM_MENU_PRESET_ICONS) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'nm-icon-choice';
        button.dataset.iconId = icon.id;
        button.setAttribute('aria-label', `Use ${icon.title} icon`);
        button.title = icon.title;

        const image = document.createElement('span');
        image.className = 'nm-icon-choice-image';
        if (icon.id === 'cog') {
            const img = document.createElement('img');
            img.alt = '';
            img.src = NM_DEFAULT_ICON_ASSET;
            image.appendChild(img);
        } else {
            image.innerHTML = icon.svg;
        }

        const title = document.createElement('span');
        title.className = 'nm-icon-choice-title';
        title.textContent = icon.title;

        button.append(image, title);
        button.addEventListener('click', async () => {
            await container._onSelect?.(icon);
        });
        container.appendChild(button);
    }

    const total = container.children.length;

    container.addEventListener('keydown', (e) => {
        const cols = getGridColumns(container);
        const idx = getGridIndex(container, document.activeElement);
        if (idx === -1) return;

        let target;
        switch (e.key) {
            case 'ArrowRight':
                target = Math.min(idx + 1, total - 1);
                break;
            case 'ArrowLeft':
                target = Math.max(idx - 1, 0);
                break;
            case 'ArrowDown':
                target = Math.min(idx + cols, total - 1);
                break;
            case 'ArrowUp':
                target = Math.max(idx - cols, 0);
                break;
            case 'Home':
                target = 0;
                break;
            case 'End':
                target = total - 1;
                break;
            default:
                return;
        }

        e.preventDefault();
        container.children[target].focus();
    });
}

export function getMenuCustomizationSummary(customization) {
    const icon = customization?.icon;
    const summary = {
        label: normalizeMenuLabel(customization?.label),
        iconHtml: '',
        iconSrc: '',
    };

    if (icon?.type === 'preset') {
        const preset = findPresetIcon(icon.id);
        if (preset) summary.iconHtml = preset.svg;
        return summary;
    }

    if (icon?.type === 'upload' && icon.previewUrl) {
        summary.iconSrc = icon.previewUrl;
        return summary;
    }

    summary.iconSrc = NM_DEFAULT_ICON_ASSET;
    return summary;
}

export class MenuCustomizationDialog extends CustomizationDialog {
    /**
     * @param {object} config
     * @param {import('../../../flows/nickelmenu/NickelMenuSelection.js').NickelMenuSelection} config.selection
     * @param {import('../../../flows/nickelmenu/CustomizationDrafts.js').CustomizationDrafts} config.drafts
     * @param {AbortSignal} config.signal
     */
    constructor({ selection, drafts, signal }) {
        super({
            type: 'menu',
            dialogId: 'nm-customize-dialog',
            statusId: 'nm-customize-status',
            closeId: 'btn-nm-customize-close',
            cancelId: 'btn-nm-customize-cancel',
            resetId: 'btn-nm-customize-reset',
            saveId: 'btn-nm-customize-save',
            summaryContainerId: 'nm-custom-menu-summary',
            selection,
            drafts,
            signal,
        });
    }

    bindElements() {
        this.labelInput = requireInput('nm-customize-label');
        this.upload = requireInput('nm-customize-upload');
        this.counter = requireElement('nm-customize-counter');
        this.presets = requireElement('nm-customize-presets');
        this.uploadPreview = requireElement('nm-customize-upload-preview');
        this.uploadName = requireElement('nm-customize-upload-name');
    }

    get committed() {
        return this.selection.menuCustomization;
    }

    set committed(value) {
        this.selection.menuCustomization = value;
    }

    get draft() {
        return this.drafts.menu;
    }

    /** Routed through `setMenu` so the generation counter stays the drafts store's. */
    set draft(value) {
        this.drafts.setMenu(value);
    }

    createDefault() {
        return createDefaultMenuCustomization();
    }

    /**
     * The common core of open and reset. The order matters: the preset grid is
     * rebound to the new draft first, the label input is filled before the
     * refresh (which reads it back out), and only then is the derived state
     * recomputed.
     */
    seed(customization) {
        const draft = cloneMenuCustomization(customization);

        renderNmCustomizationPresets(this.presets, async (icon) => {
            if (icon.id === 'cog') {
                draft.icon = { type: 'default' };
                this.#refreshDerived(draft);
                return;
            }

            // Taken before the await, like the upload path alongside. Without it,
            // a render still in flight when the dialog is reopened repaints the
            // new dialog from the previous session's draft.
            const token = this.drafts.menuToken();
            try {
                this.status.textContent = 'Preparing preset icon...';
                const data = await renderPresetSvgToPng(icon.svg);
                if (!this.drafts.isCurrentMenu(token)) return;
                draft.icon = {
                    type: 'preset',
                    id: icon.id,
                    mimeType: 'image/png',
                    data,
                };
                this.#refreshDerived(draft, 'Preset icon prepared as 48x48 PNG.');
            } catch (err) {
                // Guarded for the same reason: this writes to the status line of
                // whichever dialog is open now, not the one that started the render.
                if (!this.drafts.isCurrentMenu(token)) return;
                this.status.textContent = err.message;
            }
        });

        this.labelInput.value = sanitizeMenuLabel(draft.label);
        this.#refreshDerived(draft);
        return draft;
    }

    focusInitial() {
        this.labelInput.focus();
        this.labelInput.select();
    }

    /**
     * Ends the dialog session *before* installing the default draft, which is the
     * order the baseline used: a reset must invalidate an in-flight upload.
     */
    reset() {
        this.drafts.endMenuSession();
        super.reset();
    }

    resetMessage() {
        return isDefaultMenuCustomization(this.committed) ? '' : 'Defaults restored.';
    }

    /** Refuses an invalid label, leaving the dialog open with the reason shown. */
    commit() {
        const label = sanitizeMenuLabel(this.labelInput.value).trim();
        if (!isValidMenuLabel(label)) {
            this.#refreshDerived(this.draft);
            return null;
        }

        // A spread copy, so the committed customization shares `icon` by
        // reference with the draft. `handleNmIconUpload` assigns a new icon
        // object rather than mutating in place, which is what stops a late
        // upload from reaching already-saved state.
        return { ...this.draft, label };
    }

    /** Ends the dialog session so an upload still resolving cannot write into the saved value. */
    afterCommit() {
        this.drafts.endMenuSession();
    }

    summary(customization) {
        return getMenuCustomizationSummary(customization);
    }

    /**
     * Unlike tabs and fonts this has **no feature-id gate**: the menu icon is
     * restored whenever the previous configuration carried one, whether or not
     * `custom-menu` was among the selected ids. That asymmetry is real behavior.
     */
    adoptPrevious(previous) {
        if (!previous?.menuCustomization) return;

        // The icon comes back off the device as raw bytes with no `previewUrl`,
        // and every consumer keys on `previewUrl` rather than on `data` — without
        // this the restored icon renders as the default cog. The URL is cached on
        // the *source* object, before cloning, so restoring repeatedly mints at
        // most one object URL per device read. Building it on the clone instead
        // would leak one per restore, since nothing revokes these.
        const previousIcon = previous.menuCustomization.icon;
        if (previousIcon?.type === 'upload' && previousIcon.data && !previousIcon.previewUrl) {
            previousIcon.previewUrl = URL.createObjectURL(new Blob([previousIcon.data], { type: previousIcon.mimeType }));
        }

        this.committed = cloneMenuCustomization(previous.menuCustomization);
        this.draft = cloneMenuCustomization(this.committed);
        this.drafts.endMenuSession();
    }

    wire(signal) {
        this.labelInput.addEventListener('input', () => this.#refreshDerived(this.draft), { signal });

        this.upload.addEventListener(
            'change',
            () => {
                // Two guards, both required. The fourth argument is the
                // load-bearing one: `handleNmIconUpload` checks it after each
                // await and before mutating the draft, and its default is
                // `() => true`, so dropping it disables the protection silently.
                // The check inside the message callback guards a repaint of a
                // dialog that has since moved on; it is unreachable today because
                // there is no await between the two, and it is kept against a
                // future change in the helper.
                const token = this.drafts.menuToken();
                handleNmIconUpload(
                    this.upload.files?.[0],
                    token.draft,
                    (msg) => {
                        if (!this.drafts.isCurrentMenu(token)) return;
                        this.#refreshDerived(this.draft, msg);
                    },
                    () => this.drafts.isCurrentMenu(token),
                );
                // Unconditional and synchronous, so re-picking the same file fires
                // `change` again. Must stay outside every guard.
                this.upload.value = '';
            },
            { signal },
        );
    }

    /** Recompute everything the dialog derives from the draft and its label input. */
    #refreshDerived(draft, message = '') {
        const label = sanitizeMenuLabel(this.labelInput.value);
        if (label !== this.labelInput.value) {
            this.labelInput.value = label;
        }

        draft.label = label;
        this.counter.textContent = `${label.length}/${NM_MENU_LABEL_MAX_LENGTH}`;

        for (const button of this.presets.querySelectorAll('.nm-icon-choice')) {
            button.classList.toggle(
                'nm-icon-choice--selected',
                (draft.icon?.type === 'preset' && button.dataset.iconId === draft.icon.id) ||
                    (draft.icon?.type === 'default' && button.dataset.iconId === 'cog'),
            );
        }

        const hasUpload = draft.icon?.type === 'upload';
        this.uploadPreview.classList.toggle('nm-upload-preview--selected', hasUpload);
        if (hasUpload) {
            renderIconPreview(this.uploadPreview, draft.icon);
            this.uploadName.textContent = draft.icon.name || 'Uploaded image';
        } else {
            this.uploadPreview.innerHTML = '';
            this.uploadName.textContent = 'No uploaded image selected';
        }

        const valid = isValidMenuLabel(label);
        this.btnSave.disabled = !valid;
        this.status.textContent = valid ? message : `Use 1-${NM_MENU_LABEL_MAX_LENGTH} letters or numbers.`;
    }
}
