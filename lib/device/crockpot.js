/* jshint -W014, -W033, esversion: 9 */
/* eslint-disable new-cap */
'use strict'
module.exports = class deviceCrockpot {
  constructor (platform, accessory, device) {
    this.log = platform.log
    this.debug = platform.debug
    this.helpers = platform.helpers
    this.disableDeviceLogging = platform.config.disableDeviceLogging
    this.Service = platform.api.hap.Service
    this.Characteristic = platform.api.hap.Characteristic
    this.client = accessory.client
    this.accessory = accessory
    this.service = this.accessory.getService(this.Service.HeaterCooler) || this.accessory.addService(this.Service.HeaterCooler)
    this.service
      .getCharacteristic(this.Characteristic.Active)
      .removeAllListeners('set')
      .on('set', this.internalActiveUpdate.bind(this))
    this.service
      .getCharacteristic(this.Characteristic.TargetHeaterCoolerState)
      .removeAllListeners('set')
      .setProps({ validValues: [0] })
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
      .setProps({ minStep: 33 })
    this.modeLabels = {
      0: 'off',
      50: 'warm',
      51: 'low',
      52: 'high'
    }

    this.requestDeviceUpdate()
    // poll the status every 30 seconds
    const pollInterval = setInterval(() => this.requestDeviceUpdate(), 30000)
    this.client.on('error', () => clearInterval(pollInterval))
  }

  async requestDeviceUpdate () {
    try {
      const data = await this.client.sendRequest('urn:Belkin:service:basicevent:1', 'GetCrockpotState', null)
      if (this.debug) this.log('[%s] received update [Mode: %s], [Time: %s].', this.accessory.displayName, data.mode, data.time)
      if (data.mode) this.externalModeUpdate(parseInt(data.mode))
      if (data.time) this.externalTimeLeftUpdate(parseInt(data.time))
    } catch (err) {
      this.log.warn('[%s] requestDeviceUpdate error: %s.', this.accessory.displayName, this.debug ? '\n' + err : err.message)
    }
  }

  async sendDeviceUpdate (mode, time) {
    await this.client.sendRequest('urn:Belkin:service:basicevent:1', 'SetCrockpotState', {
      mode: { '#text': mode },
      time: { '#text': time }
    })
  }

  async internalActiveUpdate (value, callback) {
    let prevState
    try {
      prevState = this.service.getCharacteristic(this.Characteristic.Active).value
      callback()
      if (value === prevState) return
      if (value === 0) {
        await this.helpers.sleep(500)
        this.service.setCharacteristic(this.Characteristic.RotationSpeed, 0)
        this.service.updateCharacteristic(this.Characteristic.CurrentTemperature, 0)
        this.service.updateCharacteristic(this.Characteristic.HeatingThresholdTemperature, 0)
        this.accessory.context.cacheTime = 0
      } else {
        await this.helpers.sleep(500)
        this.service.setCharacteristic(this.Characteristic.RotationSpeed, 33)
      }
    } catch (err) {
      try {
        const errToShow = this.debug ? '\n' + err : err.message
        this.log.warn('[%s] setting active to [%s] error: %s.', this.accessory.displayName, value, errToShow)
        this.log.warn('[%s] reverting HomeKit status due to error.', this.accessory.displayName)
        await this.helpers.sleep(1000)
        this.service.updateCharacteristic(this.Characteristic.Active, prevState)
      } catch (e) {}
    }
  }

  async internalModeUpdate (value, callback) {
    let prevActiveState
    let prevRotSpeedState
    let newValue = 0
    try {
      prevActiveState = this.service.getCharacteristic(this.Characteristic.Active).value
      prevRotSpeedState = this.service.getCharacteristic(this.Characteristic.RotationSpeed).value
      callback()
      if (value > 25 && value <= 50) newValue = 50
      else if (value > 50 && value <= 75) newValue = 51
      else if (value > 75) newValue = 52
      if (value === prevRotSpeedState) return
      if ([0, 33].includes(value)) {
        // reset the cooking times to 0 if turned off or set to warm
        await this.helpers.sleep(500)
        this.service.updateCharacteristic(this.Characteristic.CurrentTemperature, 0)
        this.service.updateCharacteristic(this.Characteristic.HeatingThresholdTemperature, 0)
        this.accessory.context.cacheTime = 0
        if (!this.disableDeviceLogging) {
          this.log('[%s] setting cooking timer to [0 minutes] as OFF or WARM was selected.', this.accessory.displayName)
        }
      }
      const updateKeyMode = Math.random().toString(36).substr(2, 8)
      this.accessory.context.updateKeyMode = updateKeyMode
      await this.helpers.sleep(500)
      if (updateKeyMode !== this.accessory.context.updateKeyMode) return
      await this.sendDeviceUpdate(newValue, this.accessory.context.cacheTime)
      this.accessory.context.cacheMode = newValue
      if (!this.disableDeviceLogging) {
        this.log('[%s] setting mode to [%s].', this.accessory.displayName, this.modeLabels[newValue])
      }
    } catch (err) {
      try {
        const errToShow = this.debug ? '\n' + err : err.message
        this.log.warn('[%s] setting mode to [%s] error: %s.', this.accessory.displayName, this.modeLabels[newValue], errToShow)
        this.log.warn('[%s] reverting HomeKit status due to error.', this.accessory.displayName)
        await this.helpers.sleep(1000)
        this.service.updateCharacteristic(this.Characteristic.Active, prevActiveState)
        this.service.updateCharacteristic(this.Characteristic.RotationSpeed, prevRotSpeedState)
      } catch (e) {}
    }
  }

  async internalCookingTimeUpdate (value, callback) {
    let prevState
    try {
      prevState = this.service.getCharacteristic(this.Characteristic.HeatingThresholdTemperature).value
      if (value === 24) value = 23.5
      callback()
      if (value === prevState) return
      const updateKeyTemp = Math.random().toString(36).substr(2, 8)
      this.accessory.context.updateKeyTemp = updateKeyTemp
      await this.helpers.sleep(500)
      if (updateKeyTemp !== this.accessory.context.updateKeyTemp) return
      const prevMode = this.service.getCharacteristic(this.Characteristic.RotationSpeed).value
      let modeChange = this.accessory.context.cacheMode
      // if the cooking time is changed to not zero and the mode is currently OFF or WARM, then set to LOW
      if (value !== 0 && [0, 33].includes(prevMode)) {
        this.service.updateCharacteristic(this.Characteristic.RotationSpeed, 66)
        if (!this.disableDeviceLogging) {
          this.log('[%s] setting mode to [low].', this.accessory.displayName)
        }
        modeChange = 51
        this.accessory.context.cacheMode = 51
      }
      await this.sendDeviceUpdate(modeChange, value * 60)
      if (!this.disableDeviceLogging) {
        this.log('[%s] setting cooking timer to [%s minutes].', this.accessory.displayName, value * 60)
      }
    } catch (err) {
      const errToShow = this.debug ? '\n' + err : err.message
      try {
        this.log.warn('[%s] setting cooking timer to [%s minutes] error: %s.', this.accessory.displayName, value * 60, errToShow)
        this.log.warn('[%s] reverting HomeKit status due to error.', this.accessory.displayName)
        await this.helpers.sleep(1000)
        this.service.updateCharacteristic(this.Characteristic.HeatingThresholdTemperature, prevState)
      } catch (e) {}
    }
  }

  externalModeUpdate (value) {
    try {
      let rotSpeed = 0
      switch (value) {
        case 50: {
          rotSpeed = 33
          break
        }
        case 51: {
          rotSpeed = 66
          break
        }
        case 52: {
          rotSpeed = 99
          break
        }
      }
      if (value !== this.accessory.context.cacheMode) {
        this.service.updateCharacteristic(this.Characteristic.Active, value !== 0)
        this.service.updateCharacteristic(this.Characteristic.RotationSpeed, rotSpeed)
        this.accessory.context.cacheMode = value
        if (!this.disableDeviceLogging) {
          this.log('[%s] updating mode to [%s].', this.accessory.displayName, this.modeLabels[value])
        }
        if (value === 0) {
          this.service.updateCharacteristic(this.Characteristic.CurrentTemperature, 0)
          this.service.updateCharacteristic(this.Characteristic.HeatingThresholdTemperature, 0)
        }
      }
    } catch (err) {
      const errToShow = this.debug ? '\n' + err : err.message
      this.log.warn('[%s] updating mode to [%s] error: %s.', this.accessory.displayName, this.modeLabels[value], errToShow)
    }
  }

  externalTimeLeftUpdate (value) {
    try {
      // value is passed as a value in minutes
      let convertedValue = 0
      if (value !== 0) {
        // need to (1) convert to minutes (2) round to nearest 0.5 hour unit and (3) if 0 then raise to 0.5
        // this last check is to show the user a timer of half hour even if the actual timer is just one minute,
        // as it would seem worse to have the timer shown as zero if in fact it is still on
        convertedValue = Math.max(Math.round(value / 30) / 2, 0.5)
      }
      if (value !== this.accessory.context.cacheTime) {
        if (convertedValue > 0 && this.service.getCharacteristic(this.Characteristic.RotationSpeed).value === 0) {
          this.service.updateCharacteristic(this.Characteristic.RotationSpeed, 33)
          this.accessory.context.cacheMode = 50
        }
        this.service.updateCharacteristic(this.Characteristic.CurrentTemperature, convertedValue)
        this.service.updateCharacteristic(this.Characteristic.HeatingThresholdTemperature, convertedValue)
        this.accessory.context.cacheTime = value
        if (!this.disableDeviceLogging) {
          this.log('[%s] updating cooking timer to [%s minutes].', this.accessory.displayName, value)
        }
      }
    } catch (err) {
      const errToShow = this.debug ? '\n' + err : err.message
      this.log.warn('[%s] updating cooking timer to [%s minutes] error: %s.', this.accessory.displayName, value, errToShow)
    }
  }
}
