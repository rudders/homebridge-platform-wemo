# Change Log

All notable changes to this homebridge-platform-wemo will be documented in this file.

## BETA

### Added

* A queue for device loading to improve reliability for users with a lot of Wemo devices
* Configuration checks to highlight any unnecessary or incorrectly formatted settings you have
* Links to 'Configuration' and 'Uninstall' wiki pages in the plugin-ui

### Changes

* Adapted port scanning method which now checks the reachability of the `setup.xml` file
* ⚠️ `disableDiscovery`, `noMotionTimer` and `doorOpenTimer` settings no longer have any effect
* Hide unused modes for `HeaterCooler` services for Wemo Heater, Dehumidifier, Purifier and Crockpot
* Error messages refactored to show the most useful information
* Updated minimum Homebridge to v1.1.7
* Updated minimum Node to v14.15.5
* [Backend] Code refactoring

## 2.11.0 (2021-02-01)

### Changes

* **Configuration Changes**
  * These changes are backwards compatible with existing setups
  * New 'Wemo Outlets' section to define outlets to show as switches
  * Removal of `removeByName` from the UI, this setting is still available manually
  * Deprecation of the following settings:
    * `disableDiscovery` - now has no effect
    * `doorOpenTimer` - now configured per Wemo Maker device in the 'Wemo Makers' section
    * `noMotionTimer` - now configured per Wemo Motion device in the 'Wemo Motions' section
    * `outletAsSwitch` - now configured per Wemo Outlet device in the 'Wemo Outlets' section
  * These deprecated settings have their own section in the plugin UI
* Properly catch exceptions on SSDP search errors
* Clean up the plugin-ui by removing unnecessary descriptions
* Fixes a bug when initialising Garage Doors

## 2.10.0 (2021-01-30)

### Notable Changes

* New configuration option `mode` to choose between:
  * `mode: "auto"` the plugin will auto-discover devices **and** configure manual devices (default if option not set)
  * `mode: "manual"` the plugin will **only** configure manual devices
* `discoveryInterval` now needs a minimum value of `15` and discovery cannot be disabled
  * Existing configurations with lower value will be disregarded and `15` will be used
  * The option of disabling the discovery interval has been removed as this interval is essential for correcting connection issues for all your Wemo devices

### New

* Support for the Wemo Outdoor Plug
* [Experimental] Automatic port scan for manual devices
  * Use a full address `http://192.168.1.X:49153/setup.xml` as before to fully configure a manual device
  * Use an IP `192.168.1.X` to let the plugin scan between ports 49152 - 49155 and choose the correct port
* Set a custom `noMotionTimer` per Wemo motion device (NetCam/Motion Sensor)
  * If this is not configured then the plugin will continue to use the global `noMotionTimer` setting per motion device
  * If the global setting is not configured then the plugin will use the default of 60 seconds
* Cumulative `TotalConsumption` for Insight devices
  * This changes the current method of resetting each day
  * This can be reverted back to resetting each day in the plugin settings with the `showTodayTC` config option
* Set a custom `wattDiff` (wattage difference) for Insight devices - the plugin will not log consecutive wattage updates if the difference from the previous is less than this value (default: `0`)

### Changes

* Logging for manual devices that cause errors when loading (e.g. IP/port change)
* Fixes an issue where the Insight would consistently log outlet-in-use between true and false
* More consistent and clearer error logging
* Updated plugin-ui-utils dep and use new method to get cached accessories

## 2.9.1 (2021-01-21)

### Changes

* Minimum Homebridge beta needed for Adaptive Lighting bumped to beta-46
* Fixes a 'multiple callback' issue with Fakegato history service
* Fakegato logging disabled in Homebridge `debug` mode, can be explicitly enabled with `debugFakegato`
* Unsupported device types to show urn in logs

## 2.9.0 (2021-01-14)

### New
* New configuration option `removeByName` to remove 'orphan' accessories from the cache
* (Backend) Gracefully close listener server and ssdp client on Homebridge shutdown
* Created CHANGELOG.md

### Changes
* Modifications to the layout of the plugin settings screen
* Removal of maximum value for `number` types on plugin settings screen
* Remove `renewing subscription` log entries which appeared repetitively in plugin `debug` mode
* `subscription error` log entries will now always appear, not just when in plugin `debug` mode
* Changes to startup log messages
* Backend code changes
