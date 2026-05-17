#!/bin/sh

CONFIG_FILE="/mnt/onboard/.kobo/Kobo/Kobo eReader.conf"

if grep -q "^webkitTextRendering=optimizeLegibility" "$CONFIG_FILE"; then
    echo "Optimized legibility is ON."
    echo ""
    echo "- Ligatures will be displayed."
    echo "- GPOS kerning works correctly."
    echo "- Justified text may have some wrapping issues."
    echo ""
    echo "It's highly recommended to enable left-aligned"
    echo "text to avoid wrapping issues in some books."
    echo ""
    echo "This mode renders text more correctly."
    echo "Use 'Legibility Toggle' to turn this OFF."
else
    echo "Optimized legibility is OFF."
    echo ""
    echo "- Ligatures will NOT be displayed."
    echo "- Only old-style kerning works correctly."
    echo ""
    echo "This is the most compatible mode, and Kobo's default."
    echo "Use 'Legibility Toggle' to switch to turn this ON."
fi
