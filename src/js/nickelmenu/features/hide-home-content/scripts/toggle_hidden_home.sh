#!/bin/sh

# Toggles NickelHome's minimal home on and off via its master switch (nhm_enabled),
# keeping which widgets you chose to hide. Flips nhm_enabled between 1 (minimal home
# applied) and 0 (home left untouched), reports the new state, then reboots so
# NickelHome re-reads the config.

CONFIG_FILE="/mnt/onboard/.adds/nickel-home/config"

reboot_notice() {
    echo ""
    echo "Your Kobo will reboot in 7 seconds."
    echo "(No need to press the OK button...)"
    sleep 7 && reboot &
}

if [ ! -f "$CONFIG_FILE" ]; then
    echo "NickelHome's config was not found, so"
    echo "there is nothing to toggle. Install the"
    echo "home-screen hiders first."
elif grep -q "^nhm_enabled:1" "$CONFIG_FILE"; then
    # Minimal home is on — turn it off (show every widget).
    sed -i 's/^nhm_enabled:1/nhm_enabled:0/' "$CONFIG_FILE"
    echo "Your minimal home screen will be"
    echo "TURNED OFF after the reboot"
    echo "(all widgets shown)."
    reboot_notice
elif grep -q "^nhm_enabled:0" "$CONFIG_FILE"; then
    # Minimal home is off — turn it back on (your hidden widgets return).
    sed -i 's/^nhm_enabled:0/nhm_enabled:1/' "$CONFIG_FILE"
    echo "Your minimal home screen will be"
    echo "TURNED ON after the reboot"
    echo "(your hidden widgets stay hidden)."
    reboot_notice
else
    # No explicit switch yet (NickelHome defaults to on) — add it as off to turn it off.
    echo "nhm_enabled:0" >> "$CONFIG_FILE"
    echo "Your minimal home screen will be"
    echo "TURNED OFF after the reboot"
    echo "(all widgets shown)."
    reboot_notice
fi
