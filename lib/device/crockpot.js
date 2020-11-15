/* jshint -W014, -W033, esversion: 9 */
/* eslint-disable new-cap */
'use strict'
// const entities = require('entities')
// const helpers = require('./../helpers')
// const xml2js = require('xml2js')
module.exports = class deviceCrockpot {
  constructor (platform, accessory, device) {
    this.log = platform.log
    this.debug = platform.debug
    this.disableDeviceLogging = platform.config.disableDeviceLogging || false
    this.Service = platform.api.hap.Service
    this.Characteristic = platform.api.hap.Characteristic
    this.service = accessory.getService(this.Service.HeaterCooler) || accessory.addService(this.Service.HeaterCooler)
    this.service
      .getCharacteristic(this.Characteristic.Active)
      .removeAllListeners('set')
      .on('set', this.internalActiveUpdate.bind(this))
    this.service
      .getCharacteristic(this.Characteristic.TargetHeaterCoolerState)
      .removeAllListeners('set')
      .setProps({
        validValues: [0]
      })
    this.service
      .getCharacteristic(this.Characteristic.HeatingThresholdTemperature)
      .removeAllListeners('set')
      .on('set', this.internalTargetTempUpdate.bind(this))
      .setProps({
        minStep: 5,
        minValue: 0,
        maxValue: 600
      })
    this.service
      .getCharacteristic(this.Characteristic.RotationSpeed)
      .removeAllListeners('set')
      .on('set', this.internalModeUpdate.bind(this))
      .setProps({
        minStep: 33
      })
    this.device = device
    this.accessory = accessory
    this.client = accessory.client
    this.getAttributes()
    // *** Crockpot has to be polled as it doesn't seem to send updates *** \\
    setInterval(() => this.getAttributes(), 120000)
    if (!this.accessory.context.cacheLastOnMode || this.accessory.context.cacheLastOnMode === 0) {
      this.accessory.context.cacheLastOnMode = 50
    }
    this.modeLabels = {
      0: 'off',
      50: 'warm',
      51: 'low',
      52: 'high'
    }
  }

  async getAttributes () {
    try {
      const data = await this.client.soapAction('urn:Belkin:service:basicevent:1', 'GetCrockpotState', null)
      const attributes = {}
      for (const [k, v] of Object.entries(data)) {
        if (['mode', 'time', 'cookedTime'].includes(k)) attributes[k] = v
      }
      /* EXAMPLE
      {
        mode: '0',
        time: '0',
        cookedTime: '0',
      }
      */
    } catch (err) {
      this.log.warn('[%s] getAttributes error: %s.', this.accessory.displayName, this.debug ? '\n' + err : err.message)
    }
  }
}
