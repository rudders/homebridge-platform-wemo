/* jshint -W014, -W033, esversion: 9 */
/* eslint-disable new-cap */
'use strict'
const helpers = require('./../helpers')
module.exports = class deviceHeater {
  constructor (platform, accessory, device) {
    this.log = platform.log
    this.debug = platform.debug
    this.disableDeviceLogging = platform.config.disableDeviceLogging || false
    this.Service = platform.api.hap.Service
    this.Characteristic = platform.api.hap.Characteristic
    const service = accessory.getService(this.Service.Switch) || accessory.addService(this.Service.Switch)
    service
      .getCharacteristic(this.Characteristic.On)
      .on('set', (value, callback) => this.internalSwitchUpdate(value, callback))
    this.device = device
    this.accessory = accessory
    this.client = accessory.client
    this.getAttributes()
    this.client.on('attributeList', (name, value, prevalue, timestamp) => {
      this.log.error('---- heater attributeList output ----')
      this.log.warn(
        'name: %s as %s, value: %s as %s',
        name,
        typeof name,
        value,
        typeof value
      )
      this.log.error('---- end heater attributeList output ----')
    })
  }

  async internalSwitchUpdate (value, callback) {
    const service = this.accessory.getService(this.Service.Switch)
    const prevState = service.getCharacteristic(this.Characteristic.On).value
    try {
      callback()
      if (!this.disableDeviceLogging) this.log('[%s] setting state to [%s].', this.accessory.displayName, value ? 'on' : 'off')
    } catch (err) {
      this.log.warn(
        '[%s] setting state to [%s] error:\n%s',
        this.accessory.displayName,
        value ? 'on' : 'off',
        this.debug ? err : err.message
      )
      this.log.warn('[%s] Reverting HomeKit status due to error.', this.accessory.displayName)
      await helpers.sleep(1000)
      service.updateCharacteristic(this.Characteristic.On, prevState)
      service.updateCharacteristic(this.Characteristic.OutletInUse, prevState)
    }
  }
}
