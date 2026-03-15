# Device Identification

## Source: `.kobo/version`

The file contains a single line with 6 comma-separated fields:

```
N4284B5215352,4.9.77,4.45.23646,4.9.77,4.9.77,00000000-0000-0000-0000-000000000390
```

| Index | Value | Meaning |
|-------|-------|---------|
| 0 | `N4284B5215352` | Device serial number |
| 1 | `4.9.77` | Unknown (kernel version?) |
| 2 | `4.45.23646` | **Firmware version** (what kobopatch matches against) |
| 3 | `4.9.77` | Unknown |
| 4 | `4.9.77` | Unknown |
| 5 | `00000000-0000-0000-0000-000000000390` | Hardware platform UUID |

## Serial Prefix → Model Mapping

The first 3-4 characters of the serial identify the device model.
Source: https://help.kobo.com/hc/en-us/articles/360019676973

### Current eReaders

| Prefix | Model |
|--------|-------|
| N428 | Kobo Libra Colour |
| N367 | Kobo Clara Colour |
| N365 / P365 | Kobo Clara BW |
| N605 | Kobo Elipsa 2E |
| N506 | Kobo Clara 2E |
| N778 | Kobo Sage |
| N418 | Kobo Libra 2 |
| N604 | Kobo Elipsa |
| N306 | Kobo Nia |
| N873 | Kobo Libra H2O |
| N782 | Kobo Forma |
| N249 | Kobo Clara HD |

### Older eReaders

| Prefix | Model |
|--------|-------|
| N867 | Kobo Aura H2O Edition 2 |
| N709 | Kobo Aura ONE |
| N236 | Kobo Aura Edition 2 |
| N587 | Kobo Touch 2.0 |
| N437 | Kobo Glo HD |
| N250 | Kobo Aura H2O |
| N514 | Kobo Aura |
| N204 | Kobo Aura HD |
| N613 | Kobo Glo |
| N705 | Kobo Mini |
| N905 | Kobo Touch |
| N416 | Kobo Original |
| N647 / N47B | Kobo Wireless |

## Firmware

- The user provides their own firmware zip (not hosted by us for legal reasons)
- Both Libra Colour and Clara BW/Colour currently use firmware `4.45.23646`
- The firmware zip filename matches what `kobopatch.yaml` references: `kobo-update-4.45.23646.zip`
- Different device families may have different firmware zips even for the same version number
