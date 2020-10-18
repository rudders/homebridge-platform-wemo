/* jshint -W014, -W033, esversion: 9 */
/* eslint-disable new-cap */
'use strict'
const helpers = require('./helpers')
module.exports = class deviceLink {
  constructor (platform, accessory, link, device) {
    this.log = platform.log
    this.debug = platform.config.debug || false
    this.wemoClient = platform.wemoClient
    this.device = device
    this.link = link
    this.Service = platform.api.hap.Service
    this.Characteristic = platform.api.hap.Characteristic
    this.accessory = accessory
    this.setupDevice(link, device)
    this.addEventHandlers()
    this.observeDevice()
  }

  addEventHandler (characteristic) {
    const service = this.accessory.getService(this.Service.Lightbulb)
    if (!service.testCharacteristic(characteristic)) return
    const char = service.getCharacteristic(characteristic)
    switch (characteristic) {
      case this.Characteristic.On:
        char.on('set', (value, callback) => this.setSwitchState(value, callback))
        break
      case this.Characteristic.Brightness:
        char.on('set', (value, callback) => this.setBrightness(value, callback))
        break
      case this.Characteristic.ColorTemperature:
        char.on('set', (value, callback) => this.setColorTemperature(value, callback))
        break
    }
  }

  addEventHandlers () {
    this.addEventHandler(this.Characteristic.On)
    this.addEventHandler(this.Characteristic.Brightness)
    this.addEventHandler(this.Characteristic.ColorTemperature)
  }

  miredKelvin (value) {
    return Math.round(100000 / (5 * value)) * 50
  }

  observeDevice () {
    this.client.getDeviceStatus(
      this.device.deviceId,
      (err, capabilities) => {
        if (err) {
          this.log.warn('[%s] wemoClient.getDeviceStatus error - %s.', this.accessory.displayName, err)
          return
        }
        if (capabilities[helpers.linkAcc.switch] === undefined || !capabilities[helpers.linkAcc.switch].length) {
          this.log.warn('[%s] appears to be offline.', this.accessory.displayName)
          return
        }
        this.updateSwitchState(capabilities[helpers.linkAcc.switch])
        this.updateBrightness(capabilities[helpers.linkAcc.brightness])
        this.updateColorTemperature(capabilities[helpers.linkAcc.temperature])
      }
    )
    this.client.on(
      'statusChange',
      (deviceId, capabilityId, value) => {
        if (this.device.deviceId !== deviceId) return
        if (this.device.capabilities[capabilityId] === value) return
        this.device.capabilities[capabilityId] = value
        switch (capabilityId) {
          case helpers.linkAcc.switch:
            this.updateSwitchState(value)
            break
          case helpers.linkAcc.brightness:
            this.updateBrightness(value)
            break
          case helpers.linkAcc.temperature:
            this.updateColorTemperature(value)
            break
          default:
            this.log.warn('Capability [%s] is not implemented.', capabilityId)
        }
      }
    )
  }

  async setBrightness (value, callback) {
    if (this.brightness === value) {
      callback()
      return
    }
    this._brightness = value
    /*****
      defer the actual update to smooth out changes from sliders
      check that we actually have a change to make and that something
      hasn't tried to update the brightness again in the last 0.1 seconds
    *****/
    await helpers.sleep(100)
    if (this.brightness !== value && this._brightness === value) {
      this.client.setDeviceStatus(
        this.device.deviceId,
        helpers.linkAcc.brightness,
        value * 2.55,
        (err, response) => {
          if (err) {
            this.log.warn('[%s] setting brightness [%s%] error - %s', this.accessory.displayName, value, err.code)
            callback(new Error(err))
            return
          }
          if (this.debug) {
            this.log('[%s] setting brightness to [%s%].', this.accessory.displayName, value)
          }
          this.brightness = value
          this.device.capabilities[helpers.linkAcc.brightness] = value
        }
      )
    }
    callback()
  }

  async setColorTemperature (value, callback) {
    if (this.temperature === value) {
      callback()
      return
    }
    if (value < 154) {
      value = 154
    } else if (value > 370) {
      value = 370
    }
    this._temperature = value
    /*****
      defer the actual update to smooth out changes from sliders
      check that we actually have a change to make and that something
      hasn't tried to update the brightness again in the last 0.1 seconds
    *****/
    await helpers.sleep(100)
    if (this.temperature !== value && this._temperature === value) {
      this.client.setDeviceStatus(
        this.device.deviceId,
        helpers.linkAcc.temperature,
        value + ':0',
        (err, response) => {
          if (err) {
            this.log.warn('[%s] setting ctemp [%s / %sK] error - %s', this.accessory.displayName, value, this.miredKelvin(value), err.code)
            callback(new Error(err))
            return
          }
          if (this.debug) {
            this.log('[%s] setting ctemp to [%s / %sK].', this.accessory.displayName, value, this.miredKelvin(value))
          }
          this.temperature = value
          this.device.capabilities[helpers.linkAcc.temperature] = value
        }
      )
    }
    callback()
  }

  setSwitchState (state, callback) {
    const value = state | 0
    if (this.switchState === value) {
      callback()
      return
    }
    this.client.setDeviceStatus(
      this.device.deviceId,
      helpers.linkAcc.switch,
      value,
      (err, response) => {
        if (err) {
          this.log.warn('[%s] setting state [%s] error - %s', this.accessory.displayName, value ? 'on' : 'off', err.code)
          callback(new Error(err))
          return
        }
        if (this.debug) {
          this.log('[%s] setting state to [%s].', this.accessory.displayName, value ? 'on' : 'off')
        }
        this.device.capabilities[helpers.linkAcc.switch] = value
      }
    )
    callback()
  }

  setupDevice (link, device) {
    this.link = link
    this.device = device
    this.client = this.wemoClient.client(link)
    this.client.on('error', err => this.log('[%s] reported error - %s.', this.accessory.displayName, err.code))
  }

  updateBrightness (capability) {
    const value = Math.round(capability.split(':').shift() / 2.55)
    const brightness = this.accessory.getService(this.Service.Lightbulb).getCharacteristic(this.Characteristic.Brightness)
    if (brightness.value !== value) {
      if (this.debug) {
        this.log('[%s] updating brightness to [%s%].', this.accessory.displayName, value)
      }
      brightness.updateValue(value)
      this.brightness = value
    }
  }

  updateColorTemperature (capability) {
    const service = this.accessory.getService(this.Service.Lightbulb)
    if (!service.testCharacteristic(this.Characteristic.ColorTemperature) || capability === undefined) return
    const value = Math.round(capability.split(':').shift())
    const temperature = service.getCharacteristic(this.Characteristic.ColorTemperature)
    if (temperature.value !== value) {
      if (this.debug) {
        this.log('[%s] updating ctemp to [%s / %sK].', this.accessory.displayName, value, this.miredKelvin(value))
      }
      temperature.updateValue(value)
      this.temperature = value
    }
  }

  updateSwitchState (state) {
    state = state | 0
    const value = !!state
    const switchState = this.accessory.getService(this.Service.Lightbulb).getCharacteristic(this.Characteristic.On)
    if (switchState.value !== value) {
      if (this.debug) {
        this.log('[%s] updating state to [%s].', this.accessory.displayName, value ? 'on' : 'off')
      }
      switchState.updateValue(value)
      this.switchState = value
    }
  }
}
