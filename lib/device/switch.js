/* jshint -W014, -W033, esversion: 9 */
/* eslint-disable new-cap */
'use strict'

module.exports = class deviceSwitch {
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

    // Set up custom variables for this device type
    let deviceConf = false
    if (platform.wemoOutlets[device.serialNumber]) {
      deviceConf = platform.wemoOutlets[device.serialNumber]
    } else if (platform.wemoLights[device.serialNumber]) {
      deviceConf = platform.wemoLights[device.serialNumber]
    }
    this.disableDeviceLogging = deviceConf && deviceConf.overrideDisabledLogging
      ? false
      : platform.config.disableDeviceLogging

    // Set up variables from the accessory
    this.accessory = accessory
    this.client = accessory.client
    this.name = accessory.displayName

    // If the accessory has an outlet service then remove it
    if (this.accessory.getService(this.hapServ.Outlet)) {
      this.accessory.removeService(this.accessory.getService(this.hapServ.Outlet))
    }

    // Add the switch service if it doesn't already exist
    this.service = this.accessory.getService(this.hapServ.Switch) ||
      this.accessory.addService(this.hapServ.Switch)

    // Add the set handler to the switch on/off characteristic
    this.service.getCharacteristic(this.hapChar.On).onSet(async value => {
      await this.internalUpdate(value)
    })

    // Pass the accessory to fakegato to setup the eve info service
    this.accessory.historyService = new platform.eveService('switch', this.accessory, {
      log: platform.config.debugFakegato ? this.log : () => {}
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
    // Log the receiving update if debug is enabled
    if (this.debug) {
      this.log(
        '[%s] %s [%s: %s].',
        this.name,
        this.messages.recUpd,
        attribute.name,
        attribute.value
      )
    }

    // Send a HomeKit needed true/false argument
    // attribute.value is 0 if and only if the switch is off
    this.externalUpdate(attribute.value !== 0)
  }

  async sendDeviceUpdate (value) {
    // Log the sending update if debug is enabled
    if (this.debug) {
      this.log('[%s] %s %s.', this.name, this.messages.senUpd, JSON.stringify(value))
    }

    // Send the update
    await this.client.sendRequest(
      'urn:Belkin:service:basicevent:1',
      'SetBinaryState',
      value
    )
  }

  async requestDeviceUpdate () {
    try {
      // Request the update
      const data = await this.client.sendRequest(
        'urn:Belkin:service:basicevent:1',
        'GetBinaryState'
      )

      // Check for existence since BinaryState can be int 0
      if (this.funcs.hasProperty(data, 'BinaryState')) {
        // Send the data to the receive function
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
      // Send the update
      await this.sendDeviceUpdate({
        BinaryState: value ? 1 : 0
      })

      // Update the cache value
      this.cacheOnOff = value

      // Log the change if appropriate
      if (!this.disableDeviceLogging) {
        this.log('[%s] current state [%s].', this.name, value ? 'on' : 'off')
      }
    } catch (err) {
      // Catch any errors
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
      // Check to see if the cache value is different
      if (value !== this.cacheOnOff) {
        // Update the HomeKit characteristic
        this.service.updateCharacteristic(this.hapChar.On, value)

        // Update the cache value
        this.cacheOnOff = value

        // Log the change if appropriate
        if (!this.disableDeviceLogging) {
          this.log('[%s] current state [%s].', this.name, value ? 'on' : 'off')
        }
      }
      this.accessory.historyService.addEntry({ status: value ? 1 : 0 })
    } catch (err) {
      // Catch any errors
      const eText = this.funcs.parseError(err)
      this.log.warn('[%s] %s %s.', this.name, this.messages.cantUpd, eText)
    }
  }
}
