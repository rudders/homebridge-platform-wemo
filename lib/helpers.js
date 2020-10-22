/* jshint -W014, -W033, esversion: 9 */
/* eslint-disable new-cap */
'use strict'
module.exports = {
  sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
  hasProperty: (obj, prop) => Object.prototype.hasOwnProperty.call(obj, prop),
  doorOpenTimer: 20,
  noMotionTimer: 60,
  discoveryInterval: 30,
  linkAcc: {
    brightness: '10008',
    color: '10300',
    switch: '10006',
    temperature: '30301'
  },
  deviceTypes: {
    Bridge: 'urn:Belkin:device:bridge:1',
    Switch: 'urn:Belkin:device:controllee:1',
    Motion: 'urn:Belkin:device:sensor:1',
    Maker: 'urn:Belkin:device:Maker:1',
    Insight: 'urn:Belkin:device:insight:1',
    LightSwitch: 'urn:Belkin:device:lightswitch:1',
    Dimmer: 'urn:Belkin:device:dimmer:1',
    Humidifier: 'urn:Belkin:device:Humidifier:1',
    HeaterB: 'urn:Belkin:device:HeaterB:1',
    NetCamSensor: 'urn:Belkin:device:NetCamSensor:1'
  },
  garageStates: {
    Open: 0,
    Closed: 1,
    Opening: 2,
    Closing: 3,
    Stopped: 4
  }
}
