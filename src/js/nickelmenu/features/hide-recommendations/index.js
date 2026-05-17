import { appendToNmConfig } from '../helpers.js';

export default {
    id: 'hide-recommendations',
    section: 'Interface tweaks',
    title: 'Hide home screen recommendations',
    description: 'Hides the recommendations next to your current read on the home screen.',
    default: false,

    postProcess: appendToNmConfig('experimental:hide_home_row1col2_enabled:1'),
};
