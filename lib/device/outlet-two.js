/* jshint -W014, -W033, esversion: 9 */
/* eslint-disable new-cap */
'use strict'
module.exports = class deviceSwitch {
  constructor (platform, accessory, device) {
    this.log = platform.log
    this.debug = platform.debug
    this.helpers = platform.helpers
    this.disableDeviceLogging = platform.config.disableDeviceLogging
    this.Service = platform.api.hap.Service
    this.Characteristic = platform.api.hap.Characteristic
    this.client = accessory.client
    this.accessory = accessory

    // *** Add the switch services if they don't already exist *** \\
    this.serviceA = this.accessory.getService('Outlet A') || this.accessory.addService(this.Service.Outlet, 'Outlet A', 'outletA')
    this.serviceB = this.accessory.getService('Outlet B') || this.accessory.addService(this.Service.Outlet, 'Outlet B', 'outletB')

    // *** Add the set handler to the outlet A on/off characteristic *** \\
    this.serviceA.getCharacteristic(this.Characteristic.On)
      .removeAllListeners('set')
      .on('set', this.internalUpdateA.bind(this))

    // *** Add the set handler to the switch on/off characteristic *** \\
    this.serviceB.getCharacteristic(this.Characteristic.On)
      .removeAllListeners('set')
      .on('set', this.internalUpdateB.bind(this))

    // *** A listener for when the device sends an update to the plugin *** \\
    this.client.on('binaryState', attribute => this.receiveDeviceUpdate(attribute))
  }

  receiveDeviceUpdate (attribute) {
    // if (this.debug) {
    this.log('[%s] received update [%s: %s]', this.accessory.displayName, attribute.name, attribute.value)
    // }
    // const hkValue = attribute.value !== 0
    // this.externalUpdate(hkValue)
  }

  async sendDeviceUpdate (value) {
    await this.client.sendRequest(
      'urn:Belkin:service:basicevent:1',
      'SetBinaryState',
      value
    )
  }

  async internalUpdateA (value, callback) {
    let prevState
    try {
      prevState = this.service.getCharacteristic(this.Characteristic.On).value
      callback()
      /*
      await this.sendDeviceUpdate({
        BinaryState: value ? 1 : 0
      })
      */
      if (!this.disableDeviceLogging) {
        this.log('[%s] setting state to [%s].', this.accessory.displayName, value ? 'on' : 'off')
      }
    } catch (err) {
      try {
        const errToShow = this.debug ? '\n' + err : err.message
        this.log.warn('[%s] setting state to [%s] error: %s.', this.accessory.displayName, value ? 'on' : 'off', errToShow)
        this.log.warn('[%s] reverting HomeKit status due to error.', this.accessory.displayName)
        await this.helpers.sleep(1000)
        this.service.updateCharacteristic(this.Characteristic.On, prevState)
      } catch (e) {}
    }
  }

  async internalUpdateB (value, callback) {
    let prevState
    try {
      prevState = this.service.getCharacteristic(this.Characteristic.On).value
      callback()
      /*
      await this.sendDeviceUpdate({
        BinaryState: value ? 1 : 0
      })
      */
      if (!this.disableDeviceLogging) {
        this.log('[%s] setting state to [%s].', this.accessory.displayName, value ? 'on' : 'off')
      }
    } catch (err) {
      try {
        const errToShow = this.debug ? '\n' + err : err.message
        this.log.warn('[%s] setting state to [%s] error: %s.', this.accessory.displayName, value ? 'on' : 'off', errToShow)
        this.log.warn('[%s] reverting HomeKit status due to error.', this.accessory.displayName)
        await this.helpers.sleep(1000)
        this.service.updateCharacteristic(this.Characteristic.On, prevState)
      } catch (e) {}
    }
  }

  externalUpdate (value) {
    try {
      const switchState = this.service.getCharacteristic(this.Characteristic.On).value
      if (switchState !== value) {
        this.service.updateCharacteristic(this.Characteristic.On, value)
        if (!this.disableDeviceLogging) {
          this.log('[%s] updating state to [%s].', this.accessory.displayName, value ? 'on' : 'off')
        }
      }
    } catch (err) {
      const errToShow = this.debug ? '\n' + err : err.message
      this.log.warn('[%s] updating state to [%s] error: %s.', this.accessory.displayName, value ? 'on' : 'off', errToShow)
    }
  }
}
