/* jshint -W014, -W033, esversion: 8 */
'use strict'
let Characteristic, Service
const constants = require('./constants')
const utils = require('./utils')
module.exports = class wemoLinkAcc {
  constructor (platform, accessory, link, device) {
    Service = platform.api.hap.Service
    Characteristic = platform.api.hap.Characteristic
    this.log = platform.log
    this.wemoClient = platform.wemoClient
    this.debug = platform.config.debug || false
    this.accessory = accessory
    this.link = link
    this.device = device
    this.setupDevice(link, device)
    this.accessory
      .getService(Service.AccessoryInformation)
      .setCharacteristic(Characteristic.Manufacturer, 'Belkin Wemo')
      .setCharacteristic(Characteristic.Model, 'Dimmable Bulb')
      .setCharacteristic(Characteristic.SerialNumber, device.deviceId)
    this.accessory.on('identify', (paired, callback) => {
      this.log('[%s] - identify.', this.accessory.displayName)
      callback()
    })
    this.addEventHandlers()
    this.observeDevice()
  }

  addEventHandler (characteristic) {
    const service = this.accessory.getService(Service.Lightbulb)
    if (!service.testCharacteristic(characteristic)) return
    const char = service.getCharacteristic(characteristic)
    switch (characteristic) {
      case Characteristic.On:
        char.on('set', (value, callback) => this.setSwitchState(value, callback))
        break
      case Characteristic.Brightness:
        char.on('set', (value, callback) => this.setBrightness(value, callback))
        break
      case Characteristic.ColorTemperature:
        char.on('set', (value, callback) => this.setColorTemperature(value, callback))
        break
    }
  }

  addEventHandlers () {
    this.addEventHandler(Characteristic.On)
    this.addEventHandler(Characteristic.Brightness)
    this.addEventHandler(Characteristic.ColorTemperature)
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
        if (capabilities[constants.linkAcc.switch] === undefined || !capabilities[constants.linkAcc.switch].length) {
          this.log.warn('[%s] appears to be offline.', this.accessory.displayName)
          return
        }
        this.updateSwitchState(capabilities[constants.linkAcc.switch])
        this.updateBrightness(capabilities[constants.linkAcc.brightness])
        this.updateColorTemperature(capabilities[constants.linkAcc.temperature])
      }
    )
    this.client.on(
      'statusChange',
      (deviceId, capabilityId, value) => {
        if (this.device.deviceId !== deviceId) return
        if (this.device.capabilities[capabilityId] === value) return
        this.device.capabilities[capabilityId] = value
        switch (capabilityId) {
          case constants.linkAcc.switch:
            this.updateSwitchState(value)
            break
          case constants.linkAcc.brightness:
            this.updateBrightness(value)
            break
          case constants.linkAcc.temperature:
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
    await utils.sleep(100)
    if (this.brightness !== value && this._brightness === value) {
      this.client.setDeviceStatus(
        this.device.deviceId,
        constants.linkAcc.brightness,
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
          this.device.capabilities[constants.linkAcc.brightness] = value
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
    await utils.sleep(100)
    if (this.temperature !== value && this._temperature === value) {
      this.client.setDeviceStatus(
        this.device.deviceId,
        constants.linkAcc.temperature,
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
          this.device.capabilities[constants.linkAcc.temperature] = value
        }
      )
    }
    callback()
  }

  setSwitchState (state, callback) {
    const value = state | 0
    const switchState = this.accessory.getService(Service.Lightbulb).getCharacteristic(Characteristic.On)
    if (switchState.value === value) {
      callback()
      return
    }
    this.client.setDeviceStatus(
      this.device.deviceId,
      constants.linkAcc.switch,
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
        this.device.capabilities[constants.linkAcc.switch] = value
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
    const brightness = this.accessory.getService(Service.Lightbulb).getCharacteristic(Characteristic.Brightness)
    if (brightness.value !== value) {
      if (this.debug) {
        this.log('[%s] updating brightness to [%s%].', this.accessory.displayName, value)
      }
      brightness.updateValue(value)
      this.brightness = value
    }
  }

  updateColorTemperature (capability) {
    const service = this.accessory.getService(Service.Lightbulb)
    if (!service.testCharacteristic(Characteristic.ColorTemperature) || capability === undefined) return
    const value = Math.round(capability.split(':').shift())
    const temperature = service.getCharacteristic(Characteristic.ColorTemperature)
    if (temperature.value !== value) {
      if (this.debug) {
        this.log('[%s] updating ctemp to [%s / %sK].', this.accessory.displayName, value, this.miredKelvin(value))
      }
      temperature.updateValue(value)
    }
  }

  updateSwitchState (state) {
    state = state | 0
    const value = !!state
    const switchState = this.accessory.getService(Service.Lightbulb).getCharacteristic(Characteristic.On)
    if (switchState.value !== value) {
      if (this.debug) {
        this.log('[%s] updating state to [%s].', this.accessory.displayName, value ? 'on' : 'off')
      }
      switchState.updateValue(value)
    }
  }
}
