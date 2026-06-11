import { appendToNmConfig } from '../helpers.js';

export default {
    id: 'hide-recommendations',
    section: 'Interface tweaks',
    title: 'Hide home screen recommendations',
    description: 'Hides the recommendations next to your current read on the home screen.',
    default: false,
    // Declares that it hides home-screen content, so custom-menu adds the
    // universal "Show/hide home content" Tweak item and ships its toggle script.
    hidesHomeContent: true,

    postProcess: appendToNmConfig('experimental:hide_home_row1col2_enabled:1'),
};
