I would like to build a web application that uses the USB file system API with Chrome to interface with a Kobo Libra Color / Kobo Clara Color / Kobo Clara BW and provide a gui for custom kobo patches.

The website should make it easy to configure which patches need to be executed, run the patcher, connect to the USB device, and place the KoboRoot.tgz in the .kobo directory, after which the user will be instructed to reboot.

To verify nothing bad can happen, we should make sure that we can identify what device and operating system version a particular device is before starting. I've copied the root of my Kobo Libra Color's accessible filesystem over to the kobo_usb_root folder for further research.

So, in short, what's needed:

- Determining the operating system and device (via the browser / usb filesystem API)
- Downloading the firmware for that version from https://pgaskin.net/KoboStuff/kobofirmware.html (currently we can hardcode only the latest release? I've included the firmware in the ./firmware directory)
- Applying patches
- Copying the patch to the target device via the browser
- ... that's it?

Patches are made available via the MobileRead forums and it would be necessary to manually update this patcher when new kobo os versions come out.

As a bonus, it would be nice if we could also install NickelMenu (see https://pgaskin.net/NickelMenu/) via this method as well. (Or uninstall it, by placing the correct file in the correct location.)
