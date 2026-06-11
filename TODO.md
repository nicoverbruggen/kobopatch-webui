# TODO

## Hidden content on main screen (toggle)

When selecting any option that hides content on the home screen, add an option to the menu that allows the user to toggle this feature (which runs as script that toggles the config options + reboots).

Similarly, add a script that does the same for the hidden tabs. This and the other script should toggle ALL options that were injected in the config, but the script should be universal for ALL options.

## Detect device that has been factory reset

It's possible to do a complete factory reset, NOT SIGN IN, and use the device with `SideloadedMode=true` under `ApplicationPreferences`. I'd like to be able to detect if the user is NOT signed in and show a banner recommending the user to enable "Advanced > Sideloaded Mode".

We might be able to query the database via KoboReader.sqlite > user -> count how many rows are present. If zero rows, the user is not signed in yet.

"Sideloaded Mode" should be a new preference that enables this `SideloadedMode` value in the configuration file. It should, like other preferences, be easy to uninstall.

(This option should be disabled if the user is running a version of the software prior to 4.31. Perhaps a "minimumVersion" property needs to be added to make features conditional? If an older version does not allow the installation of a feature, it should be displayed in the section below the feature why, in red text.)

Make sure to add all appropriate E2E tests, plus screenshots for the "too old of a Kobo OS" flow as an edge case for this particular feature.

## Audit log on the device

Write a `kobopatch-webui.log` file to the root of the connected Kobo that records each step undertaken during an install or removal — file additions, file removals, `Kobo eReader.conf` changes, etc. — for audit/troubleshooting purposes. Should capture the same operations the installer/uninstaller already perform (KoboRoot.tgz write, per-feature file writes, cleanup removals, conf edits) with timestamps.

## Build `.adds/nm/items` programmatically

Generate the NickelMenu `items` file from structured data per feature instead of shipping a static template that features patch via `postProcess` (e.g. the screensaver toggle is currently inserted by string anchoring). Each feature could declare its menu entries and the installer would assemble the file.

## Refactor `items` pre-fab

Today the custom-menu preset ships a static `src/js/nickelmenu/features/custom-menu/items` asset, and device-conditional tweaks (e.g. dropping the Dark Mode item on older Kobos) are done by string-mutating that file in `postProcess`. Generating the items file from JS — each menu entry as a data structure the feature assembles — would make such conditional logic a simple "don't add this entry" instead of commenting out matched lines, and remove the need to keep the asset and the code in sync.
