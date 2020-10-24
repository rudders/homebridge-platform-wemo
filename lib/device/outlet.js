/* jshint -W014, -W033, esversion: 9 */
/* eslint-disable new-cap */
'use strict'
module.exports = class deviceOutlet {
  constructor (platform, accessory, device) {
    this.log = platform.log
    this.debug = platform.config.debug || false
    this.Service = platform.api.hap.Service
    this.Characteristic = platform.api.hap.Characteristic
    const service = accessory.getService(this.Service.Outlet) || accessory.addService(this.Service.Outlet)
    service
      .getCharacteristic(this.Characteristic.On)
      .on('set', (value, callback) => this.internalOutletUpdate(value, callback))
    this.accessory = accessory
    this.client = accessory.client
    this.client.on('error', err => this.log.warn('[%s] reported error - %s.', this.accessory.displayName, err.code))
    this.client.on('binaryState', value => this.externalOutletUpdate(parseInt(value)))
  }

  internalOutletUpdate (value, callback) {
    try {
      const outletState = this.accessory.getService(this.Service.Outlet).getCharacteristic(this.Characteristic.On).value
      if (outletState === value) {
        callback()
        return
      }
      this.client.setBinaryState(value ? 1 : 0, err => {
        if (err) {
          if (err) throw new Error(err)
          this.log('[%s] setting state to [%s].', this.accessory.displayName, value ? 'on' : 'off')
        }
      })
      callback()
    } catch (err) {
      this.log.warn('[%s] setting state to [%s] error - %s', this.accessory.displayName, value ? 'on' : 'off', err)
      callback(err)
    }
  }

  externalOutletUpdate (value) {
    try {
      value = value === 1
      const service = this.accessory.getService(this.Service.Outlet)
      const outletState = service.getCharacteristic(this.Characteristic.On).value
      if (outletState !== value) {
        service
          .updateCharacteristic(this.Characteristic.On, value)
          .updateCharacteristic(this.Characteristic.OutletInUse, value)
        this.log('[%s] updating state to [%s].', this.accessory.displayName, value ? 'on' : 'off')
      }
    } catch (err) {
      this.log.warn('[%s] updating state to [%s] error - %s', this.accessory.displayName, value ? 'on' : 'off', err)
    }
  }
}
