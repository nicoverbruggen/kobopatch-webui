#!/bin/sh

# Toggles the NickelMenu navigation-tab customization (the "simplify tabs"
# option). It flips the master menu_main_15505_enabled switch in the NickelMenu
# items file between 1 (custom tabs) and 0 (Kobo's default tabs) — which turns
# all of the tab overrides on or off at once — then reboots so NickelMenu
# re-reads the file.

ITEMS_FILE="/mnt/onboard/.adds/nm/items"

if grep -q "menu_main_15505_enabled *: *1" "$ITEMS_FILE"; then
    # Custom tabs are on — restore Kobo's default tab bar.
    sed -i 's/\(menu_main_15505_enabled *: *\)1/\10/' "$ITEMS_FILE"
    echo "The default Kobo navigation tabs will"
    echo "be RESTORED after the reboot."
    echo ""
    echo "Your Kobo will reboot in 7 seconds."
    echo "(No need to press the OK button...)"
    sleep 7 && reboot &
elif grep -q "menu_main_15505_enabled *: *0" "$ITEMS_FILE"; then
    # Custom tabs are off — re-enable the simplified tab bar.
    sed -i 's/\(menu_main_15505_enabled *: *\)0/\11/' "$ITEMS_FILE"
    echo "The simplified navigation tabs will"
    echo "be RE-ENABLED after the reboot."
    echo ""
    echo "Your Kobo will reboot in 7 seconds."
    echo "(No need to press the OK button...)"
    sleep 7 && reboot &
else
    echo "No tab settings were found in the"
    echo "NickelMenu items file, so nothing"
    echo "was changed."
fi
