/* jshint -W014, -W033, esversion: 9 */
/* eslint-disable new-cap */
'use strict'
const helpers = require('./../helpers')
module.exports = class deviceLightDimmer {
  constructor (platform, accessory, device) {
    this.log = platform.log
    this.debug = platform.debug
    this.disableDeviceLogging = platform.config.disableDeviceLogging || false
    this.Service = platform.api.hap.Service
    this.Characteristic = platform.api.hap.Characteristic
    let service
    if (!(service = accessory.getService(this.Service.Lightbulb))) {
      accessory.addService(this.Service.Lightbulb)
      service = accessory.getService(this.Service.Lightbulb)
      service.addCharacteristic(this.Characteristic.Brightness)
    }
    service
      .getCharacteristic(this.Characteristic.On)
      .on('set', (value, callback) => this.internalSwitchUpdate(value, callback))
    service
      .getCharacteristic(this.Characteristic.Brightness)
      .on('set', (value, callback) => this.internalBrightnessUpdate(value, callback))
    this.accessory = accessory
    this.client = accessory.client
    this.client.on('binaryState', value => this.externalSwitchUpdate(parseInt(value)))
    this.client.on('brightness', value => this.externalBrightnessUpdate(parseInt(value)))
  }

  async internalSwitchUpdate (value, callback) {
    const service = this.accessory.getService(this.Service.Lightbulb)
    const prevState = service.getCharacteristic(this.Characteristic.On).value
    try {
      callback()
      await this.client.soapAction('urn:Belkin:service:basicevent:1', 'SetBinaryState', { BinaryState: value ? 1 : 0 })
      if (!this.disableDeviceLogging) this.log('[%s] setting state to [%s].', this.accessory.displayName, value ? 'on' : 'off')
      if (!value) return
      try {
        const data = await this.client.soapAction('urn:Belkin:service:basicevent:1', 'GetBinaryState', null)
        const newBright = parseInt(data.brightness)
        service.updateCharacteristic(this.Characteristic.Brightness, newBright)
        if (!this.disableDeviceLogging) this.log('[%s] updating brightness to [%s%].', this.accessory.displayName, newBright)
      } catch (err) {
        this.log.warn('[%s] error updating brightness upon setting state to [on]:\n%s.', this.accessory.displayName, err)
      }
    } catch (err) {
      this.log.warn('[%s] setting state to [%s] error:\n%s', this.accessory.displayName, value ? 'on' : 'off', err)
      this.log.warn('[%s] Reverting HomeKit status due to error.', this.accessory.displayName)
      await helpers.sleep(1000)
      service.updateCharacteristic(this.Characteristic.On, prevState)
    }
  }

  async internalBrightnessUpdate (value, callback) {
    const service = this.accessory.getService(this.Service.Lightbulb)
    const prevState = service.getCharacteristic(this.Characteristic.Brightness).value
    try {
      callback()
      const updateKey = Math.random().toString(36).substr(2, 8)
      this.accessory.context.updateKey = updateKey
      await helpers.sleep(250)
      if (updateKey !== this.accessory.context.updateKey) return
      await this.client.soapAction('urn:Belkin:service:basicevent:1', 'SetBinaryState', {
        BinaryState: value === 0 ? 0 : 1,
        brightness: value
      })
    } catch (err) {
      this.log.warn('[%s] setting brightness to [%s%] error:\n%s', this.accessory.displayName, value, err)
      this.log.warn('[%s] Reverting HomeKit status due to error.', this.accessory.displayName)
      await helpers.sleep(1000)
      service.updateCharacteristic(this.Characteristic.Brightness, prevState)
    }
  }

  async externalSwitchUpdate (value) {
    try {
      value = value !== 0
      const service = this.accessory.getService(this.Service.Lightbulb)
      const switchState = service.getCharacteristic(this.Characteristic.On).value
      if (switchState !== value) {
        service.updateCharacteristic(this.Characteristic.On, value)
        if (!this.disableDeviceLogging) this.log('[%s] updating state to [%s].', this.accessory.displayName, value ? 'on' : 'off')
        if (!value) return
        try {
          const data = await this.client.soapAction('urn:Belkin:service:basicevent:1', 'GetBinaryState', null)
          const newBright = parseInt(data.brightness)
          service.updateCharacteristic(this.Characteristic.Brightness, newBright)
          if (!this.disableDeviceLogging) this.log('[%s] updating brightness to [%s%].', this.accessory.displayName, newBright)
        } catch (err) {
          this.log.warn('[%s] error updating brightness upon updating state to [on]:\n%s.', this.accessory.displayName, err)
        }
      }
    } catch (err) {
      this.log.warn('[%s] updating state to [%s] error - %s', this.accessory.displayName, value ? 'on' : 'off', err)
    }
  }

  externalBrightnessUpdate (value) {
    try {
      const service = this.accessory.getService(this.Service.Lightbulb)
      const currentBrightness = service.getCharacteristic(this.Characteristic.Brightness).value
      if (currentBrightness !== value) {
        service.updateCharacteristic(this.Characteristic.Brightness, value)
        if (!this.disableDeviceLogging) this.log('[%s] updating brightness to [%s%].', this.accessory.displayName, value)
      }
    } catch (err) {
      this.log.warn('[%s] updating brightness to [%s%] error - %s', this.accessory.displayName, value, err)
    }
  }
}
