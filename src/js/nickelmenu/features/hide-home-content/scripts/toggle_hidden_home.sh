#!/bin/sh

# Toggles every NickelMenu home-screen content hider that was installed
# (recommendations, suggestions, notices). It flips all hide_home_*_enabled
# flags in the NickelMenu items file between 1 (hidden) and 0 (shown) at once,
# reports which state will apply, then reboots so NickelMenu re-reads the file.

ITEMS_FILE="/mnt/onboard/.adds/nm/webui-preset"

if grep -q "hide_home_[a-z0-9]*_enabled:1" "$ITEMS_FILE"; then
    # At least one hider is on — turn them all off.
    sed -i 's/\(hide_home_[a-z0-9]*_enabled:\)1/\10/g' "$ITEMS_FILE"
    echo "Hidden home-screen content will be"
    echo "SHOWN again after the reboot."
    echo ""
    echo "Your Kobo will reboot in 7 seconds."
    echo "(No need to press the OK button...)"
    sleep 7 && reboot &
elif grep -q "hide_home_[a-z0-9]*_enabled:0" "$ITEMS_FILE"; then
    # All hiders are off — turn them all back on.
    sed -i 's/\(hide_home_[a-z0-9]*_enabled:\)0/\11/g' "$ITEMS_FILE"
    echo "Home-screen content will be"
    echo "HIDDEN again after the reboot."
    echo ""
    echo "Your Kobo will reboot in 7 seconds."
    echo "(No need to press the OK button...)"
    sleep 7 && reboot &
else
    echo "No home-content settings were found in"
    echo "the NickelMenu items file, so nothing"
    echo "was changed."
fi
