/* jshint -W014, -W033, esversion: 9 */
/* eslint-disable new-cap */
'use strict'
module.exports = class deviceOutlet {
  constructor (platform, accessory, device) {
    this.log = platform.log
    this.debug = platform.debug
    this.disableDeviceLogging = platform.config.disableDeviceLogging || false
    this.Service = platform.api.hap.Service
    this.Characteristic = platform.api.hap.Characteristic
    const service = accessory.getService(this.Service.Outlet) || accessory.addService(this.Service.Outlet)
    service
      .getCharacteristic(this.Characteristic.On)
      .on('set', (value, callback) => this.internalOutletUpdate(value, callback))
    this.accessory = accessory
    this.client = accessory.client
    this.client.on('error', err => this.log.warn('[%s] reported error:\n%s.', accessory.displayName, err))
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
          this.log.warn('[%s] reported error - %s', this.accessory.displayName, this.debug ? err : err.message)
          callback(err)
          return
        }
        if (!this.disableDeviceLogging) {
          this.log('[%s] setting state and outlet-in-use to [%s].', this.accessory.displayName, value ? 'on' : 'off')
        }
        this.accessory.getService(this.Service.Outlet).updateCharacteristic(this.Characteristic.OutletInUse, value)
        callback()
      })
    } catch (err) {
      this.log.warn('[%s] setting state and outlet-in-use to [%s] error - %s', this.accessory.displayName, value ? 'on' : 'off', err)
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
        if (!this.disableDeviceLogging) {
          this.log('[%s] updating state and outlet-in-use to [%s].', this.accessory.displayName, value ? 'on' : 'off')
        }
      }
    } catch (err) {
      this.log.warn('[%s] updating state and outlet-in-use to [%s] error - %s', this.accessory.displayName, value ? 'on' : 'off', err)
    }
  }
}
