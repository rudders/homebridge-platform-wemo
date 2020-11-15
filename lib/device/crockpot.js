/* jshint -W014, -W033, esversion: 9 */
/* eslint-disable new-cap */
'use strict'
const helpers = require('./../helpers')
module.exports = class deviceCrockpot {
  constructor (platform, accessory, device) {
    this.log = platform.log
    this.debug = platform.debug
    this.disableDeviceLogging = platform.config.disableDeviceLogging || false
    this.Service = platform.api.hap.Service
    this.Characteristic = platform.api.hap.Characteristic

    // *** ONLY FOR BETA REMOVE AND READD THE SERVICE EACH HB RESTART
    if (accessory.getService(this.Service.HeaterCooler)) {
      accessory.removeService(accessory.getService(this.Service.HeaterCooler))
    }
    // *** END

    this.service = accessory.getService(this.Service.HeaterCooler) || accessory.addService(this.Service.HeaterCooler)
    this.service
      .getCharacteristic(this.Characteristic.Active)
      .removeAllListeners('set')
      .on('set', this.internalActiveUpdate.bind(this))
    this.service
      .getCharacteristic(this.Characteristic.TargetHeaterCoolerState)
      .removeAllListeners('set')
      .setProps({
        validValues: [0]
      })
    this.service
      .getCharacteristic(this.Characteristic.HeatingThresholdTemperature)
      .removeAllListeners('set')
      .on('set', this.internalCookingTimeUpdate.bind(this))
      .setProps({
        minValue: 0,
        maxValue: 24,
        minStep: 0.5
      })
    this.service
      .getCharacteristic(this.Characteristic.CurrentTemperature)
      .setProps({
        minValue: 0,
        maxValue: 24,
        minStep: 0.5
      })
    this.service
      .getCharacteristic(this.Characteristic.RotationSpeed)
      .removeAllListeners('set')
      .on('set', this.internalModeUpdate.bind(this))
      .setProps({
        minStep: 33
      })
    this.device = device
    this.accessory = accessory
    this.client = accessory.client
    this.getAttributes()
    // *** Crockpot has to be polled as it doesn't seem to send updates *** \\
    setInterval(() => this.getAttributes(), 60000)
    this.modeLabels = {
      0: 'off',
      50: 'warm',
      51: 'low',
      52: 'high'
    }

    // for testing purposes
    // this.service.updateCharacteristic(this.Characteristic.Active, false)
    // this.service.updateCharacteristic(this.Characteristic.CurrentTemperature, 0)
    // this.service.updateCharacteristic(this.Characteristic.HeatingThresholdTemperature, 0)
  }

  async getAttributes () {
    try {
      const data = await this.client.soapAction('urn:Belkin:service:basicevent:1', 'GetCrockpotState', null)
      const attributes = {}
      for (const [k, v] of Object.entries(data)) {
        if (['mode', 'time', 'cookedTime'].includes(k)) attributes[k] = v
      }
      /* EXAMPLE
      {
        mode: '0',
        time: '0', // in minutes
        cookedTime: '0', // probably not needed by the plugin
      }
      */
      this.externalModeUpdate(parseInt(attributes.mode))
      this.externalTimeLeftUpdate(parseInt(attributes.time))
    } catch (err) {
      this.log.warn('[%s] getAttributes error: %s.', this.accessory.displayName, this.debug ? '\n' + err : err.message)
    }
  }

  async setAttributes (key, val) {
    await this.client.soapAction('urn:Belkin:service:basicevent:1', 'SetCrockpotState', { [key]: { '#text': val } })
  }

  async internalActiveUpdate (value, callback) {
    const prevState = this.service.getCharacteristic(this.Characteristic.Active).value
    try {
      callback()
      if (value === prevState) return
      if (value === 0) {
        await helpers.sleep(500)
        this.service.setCharacteristic(this.Characteristic.RotationSpeed, 0)
        this.service.updateCharacteristic(this.Characteristic.CurrentTemperature, 0)
        this.service.updateCharacteristic(this.Characteristic.HeatingThresholdTemperature, 0)
      } else {
        await helpers.sleep(500)
        this.service.setCharacteristic(this.Characteristic.RotationSpeed, 33)
      }

      if (!this.disableDeviceLogging) this.log('[%s] setting active to [%s].', this.accessory.displayName, value)
    } catch (err) {
      this.log.warn(
        '[%s] setting active to [%s] error: %s.',
        this.accessory.displayName,
        value,
        this.debug ? '\n' + err : err.message
      )
      this.log.warn('[%s] reverting HomeKit status due to error.', this.accessory.displayName)
      await helpers.sleep(1000)
      this.service.updateCharacteristic(this.Characteristic.Active, prevState)
    }
  }

  async internalCookingTimeUpdate (value, callback) {
    if (value === 24) value = 23.5
    const prevState = this.service.getCharacteristic(this.Characteristic.HeatingThresholdTemperature).value
    try {
      callback()
      if (value === prevState) return
      const updateKeyTemp = Math.random().toString(36).substr(2, 8)
      this.accessory.context.updateKeyTemp = updateKeyTemp
      await helpers.sleep(500)
      if (updateKeyTemp !== this.accessory.context.updateKeyTemp) return
      await this.setAttributes('time', value * 60)
      if (!this.disableDeviceLogging) this.log('[%s] setting cooking time to [%s minutes].', this.accessory.displayName, value * 60)
    } catch (err) {
      this.log.warn(
        '[%s] setting cooking time to [%s minutes] error: %s.',
        this.accessory.displayName,
        value * 60,
        this.debug ? '\n' + err : err.message
      )
      this.log.warn('[%s] reverting HomeKit status due to error.', this.accessory.displayName)
      await helpers.sleep(1000)
      this.service.updateCharacteristic(this.Characteristic.HeatingThresholdTemperature, prevState)
    }
  }

  async internalModeUpdate (value, callback) {
    const prevActiveState = this.service.getCharacteristic(this.Characteristic.Active).value
    const prevRotSpeedState = this.service.getCharacteristic(this.Characteristic.RotationSpeed).value
    let newValue = 0
    if (value > 25 && value <= 50) newValue = 50
    else if (value > 50 && value <= 75) newValue = 51
    else if (value > 75) newValue = 52
    try {
      callback()
      if (value === prevRotSpeedState) return
      let setTime = false
      if ([0, 33].includes(value)) {
        // reset the cooking times to 0 if turned off or set to warm
        await helpers.sleep(500)
        this.service.updateCharacteristic(this.Characteristic.CurrentTemperature, 0)
        this.service.updateCharacteristic(this.Characteristic.HeatingThresholdTemperature, 0)
        setTime = 0
      }
      if ([66, 99].includes(value) && this.service.getCharacteristic(this.Characteristic.CurrentTemperature).value === 0) {
        // set the cooking time to 30 minutes if the user has changed from OFF
        await helpers.sleep(500)
        this.service.updateCharacteristic(this.Characteristic.CurrentTemperature, 0.5)
        this.service.updateCharacteristic(this.Characteristic.HeatingThresholdTemperature, 0.5)
        setTime = 30
      }
      const updateKeyMode = Math.random().toString(36).substr(2, 8)
      this.accessory.context.updateKeyMode = updateKeyMode
      await helpers.sleep(500)
      if (updateKeyMode !== this.accessory.context.updateKeyMode) return
      if ([0, 30].includes(setTime)) {
        await this.setAttributes('time', setTime)
        if (!this.disableDeviceLogging) this.log('[%s] setting cooking time to [%s minutes].', this.accessory.displayName, setTime)
        await helpers.sleep(1000)
      }
      await this.setAttributes('mode', newValue.toString())
      if (!this.disableDeviceLogging) this.log('[%s] setting mode to [%s].', this.accessory.displayName, this.modeLabels[newValue])
    } catch (err) {
      this.log.warn(
        '[%s] setting mode to [%s] error: %s.',
        this.accessory.displayName,
        this.modeLabels[newValue],
        this.debug ? '\n' + err : err.message
      )
      this.log.warn('[%s] reverting HomeKit status due to error.', this.accessory.displayName)
      await helpers.sleep(1000)
      this.service.updateCharacteristic(this.Characteristic.Active, prevActiveState)
      this.service.updateCharacteristic(this.Characteristic.RotationSpeed, prevRotSpeedState)
    }
  }

  externalModeUpdate (value) {
    try {
      let rotSpeed = 0
      switch (value) {
        case 52: {
          rotSpeed = 99
          break
        }
        case 51: {
          rotSpeed = 66
          break
        }
        case 50: {
          rotSpeed = 33
          break
        }
      }
      this.service.updateCharacteristic(this.Characteristic.Active, value !== 0)
      this.service.updateCharacteristic(this.Characteristic.RotationSpeed, rotSpeed)
      if (!this.disableDeviceLogging) this.log('[%s] updating mode to [%s].', this.accessory.displayName, this.modeLabels[value])
    } catch (err) {
      this.log.warn(
        '[%s] updating mode to [%s] error: %s.',
        this.accessory.displayName,
        this.modeLabels[value],
        this.debug ? '\n' + err : err.message
      )
    }
  }

  externalTimeLeftUpdate (value) {
    // value is passed as a value in minutes. need to convert to hours in terms of a 0.5 (30 min) step
    let convertedValue = 0
    if (value !== 0) {
      convertedValue = Math.max(Math.round(value * 2) / 2, 0.5)
    }
    try {
      const tempState = this.service.getCharacteristic(this.Characteristic.CurrentTemperature).value
      if (tempState !== value) {
        this.service.updateCharacteristic(this.Characteristic.CurrentTemperature, convertedValue)
        this.service.updateCharacteristic(this.Characteristic.HeatingThresholdTemperature, convertedValue)
        if (!this.disableDeviceLogging) this.log('[%s] updating cook time left to [%s minutes].', this.accessory.displayName, value)
      }
    } catch (err) {
      this.log.warn(
        '[%s] updating cook time left to [%s minutes] error: %s.',
        this.accessory.displayName,
        value,
        this.debug ? '\n' + err : err.message
      )
    }
  }
}
