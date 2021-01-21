# Change Log

All notable changes to this homebridge-platform-wemo will be documented in this file.

## BETA

### Changes

* Minimum Homebridge beta needed for Adaptive Lighting bumped to beta-46.
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
