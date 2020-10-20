/* jshint -W014, -W033, esversion: 9 */
/* eslint-disable new-cap */
'use strict'
module.exports = class deviceSwitch {
  constructor (platform, accessory, device) {
    this.log = platform.log
    this.config = platform.config
    this.debug = this.config.debug || false
    this.client = accessory.client
    this.Service = platform.api.hap.Service
    this.Characteristic = platform.api.hap.Characteristic
    const service = accessory.getService(this.Service.Outlet) || accessory.addService(this.Service.Outlet)
    service
      .getCharacteristic(this.Characteristic.On)
      .on('set', (value, callback) => this.internalUpdate(value, callback))
    accessory.client.on('error', err => this.log.warn('[%s] reported error - %s.', accessory.displayName, err.code))
    accessory.client.on('binaryState', state => this.updateSwitchState(state))
    this.accessory = accessory
  }

  internalUpdate (state, callback) {
    const value = state | 0
    const switchState = this.accessory.getService(this.Service.Outlet).getCharacteristic(this.Characteristic.On).value
    if (switchState === value) {
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

  updateOutletInUse (state) {
    state = state | 0
    const value = state === 1
    const service = this.accessory.getService(this.Service.Outlet)
    const outletInUse = service.getCharacteristic(this.Characteristic.OutletInUse).value
    if (outletInUse !== value) {
      service.updateCharacteristic(this.Characteristic.OutletInUse, value)
      if (this.debug) this.log('[%s] updated outlet in use [%s].', this.accessory.displayName, value ? 'Yes' : 'No')
    }
  }

  updateSwitchState (state) {
    state = state | 0
    const value = state === 1
    const service = this.accessory.getService(this.Service.Outlet)
    const switchState = service.getCharacteristic(this.Characteristic.On).value
    if (switchState !== value) {
      service.updateCharacteristic(this.Characteristic.On, value)
      if (this.debug) this.log('[%s] updated state [%s].', this.accessory.displayName, value ? 'on' : 'off')
    }
  }
}
