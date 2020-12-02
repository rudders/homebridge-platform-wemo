/* jshint -W014, -W033, esversion: 9 */
/* eslint-disable new-cap */
'use strict'
module.exports = class deviceLightDimmer {
  constructor (platform, accessory, device) {
    this.log = platform.log
    this.helpers = platform.helpers
    this.debug = platform.debug
    this.disableDeviceLogging = platform.config.disableDeviceLogging || false
    this.Service = platform.api.hap.Service
    this.Characteristic = platform.api.hap.Characteristic
    if (!(this.service = accessory.getService(this.Service.Lightbulb))) {
      this.service = accessory.addService(this.Service.Lightbulb)
      this.service.addCharacteristic(this.Characteristic.Brightness)
    }
    this.service
      .getCharacteristic(this.Characteristic.On)
      .removeAllListeners('set')
      .on('set', this.internalSwitchUpdate.bind(this))
    this.service
      .getCharacteristic(this.Characteristic.Brightness)
      .removeAllListeners('set')
      .on('set', this.internalBrightnessUpdate.bind(this))
    this.accessory = accessory
    this.client = accessory.client
    this.client.on('binaryState', value => this.externalSwitchUpdate(parseInt(value)))
    this.client.on('brightness', value => this.externalBrightnessUpdate(parseInt(value)))
  }

  async internalSwitchUpdate (value, callback) {
    const prevState = this.service.getCharacteristic(this.Characteristic.On).value
    try {
      callback()
      await this.client.soapAction('urn:Belkin:service:basicevent:1', 'SetBinaryState', { BinaryState: value ? 1 : 0 })
      if (!this.disableDeviceLogging) this.log('[%s] setting state to [%s].', this.accessory.displayName, value ? 'on' : 'off')
      if (!value) return
      try {
        const data = await this.client.soapAction('urn:Belkin:service:basicevent:1', 'GetBinaryState', null)
        const newBright = parseInt(data.brightness)
        this.service.updateCharacteristic(this.Characteristic.Brightness, newBright)
        if (!this.disableDeviceLogging) this.log('[%s] updating brightness to [%s%].', this.accessory.displayName, newBright)
      } catch (err) {
        this.log.warn('[%s] error updating brightness upon setting state to [on]:\n%s.', this.accessory.displayName, err)
      }
    } catch (err) {
      this.log.warn(
        '[%s] setting state to [%s] error: %s.',
        this.accessory.displayName,
        value ? 'on' : 'off',
        this.debug ? '\n' + err : err.message
      )
      this.log.warn('[%s] reverting HomeKit status due to error.', this.accessory.displayName)
      await this.helpers.sleep(1000)
      this.service.updateCharacteristic(this.Characteristic.On, prevState)
    }
  }

  async internalBrightnessUpdate (value, callback) {
    const prevState = this.service.getCharacteristic(this.Characteristic.Brightness).value
    try {
      callback()
      const updateKey = Math.random().toString(36).substr(2, 8)
      this.accessory.context.updateKey = updateKey
      await this.helpers.sleep(250)
      if (updateKey !== this.accessory.context.updateKey) return
      await this.client.soapAction('urn:Belkin:service:basicevent:1', 'SetBinaryState', {
        BinaryState: value === 0 ? 0 : 1,
        brightness: value
      })
    } catch (err) {
      this.log.warn(
        '[%s] setting brightness to [%s%] error: %s.',
        this.accessory.displayName,
        value,
        this.debug ? '\n' + err : err.message
      )
      this.log.warn('[%s] reverting HomeKit status due to error.', this.accessory.displayName)
      await this.helpers.sleep(1000)
      this.service.updateCharacteristic(this.Characteristic.Brightness, prevState)
    }
  }

  async externalSwitchUpdate (value) {
    try {
      value = value !== 0
      const switchState = this.service.getCharacteristic(this.Characteristic.On).value
      if (switchState !== value) {
        this.service.updateCharacteristic(this.Characteristic.On, value)
        if (!this.disableDeviceLogging) this.log('[%s] updating state to [%s].', this.accessory.displayName, value ? 'on' : 'off')
        if (!value) return
        try {
          const data = await this.client.soapAction('urn:Belkin:service:basicevent:1', 'GetBinaryState', null)
          const newBright = parseInt(data.brightness)
          this.service.updateCharacteristic(this.Characteristic.Brightness, newBright)
          if (!this.disableDeviceLogging) this.log('[%s] updating brightness to [%s%].', this.accessory.displayName, newBright)
        } catch (err) {
          this.log.warn('[%s] error updating brightness upon updating state to [on]:\n%s.', this.accessory.displayName, err)
        }
      }
    } catch (err) {
      this.log.warn(
        '[%s] updating state to [%s] error: %s.',
        this.accessory.displayName,
        value ? 'on' : 'off',
        this.debug ? '\n' + err : err.message
      )
    }
  }

  externalBrightnessUpdate (value) {
    try {
      const currentBrightness = this.service.getCharacteristic(this.Characteristic.Brightness).value
      if (currentBrightness !== value) {
        this.service.updateCharacteristic(this.Characteristic.Brightness, value)
        if (!this.disableDeviceLogging) this.log('[%s] updating brightness to [%s%].', this.accessory.displayName, value)
      }
    } catch (err) {
      this.log.warn(
        '[%s] updating brightness to [%s%] error: %s.',
        this.accessory.displayName,
        value,
        this.debug ? '\n' + err : err.message
      )
    }
  }
}
