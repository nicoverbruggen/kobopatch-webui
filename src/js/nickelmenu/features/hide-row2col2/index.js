import { appendToNmConfig } from '../helpers.js';

export default {
    id: 'hide-row2col2',
    section: 'Interface tweaks',
    title: 'Hide suggestions next to My Books',
    description: 'Hides the suggestions shown next to My Books on the second row of the home screen.',
    default: false,
    // Declares that it hides home-screen content, so custom-menu adds the
    // universal "Show/hide home content" Tweak item and ships its toggle script.
    hidesHomeContent: true,

    postProcess: appendToNmConfig('experimental:hide_home_row2col2_enabled:1'),
};
