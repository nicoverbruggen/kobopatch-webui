-- Keep this filename so upgrades replace the old OS 6 patch that hid Exit.
-- Returning to Nickel can hang or disable mods on Kobo OS 4 and 6.
local Device = require("device")
if not Device:isKobo() then return end

local UIManager = require("ui/uimanager")
local function reboot()
    UIManager:askForReboot()
end

local MenuSorter = require("ui/menusorter")
local original = MenuSorter.mergeAndSort
function MenuSorter:mergeAndSort(config_prefix, item_table, order)
    if config_prefix == "filemanager" or config_prefix == "reader" then
        if item_table.exit then
            item_table.exit.callback = reboot
            item_table.exit.keep_menu_open = true
        end
        if item_table.exit_menu then
            -- Some devices use the parent as a direct Exit action.
            if item_table.exit_menu.callback then
                item_table.exit_menu.callback = reboot
                item_table.exit_menu.keep_menu_open = true
            end
            item_table.exit_menu.hold_callback = reboot
        end
    end
    return original(self, config_prefix, item_table, order)
end
