#!/bin/sh

# NickelMenu toggles FeatureSettings.Screenshots before running this script.
# Report the resulting state and, most importantly, explain that enabling
# screenshots temporarily takes over the power button.

CONFIG_FILE="/mnt/onboard/.kobo/Kobo/Kobo eReader.conf"

if grep -q "^Screenshots=true" "$CONFIG_FILE"; then
    echo "Screenshot mode is ON!"
    echo ""
    echo "Press the power button to take a screenshot."
    echo ""
    echo "Important: the button cannot lock or wake your"
    echo "Kobo in this mode. Remember to select Screenshots"
    echo "again when you're done."
elif grep -q "^Screenshots=false" "$CONFIG_FILE"; then
    echo "Screenshot mode is OFF!"
    echo ""
    echo "Your power button works normally again and can"
    echo "be used to lock or wake up your device."
else
    echo "The screenshot setting was toggled, but its"
    echo "new state could not be read from Kobo eReader.conf."
fi
