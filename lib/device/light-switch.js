/* jshint -W014, -W033, esversion: 9 */
/* eslint-disable new-cap */
'use strict'
module.exports = class deviceLightSwitch {
  constructor (platform, accessory, device) {
    this.log = platform.log
    this.debug = platform.config.debug || false
    this.disableDeviceLogging = platform.config.disableDeviceLogging || false
    this.Service = platform.api.hap.Service
    this.Characteristic = platform.api.hap.Characteristic
    const service = accessory.getService(this.Service.Switch) || accessory.addService(this.Service.Switch)
    service
      .getCharacteristic(this.Characteristic.On)
      .on('set', (value, callback) => this.internalSwitchUpdate(value, callback))
    this.accessory = accessory
    this.client = accessory.client
    this.client.on('error', err => this.log.warn('[%s] reported error - %s.', accessory.displayName, err.code))
    this.client.on('binaryState', value => this.externalSwitchUpdate(parseInt(value)))
  }

  internalSwitchUpdate (value, callback) {
    try {
      const switchState = this.accessory.getService(this.Service.Switch).getCharacteristic(this.Characteristic.On).value
      if (switchState === value) {
        callback()
        return
      }
      this.client.setBinaryState(value ? 1 : 0, err => {
        if (err) {
          this.log.warn('[%s] reported error - %s', this.accessory.displayName, this.debug ? err : err.message)
          callback(err)
          return
        }
        if (!this.disableDeviceLogging) this.log('[%s] setting state to [%s].', this.accessory.displayName, value ? 'on' : 'off')
        callback()
      })
    } catch (err) {
      this.log.warn('[%s] setting state to [%s] error - %s', this.accessory.displayName, value ? 'on' : 'off', err)
      callback(err)
    }
  }

  externalSwitchUpdate (value) {
    try {
      value = value === 1
      const service = this.accessory.getService(this.Service.Switch)
      const switchState = service.getCharacteristic(this.Characteristic.On).value
      if (switchState !== value) {
        service.updateCharacteristic(this.Characteristic.On, value)
        if (!this.disableDeviceLogging) this.log('[%s] updating state to [%s].', this.accessory.displayName, value ? 'on' : 'off')
      }
    } catch (err) {
      this.log.warn('[%s] updating state to [%s] error - %s', this.accessory.displayName, value ? 'on' : 'off', err)
    }
  }
}
