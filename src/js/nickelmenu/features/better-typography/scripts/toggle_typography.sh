#!/bin/sh

# Toggles Kobo's optimized WebKit text rendering (webkitTextRendering). Adds or
# removes the line under [Reading], reports which WebKit mode will be active
# after the reboot, then reboots after 7 seconds so the change takes effect.

CONFIG_FILE="/mnt/onboard/.kobo/Kobo/Kobo eReader.conf"

if grep -q "^webkitTextRendering=optimizeLegibility" "$CONFIG_FILE"; then
    # Currently ON — turn it OFF.
    sed -i '/^webkitTextRendering=optimizeLegibility/d' "$CONFIG_FILE"
    echo "Optimized typography will be DISABLED"
    echo "after the reboot."
    echo ""
    echo "WebKit returns to Kobo's default mode:"
    echo "- Ligatures are NOT displayed."
    echo "- Only old-style kerning is used."
    echo "This is the most compatible mode."
    echo ""
    echo "Your Kobo will reboot in 7 seconds."
    echo "(No need to press the OK button...)"
    sleep 7 && reboot &
elif grep -q "^\[Reading\]" "$CONFIG_FILE"; then
    # Currently OFF — turn it ON.
    sed -i '/^\[Reading\]/a webkitTextRendering=optimizeLegibility' "$CONFIG_FILE"
    echo "Optimized typography will be ENABLED"
    echo "after the reboot."
    echo ""
    echo "WebKit switches to optimizeLegibility:"
    echo "- Ligatures are displayed."
    echo "- GPOS kerning works correctly."
    echo "- Use left-aligned text to avoid"
    echo "  justified-text wrapping issues."
    echo ""
    echo "Your Kobo will reboot in 7 seconds."
    echo "(No need to press the OK button...)"
    sleep 7 && reboot &
else
    echo "Could not find the [Reading] section in"
    echo "Kobo eReader.conf, so nothing was changed."
fi
