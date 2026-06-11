#!/bin/sh

# Toggles the NickelMenu navigation-tab customisation (the "simplify tabs"
# option). It comments or uncomments the simplify-tabs config lines in the
# NickelMenu items file, then reboots so NickelMenu re-reads the file.

ITEMS_FILE="/mnt/onboard/.adds/nm/items"

if grep -q "^experimental :menu_main_15505_enabled:" "$ITEMS_FILE"; then
    # Custom tabs are on — comment out the tab override lines.
    sed -i '/^experimental :menu_main_15505_\([0-9]\|enabled\|default\)/s/^/# /' "$ITEMS_FILE"
    echo "The default Kobo navigation tabs will"
    echo "be RESTORED after the reboot."
    echo ""
    echo "Your Kobo will reboot in 7 seconds."
    echo "(No need to press the OK button...)"
    sleep 7 && reboot &
elif grep -q "^# experimental :menu_main_15505_enabled:" "$ITEMS_FILE"; then
    # Custom tabs are off — uncomment the tab override lines.
    sed -i '/^# experimental :menu_main_15505_\([0-9]\|enabled\|default\)/s/^# //' "$ITEMS_FILE"
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
