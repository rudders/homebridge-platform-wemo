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

    // *** If the accessory has an outlet service, then remove it *** \\
    if (this.accessory.getService(this.Service.Outlet)) {
      this.accessory.removeService(this.accessory.getService(this.Service.Outlet))
    }

    // *** Add the switch service if it doesn't already exist *** \\
    this.service = this.accessory.getService(this.Service.Switch) || this.accessory.addService(this.Service.Switch)

    // *** Add the set handler to the switch on/off characteristic *** \\
    this.service
      .getCharacteristic(this.Characteristic.On)
      .removeAllListeners('set')
      .on('set', this.internalUpdate.bind(this))

    // *** Pass the accessory to fakegato to setup the eve info service *** \\
    this.accessory.log = this.log
    this.accessory.eveLogger = new platform.eveService('switch', this.accessory)

    // *** A listener for when the device sends an update to the plugin *** \\
    this.client.on('binaryState', value => this.receiveDeviceUpdate('binaryState', value))
  }

  receiveDeviceUpdate (attribute, value) {
    if (this.debug) {
      this.log('[%s] received update [%s: %s]', this.accessory.displayName, attribute, value)
    }
    const hkValue = parseInt(value) !== 0
    this.externalUpdate(hkValue)
  }

  async sendDeviceUpdate (value) {
    await this.client.sendRequest(
      'urn:Belkin:service:basicevent:1',
      'SetBinaryState',
      value
    )
  }

  async internalUpdate (value, callback) {
    let prevState
    try {
      prevState = this.service.getCharacteristic(this.Characteristic.On).value
      callback()
      await this.sendDeviceUpdate({
        BinaryState: value ? 1 : 0
      })
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
      this.accessory.eveLogger.addEntry({ status: value ? 1 : 0 })
    } catch (err) {
      const errToShow = this.debug ? '\n' + err : err.message
      this.log.warn('[%s] updating state to [%s] error: %s.', this.accessory.displayName, value ? 'on' : 'off', errToShow)
    }
  }
}
