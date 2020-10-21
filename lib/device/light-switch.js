/* jshint -W014, -W033, esversion: 9 */
/* eslint-disable new-cap */
'use strict'
module.exports = class deviceLightSwitch {
  constructor (platform, accessory, device) {
    this.log = platform.log
    this.config = platform.config
    this.debug = this.config.debug || false
    this.client = accessory.client
    this.Service = platform.api.hap.Service
    this.Characteristic = platform.api.hap.Characteristic
    const service = accessory.getService(this.Service.Switch) || accessory.addService(this.Service.Switch)
    service
      .getCharacteristic(this.Characteristic.On)
      .on('set', (value, callback) => this.internalSwitchUpdate(value, callback))
    accessory.client.on('error', err => this.log.warn('[%s] reported error - %s.', accessory.displayName, err.code))
    accessory.client.on('binaryState', state => this.updateSwitchState(state))
    this.accessory = accessory
  }

  internalSwitchUpdate (state, callback) {
    const value = state | 0
    const switchState = this.accessory.getService(this.Service.Switch).getCharacteristic(this.Characteristic.On)
    if (switchState.value === value) {
      callback()
      return
    }
    this.client.setBinaryState(
      value,
      err => {
        if (err) {
          this.log.warn('[%s] setting state [%s] error - %s', this.accessory.displayName, value ? 'on' : 'off', err.code)
          callback(new Error(err))
        } else {
          if (this.debug) this.log('[%s] setting state to [%s].', this.accessory.displayName, value ? 'on' : 'off')
        }
      }
    )
    callback()
  }

  updateSwitchState (state) {
    state = state | 0
    const value = state === 1
    const service = this.accessory.getService(this.Service.Switch)
    const switchState = service.getCharacteristic(this.Characteristic.On).value
    if (switchState !== value) {
      service.updateCharacteristic(this.Characteristic.On, value)
      if (this.debug) this.log('[%s] getting state [%s].', this.accessory.displayName, value ? 'on' : 'off')
    }
  }
}
