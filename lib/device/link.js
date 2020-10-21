/* jshint -W014, -W033, esversion: 9 */
/* eslint-disable new-cap */
'use strict'
const helpers = require('./../helpers')
module.exports = class deviceLink {
  constructor (platform, accessory, link, device) {
    this.log = platform.log
    this.debug = platform.config.debug || false
    this.device = device
    this.client = accessory.client
    this.link = link
    this.Service = platform.api.hap.Service
    this.Characteristic = platform.api.hap.Characteristic
    let service
    if (!(service = accessory.getService(this.Service.Lightbulb))) {
      accessory.addService(this.Service.Lightbulb)
      service = accessory.getService(this.Service.Lightbulb)
      service.addCharacteristic(this.Characteristic.Brightness)
      if (device.capabilities[helpers.linkAcc.temperature]) {
        service.addCharacteristic(this.Characteristic.ColorTemperature)
      }
    }
    service
      .getCharacteristic(this.Characteristic.On)
      .on('set', (value, callback) => this.internalSwitchUpdate(value, callback))
    service
      .getCharacteristic(this.Characteristic.Brightness)
      .on('set', (value, callback) => this.internalBrightnessUpdate(value, callback))
    if (device.capabilities[helpers.linkAcc.temperature]) {
      service
        .getCharacteristic(this.Characteristic.ColorTemperature)
        .on('set', (value, callback) => this.internalColourUpdate(value, callback))
    }
    accessory.client.getDeviceStatus(
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
        this.externalSwitchUpdate(capabilities[helpers.linkAcc.switch])
        this.externalBrightnessUpdate(capabilities[helpers.linkAcc.brightness])
        if (device.capabilities[helpers.linkAcc.temperature]) {
          this.externalColourUpdate(capabilities[helpers.linkAcc.temperature])
        }
      }
    )
    accessory.client.on('error', err => this.log('[%s] reported error - %s.', this.accessory.displayName, err.code))
    accessory.client.on(
      'statusChange',
      (deviceId, capabilityId, value) => {
        if (this.device.deviceId !== deviceId) return
        if (this.device.capabilities[capabilityId] === value) return
        this.device.capabilities[capabilityId] = value
        switch (capabilityId) {
          case helpers.linkAcc.switch:
            this.externalSwitchUpdate(value)
            break
          case helpers.linkAcc.brightness:
            this.externalBrightnessUpdate(value)
            break
          case helpers.linkAcc.temperature:
            this.externalColourUpdate(value)
            break
          default:
            this.log.warn('Capability [%s] is not implemented.', capabilityId)
        }
      }
    )
    this.accessory = accessory
  }

  async internalBrightnessUpdate (value, callback) {
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
          this.brightness = value
          this.device.capabilities[helpers.linkAcc.brightness] = value
          if (this.debug) this.log('[%s] setting brightness to [%s%].', this.accessory.displayName, value)
        }
      )
    }
    callback()
  }

  async internalColourUpdate (value, callback) {
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
          this.temperature = value
          this.device.capabilities[helpers.linkAcc.temperature] = value
          if (this.debug) this.log('[%s] setting ctemp to [%s / %sK].', this.accessory.displayName, value, this.miredKelvin(value))
        }
      )
    }
    callback()
  }

  internalSwitchUpdate (state, callback) {
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
        this.device.capabilities[helpers.linkAcc.switch] = value
        if (this.debug) this.log('[%s] setting state to [%s].', this.accessory.displayName, value ? 'on' : 'off')
      }
    )
    callback()
  }

  externalBrightnessUpdate (capability) {
    const value = Math.round(capability.split(':').shift() / 2.55)
    const service = this.accessory.getService(this.Service.Lightbulb)
    const brightness = service.getCharacteristic(this.Characteristic.Brightness).value
    if (brightness !== value) {
      service.updateCharacteristic(this.Characteristic.Brightness, value)
      this.brightness = value
      if (this.debug) this.log('[%s] updating brightness to [%s%].', this.accessory.displayName, value)
    }
  }

  externalColourUpdate (capability) {
    const service = this.accessory.getService(this.Service.Lightbulb)
    if (!service.testCharacteristic(this.Characteristic.ColorTemperature) || capability === undefined) return
    const value = Math.round(capability.split(':').shift())
    const temperature = service.getCharacteristic(this.Characteristic.ColorTemperature).value
    if (temperature !== value) {
      service.updateCharacteristic(this.Characteristic.ColorTemperature, value)
      this.temperature = value
      if (this.debug) this.log('[%s] updating ctemp to [%s / %sK].', this.accessory.displayName, value, this.miredKelvin(value))
    }
  }

  externalSwitchUpdate (state) {
    state = state | 0
    const value = state === 1
    const service = this.accessory.getService(this.Service.Lightbulb)
    const switchState = service.getCharacteristic(this.Characteristic.On).value
    if (switchState !== value) {
      service.updateCharacteristic(this.Characteristic.On, value)
      this.switchState = value
      if (this.debug) this.log('[%s] updating state to [%s].', this.accessory.displayName, value ? 'on' : 'off')
    }
  }

  miredKelvin (value) {
    return Math.round(100000 / (5 * value)) * 50
  }
}
