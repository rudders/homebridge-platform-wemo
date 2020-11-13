/* jshint -W014, -W033, esversion: 9 */
/* eslint-disable new-cap */
'use strict'
const helpers = require('./../helpers')
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
      .removeAllListeners('set')
      .on('set', (value, callback) => this.internalUpdate(value, callback))
    this.accessory = accessory
    this.client = accessory.client
    this.client.on('binaryState', value => this.externalUpdate(parseInt(value)))
  }

  async internalUpdate (value, callback) {
    const service = this.accessory.getService(this.Service.Outlet)
    const prevState = service.getCharacteristic(this.Characteristic.On).value
    try {
      callback()
      await this.client.soapAction('urn:Belkin:service:basicevent:1', 'SetBinaryState', { BinaryState: value ? 1 : 0 })
      if (!this.disableDeviceLogging) {
        this.log('[%s] setting state and outlet-in-use to [%s].', this.accessory.displayName, value ? 'on' : 'off')
      }
      this.accessory.getService(this.Service.Outlet).updateCharacteristic(this.Characteristic.OutletInUse, value)
    } catch (err) {
      this.log.warn(
        '[%s] setting state and outlet-in-use to [%s] error: %s.',
        this.accessory.displayName,
        value ? 'on' : 'off',
        this.debug ? '\n' + err : err.message
      )
      this.log.warn('[%s] reverting HomeKit status due to error.', this.accessory.displayName)
      await helpers.sleep(1000)
      service.updateCharacteristic(this.Characteristic.On, prevState)
      service.updateCharacteristic(this.Characteristic.OutletInUse, prevState)
    }
  }

  externalUpdate (value) {
    try {
      value = value !== 0
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
      this.log.warn(
        '[%s] updating state and outlet-in-use to [%s] error: %s.',
        this.accessory.displayName,
        value ? 'on' : 'off',
        this.debug ? '\n' + err : err.message
      )
    }
  }
}
