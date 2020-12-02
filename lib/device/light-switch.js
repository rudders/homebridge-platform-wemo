/* jshint -W014, -W033, esversion: 9 */
/* eslint-disable new-cap */
'use strict'
module.exports = class deviceLightSwitch {
  constructor (platform, accessory, device) {
    this.log = platform.log
    this.helpers = platform.helpers
    this.debug = platform.debug
    this.disableDeviceLogging = platform.config.disableDeviceLogging || false
    this.Service = platform.api.hap.Service
    this.Characteristic = platform.api.hap.Characteristic
    this.service = accessory.getService(this.Service.Switch) || accessory.addService(this.Service.Switch)
    this.service
      .getCharacteristic(this.Characteristic.On)
      .removeAllListeners('set')
      .on('set', this.internalUpdate.bind(this))
    this.accessory = accessory
    this.client = accessory.client
    this.client.on('binaryState', value => this.externalUpdate(parseInt(value)))
  }

  async internalUpdate (value, callback) {
    const prevState = this.service.getCharacteristic(this.Characteristic.On).value
    try {
      callback()
      await this.client.sendRequest('urn:Belkin:service:basicevent:1', 'SetBinaryState', { BinaryState: value ? 1 : 0 })
      if (!this.disableDeviceLogging) this.log('[%s] setting state to [%s].', this.accessory.displayName, value ? 'on' : 'off')
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

  externalUpdate (value) {
    try {
      value = value !== 0
      const switchState = this.service.getCharacteristic(this.Characteristic.On).value
      if (switchState !== value) {
        this.service.updateCharacteristic(this.Characteristic.On, value)
        if (!this.disableDeviceLogging) this.log('[%s] updating state to [%s].', this.accessory.displayName, value ? 'on' : 'off')
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
}
