# Change Log

All notable changes to this homebridge-platform-wemo will be documented in this file.

## BETA

### ⚠️ Notable Change

* Changes to the discovery process
  * Description coming soon...

### New

* Support for the Wemo Outdoor Plug
* Cumulative `TotalConsumption` for Insight devices
  * This changes the current method of resetting each day
  * This can be reverted back to resetting each day in the plugin settings with the `showTodayTC` config option
* Set a custom `OutletInUse` wattage threshold per Insight device
* Set a custom `noMotionTimer` per Wemo motion device (NetCam/Motion Sensor)
  * If this is not configured then the plugin will continue to use the global `noMotionTimer` setting per motion device
  * If the global setting is not configured then the plugin will use the default of 60 seconds

### Changes

* Logging for manual devices that cause errors when loading (e.g. IP/port change)

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
