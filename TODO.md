# TODO

## NickelMenu flow

### Audit should generate a parsable JSON file so we can easily uninstall the latest state

In addition to an install log, maintain a `kp-webui.json` file in `.kobopatch-webui` that contains information about what was installed, i.e.:

```
{
    "files": [
        {path: ".adds/nm/kp-preset", type: file},
        {path: ".adds/koreader", type: "folder"}
    ],
    "features": [
        "preset", "koreader"
    ],
    "metadata": {
        "version": 1.15
    }
}
```

Based on this information, we can do a more informed uninstall in the future.

### Offer alternative reading apps

Currently, KOReader is the only alternative reader app that's available to install.

I would like to expand this (see #11) with alternatives. The "KOReader" section should become "Reading Apps".

Add Plato (https://github.com/baskerville/plato) or Cadmus (https://github.com/OGKevin/cadmus) to "Reading Apps". These are mutually exclusive, so enabling one should automatically disable the other option. `excludes: ['cadmus']` is probably needed as part of the feature export for Plato (and vice-versa). It should be obvious in the UI that these are, in fact mutually exclusive w/ a label in red as soon as one is selected.

### Consider making the required preset optional

When the user selects "Install with preset", the default menu items and "Tweak" label + icon should be optional but checked by default. This should be easier to achieve now that the way the NickelMenu config file is generated, has changed.

## Custom patches

### Search feature

It currently isn't that easy to locate a specific patch if you know of one. A search field with live filtering would be very helpful here.

### Customizing patches

Some patches are intended to be modified. It should be possible to press an "Edit" button which opens an editor that lets you customize (and validate!) the patch. This should probably be some sort of pop-up or popover.

### Side effects

Set up side effects for certain patches. For example, in order to easily enable Google Drive/Dropbox support. For more information, see: 
https://github.com/nicoverbruggen/kobopatch-webui/issues/10

This is probably the most difficult one because it also needs additional testing.
