# homebridge-platform-wemo
[![NPM Version](https://img.shields.io/npm/v/homebridge-platform-wemo.svg)](https://www.npmjs.com/package/homebridge-platform-wemo)
[![Code Climate](https://codeclimate.com/github/rudders/homebridge-platform-wemo/badges/gpa.svg)](https://codeclimate.com/github/rudders/homebridge-platform-wemo)

Belkin WeMo Platform plugin for the awesome  [Homebridge](https://github.com/nfarina/homebridge) project.

## Currently supports
- Wemo Switch
- Wemo Light Switch 
- Wemo Insight Switch (on/off/in use only)
- Wemo Bulb (via Wemo Link - on/off/brightness)
- Wemo Maker
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

`no_motion_timer` is optional, defaults to 60 and applies to WeMo Motion Only. It is a timer in seconds for how long after motion is not detected that the state is changed.

 ```javascript
    "platforms": [
        {
          "platform": "BelkinWeMo",
          "name": "WeMo Platform",
          "no_motion_timer": 60
        }   
    ]

```

The module will try and find all your WeMo Devices and make them available to HomeBridge / HomeKit / Siri. It will use the name you have set up with the Belkin app as the name used for Homekit and hence Siri so ensure your naming is distinct so poor Siri has some chance of getting you commands right. To change a name simply use the Wemo App on your smartphone and restart homebridge to pick up the changes.

The discovery process can be a little hit or miss with the Wemo platform so if all your devices are not discovered try restarting homebridge a few times and make sure all Lights (Bulbs) are on!

# ToDo

Update to increase the speed of status checking by persisting the WemoClient objects properly - work is in progress and may remove the necessity for the brute force crashing of homebridge if the expected number of devices isn't found.

# Credits

Credit goes to
- Timon Reinhard for his awesome [Wemo Client](https://github.com/timonreinhard/wemo-client) module and advise 
- Andy Lindeman for the [homebridge-smartthings](https://github.com/alindeman/homebridge-smartthings) that this is work is based on.
- [David Parry](https://github.com/devbobo) for his contributions.

# License

Published under the MIT License.
