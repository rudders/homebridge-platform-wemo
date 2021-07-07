# Change Log

All notable changes to this homebridge-platform-wemo will be documented in this file.

## 3.2.1 (2021-07-07)

### Fixed

- An issue initialising Wemo light switch devices ([#262](https://github.com/bwp91/homebridge-platform-wemo/issues/262))

## 3.2.0 (2021-07-07)

### Added

- **Accessory Logging**
  - `overrideLogging` setting per device type (to replace the removed `overrideDisabledLogging`), which can be set to (and will override the global device logging and debug logging settings):
    - `"default"` to follow the global device update and debug logging setting for this accessory (default if setting not set)
    - `"standard"` to enable device update logging but disable debug logging for this accessory
    - `"debug"` to enable device update and debug logging for this accessory
    - `"disable"` to disable device update and debug logging for this accessory
- **Wemo Outlets & Insights**
  - More consistent settings to expose these devices as an _Outlet_ (default), _Switch_ or _AirPurifier_ accessory types
- **Wemo Bulbs**
  - Transition time config option for brightness and colour temperature changes for Wemo Bulbs (via Link)
  - Remove Adaptive Lighting feature from a device by setting the `adaptiveLightingShift` to `-1`
- **Node-SSDP**
  - Added option to enable node-ssdp library debugging

### Changed

- **Homebridge UI**
  - More interactive Homebridge UI - device configuration will expand once device ID entered
- **Wemo Crockpot**
  - Changed the cooking-time-remaining format in logs to HH:MM
- **Other**
  - Small changes to the startup logging
  - Recommended node version bump to v14.17.3

### Fixed

- A `device.serviceList.service.forEach is not a function` log warning

### Removed

- `ContactSensorState` and other unused characteristics removed from Wemo Maker's `GarageDoorOpener` service
- `OutletInUse` characteristic from Wemo Outlet (not Insight) as this value is always the same as the actual state
- `overrideDisabledLogging` setting for each accessory type (replaced with `overrideLogging` setting)
- `showAsSwitch` setting for Wemo Outlets (replaced with `showAs` setting)

## 3.1.0 (2021-05-26)

### Added

- Expose a Wemo Outlet as a _AirPurifier_ accessory type [[#257](https://github.com/bwp91/homebridge-platform-wemo/issues/257)]

### Changed

- Use `standard-prettier` code formatting
- Recommended node version bump to v14.17.0

## 3.0.9 (2021-05-10)

### Changed

- Reduce 'No Response' timeout to 2 seconds
- Update the correct corresponding characteristic after the 'No Response' timeout
- Ensure user is using at least Homebridge v1.3.0

## 3.0.8 (2021-05-04)

### Changed

- Update config schema title and description for 'Manual Devices'
- Accessory 'identify' function will now add an entry to the log
- Backend refactoring, function and variable name changes

## 3.0.7 (2021-04-27)

### Changed

- Display Wemo Insight 'on time' as HH:MM:SS in logs
- More consistent logging on device errors, and helpful info for common errors

## 3.0.6 (2021-04-24)

### Fixed

- Fix 'time on' and 'total consumption' calculations for Wemo Insights

## 3.0.5 (2021-04-16)

### Changed

- Update wiki links in the Homebridge plugin-ui

### Fixed

- Fix characteristic NaN warning for `LastActivation`

## 3.0.4 (2021-04-14)

### Fixed

- Ensure 'No Response' is removed from Wemo Makers when discovered

## 3.0.3 (2021-04-14)

### Fixed

- Fixes a characteristic issue with Wemo Maker devices

## 3.0.2 (2021-04-13)

### Fixed

- Fix for `Cannot read property 'updateCharacteristic' of undefined` on plugin startup

## 3.0.1 (2021-04-13)

### Requirements

- **Homebridge Users**
  - This plugin has a minimum requirement of Homebridge v1.3.3
- **HOOBS Users**
  - This plugin has a minimum requirement of HOOBS v3.3.4

### Added

- For auto-discovered devices and devices manually-defined with a full address for which the given port does not work, the port scanner will now check to see if a different port is working and setup the device using this new port
- On Homebridge restart, devices will show as 'No Response' until discovered
- 'No Response' messages for devices if controlled and unsuccessful (and this status will be reverted after 5 seconds)
- Debug log messages showing data sent to devices when controlled

### Changed

- Use the new `.onGet`/`.onSet` methods available in Homebridge v1.3
- Logs will show IP and port on device initiation instead of mac address
- Updated plugin-ui 'Support' page links to match GitHub readme file
- Updated README to reflect minimum supported Homebridge/HOOBS and Node versions
- Updated recommended Node to v14.16.1

## 2.15.2 (2021-03-21)

### Changed

- More welcome messages
- Updated `plugin-ui-utils` dependency

### Fixed

- Correct `debugFakegato` setting to type boolean

## 2.15.1 (2021-03-17)

### Changed

- Modified config schema to show titles/descriptions for non Homebridge UI users

## 2.15.0 (2021-03-14)

### Added

- Device's current state will be requested immediately when initialised into Homebridge
- Optional polling setting for newer **Wemo Dimmers** that don't automatically notify the plugin when the brightness is changed externally
- Optional 'timeout' setting for **Wemo Insight** to configure a minimum time between wattage log entries

### Changed

- Open/close time setting for **Wemo Makers** will be hidden if device is set to expose as switch
- **Wemo Makers** no longer need 'dummy' contact sensor to view Eve history
  - For this reason, the `exposeContactSensor` setting is now redundant and so has been removed
- Adaptive Lighting now requires Homebridge 1.3 release
- **Wemo Crockpot** polling interval will be stopped if Homebridge shuts down

## 2.14.0 (2021-03-02)

### Added

- A `label` setting per device group which has no effect except to help identify the device when editing the configuration
- [experimental] Expose a Contact Sensor service for your Wemo Maker (via the plugin settings, when configured as a Garage Door) to show more information in the Eve app, including:
  - when the door was last open
  - how many times it's been opened
  - for how long the garage door was open each time

### Changed

- Plugin will now check if a device is ignored by the device USN at an earlier stage of being discovered
- Updated minimum Node to v14.16.0

## 2.13.0 (2021-02-17)

### Added

- **Configuration**
  - Explicitly enable device logging _per_ device if you have `disableDeviceLogging` set to `true`
  - `brightnessStep` option to specify a brightness step in the Home app per Wemo Dimmer/Bulb
  - `adaptiveLightingShift` option to offset the Adaptive Lighting values per Wemo Bulb
- Plugin-UI shows an status icon next to the reachability + shows device firmware
- In debug mode, the plugin will log each device's customised options when initialised

### Changed

- Raised minimum Homebridge beta required for Adaptive Lighting to 1.3.0-beta.58
- Disable Adaptive Lighting if the plugin detects a significant colour change (i.e. controlled externally)

### Fixed

- Fixes a uuid error when adding Insights to Homebridge

## 2.12.0 (2021-02-13)

### Added

- A queue for device loading to improve reliability for users with a lot of Wemo devices
- Configuration checks to highlight any unnecessary or incorrectly formatted settings you have
- Network Settings section to the Homebridge UI where you can configure the settings that were the `wemoClient` settings
- Links to 'Configuration' and 'Uninstall' wiki pages in the plugin-ui

### Changed

- ⚠️ `disableDiscovery`, `noMotionTimer`, `doorOpenTimer` and `outletAsSwitch` settings no longer have any effect
- Adapted port scanning method which now checks the reachability of the `setup.xml` file
- Hide unused modes for `HeaterCooler` services for Wemo Heater, Dehumidifier, Purifier and Crockpot
- Error messages refactored to show the most useful information
- Updated minimum Homebridge to v1.1.7
- Updated minimum Node to v14.15.5
- Fakegato library formatting and simplification
- [Backend] Code refactoring

## 2.11.0 (2021-02-01)

### Changed

- **Configuration Changes**
  - These changes are backwards compatible with existing setups
  - New 'Wemo Outlets' section to define outlets to show as switches
  - Removal of `removeByName` from the UI, this setting is still available manually
  - Deprecation of the following settings:
    - `disableDiscovery` - now has no effect
    - `doorOpenTimer` - now configured per Wemo Maker device in the 'Wemo Makers' section
    - `noMotionTimer` - now configured per Wemo Motion device in the 'Wemo Motions' section
    - `outletAsSwitch` - now configured per Wemo Outlet device in the 'Wemo Outlets' section
  - These deprecated settings have their own section in the plugin UI
- Clean up the plugin-ui by removing unnecessary descriptions

### Fixed

- Properly catch exceptions on SSDP search errors
- Fixes a bug when initialising Garage Doors

## 2.10.0 (2021-01-30)

### Added

- New configuration option `mode` to choose between:
  - `mode: "auto"` the plugin will auto-discover devices **and** configure manual devices (default if option not set)
  - `mode: "manual"` the plugin will **only** configure manual devices
- Support for the Wemo Outdoor Plug
- [Experimental] Automatic port scan for manual devices
  - Use a full address `http://192.168.1.X:49153/setup.xml` as before to fully configure a manual device
  - Use an IP `192.168.1.X` to let the plugin scan between ports 49152 - 49155 and choose the correct port
- Set a custom `noMotionTimer` per Wemo motion device (NetCam/Motion Sensor)
  - If this is not configured then the plugin will continue to use the global `noMotionTimer` setting per motion device
  - If the global setting is not configured then the plugin will use the default of 60 seconds
- Cumulative `TotalConsumption` for Insight devices
  - This changes the current method of resetting each day
  - This can be reverted back to resetting each day in the plugin settings with the `showTodayTC` config option
- Set a custom `wattDiff` (wattage difference) for Insight devices - the plugin will not log consecutive wattage updates if the difference from the previous is less than this value (default: `0`)

### Changed

- `discoveryInterval` now needs a minimum value of `15` and discovery cannot be disabled
  - Existing configurations with lower value will be disregarded and `15` will be used
  - The option of disabling the discovery interval has been removed as this interval is essential for correcting connection issues for all your Wemo devices
- Logging for manual devices that cause errors when loading (e.g. IP/port change)
- More consistent and clearer error logging
- Updated plugin-ui-utils dep and use new method to get cached accessories

### Fixed

- Fixes an issue where the Insight would consistently log outlet-in-use between true and false

## 2.9.1 (2021-01-21)

### Changed

- Minimum Homebridge beta needed for Adaptive Lighting bumped to beta-46
- Fakegato logging disabled in Homebridge `debug` mode, can be explicitly enabled with `debugFakegato`
- Unsupported device types to show urn in logs

### Fixed

- Fixes a 'multiple callback' issue with Fakegato history service

## 2.9.0 (2021-01-14)

### Added

- New configuration option `removeByName` to remove 'orphan' accessories from the cache
- (Backend) Gracefully close listener server and ssdp client on Homebridge shutdown
- Created CHANGELOG.md

### Changed

- Modifications to the layout of the plugin settings screen
- Removal of maximum value for `number` types on plugin settings screen
- Remove `renewing subscription` log entries which appeared repetitively in plugin `debug` mode
- `subscription error` log entries will now always appear, not just when in plugin `debug` mode
- Changes to startup log messages
- Backend code changes
