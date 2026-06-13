#!/bin/sh

# Toggles the NickelClock reading-screen clock on or off by flipping
# [Clock] Enabled in NickelClock's settings.ini, then reboots so NickelClock
# re-reads the file (it only loads its settings at startup). Only the clock is
# touched: the [Battery] section has its own Enabled key and is left exactly as
# the user configured it (hidden by default).

SETTINGS_FILE="/mnt/onboard/.adds/nickelclock/settings.ini"

if [ ! -f "$SETTINGS_FILE" ]; then
    echo "NickelClock hasn't created its settings"
    echo "file yet. Reboot once after installing,"
    echo "then try again."
    exit 0
fi

# Read the Enabled value from the [Clock] section only (not [Battery]).
STATE=$(awk -F= '
    /^\[/ { section=$0; next }
    section=="[Clock]" && $1=="Enabled" { print $2; exit }
' "$SETTINGS_FILE")

if [ "$STATE" = "true" ]; then
    # Flip Enabled=true -> false within the [Clock] section only.
    sed -i '/^\[Clock\]/,/^\[/ s/^Enabled=true$/Enabled=false/' "$SETTINGS_FILE"
    echo "The reading-screen clock will be"
    echo "turned OFF after the reboot."
    echo ""
    echo "Your Kobo will reboot in 7 seconds."
    echo "(No need to press the OK button...)"
    sleep 7 && reboot &
elif [ "$STATE" = "false" ]; then
    # Flip Enabled=false -> true within the [Clock] section only.
    sed -i '/^\[Clock\]/,/^\[/ s/^Enabled=false$/Enabled=true/' "$SETTINGS_FILE"
    echo "The reading-screen clock will be"
    echo "turned ON after the reboot."
    echo ""
    echo "Your Kobo will reboot in 7 seconds."
    echo "(No need to press the OK button...)"
    sleep 7 && reboot &
else
    echo "Couldn't find the clock setting in"
    echo "NickelClock's settings file, so nothing"
    echo "was changed."
fi
