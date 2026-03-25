import { appendToNmConfig } from '../helpers.js';

export default {
    id: 'hide-notices',
    title: 'Hide home screen notices',
    description: 'Hides the third row on the home screen that shows notices below your books, such as reading time, release notes for updates, and Kobo Plus or Store promotions.',
    default: false,

    postProcess: appendToNmConfig('experimental:hide_home_row3_enabled:1'),
};
