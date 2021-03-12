/* jshint -W014, -W033, esversion: 9 */
/* eslint-disable new-cap */
'use strict'

module.exports = class deviceDimmer {
  constructor (platform, accessory, device) {
    // Set up variables from the platform
    this.debug = platform.config.debug
    this.funcs = platform.funcs
    this.hapServ = platform.api.hap.Service
    this.hapChar = platform.api.hap.Characteristic
    this.log = platform.log
    this.messages = platform.messages

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
    this.service.getCharacteristic(this.hapChar.On)
      .removeAllListeners('set')
      .on('set', this.internalSwitchUpdate.bind(this))

    // Add the set handler to the lightbulb brightness characteristic
    this.service.getCharacteristic(this.hapChar.Brightness)
      .removeAllListeners('set')
      .on('set', this.internalBrightnessUpdate.bind(this))
      .setProps({ minStep: this.brightStep })

    // Output the customised options to the log if in debug mode
    if (this.debug) {
      const opts = JSON.stringify({
        brightnessStep: this.brightStep,
        disableDeviceLogging: this.disableDeviceLogging,
        pollingInterval: this.pollingInterval
      })
      this.log('[%s] %s %s.', this.name, this.messages.devInitOpts, opts)
    }

    // Listeners for when the device sends an update to the plugin
    this.client.on('binaryState', attribute => this.receiveDeviceUpdate(attribute))
    this.client.on('brightness', attribute => this.receiveDeviceUpdate(attribute))

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
          this.log.warn('[%s] %s.', this.name, this.messages.dimmerPoll)
        }
      } else {
        if (this.pollingInterval) {
          this.log.warn('[%s] %s.', this.name, this.messages.dimmerNoPoll)
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
      this.log(
        '[%s] %s [%s: %s].',
        this.name,
        this.messages.recUpd,
        attribute.name,
        attribute.value
      )
    }
    switch (attribute.name) {
      case 'binaryState': {
        const hkValue = attribute.value !== 0
        this.externalSwitchUpdate(hkValue)
        break
      }
      case 'brightness':
        this.externalBrightnessUpdate(attribute.value)
        break
    }
  }

  async sendDeviceUpdate (value) {
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
          name: 'binaryState',
          value: parseInt(data.BinaryState)
        })
      }
      if (this.funcs.hasProperty(data, 'brightness')) {
        this.receiveDeviceUpdate({
          name: 'brightness',
          value: parseInt(data.brightness)
        })
      }
    } catch (err) {
      const eText = this.funcs.parseError(err)
      this.log.warn('[%s] %s: %s.', this.name, this.messages.rduErr, eText)
    }
  }

  async getCurrentBrightness () {
    const data = await this.client.sendRequest(
      'urn:Belkin:service:basicevent:1',
      'GetBinaryState'
    )

    // For the dimmer we just return the brightness as that's all we need
    return parseInt(data.brightness)
  }

  async internalSwitchUpdate (value, callback) {
    let prevState
    try {
      prevState = this.service.getCharacteristic(this.hapChar.On).value
      callback()
      await this.sendDeviceUpdate({
        BinaryState: value ? 1 : 0
      })
      if (!this.disableDeviceLogging) {
        this.log('[%s] setting state to [%s].', this.name, value ? 'on' : 'off')
      }
      if (!value) {
        return
      }
      let newBrightness
      try {
        newBrightness = await this.getCurrentBrightness()
        this.service.updateCharacteristic(this.hapChar.Brightness, newBrightness)
        if (!this.disableDeviceLogging) {
          this.log('[%s] updating brightness to [%s%].', this.name, newBrightness)
        }
      } catch (e) {
        const eText = this.funcs.parseError(e)
        this.log.warn('[%s] %s %s.', this.name, this.messages.cantCtl, eText)
      }
    } catch (err) {
      try {
        const eText = this.funcs.parseError(err)
        this.log.warn('[%s] %s %s.', this.name, this.messages.cantCtl, eText)
        await this.funcs.sleep(1000)
        this.service.updateCharacteristic(this.hapChar.On, prevState)
      } catch (e) {}
    }
  }

  async internalBrightnessUpdate (value, callback) {
    let prevBrightness
    try {
      prevBrightness = this.service.getCharacteristic(this.hapChar.Brightness).value
      callback()
      const updateKeyBrightness = Math.random().toString(36).substr(2, 8)
      this.updateKeyBrightness = updateKeyBrightness
      await this.funcs.sleep(500)
      if (updateKeyBrightness !== this.updateKeyBrightness) {
        return
      }
      await this.sendDeviceUpdate({
        BinaryState: value === 0 ? 0 : 1,
        brightness: value
      })
    } catch (err) {
      try {
        const eText = this.funcs.parseError(err)
        this.log.warn('[%s] %s %s.', this.name, this.messages.cantCtl, eText)
        await this.funcs.sleep(1000)
        this.service.updateCharacteristic(this.hapChar.Brightness, prevBrightness)
      } catch (e) {}
    }
  }

  async externalSwitchUpdate (value) {
    try {
      const prevState = this.service.getCharacteristic(this.hapChar.On).value
      if (prevState !== value) {
        this.service.updateCharacteristic(this.hapChar.On, value)
        if (!this.disableDeviceLogging) {
          this.log('[%s] updating state to [%s].', this.name, value ? 'on' : 'off')
        }
        if (!value) {
          return
        }
        let newBrightness
        try {
          newBrightness = await this.getCurrentBrightness()
          this.service.updateCharacteristic(this.hapChar.Brightness, newBrightness)
          if (!this.disableDeviceLogging) {
            this.log('[%s] updating brightness to [%s%].', this.name, newBrightness)
          }
        } catch (e) {
          const eText = this.funcs.parseError(e)
          this.log.warn('[%s] %s %s.', this.name, this.messages.cantUpd, eText)
        }
      }
    } catch (err) {
      const eText = this.funcs.parseError(err)
      this.log.warn('[%s] %s %s.', this.name, this.messages.cantUpd, eText)
    }
  }

  externalBrightnessUpdate (value) {
    try {
      const prevBrightness = this.service.getCharacteristic(this.hapChar.Brightness).value
      if (prevBrightness !== value) {
        this.service.updateCharacteristic(this.hapChar.Brightness, value)
        if (!this.disableDeviceLogging) {
          this.log('[%s] updating brightness to [%s%].', this.name, value)
        }
      }
    } catch (err) {
      const eText = this.funcs.parseError(err)
      this.log.warn('[%s] %s %s.', this.name, this.messages.cantUpd, eText)
    }
  }
}
