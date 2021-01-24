/* jshint -W014, -W033, esversion: 9 */
/* eslint-disable new-cap */
'use strict'
module.exports = class deviceDimmer {
  constructor (platform, accessory, device) {
    this.log = platform.log
    this.debug = platform.debug
    this.helpers = platform.helpers
    this.disableDeviceLogging = platform.config.disableDeviceLogging
    this.S = platform.api.hap.Service
    this.C = platform.api.hap.Characteristic
    this.client = accessory.client
    this.dName = accessory.displayName
    this.accessory = accessory

    // *** Add the lightbulb service if it doesn't already exist *** \\
    this.service = accessory.getService(this.S.Lightbulb) || accessory.addService(this.S.Lightbulb)

    // *** Add the set handler to the lightbulb on/off characteristic *** \\
    this.service.getCharacteristic(this.C.On)
      .removeAllListeners('set')
      .on('set', this.internalSwitchUpdate.bind(this))

    // *** Add the set handler to the lightbulb brightness characteristic *** \\
    this.service.getCharacteristic(this.C.Brightness)
      .removeAllListeners('set')
      .on('set', this.internalBrightnessUpdate.bind(this))

    // *** Listeners for when the device sends an update to the plugin *** \\
    this.client.on('binaryState', attribute => this.receiveDeviceUpdate(attribute))
    this.client.on('brightness', attribute => this.receiveDeviceUpdate(attribute))
  }

  receiveDeviceUpdate (attribute) {
    if (this.debug) {
      this.log('[%s] received update [%s: %s]', this.dName, attribute.name, attribute.value)
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
    const data = await this.client.sendRequest(
      'urn:Belkin:service:basicevent:1',
      'GetBinaryState'
    )
    return parseInt(data.brightness)
    // *** For the dimmer we just return the brightness as that's all we need this function for *** \\
  }

  async internalSwitchUpdate (value, callback) {
    let prevState
    try {
      prevState = this.service.getCharacteristic(this.C.On).value
      callback()
      await this.sendDeviceUpdate({
        BinaryState: value ? 1 : 0
      })
      if (!this.disableDeviceLogging) {
        this.log('[%s] setting state to [%s].', this.dName, value ? 'on' : 'off')
      }
      if (!value) return
      let newBrightness
      try {
        newBrightness = await this.requestDeviceUpdate()
        this.service.updateCharacteristic(this.C.Brightness, newBrightness)
        if (!this.disableDeviceLogging) {
          this.log('[%s] updating brightness to [%s%].', this.dName, newBrightness)
        }
      } catch (e) {
        const eToShow = this.debug ? '\n' + e : e.message
        this.log.warn('[%s] updating brightness to [%s%] error:\n%s.', this.dName, newBrightness, eToShow)
      }
    } catch (err) {
      try {
        const errToShow = this.debug ? '\n' + err : err.message
        this.log.warn('[%s] setting state to [%s] error: %s.', this.dName, value ? 'on' : 'off', errToShow)
        this.log.warn('[%s] reverting HomeKit status due to error.', this.dName)
        await this.helpers.sleep(1000)
        this.service.updateCharacteristic(this.C.On, prevState)
      } catch (e) {}
    }
  }

  async internalBrightnessUpdate (value, callback) {
    let prevBrightness
    try {
      prevBrightness = this.service.getCharacteristic(this.C.Brightness).value
      callback()
      const updateKeyBrightness = Math.random().toString(36).substr(2, 8)
      this.updateKeyBrightness = updateKeyBrightness
      await this.helpers.sleep(500)
      if (updateKeyBrightness !== this.updateKeyBrightness) return
      await this.sendDeviceUpdate({
        BinaryState: value === 0 ? 0 : 1,
        brightness: value
      })
    } catch (err) {
      try {
        const errToShow = this.debug ? '\n' + err : err.message
        this.log.warn('[%s] setting brightness to [%s%] error: %s.', this.dName, value, errToShow)
        this.log.warn('[%s] reverting HomeKit status due to error.', this.dName)
        await this.helpers.sleep(1000)
        this.service.updateCharacteristic(this.C.Brightness, prevBrightness)
      } catch (e) {}
    }
  }

  async externalSwitchUpdate (value) {
    try {
      const prevState = this.service.getCharacteristic(this.C.On).value
      if (prevState !== value) {
        this.service.updateCharacteristic(this.C.On, value)
        if (!this.disableDeviceLogging) {
          this.log('[%s] updating state to [%s].', this.dName, value ? 'on' : 'off')
        }
        if (!value) return
        let newBrightness
        try {
          newBrightness = await this.requestDeviceUpdate()
          this.service.updateCharacteristic(this.C.Brightness, newBrightness)
          if (!this.disableDeviceLogging) {
            this.log('[%s] updating brightness to [%s%].', this.dName, newBrightness)
          }
        } catch (e) {
          const eToShow = this.debug ? '\n' + e : e.message
          this.log.warn('[%s] updating brightness to [%s%] error:\n%s.', this.dName, newBrightness, eToShow)
        }
      }
    } catch (err) {
      const errToShow = this.debug ? '\n' + err : err.message
      this.log.warn('[%s] updating state to [%s] error: %s.', this.dName, value ? 'on' : 'off', errToShow)
    }
  }

  externalBrightnessUpdate (value) {
    try {
      const prevBrightness = this.service.getCharacteristic(this.C.Brightness).value
      if (prevBrightness !== value) {
        this.service.updateCharacteristic(this.C.Brightness, value)
        if (!this.disableDeviceLogging) {
          this.log('[%s] updating brightness to [%s%].', this.dName, value)
        }
      }
    } catch (err) {
      const errToShow = this.debug ? '\n' + err : err.message
      this.log.warn('[%s] updating brightness to [%s%] error: %s.', this.dName, value, errToShow)
    }
  }
}
