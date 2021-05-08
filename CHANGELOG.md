# Change Log

All notable changes to this homebridge-platform-wemo will be documented in this file.

## BETA

### Changes

* Reduce 'No Response' timeout to 2 seconds
* Ensure user is using at least Homebridge v1.3.0

## 3.0.8 (2021-05-04)

### Changes

* Update config schema title and description for 'Manual Devices'
* Accessory 'identify' function will now add an entry to the log
* Backend refactoring, function and variable name changes

## 3.0.7 (2021-04-27)

### Changes

* Display Wemo Insight 'on time' as HH:MM:SS in logs
* More consistent logging on device errors, and helpful info for common errors

## 3.0.6 (2021-04-24)

### Changes

* Fix 'time on' and 'total consumption' calculations for Wemo Insights

## 3.0.5 (2021-04-16)

### Changes

* Fix characteristic NaN warning for `LastActivation`
* Update wiki links in the Homebridge plugin-ui

## 3.0.4 (2021-04-14)

### Changes

* Ensure 'No Response' is removed from Wemo Makers when discovered

## 3.0.3 (2021-04-14)

### Changes

* Fixes a characteristic issue with Wemo Maker devices

## 3.0.2 (2021-04-13)

### Changes

* Fix for `Cannot read property 'updateCharacteristic' of undefined` on plugin startup

## 3.0.1 (2021-04-13)

### Requirements

* **Homebridge Users**
  * This plugin has a minimum requirement of Homebridge v1.3.3

* **HOOBS Users**
  * This plugin has a minimum requirement of HOOBS v3.3.4

### Added

* For auto-discovered devices and devices manually-defined with a full address for which the given port does not work, the port scanner will now check to see if a different port is working and setup the device using this new port
* On Homebridge restart, devices will show as 'No Response' until discovered
* 'No Response' messages for devices if controlled and unsuccessful (and this status will be reverted after 5 seconds)
* Debug log messages showing data sent to devices when controlled

### Changes

* Use the new `.onGet`/`.onSet` methods available in Homebridge v1.3
* Logs will show IP and port on device initiation instead of mac address
* Updated plugin-ui 'Support' page links to match GitHub readme file
* Updated README to reflect minimum supported Homebridge/HOOBS and Node versions
* Updated recommended Node to v14.16.1

## 2.15.2 (2021-03-21)

### Changes

* Correct `debugFakegato` setting to type boolean
* More welcome messages
* Updated `plugin-ui-utils` dependency

## 2.15.1 (2021-03-17)

### Changes

* Modified config schema to show titles/descriptions for non Homebridge UI users

## 2.15.0 (2021-03-14)

### Added

* Device's current state will be requested immediately when initialised into Homebridge
* Optional polling setting for newer **Wemo Dimmers** that don't automatically notify the plugin when the brightness is changed externally
* Optional 'timeout' setting for **Wemo Insight** to configure a minimum time between wattage log entries

### Changes

* Open/close time setting for **Wemo Makers** will be hidden if device is set to expose as switch
* **Wemo Makers** no longer need 'dummy' contact sensor to view Eve history
  * For this reason, the `exposeContactSensor` setting is now redundant and so has been removed
* Adaptive Lighting now requires Homebridge 1.3 release
* **Wemo Crockpot** polling interval will be stopped if Homebridge shuts down

## 2.14.0 (2021-03-02)

### Added

* A `label` setting per device group which has no effect except to help identify the device when editing the configuration
* [experimental] Expose a Contact Sensor service for your Wemo Maker (via the plugin settings, when configured as a Garage Door) to show more information in the Eve app, including:
  * when the door was last open
  * how many times it's been opened
  * for how long the garage door was open each time

### Changes

* Plugin will now check if a device is ignored by the device USN at an earlier stage of being discovered
* Updated minimum Node to v14.16.0

## 2.13.0 (2021-02-17)

### Added

* **Configuration**
  * Explicitly enable device logging *per* device if you have `disableDeviceLogging` set to `true`
  * `brightnessStep` option to specify a brightness step in the Home app per Wemo Dimmer/Bulb
  * `adaptiveLightingShift` option to offset the Adaptive Lighting values per Wemo Bulb
* Plugin-UI shows an status icon next to the reachability + shows device firmware
* In debug mode, the plugin will log each device's customised options when initialised

### Changes

* Raised minimum Homebridge beta required for Adaptive Lighting to 1.3.0-beta.58
* Disable Adaptive Lighting if the plugin detects a significant colour change (i.e. controlled externally)
* Fixes a uuid error when adding Insights to Homebridge

## 2.12.0 (2021-02-13)

### Added

* A queue for device loading to improve reliability for users with a lot of Wemo devices
* Configuration checks to highlight any unnecessary or incorrectly formatted settings you have
* Network Settings section to the Homebridge UI where you can configure the settings that were the `wemoClient` settings
* Links to 'Configuration' and 'Uninstall' wiki pages in the plugin-ui

### Changes

* ⚠️ `disableDiscovery`, `noMotionTimer`, `doorOpenTimer` and `outletAsSwitch` settings no longer have any effect
* Adapted port scanning method which now checks the reachability of the `setup.xml` file
* Hide unused modes for `HeaterCooler` services for Wemo Heater, Dehumidifier, Purifier and Crockpot
* Error messages refactored to show the most useful information
* Updated minimum Homebridge to v1.1.7
* Updated minimum Node to v14.15.5
* Fakegato library formatting and simplification
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
