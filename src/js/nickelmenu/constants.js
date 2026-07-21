/** The path (relative to the Kobo onboard root) where the generated NickelMenu config file is written. */
export const NM_ITEMS_FILE = '.adds/nm/webui-preset';

/**
 * The path (relative to the Kobo onboard root) of NickelHome's config file. The home-content hiders
 * write the selected `hide_home_*_enabled` flags here; NickelHome reads it at boot. Writing it also
 * stops NickelHome from seeding its own hide-everything default template on first run.
 */
export const NICKELHOME_CONFIG_FILE = '.adds/nickel-home/config';

/**
 * The first KoboPatch Web UI version that installs the upstream (stock) NickelMenu. Every release
 * BEFORE this one bundled a NickelMenu *fork*, so any Kobo set up by a pre-1.50 web UI has the fork
 * installed. Reinstalling with 1.50+ writes stock NickelMenu over it (same `libnm.so` filename), so
 * the upgrade happens silently on the next reinstall — no migration prompt.
 *
 * The install manifest records the installing web UI version as `writer.version`, so a fork install
 * can be identified after the fact (writer.version < this) if that awareness is ever needed. Kept as
 * a documented constant for now; there is deliberately no runtime gate on it.
 */
export const NICKELMENU_STOCK_SINCE_VERSION = '1.50';
