-- Returning to Nickel can hang on Kobo OS 6. Keep the reboot and power-off
-- actions, but remove normal Exit from both menus, including its hold shortcut.
local Device = require("device")
if not Device:isKobo() then return end
Device:getFirmwareVersion()
if not (Device.firmware_rev or ""):match("^6%.") then return end

local MenuSorter = require("ui/menusorter")
local original = MenuSorter.mergeAndSort
function MenuSorter:mergeAndSort(config_prefix, item_table, order)
    if config_prefix == "filemanager" or config_prefix == "reader" then
        item_table.exit = nil
        if item_table.exit_menu then
            item_table.exit_menu.hold_callback = nil
        end
    end
    return original(self, config_prefix, item_table, order)
end
