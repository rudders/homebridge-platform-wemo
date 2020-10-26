/* jshint -W014, -W033, esversion: 9 */
/* eslint-disable new-cap */
'use strict'
const helpers = require('./../helpers')
module.exports = class deviceLightDimmer {
  constructor (platform, accessory, device) {
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
    }
    service
      .getCharacteristic(this.Characteristic.On)
      .on('set', (value, callback) => this.internalSwitchUpdate(value, callback))
    service
      .getCharacteristic(this.Characteristic.Brightness)
      .on('set', (value, callback) => this.internalBrightnessUpdate(value, callback))
    this.accessory = accessory
    this.client = accessory.client
    this.client.on('error', err => this.log.warn('[%s] reported error - %s.', accessory.displayName, err.code))
    this.client.on('binaryState', value => this.externalSwitchUpdate(parseInt(value)))
    this.client.on('brightness', value => this.externalBrightnessUpdate(parseInt(value)))
  }

  internalSwitchUpdate (value, callback) {
    try {
      const switchState = this.accessory.getService(this.Service.Lightbulb).getCharacteristic(this.Characteristic.On).value
      if (switchState === value) {
        callback()
        return
      }
      this.client.setBinaryState(value ? 1 : 0, err => {
        if (err) {
          this.log.warn('[%s] reported error - %s', this.accessory.displayName, this.debug ? err : err.message)
          callback(err)
          return
        }
        if (!this.disableDeviceLogging) this.log('[%s] setting state to [%s].', this.accessory.displayName, value ? 'on' : 'off')
        if (value) {
          this.client.getBrightness((errBrightness, brightness) => {
            if (err) {
              this.log.warn('[%s] error getting brightness - %s.', this.accessory.displayName, errBrightness)
              return
            }
            this.externalBrightnessUpdate(brightness)
          })
        }
        callback()
      })
    } catch (err) {
      this.log.warn('[%s] setting state to [%s] error - %s', this.accessory.displayName, value ? 'on' : 'off', err)
      callback(err)
    }
  }

  async internalBrightnessUpdate (value, callback) {
    try {
      if (value === this.brightness) {
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
        this.client.setBrightness(value, err => {
          if (err) {
            this.log.warn('[%s] reported error - %s', this.accessory.displayName, this.debug ? err : err.message)
            callback(err)
            return
          }
          this.brightness = value
          if (!this.disableDeviceLogging) this.log('[%s] setting brightness to [%s%].', this.accessory.displayName, value)
          callback()
        })
      }
    } catch (err) {
      this.log.warn('[%s] setting brightness to [%s] error - %s', this.accessory.displayName, value ? 'on' : 'off', err)
      callback(err)
    }
  }

  externalSwitchUpdate (value) {
    try {
      value = value === 1
      const service = this.accessory.getService(this.Service.Lightbulb)
      const switchState = service.getCharacteristic(this.Characteristic.On).value
      if (switchState !== value) {
        service.getCharacteristic(this.Characteristic.On, value)
        if (!this.disableDeviceLogging) this.log('[%s] updating state to [%s].', this.accessory.displayName, value ? 'on' : 'off')
        if (value) {
          this.client.getBrightness((errBrightness, brightness) => {
            if (errBrightness) {
              this.log.warn('[%s] error getting brightness - %s.', this.accessory.displayName, errBrightness)
              return
            }
            this.externalBrightnessUpdate(brightness)
          })
        }
      }
    } catch (err) {
      this.log.warn('[%s] updating state to [%s] error - %s', this.accessory.displayName, value ? 'on' : 'off', err)
    }
  }

  externalBrightnessUpdate (value) {
    try {
      const service = this.accessory.getService(this.Service.Lightbulb)
      const currentBrightness = service.getCharacteristic(this.Characteristic.Brightness).value
      if (currentBrightness !== value) {
        service.updateCharacteristic(this.Characteristic.Brightness, value)
        if (!this.disableDeviceLogging) this.log('[%s] updating brightness to [%s%].', this.accessory.displayName, value)
        this.brightness = value
      }
    } catch (err) {
      this.log.warn('[%s] updating brightness to [%s%] error - %s', this.accessory.displayName, value, err)
    }
  }
}
