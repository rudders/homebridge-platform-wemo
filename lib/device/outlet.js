/* jshint -W014, -W033, esversion: 9 */
/* eslint-disable new-cap */
'use strict'

module.exports = class deviceOutlet {
  constructor (platform, accessory, device) {
    // Set up variables from the platform
    this.debug = platform.config.debug
    this.funcs = platform.funcs
    this.consts = platform.consts
    this.hapServ = platform.api.hap.Service
    this.hapChar = platform.api.hap.Characteristic
    this.log = platform.log
    this.messages = platform.messages
    this.platform = platform

    // Set up variables from the accessory
    this.accessory = accessory
    this.client = accessory.client
    this.name = accessory.displayName

    // Set up custom variables for this device type
    const deviceConf = platform.wemoOutlets[device.serialNumber]
    this.disableDeviceLogging = deviceConf && deviceConf.overrideDisabledLogging
      ? false
      : platform.config.disableDeviceLogging

    // If the accessory has an switch service then remove it
    if (this.accessory.getService(this.hapServ.Switch)) {
      this.accessory.removeService(this.accessory.getService(this.hapServ.Switch))
    }

    // Add the outlet service if it doesn't already exist
    this.service = this.accessory.getService(this.hapServ.Outlet) ||
      this.accessory.addService(this.hapServ.Outlet)

    // Add the set handler to the outlet on/off characteristic
    this.service.getCharacteristic(this.hapChar.On).onSet(async value => {
      await this.internalUpdate(value)
    })

    // Output the customised options to the log if in debug mode
    if (this.debug) {
      const opts = JSON.stringify({ disableDeviceLogging: this.disableDeviceLogging })
      this.log('[%s] %s %s.', this.name, this.messages.devInitOpts, opts)
    }

    // A listener for when the device sends an update to the plugin
    this.client.on('BinaryState', attribute => this.receiveDeviceUpdate(attribute))

    // Request a device update immediately
    this.requestDeviceUpdate()
  }

  receiveDeviceUpdate (attribute) {
    if (this.debug) {
      this.log(
        '[%s] %s [%s: %s].',
        this.name,
        this.messages.recUpd,
        attribute.name,
        attribute.value
      )
    }
    const hkValue = attribute.value !== 0
    this.externalUpdate(hkValue)
  }

  async sendDeviceUpdate (value) {
    if (this.debug) {
      this.log('[%s] %s %s.', this.name, this.messages.senUpd, JSON.stringify(value))
    }
    await this.client.sendRequest(
      'urn:Belkin:service:basicevent:1',
      'SetBinaryState',
      value
    )
  }

  async requestDeviceUpdate () {
    try {
      const data = await this.client.sendRequest(
        'urn:Belkin:service:basicevent:1',
        'GetBinaryState'
      )
      if (this.funcs.hasProperty(data, 'BinaryState')) {
        this.receiveDeviceUpdate({
          name: 'BinaryState',
          value: parseInt(data.BinaryState)
        })
      }
    } catch (err) {
      const eText = this.funcs.parseError(err)
      this.log.warn('[%s] %s: %s.', this.name, this.messages.rduErr, eText)
    }
  }

  async internalUpdate (value) {
    try {
      await this.sendDeviceUpdate({
        BinaryState: value ? 1 : 0
      })
      this.service.updateCharacteristic(this.hapChar.OutletInUse, value)
      this.cacheOnOff = value
      if (!this.disableDeviceLogging) {
        this.log('[%s] current state [%s].', this.name, value ? 'on' : 'off')
      }
    } catch (err) {
      const eText = this.funcs.parseError(err)
      this.log.warn('[%s] %s %s.', this.name, this.messages.cantCtl, eText)

      // Throw a 'no response' error and set a timeout to revert this after 5 seconds
      setTimeout(() => {
        this.service.updateCharacteristic(this.hapChar.On, this.cacheOnOff)
      }, 5000)
      throw new this.platform.api.hap.HapStatusError(this.consts.hapError)
    }
  }

  externalUpdate (value) {
    try {
      if (value !== this.cacheOnOff) {
        this.service.updateCharacteristic(this.hapChar.On, value)
        this.service.updateCharacteristic(this.hapChar.OutletInUse, value)
        this.cacheOnOff = value
        if (!this.disableDeviceLogging) {
          this.log('[%s] current state [%s].', this.name, value ? 'on' : 'off')
        }
      }
    } catch (err) {
      const eText = this.funcs.parseError(err)
      this.log.warn('[%s] %s %s.', this.name, this.messages.cantUpd, eText)
    }
  }
}
