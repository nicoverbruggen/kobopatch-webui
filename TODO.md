# TODO

## NickelMenu flow

### Consider making the required preset optional

When the user selects "Install with preset", the default menu items and "Tweak" label + icon should be optional but checked by default. This should be easier to achieve now that the way the NickelMenu config file is generated, has changed.

## Custom patches

### Import from manifest

Currently, manifests are written when applying custom patches and when installing the NickelMenu preset. 

When using custom patches, the app should automatically suggest loading the previous configuration.

### Side effects (to be looked at later)

Set up side effects for certain patches. For example, in order to easily enable Google Drive/Dropbox support. For more information, see: 
https://github.com/nicoverbruggen/kobopatch-webui/issues/10

This is probably the most difficult one because it also needs additional testing.
