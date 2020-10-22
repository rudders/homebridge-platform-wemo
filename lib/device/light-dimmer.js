/* jshint -W014, -W033, esversion: 9 */
/* eslint-disable new-cap */
'use strict'
const helpers = require('./../helpers')
module.exports = class deviceLightDimmer {
  constructor (platform, accessory, device) {
    this.log = platform.log
    this.config = platform.config
    this.debug = this.config.debug || false
    this.Service = platform.api.hap.Service
    this.Characteristic = platform.api.hap.Characteristic
    let service
    if (!(service = accessory.getService(this.Service.Lightbulb))) {
      accessory.addService(this.Service.Lightbulb)
      service = accessory.getService(this.Service.Lightbulb)
      service.addCharacteristic(this.Characteristic.Brightness)
    }
    service.getCharacteristic(this.Characteristic.On)
      .on('set', (value, callback) => this.internalSwitchUpdate(value, callback))
    service.getCharacteristic(this.Characteristic.Brightness)
      .on('set', (value, callback) => this.internalBrightnessUpdate(value, callback))
    this.accessory = accessory
    this.client = accessory.client
    this.client.on('error', err => this.log.warn('[%s] reported error - %s.', accessory.displayName, err.code))
    this.client.on('binaryState', state => this.externalSwitchUpdate(state))
    this.client.on('brightness', newBrightness => this.externalBrightnessUpdate(newBrightness))
  }

  internalSwitchUpdate (state, callback) {
    const value = state | 0
    const switchState = this.accessory.getService(this.Service.Lightbulb).getCharacteristic(this.Characteristic.On)
    if (switchState.value === value) {
      callback()
      return
    }
    this.client.setBinaryState(
      value,
      err => {
        if (err) {
          this.log.warn('[%s] setting state [%s] error - %s', this.accessory.displayName, value ? 'on' : 'off', err.code)
          callback(new Error(err))
        } else {
          if (this.debug) this.log('[%s] setting state to [%s].', this.accessory.displayName, value ? 'on' : 'off')
          // *** For dimmer, poll brightness for ON events (supports night mode) *** \\
          if (value) {
            this.client.getBrightness(
              (err, brightness) => {
                if (err) {
                  this.log.warn('[%s] error getting brightness - %s.', this.accessory.displayName, err)
                  return
                }
                this.externalBrightnessUpdate(brightness)
              }
            )
          }
        }
      }
    )
    callback()
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
      this.client.setBrightness(
        value,
        err => {
          if (err) {
            this.log.warn('[%s] setting brightness [%s%] error - %s.', this.accessory.displayName, value, err.code)
            callback(new Error(err))
            return
          }
          this.brightness = value
          if (this.debug) this.log('[%s] setting to brightness [%s%].', this.accessory.displayName, value)
        }
      )
    }
    callback()
  }

  externalBrightnessUpdate (newBrightness) {
    const currentBrightness = this.accessory.getService(this.Service.Lightbulb).getCharacteristic(this.Characteristic.Brightness)
    if (currentBrightness.value !== newBrightness) {
      this.accessory.getService(this.Service.Lightbulb).updateCharacteristic(this.Characteristic.Brightness, newBrightness)
      if (this.debug) this.log('[%s] updating brightness to [%s%].', this.accessory.displayName, newBrightness)
      this.brightness = newBrightness
    }
    return newBrightness
  }

  externalSwitchUpdate (state) {
    state = state | 0
    const value = state === 1
    const service = this.accessory.getService(this.Service.Lightbulb)
    const switchState = service.getCharacteristic(this.Characteristic.On).value
    if (switchState !== value) {
      service.getCharacteristic(this.Characteristic.On, value)
      if (this.debug) this.log('[%s] getting state [%s].', this.accessory.displayName, value ? 'on' : 'off')
      // *** For dimmer, poll brightness for ON events (supports night mode) *** \\
      if (value) {
        this.client.getBrightness(
          (err, brightness) => {
            if (err) {
              this.log('%s - Error getting brightness - %s.', this.accessory.displayName, err.code)
              return
            }
            this.externalBrightnessUpdate(brightness)
          }
        )
      }
    }
  }
}
