/* jshint -W014, -W033, esversion: 9 */
/* eslint-disable new-cap */
'use strict'
module.exports = class deviceCrockpot {
  constructor (platform, accessory, device) {
    this.log = platform.log
    this.helpers = platform.helpers
    this.debug = platform.debug
    this.disableDeviceLogging = platform.config.disableDeviceLogging || false
    this.Service = platform.api.hap.Service
    this.Characteristic = platform.api.hap.Characteristic
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
    // setInterval(() => this.getAttributes(), 120000) // every two minutes
    setInterval(() => this.getAttributes(), 30000) // every two minutes @BETA
    this.modeLabels = {
      0: 'off',
      50: 'warm',
      51: 'low',
      52: 'high'
    }
  }

  async getAttributes () {
    try {
      const data = await this.client.sendRequest('urn:Belkin:service:basicevent:1', 'GetCrockpotState', null)
      this.log.warn('[%s] ----- Received update from device -----', this.accessory.displayName)
      this.log(
        '[%s] Received mode [%s (%s)] and time remaining [%s minutes].',
        this.accessory.displayName,
        data.mode,
        this.modeLabels[parseInt(data.mode)],
        data.time
      )
      if (data.mode) this.externalModeUpdate(parseInt(data.mode))
      if (data.time) this.externalTimeLeftUpdate(parseInt(data.time))
      this.log.warn('[%s] ----- END Received update from device -----', this.accessory.displayName)
    } catch (err) {
      this.log.warn('[%s] getAttributes error: %s.', this.accessory.displayName, this.debug ? '\n' + err : err.message)
    }
  }

  async setAttributes (mode, time) {
    this.log.warn('[%s] ----- Sending update to device -----', this.accessory.displayName)
    this.log(
      '[%s] Sending mode [%s (%s)] and time remaining [%s minutes].',
      this.accessory.displayName,
      mode,
      this.modeLabels[mode],
      time
    )
    await this.client.sendRequest('urn:Belkin:service:basicevent:1', 'SetCrockpotState', {
      mode: { '#text': mode },
      time: { '#text': time }
    })
    this.log.warn('[%s] ----- END Sending update to device -----', this.accessory.displayName)
  }

  async internalActiveUpdate (value, callback) {
    const prevState = this.service.getCharacteristic(this.Characteristic.Active).value
    try {
      callback()
      if (value === prevState) return
      this.log.warn('[%s] ----- "Active" Change via Home App -----', this.accessory.displayName)
      if (value === 0) {
        await this.helpers.sleep(500)
        if (!this.disableDeviceLogging) this.log('[%s] request to set mode to [0].', this.accessory.displayName)
        this.service.setCharacteristic(this.Characteristic.RotationSpeed, 0)
        if (!this.disableDeviceLogging) this.log('[%s] setting cooking timer to [0 minutes].', this.accessory.displayName)
        this.service.updateCharacteristic(this.Characteristic.CurrentTemperature, 0)
        this.service.updateCharacteristic(this.Characteristic.HeatingThresholdTemperature, 0)
        this.accessory.context.cacheTime = 0
      } else {
        await this.helpers.sleep(500)
        if (!this.disableDeviceLogging) this.log('[%s] will set to WARM by default.', this.accessory.displayName)
        this.service.setCharacteristic(this.Characteristic.RotationSpeed, 33)
      }
      if (!this.disableDeviceLogging) this.log('[%s] setting active to [%s].', this.accessory.displayName, value)
      this.log.warn('[%s] ----- END "Active" Change via Home App -----', this.accessory.displayName)
    } catch (err) {
      this.log.warn(
        '[%s] setting active to [%s] error: %s.',
        this.accessory.displayName,
        value,
        this.debug ? '\n' + err : err.message
      )
      this.log.warn('[%s] reverting HomeKit status due to error.', this.accessory.displayName)
      await this.helpers.sleep(1000)
      this.service.updateCharacteristic(this.Characteristic.Active, prevState)
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
      this.log.warn('[%s] ----- "Mode" Change via Home App -----', this.accessory.displayName)
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
      await this.setAttributes(newValue, this.accessory.context.cacheTime)
      this.accessory.context.cacheMode = newValue
      if (!this.disableDeviceLogging) this.log('[%s] setting mode to [%s].', this.accessory.displayName, this.modeLabels[newValue])
      this.log.warn('[%s] ----- END "Mode" Change via Home App -----', this.accessory.displayName)
    } catch (err) {
      this.log.warn(
        '[%s] setting mode to [%s] error: %s.',
        this.accessory.displayName,
        this.modeLabels[newValue],
        this.debug ? '\n' + err : err.message
      )
      this.log.warn('[%s] reverting HomeKit status due to error.', this.accessory.displayName)
      await this.helpers.sleep(1000)
      this.service.updateCharacteristic(this.Characteristic.Active, prevActiveState)
      this.service.updateCharacteristic(this.Characteristic.RotationSpeed, prevRotSpeedState)
    }
  }

  async internalCookingTimeUpdate (value, callback) {
    if (value === 24) value = 23.5
    const prevState = this.service.getCharacteristic(this.Characteristic.HeatingThresholdTemperature).value
    try {
      callback()
      if (value === prevState) return
      this.log.warn('[%s] ----- "Cooking Time" Change via Home App -----', this.accessory.displayName)
      const updateKeyTemp = Math.random().toString(36).substr(2, 8)
      this.accessory.context.updateKeyTemp = updateKeyTemp
      await this.helpers.sleep(500)
      if (updateKeyTemp !== this.accessory.context.updateKeyTemp) return
      const prevMode = this.service.getCharacteristic(this.Characteristic.RotationSpeed).value
      let modeChange = this.accessory.context.cacheMode
      // if the cooking time is changed to not zero and the mode is currently OFF or WARM, then set to LOW
      if (value !== 0 && [0, 33].includes(prevMode)) {
        this.service.updateCharacteristic(this.Characteristic.RotationSpeed, 66)
        if (!this.disableDeviceLogging) this.log('[%s] setting mode to [low] since cooking time above zero and the last mode was OFF or WARM.', this.accessory.displayName)
        modeChange = 51
        this.accessory.context.cacheMode = 51
      }
      await this.setAttributes(modeChange, value * 60)
      if (!this.disableDeviceLogging) this.log('[%s] setting cooking timer to [%s minutes].', this.accessory.displayName, value * 60)
      this.log.warn('[%s] ----- END "Cooking Time" Change via Home App -----', this.accessory.displayName)
    } catch (err) {
      this.log.warn(
        '[%s] setting cooking timer to [%s minutes] error: %s.',
        this.accessory.displayName,
        value * 60,
        this.debug ? '\n' + err : err.message
      )
      this.log.warn('[%s] reverting HomeKit status due to error.', this.accessory.displayName)
      await this.helpers.sleep(1000)
      this.service.updateCharacteristic(this.Characteristic.HeatingThresholdTemperature, prevState)
    }
  }

  externalModeUpdate (value) {
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
    try {
      if (value !== this.accessory.context.cacheMode) {
        if (!this.disableDeviceLogging) this.log('[%s] updating on/off to [%s].', this.accessory.displayName, value !== 0 ? 'on' : 'off')
        this.service.updateCharacteristic(this.Characteristic.Active, value !== 0)
        if (!this.disableDeviceLogging) this.log('[%s] updating fan speed to [%s%].', this.accessory.displayName, rotSpeed)
        this.service.updateCharacteristic(this.Characteristic.RotationSpeed, rotSpeed)
        this.accessory.context.cacheMode = value
        if (!this.disableDeviceLogging) this.log('[%s] updating mode to [%s].', this.accessory.displayName, this.modeLabels[value])
        if (value === 0) {
          this.service.updateCharacteristic(this.Characteristic.CurrentTemperature, 0)
          this.service.updateCharacteristic(this.Characteristic.HeatingThresholdTemperature, 0)
          if (!this.disableDeviceLogging) this.log('[%s] updating cooking time to [0 minutes] since state received is OFF.')
        }
      } else {
        if (!this.disableDeviceLogging) this.log('[%s] skipping mode update as value is same as before.', this.accessory.displayName)
      }
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
    // value is passed as a value in minutes
    let convertedValue = 0
    if (value !== 0) {
      // need to (1) convert to minutes (2) round to nearest 0.5 hour unit and (3) if 0 then raise to 0.5
      // this last check is to show the user a timer of half hour even if the actual timer is just one minute,
      // as it would seem worse to have the timer shown as zero if in fact it is still on
      convertedValue = Math.max(Math.round(value / 30) / 2, 0.5)
    }
    try {
      if (value !== this.accessory.context.cacheTime) {
        if (convertedValue > 0 && this.service.getCharacteristic(this.Characteristic.RotationSpeed).value === 0) {
          if (!this.disableDeviceLogging) this.log('[%s] updating fan speed to [33%] (WARM) since we received a cooking time greater than 0, and the previous state was OFF.', this.accessory.displayName)

          this.service.updateCharacteristic(this.Characteristic.RotationSpeed, 33)
          this.accessory.context.cacheMode = 50
        }
        this.service.updateCharacteristic(this.Characteristic.CurrentTemperature, convertedValue)
        this.service.updateCharacteristic(this.Characteristic.HeatingThresholdTemperature, convertedValue)
        this.accessory.context.cacheTime = value
        if (!this.disableDeviceLogging) this.log('[%s] updating cooking timer to [%s minutes].', this.accessory.displayName, value)
      } else {
        if (!this.disableDeviceLogging) this.log('[%s] skipping cooking time update as value is same as before.', this.accessory.displayName)
      }
    } catch (err) {
      this.log.warn(
        '[%s] updating cooking timer to [%s minutes] error: %s.',
        this.accessory.displayName,
        value,
        this.debug ? '\n' + err : err.message
      )
    }
  }
}
