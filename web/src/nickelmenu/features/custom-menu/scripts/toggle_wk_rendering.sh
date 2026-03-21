#!/bin/sh

# Script to toggle webkitTextRendering setting.
# This causes certain font features to work in kepub files.

CONFIG_FILE="/mnt/onboard/.kobo/Kobo/Kobo eReader.conf"

# Check if the setting exists
if grep -q "^webkitTextRendering=optimizeLegibility" "$CONFIG_FILE"; then
    # Remove the line
    sed -i '/^webkitTextRendering=optimizeLegibility/d' "$CONFIG_FILE"
    echo "Now turned OFF. Your Kobo will now reboot."
    echo "(No need to press the OK button...)"
    sleep 3 && reboot &
else
    # Add the line below [Reading] section
    if grep -q "^\[Reading\]" "$CONFIG_FILE"; then
        sed -i '/^\[Reading\]/a webkitTextRendering=optimizeLegibility' "$CONFIG_FILE"
        echo "Now turned ON. Your Kobo will now reboot."
        echo "(No need to press the OK button...)"
        sleep 3 && reboot &
    else
        echo "Oops. Could not find [Reading] section!"
    fi
fi
