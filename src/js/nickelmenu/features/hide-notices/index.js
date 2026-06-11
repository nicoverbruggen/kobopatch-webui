import { appendToNmConfig } from '../helpers.js';

export default {
    id: 'hide-notices',
    section: 'Interface tweaks',
    title: 'Hide home screen notices',
    description: 'Hides the third row on the home screen that shows notices below your books, such as reading time, release notes for updates, and Kobo Plus or Store promotions.',
    default: false,
    // Declares that it hides home-screen content, so custom-menu adds the
    // universal "Show/hide home content" Tweak item and ships its toggle script.
    hidesHomeContent: true,

    postProcess: appendToNmConfig('experimental:hide_home_row3_enabled:1'),
};
