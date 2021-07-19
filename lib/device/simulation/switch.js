/* jshint node: true,esversion: 9, -W014, -W033 */
/* eslint-disable new-cap */
'use strict'

module.exports = class deviceSimSwitch {
  constructor (platform, accessory, device) {
    // Set up variables from the platform
    this.consts = platform.consts
    this.funcs = platform.funcs
    this.hapChar = platform.api.hap.Characteristic
    this.hapErr = platform.api.hap.HapStatusError
    this.hapServ = platform.api.hap.Service
    this.lang = platform.lang
    this.log = platform.log

    // Set up custom variables for this device type
    const deviceConf = platform.wemoOutlets[device.serialNumber]

    // Set the correct logging variables for this accessory
    this.enableLogging = !platform.config.disableDeviceLogging
    this.enableDebugLogging = platform.config.debug
    if (deviceConf && deviceConf.overrideLogging) {
      switch (deviceConf.overrideLogging) {
        case 'standard':
          this.enableLogging = true
          this.enableDebugLogging = false
          break
        case 'debug':
          this.enableLogging = true
          this.enableDebugLogging = true
          break
        case 'disable':
          this.enableLogging = false
          this.enableDebugLogging = false
          break
      }
    }

    // Set up variables from the accessory
    this.accessory = accessory
    this.client = accessory.client
    this.name = accessory.displayName

    // If the accessory has an outlet service then remove it
    if (this.accessory.getService(this.hapServ.Outlet)) {
      this.accessory.removeService(this.accessory.getService(this.hapServ.Outlet))
    }

    // If the accessory has an air purifier service then remove it
    if (this.accessory.getService(this.hapServ.AirPurifier)) {
      this.accessory.removeService(this.accessory.getService(this.hapServ.AirPurifier))
    }

    // Add the switch service if it doesn't already exist
    this.service =
      this.accessory.getService(this.hapServ.Switch) ||
      this.accessory.addService(this.hapServ.Switch)

    // Add the set handler to the switch on/off characteristic
    this.service.getCharacteristic(this.hapChar.On).onSet(async value => {
      await this.internalStateUpdate(value)
    })

    // Pass the accessory to fakegato to setup the eve info service
    this.accessory.historyService = new platform.eveService('switch', this.accessory, {
      log: platform.config.debugFakegato ? this.log : () => {}
    })

    // Output the customised options to the log
    const opts = JSON.stringify({
      logging: this.enableDebugLogging ? 'debug' : this.enableLogging ? 'standard' : 'disable',
      showAs: 'switch'
    })
    this.log('[%s] %s %s.', this.name, this.lang.devInitOpts, opts)

    // A listener for when the device sends an update to the plugin
    this.client.on('BinaryState', attribute => this.receiveDeviceUpdate(attribute))

    // Request a device update immediately
    this.requestDeviceUpdate()
  }

  receiveDeviceUpdate (attribute) {
    // Log the receiving update if debug is enabled
    if (this.enableDebugLogging) {
      this.log('[%s] %s [%s: %s].', this.name, this.lang.recUpd, attribute.name, attribute.value)
    }

    // Send a HomeKit needed true/false argument
    // attribute.value is 0 if and only if the switch is off
    this.externalStateUpdate(attribute.value !== 0)
  }

  async sendDeviceUpdate (value) {
    // Log the sending update if debug is enabled
    if (this.enableDebugLogging) {
      this.log('[%s] %s %s.', this.name, this.lang.senUpd, JSON.stringify(value))
    }

    // Send the update
    await this.client.sendRequest('urn:Belkin:service:basicevent:1', 'SetBinaryState', value)
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
      this.log.warn('[%s] %s: %s.', this.name, this.lang.rduErr, eText)
    }
  }

  async internalStateUpdate (value) {
    try {
      // Send the update
      await this.sendDeviceUpdate({
        BinaryState: value ? 1 : 0
      })

      // Update the cache value
      this.cacheState = value

      // Log the change if appropriate
      if (this.enableLogging) {
        this.log('[%s] %s [%s].', this.name, this.lang.curState, value ? 'on' : 'off')
      }
    } catch (err) {
      // Catch any errors
      const eText = this.funcs.parseError(err)
      this.log.warn('[%s] %s %s.', this.name, this.lang.cantCtl, eText)

      // Throw a 'no response' error and set a timeout to revert this after 2 seconds
      setTimeout(() => {
        this.service.updateCharacteristic(this.hapChar.On, this.cacheState)
      }, 2000)
      throw new this.hapErr(-70402)
    }
  }

  externalStateUpdate (value) {
    try {
      // Check to see if the cache value is different
      if (value === this.cacheState) {
        return
      }

      // Update the HomeKit characteristic
      this.service.updateCharacteristic(this.hapChar.On, value)

      // Update the cache value
      this.cacheState = value

      // Log the change if appropriate
      if (this.enableLogging) {
        this.log('[%s] %s [%s].', this.name, this.lang.curState, value ? 'on' : 'off')
      }
      this.accessory.historyService.addEntry({ status: value ? 1 : 0 })
    } catch (err) {
      // Catch any errors
      const eText = this.funcs.parseError(err)
      this.log.warn('[%s] %s %s.', this.name, this.lang.cantUpd, eText)
    }
  }
}
