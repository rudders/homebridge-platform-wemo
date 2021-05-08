/* jshint -W014, -W033, esversion: 9 */
/* eslint-disable new-cap */
'use strict'

module.exports = class deviceDimmer {
  constructor (platform, accessory, device) {
    // Set up variables from the platform
    this.consts = platform.consts
    this.debug = platform.config.debug
    this.funcs = platform.funcs
    this.hapChar = platform.api.hap.Characteristic
    this.hapErr = platform.api.hap.HapStatusError
    this.hapServ = platform.api.hap.Service
    this.lang = platform.lang
    this.log = platform.log

    // Set up variables from the accessory
    this.accessory = accessory
    this.client = accessory.client
    this.name = accessory.displayName

    // Set up custom variables for this device type
    const deviceConf = platform.wemoLights[device.serialNumber]
    this.brightStep = deviceConf && deviceConf.brightnessStep
      ? Math.min(deviceConf.brightnessStep, 100)
      : platform.consts.defaultValues.brightnessStep
    this.pollingInterval = deviceConf && deviceConf.pollingInterval
      ? deviceConf.pollingInterval
      : false
    this.disableDeviceLogging = deviceConf && deviceConf.overrideDisabledLogging
      ? false
      : platform.config.disableDeviceLogging

    // Add the lightbulb service if it doesn't already exist
    this.service = accessory.getService(this.hapServ.Lightbulb) ||
      accessory.addService(this.hapServ.Lightbulb)

    // Add the set handler to the lightbulb on/off characteristic
    this.service.getCharacteristic(this.hapChar.On).onSet(async value => {
      await this.internalStateUpdate(value)
    })

    // Add the set handler to the lightbulb brightness characteristic
    this.service.getCharacteristic(this.hapChar.Brightness)
      .setProps({ minStep: this.brightStep })
      .onSet(async value => {
        await this.internalBrightnessUpdate(value)
      })

    // Output the customised options to the log if in debug mode
    if (this.debug) {
      const opts = JSON.stringify({
        brightnessStep: this.brightStep,
        disableDeviceLogging: this.disableDeviceLogging,
        pollingInterval: this.pollingInterval
      })
      this.log('[%s] %s %s.', this.name, this.lang.devInitOpts, opts)
    }

    // Listeners for when the device sends an update to the plugin
    this.client.on('BinaryState', attribute => this.receiveDeviceUpdate(attribute))
    this.client.on('Brightness', attribute => this.receiveDeviceUpdate(attribute))

    // Request a device update immediately
    this.requestDeviceUpdate()

    // Set up polling for updates (seems to be needed on the newer RTOS models)
    if (device.firmwareVersion) {
      if (device.firmwareVersion.includes('RTOS')) {
        if (this.pollingInterval) {
          this.pollInterval = setInterval(
            () => this.requestDeviceUpdate(),
            this.pollingInterval * 1000
          )
        } else {
          this.log.warn('[%s] %s.', this.name, this.lang.dimmerPoll)
        }
      } else {
        if (this.pollingInterval) {
          this.log.warn('[%s] %s.', this.name, this.lang.dimmerNoPoll)
        }
      }
    }

    // Stop the polling interval on any client error
    this.client.on('error', () => clearInterval(this.pollInterval))

    // Stop the polling on Homebridge shutdown
    platform.api.on('shutdown', () => clearInterval(this.pollInterval))
  }

  receiveDeviceUpdate (attribute) {
    if (this.debug) {
      this.log('[%s] %s [%s: %s].', this.name, this.lang.recUpd, attribute.name, attribute.value)
    }
    switch (attribute.name) {
      case 'BinaryState': {
        const hkValue = attribute.value !== 0
        this.externalSwitchUpdate(hkValue)
        break
      }
      case 'Brightness':
        this.externalBrightnessUpdate(attribute.value)
        break
    }
  }

  async sendDeviceUpdate (value) {
    if (this.debug) {
      this.log('[%s] %s %s.', this.name, this.lang.senUpd, JSON.stringify(value))
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
      if (this.funcs.hasProperty(data, 'brightness')) {
        this.receiveDeviceUpdate({
          name: 'Brightness',
          value: parseInt(data.brightness)
        })
      }
    } catch (err) {
      const eText = this.funcs.parseError(err)
      this.log.warn('[%s] %s: %s.', this.name, this.lang.rduErr, eText)
    }
  }

  async getCurrentBrightness () {
    const data = await this.client.sendRequest(
      'urn:Belkin:service:basicevent:1',
      'GetBinaryState'
    )
    return parseInt(data.brightness)
  }

  async internalStateUpdate (value) {
    try {
      // Wait a longer time than the brightness so in scenes brightness is sent first
      await this.funcs.sleep(500)
      await this.sendDeviceUpdate({
        BinaryState: value ? 1 : 0
      })
      this.cacheState = value
      if (!this.disableDeviceLogging) {
        this.log('[%s] current state [%s].', this.name, value ? 'on' : 'off')
      }
      if (!value) {
        return
      }
      const updatedBrightness = await this.getCurrentBrightness()
      if (updatedBrightness !== this.cacheBrightness) {
        this.service.updateCharacteristic(this.hapChar.Brightness, updatedBrightness)
        this.cacheBrightness = updatedBrightness
        if (!this.disableDeviceLogging) {
          this.log('[%s] current brightness [%s%].', this.name, updatedBrightness)
        }
      }
    } catch (err) {
      const eText = this.funcs.parseError(err)
      this.log.warn('[%s] %s %s.', this.name, this.lang.cantCtl, eText)

      // Throw a 'no response' error and set a timeout to revert this after 2 seconds
      setTimeout(() => {
        this.service.updateCharacteristic(this.hapChar.On, this.cacheState)
      }, 2000)
      throw new this.hapErr(-70402)
    }
  }

  async internalBrightnessUpdate (value) {
    try {
      const updateKey = Math.random().toString(36).substr(2, 8)
      this.updateKey = updateKey
      await this.funcs.sleep(300)
      if (updateKey !== this.updateKey) {
        return
      }
      await this.sendDeviceUpdate({
        BinaryState: value === 0 ? 0 : 1,
        brightness: value
      })
      this.cacheBrightness = value
      if (!this.disableDeviceLogging) {
        this.log('[%s] current brightness [%s%].', this.name, value)
      }
    } catch (err) {
      const eText = this.funcs.parseError(err)
      this.log.warn('[%s] %s %s.', this.name, this.lang.cantCtl, eText)

      // Throw a 'no response' error and set a timeout to revert this after 2 seconds
      setTimeout(() => {
        this.service.updateCharacteristic(this.hapChar.On, this.cacheState)
      }, 2000)
      throw new this.hapErr(-70402)
    }
  }

  async externalSwitchUpdate (value) {
    try {
      if (value !== this.cacheState) {
        this.service.updateCharacteristic(this.hapChar.On, value)
        this.cacheState = value
        if (!this.disableDeviceLogging) {
          this.log('[%s] current state [%s].', this.name, value ? 'on' : 'off')
        }
        if (!value) {
          return
        }
        const updatedBrightness = await this.getCurrentBrightness()
        if (updatedBrightness !== this.cacheBrightness) {
          this.service.updateCharacteristic(this.hapChar.Brightness, updatedBrightness)
          this.cacheBrightness = updatedBrightness
          if (!this.disableDeviceLogging) {
            this.log('[%s] current brightness [%s%].', this.name, updatedBrightness)
          }
        }
      }
    } catch (err) {
      const eText = this.funcs.parseError(err)
      this.log.warn('[%s] %s %s.', this.name, this.lang.cantUpd, eText)
    }
  }

  externalBrightnessUpdate (value) {
    try {
      if (value !== this.cacheBrightness) {
        this.service.updateCharacteristic(this.hapChar.Brightness, value)
        this.cacheBrightness = value
        if (!this.disableDeviceLogging) {
          this.log('[%s] current brightness [%s%].', this.name, value)
        }
      }
    } catch (err) {
      const eText = this.funcs.parseError(err)
      this.log.warn('[%s] %s %s.', this.name, this.lang.cantUpd, eText)
    }
  }
}
