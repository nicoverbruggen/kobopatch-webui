# TODO

## Refactor `items` pre-fab

Today the custom-menu preset ships a static `src/js/nickelmenu/features/custom-menu/items` asset, and device-conditional tweaks (e.g. dropping the Dark Mode item on older Kobos) are done by string-mutating that file in `postProcess`. Generating the items file from JS — each menu entry as a data structure the feature assembles — would make such conditional logic a simple "don't add this entry" instead of commenting out matched lines, and remove the need to keep the asset and the code in sync.

The order in which the items are currently added to the `.adds/nm/items` file is not ideal; e.g. the Typography toggle is positioned at the top which is not where I want it (I want it in the same place that previously the "Legibility Toggle" existed).

Perhaps there needs to be a master list of items w/ a link to each feature? I am unsure how this should be structured. I think it's worth exploring.

## Hidden content on main screen (toggle)

When selecting any option that hides content on the home screen, add an option to the menu that allows the user to toggle this feature (which runs as script that toggles the config options + reboots).

Similarly, add a script that does the same for the hidden tabs. This and the other script should toggle ALL options that were injected in the config, but the script should be universal for ALL options.

## Audit log on the device

Write a `kobopatch-webui.log` file to the root of the connected Kobo that records each step undertaken during an install or removal — file additions, file removals, `Kobo eReader.conf` changes, etc. — for audit/troubleshooting purposes. Should capture the same operations the installer/uninstaller already perform (KoboRoot.tgz write, per-feature file writes, cleanup removals, conf edits) with timestamps.


