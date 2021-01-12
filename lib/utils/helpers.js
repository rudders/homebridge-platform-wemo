/* jshint -W014, -W033, esversion: 9 */
/* eslint-disable new-cap */
'use strict'
module.exports = {
  sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
  hasProperty: (obj, prop) => Object.prototype.hasOwnProperty.call(obj, prop),
  decodeXML: xml => {
    return xml
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#039;/g, "'")
      .replace(/&amp;/g, '&')
  },
  defaults: {
    discoveryInterval: 30,
    doorOpenTimer: 20,
    noMotionTimer: 60
  }
  deviceTypes: {
    Bridge: 'urn:Belkin:device:bridge:1',
    Switch: 'urn:Belkin:device:controllee:1',
    Motion: 'urn:Belkin:device:sensor:1',
    Maker: 'urn:Belkin:device:Maker:1',
    Insight: 'urn:Belkin:device:insight:1',
    LightSwitch: 'urn:Belkin:device:lightswitch:1',
    Dimmer: 'urn:Belkin:device:dimmer:1',
    Humidifier: 'urn:Belkin:device:Humidifier:1',
    HeaterA: 'urn:Belkin:device:HeaterA:1',
    HeaterB: 'urn:Belkin:device:HeaterB:1',
    Crockpot: 'urn:Belkin:device:crockpot:1',
    Purifier: 'urn:Belkin:device:AirPurifier:1',
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
