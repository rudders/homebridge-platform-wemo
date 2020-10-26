/* jshint -W014, -W033, esversion: 9 */
/* eslint-disable new-cap */
'use strict'
const helpers = require('./../helpers')
module.exports = class deviceLink {
  constructor (platform, accessory, link, device) {
    this.log = platform.log
    this.debug = platform.config.debug || false
    this.disableDeviceLogging = platform.config.disableDeviceLogging || false
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
    this.accessory = accessory
    this.device = device
    this.client = accessory.client
    this.link = link
    this.client.getDeviceStatus(this.device.deviceId, (err, capabilities) => {
      if (err) {
        this.log.warn('[%s] wemoClient.getDeviceStatus error - %s.', this.accessory.displayName, err)
        return
      }
      if (capabilities[helpers.linkAcc.switch] === undefined || !capabilities[helpers.linkAcc.switch].length) {
        this.log.warn('[%s] appears to be offline.', this.accessory.displayName)
        return
      }
      this.externalSwitchUpdate(parseInt(capabilities[helpers.linkAcc.switch]))
      this.externalBrightnessUpdate(capabilities[helpers.linkAcc.brightness])
      if (device.capabilities[helpers.linkAcc.temperature]) {
        this.externalColourUpdate(capabilities[helpers.linkAcc.temperature])
      }
    })
    this.client.on('error', err => this.log('[%s] reported error - %s.', this.accessory.displayName, err.code))
    this.client.on('statusChange', (deviceId, capabilityId, value) => {
      if (this.device.deviceId !== deviceId) return
      if (this.device.capabilities[capabilityId] === value) return
      this.device.capabilities[capabilityId] = value
      switch (capabilityId) {
        case helpers.linkAcc.switch:
          this.externalSwitchUpdate(parseInt(value))
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
    })
  }

  internalSwitchUpdate (value, callback) {
    try {
      if (this.switchState === value) {
        callback()
        return
      }
      this.client.setDeviceStatus(this.device.deviceId, helpers.linkAcc.switch, value ? 1 : 0, (err, response) => {
        if (err) throw new Error(err)
        this.switchState = value
        this.device.capabilities[helpers.linkAcc.switch] = value ? 1 : 0
        if (!this.disableDeviceLogging) this.log('[%s] setting state to [%s].', this.accessory.displayName, value ? 'on' : 'off')
      })
      callback()
    } catch (err) {
      this.log.warn('[%s] setting state to [%s] error - %s', this.accessory.displayName, value ? 'on' : 'off', err)
      callback(err)
    }
  }

  async internalBrightnessUpdate (value, callback) {
    try {
      if (this.brightness === value) {
        callback()
        return
      }
      this._brightness = value
      /*****
        defer the actual update to smooth out changes from sliders
        check that we actually have a change to make and that something
        hasn't tried to update the brightness again in the last 0.25 seconds
      *****/
      await helpers.sleep(250)
      if (this.brightness !== value && this._brightness === value) {
        this.client.setDeviceStatus(this.device.deviceId, helpers.linkAcc.brightness, value * 2.55, (err, response) => {
          if (err) throw new Error(err)
          this.brightness = value
          this.device.capabilities[helpers.linkAcc.brightness] = value
          if (!this.disableDeviceLogging) this.log('[%s] setting brightness to [%s%].', this.accessory.displayName, value)
        })
      }
      callback()
    } catch (err) {
      this.log.warn('[%s] setting brightness to [%s%] error - %s', this.accessory.displayName, value, err)
      callback(err)
    }
  }

  async internalColourUpdate (value, callback) {
    try {
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
        hasn't tried to update the brightness again in the last 0.25 seconds
      *****/
      await helpers.sleep(250)
      if (this.temperature !== value && this._temperature === value) {
        this.client.setDeviceStatus(this.device.deviceId, helpers.linkAcc.temperature, value + ':0', (err, response) => {
          if (err) throw new Error(err)
          this.temperature = value
          this.device.capabilities[helpers.linkAcc.temperature] = value
          if (!this.disableDeviceLogging) {
            this.log('[%s] setting ctemp to [%s / %sK].', this.accessory.displayName, value, this.miredKelvin(value))
          }
        })
      }
      callback()
    } catch (err) {
      this.log.warn('[%s] setting ctemp [%s / %sK] error - %s', this.accessory.displayName, value, this.miredKelvin(value), err)
      callback(err)
    }
  }

  externalSwitchUpdate (value) {
    try {
      value = value === 1
      const service = this.accessory.getService(this.Service.Lightbulb)
      const switchState = service.getCharacteristic(this.Characteristic.On).value
      if (switchState !== value) {
        service.updateCharacteristic(this.Characteristic.On, value)
        this.switchState = value
        if (!this.disableDeviceLogging) this.log('[%s] updating state to [%s].', this.accessory.displayName, value ? 'on' : 'off')
      }
    } catch (err) {
      this.log.warn('[%s] updating state to [%s] error - %s', this.accessory.displayName, value ? 'on' : 'off', err)
    }
  }

  externalBrightnessUpdate (value) {
    try {
      value = Math.round(value.split(':').shift() / 2.55)
      const service = this.accessory.getService(this.Service.Lightbulb)
      const brightness = service.getCharacteristic(this.Characteristic.Brightness).value
      if (brightness !== value) {
        service.updateCharacteristic(this.Characteristic.Brightness, value)
        this.brightness = value
        if (!this.disableDeviceLogging) this.log('[%s] updating brightness to [%s%].', this.accessory.displayName, value)
      }
    } catch (err) {
      this.log.warn('[%s] updating brightness to [%s%] error - %s', this.accessory.displayName, value, err)
    }
  }

  externalColourUpdate (value) {
    try {
      const service = this.accessory.getService(this.Service.Lightbulb)
      if (!service.testCharacteristic(this.Characteristic.ColorTemperature) || value === undefined) return
      value = Math.round(value.split(':').shift())
      const temperature = service.getCharacteristic(this.Characteristic.ColorTemperature).value
      if (temperature !== value) {
        service.updateCharacteristic(this.Characteristic.ColorTemperature, value)
        this.temperature = value
        if (!this.disableDeviceLogging) {
          this.log('[%s] updating ctemp to [%s / %sK].', this.accessory.displayName, value, this.miredKelvin(value))
        }
      }
    } catch (err) {
      this.log.warn('[%s] updating ctemp to [%s / %sK].', this.accessory.displayName, value, this.miredKelvin(value), err)
    }
  }

  miredKelvin (value) {
    return Math.round(100000 / (5 * value)) * 50
  }
}
