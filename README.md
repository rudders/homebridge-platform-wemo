# homebridge-belkin-wemo

[![donate](https://img.shields.io/badge/%24-Buy%20me%20a%20coffee-ff69b4.svg)](https://www.buymeacoffee.com/devbobo)
[![Slack Channel](https://img.shields.io/badge/slack-homebridge--wemo-E01563.svg)](https://homebridgeteam.slack.com/messages/C0HSKCAR4/)


Belkin WeMo Platform plugin for the awesome  [Homebridge](https://github.com/nfarina/homebridge) project.

## Currently supports
- Wemo Switch
- Wemo Light Switch 
- Wemo Dimmer (As Light Switch, no dimming)
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

 ```javascript
    "platforms": [
        {
            "platform": "BelkinWeMo",
            "name": "WeMo Platform"
        }
    ]
```

Optional parameters:

`noMotionTimer` is optional, defaults to 60 and applies to WeMo Motion only. It is a timer in seconds for how long after motion is not detected that the state is changed.

`doorOpenTimer` is optional, defaults to 15 and applies to WeMo Maker only (Garage Door Opener mode). The time in seconds for how long it takes the garage door to open. It is used to generate the `Open` state after the door has been requested to `Open`, due to only having one input. If `Sensor` is set to `No` in the WeMo app, the time is also used to generate the `Closed` state (**Not Recommended**)

`ignoredDevices` is optional. Expects an array of serial numbers, any devices found with matching serial numbers will be skipped or removed from Homebridge

`manualDevices` is optional. Expects an array of device setup urls (eg. "http://192.168.1.20:49153/setup.xml") to be configured manually outside the device discovery process

`discovery` is optional, defaults to true. A way to disable device discovery if not required

`wemoClient` is optional. Expects an object of initialisation parameters to be passed to wemo-client.

 ```javascript
    "platforms": [
        {
            "platform": "BelkinWeMo",
            "name": "WeMo Platform",
            "noMotionTimer": 60,
            "ignoredDevices": [],
            "manualDevices": [],
            "discovery": true,
            "wemoClient": {         // this is an example, please don't copy and paste this.
                port: 1234,
                discover_opts: {
                    unicastBindPort: 1235
                },
                listen_interface: 'wlan0'
            }
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
