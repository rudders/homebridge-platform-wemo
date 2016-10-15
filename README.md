# homebridge-platform-wemo
[![NPM Version](https://img.shields.io/npm/v/homebridge-platform-wemo.svg)](https://www.npmjs.com/package/homebridge-platform-wemo)
[![Code Climate](https://codeclimate.com/github/rudders/homebridge-platform-wemo/badges/gpa.svg)](https://codeclimate.com/github/rudders/homebridge-platform-wemo)

Belkin WeMo Platform plugin for the awesome  [Homebridge](https://github.com/nfarina/homebridge) project.

## Currently supports
- Wemo Switch
- Wemo Light Switch 
- Wemo Insight Switch
- Wemo Bulb (via Wemo Link - on/off/brightness)
- Wemo Maker (as Garage Door Opener or Switch with Contact Sensor)
- Wemo Motion
- Wemo NetCam (Sensor)

# Installation

1. Install homebridge using: `npm install -g homebridge`
2. Install this plugin using: `npm install -g homebridge-platform-wemo`
3. Update your configuration file. See the sample below.

# Updating

Recently refactored to increase speed of operation and update on/off/brightness status more reliably.

1. npm update -g homebridge-platform-wemo

# Configuration

Configuration sample:

`noMotionTimer` is optional, defaults to 60 and applies to WeMo Motion only. It is a timer in seconds for how long after motion is not detected that the state is changed.

`doorOpenTimer` is optional, defaults to 15 and applies to WeMo Maker only (Garage Door Opener mode). The time in seconds for how long it takes the garage door to open. It is used to generate the `Open` state after the door has been requested to `Open`, due to only having one input. If `Sensor` is set to `No` in the WeMo app, the time is also used to generate the `Closed` state (**Not Recommended**)

`ignoredDevices` is optional. Expects an array of serial numbers, any devices found with matching serial numbers will be skipped or removed from Homebridge

 ```javascript
    "platforms": [
        {
          "platform": "BelkinWeMo",
          "name": "WeMo Platform",
          "noMotionTimer": 60,
          "ignoredDevices": []
        }   
    ]

```

# Credits

Credit goes to
- Timon Reinhard for his awesome [Wemo Client](https://github.com/timonreinhard/wemo-client) module and advise 
- Andy Lindeman for the [homebridge-smartthings](https://github.com/alindeman/homebridge-smartthings) that this is work is based on.
- [David Parry](https://github.com/devbobo) for his contributions.

# License

Published under the MIT License.
