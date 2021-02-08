/* jshint -W014, -W033, esversion: 9 */
/* eslint-disable new-cap */
'use strict'

module.exports = class deviceCrockpot {
  constructor (platform, accessory, device) {
    // Set up variables from the platform
    this.debug = platform.config.debug
    this.disableDeviceLogging = platform.config.disableDeviceLogging
    this.funcs = platform.funcs
    this.hapServ = platform.api.hap.Service
    this.hapChar = platform.api.hap.Characteristic
    this.log = platform.log
    this.messages = platform.messages

    // Set up variables from the accessory
    this.accessory = accessory
    this.client = accessory.client
    this.name = accessory.displayName

    // Add the heater service if it doesn't already exist
    this.service = this.accessory.getService(this.hapServ.HeaterCooler) ||
      this.accessory.addService(this.hapServ.HeaterCooler)

    // Add the set handler to the heater active characteristic
    this.service.getCharacteristic(this.hapChar.Active)
      .removeAllListeners('set')
      .on('set', this.internalActiveUpdate.bind(this))

    // Add the set handler to the heater target state characteristic
    this.service.getCharacteristic(this.hapChar.TargetHeaterCoolerState)
      .removeAllListeners('set')
      .setProps({ validValues: [0] })

    // Add the set handler and a range to the heater target temperature characteristic
    this.service.getCharacteristic(this.hapChar.HeatingThresholdTemperature)
      .removeAllListeners('set')
      .on('set', this.internalCookingTimeUpdate.bind(this))
      .setProps({
        minValue: 0,
        maxValue: 24,
        minStep: 0.5
      })

    // Add the set handler to the heater rotation speed characteristic
    this.service.getCharacteristic(this.hapChar.RotationSpeed)
      .removeAllListeners('set')
      .on('set', this.internalModeUpdate.bind(this))
      .setProps({ minStep: 33 })

    // Add a range to the heater current temperature characteristic
    this.service.getCharacteristic(this.hapChar.CurrentTemperature)
      .setProps({
        minValue: 0,
        maxValue: 24,
        minStep: 0.5
      })

    // Some conversion objects
    this.modeLabels = {
      0: 'off',
      50: 'warm',
      51: 'low',
      52: 'high'
    }

    // Request a device update immediately
    this.requestDeviceUpdate()

    // Crockpot doesn't send device updates so poll the status every 30 seconds
    const pollInterval = setInterval(() => this.requestDeviceUpdate(), 30000)

    // Stop the polling interval on any client error
    this.client.on('error', () => clearInterval(pollInterval))
  }

  async requestDeviceUpdate () {
    try {
      const data = await this.client.sendRequest(
        'urn:Belkin:service:basicevent:1',
        'GetCrockpotState'
      )

      // data.mode can be 0 so check for existence
      if (this.funcs.hasProperty(data, 'mode')) {
        if (this.debug) {
          this.log('[%s] %s [mode: %s].', this.messages.recUpd, this.name, data.mode)
        }
        this.externalModeUpdate(parseInt(data.mode))
      }

      // data.time can be 0 so check for existence
      if (this.funcs.hasProperty(data, 'time')) {
        if (this.debug) {
          this.log('[%s] %s [time: %s].', this.name, this.messages.recUpd, data.time)
        }
        this.externalTimeLeftUpdate(parseInt(data.time))
      }
    } catch (err) {
      const eText = this.funcs.parseError(err)
      this.log.warn('[%s] %s: %s.', this.name, this.messages.rduErr, eText)
    }
  }

  async sendDeviceUpdate (mode, time) {
    await this.client.sendRequest(
      'urn:Belkin:service:basicevent:1',
      'SetCrockpotState',
      {
        mode: { '#text': mode },
        time: { '#text': time }
      }
    )
  }

  async internalActiveUpdate (value, callback) {
    let prevState
    try {
      prevState = this.service.getCharacteristic(this.hapChar.Active).value
      callback()
      if (value === prevState) {
        return
      }
      if (value === 0) {
        await this.funcs.sleep(500)
        this.service.setCharacteristic(this.hapChar.RotationSpeed, 0)
        this.service.updateCharacteristic(this.hapChar.CurrentTemperature, 0)
        this.service.updateCharacteristic(this.hapChar.HeatingThresholdTemperature, 0)
        this.accessory.context.cacheTime = 0
      } else {
        await this.funcs.sleep(500)
        this.service.setCharacteristic(this.hapChar.RotationSpeed, 33)
      }
    } catch (err) {
      try {
        const eText = this.funcs.parseError(err)
        this.log.warn('[%s] %s %s.', this.name, this.messages.cantCtl, eText)
        await this.funcs.sleep(1000)
        this.service.updateCharacteristic(this.hapChar.Active, prevState)
      } catch (e) {}
    }
  }

  async internalModeUpdate (value, callback) {
    let prevActiveState
    let prevRotSpeedState
    let newValue = 0
    try {
      prevActiveState = this.service.getCharacteristic(this.hapChar.Active).value
      prevRotSpeedState = this.service.getCharacteristic(this.hapChar.RotationSpeed).value
      callback()
      if (value > 25 && value <= 50) {
        newValue = 50
      } else if (value > 50 && value <= 75) {
        newValue = 51
      } else if (value > 75) {
        newValue = 52
      }
      if (value === prevRotSpeedState) {
        return
      }
      if ([0, 33].includes(value)) {
        // reset the cooking times to 0 if turned off or set to warm
        await this.funcs.sleep(500)
        this.service.updateCharacteristic(this.hapChar.CurrentTemperature, 0)
        this.service.updateCharacteristic(this.hapChar.HeatingThresholdTemperature, 0)
        this.accessory.context.cacheTime = 0
        if (!this.disableDeviceLogging) {
          this.log(
            '[%s] setting cooking timer to [0 minutes] as OFF or WARM was selected.',
            this.name
          )
        }
      }
      const updateKeyMode = Math.random().toString(36).substr(2, 8)
      this.accessory.context.updateKeyMode = updateKeyMode
      await this.funcs.sleep(500)
      if (updateKeyMode !== this.accessory.context.updateKeyMode) {
        return
      }
      await this.sendDeviceUpdate(newValue, this.accessory.context.cacheTime)
      this.accessory.context.cacheMode = newValue
      if (!this.disableDeviceLogging) {
        this.log('[%s] setting mode to [%s].', this.name, this.modeLabels[newValue])
      }
    } catch (err) {
      try {
        const eText = this.funcs.parseError(err)
        this.log.warn('[%s] %s %s.', this.name, this.messages.cantCtl, eText)
        await this.funcs.sleep(1000)
        this.service.updateCharacteristic(this.hapChar.Active, prevActiveState)
        this.service.updateCharacteristic(this.hapChar.RotationSpeed, prevRotSpeedState)
      } catch (e) {}
    }
  }

  async internalCookingTimeUpdate (value, callback) {
    let prevState
    try {
      prevState = this.service
        .getCharacteristic(this.hapChar.HeatingThresholdTemperature).value
      if (value === 24) {
        value = 23.5
      }
      callback()
      if (value === prevState) {
        return
      }
      const updateKeyTemp = Math.random().toString(36).substr(2, 8)
      this.accessory.context.updateKeyTemp = updateKeyTemp
      await this.funcs.sleep(500)
      if (updateKeyTemp !== this.accessory.context.updateKeyTemp) {
        return
      }
      const prevMode = this.service.getCharacteristic(this.hapChar.RotationSpeed).value
      let modeChange = this.accessory.context.cacheMode
      // if cooking time is changed to above zero and mode is OFF or WARM, then set to LOW
      if (value !== 0 && [0, 33].includes(prevMode)) {
        this.service.updateCharacteristic(this.hapChar.RotationSpeed, 66)
        if (!this.disableDeviceLogging) {
          this.log('[%s] setting mode to [low].', this.name)
        }
        modeChange = 51
        this.accessory.context.cacheMode = 51
      }
      await this.sendDeviceUpdate(modeChange, value * 60)
      if (!this.disableDeviceLogging) {
        this.log('[%s] setting cooking timer to [%s minutes].', this.name, value * 60)
      }
    } catch (err) {
      try {
        const eText = this.funcs.parseError(err)
        this.log.warn('[%s] %s %s.', this.name, this.messages.cantCtl, eText)
        await this.funcs.sleep(1000)
        this.service.updateCharacteristic(
          this.hapChar.HeatingThresholdTemperature,
          prevState
        )
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
        this.service.updateCharacteristic(this.hapChar.Active, value !== 0)
        this.service.updateCharacteristic(this.hapChar.RotationSpeed, rotSpeed)
        this.accessory.context.cacheMode = value
        if (!this.disableDeviceLogging) {
          this.log('[%s] updating mode to [%s].', this.name, this.modeLabels[value])
        }
        if (value === 0) {
          this.service.updateCharacteristic(this.hapChar.CurrentTemperature, 0)
          this.service.updateCharacteristic(this.hapChar.HeatingThresholdTemperature, 0)
        }
      }
    } catch (err) {
      const eText = this.funcs.parseError(err)
      this.log.warn('[%s] %s %s.', this.name, this.messages.cantUpd, eText)
    }
  }

  externalTimeLeftUpdate (value) {
    try {
      // value is passed as a value in minutes
      let convertedValue = 0
      if (value !== 0) {
        // need to (1) convert to minutes (2) round to nearest 0.5 hour unit
        // and (3) if 0 then raise to 0.5
        // this last check is to show the user a timer of half hour even if
        // the actual timer is just one minute,
        // as it would seem worse to have the timer shown as 0 if in fact it is still on
        convertedValue = Math.max(Math.round(value / 30) / 2, 0.5)
      }
      if (value !== this.accessory.context.cacheTime) {
        const rotSpeed = this.service.getCharacteristic(this.hapChar.RotationSpeed).value
        if (convertedValue > 0 && rotSpeed === 0) {
          this.service.updateCharacteristic(this.hapChar.RotationSpeed, 33)
          this.accessory.context.cacheMode = 50
        }
        this.service.updateCharacteristic(
          this.hapChar.CurrentTemperature,
          convertedValue
        )
        this.service.updateCharacteristic(
          this.hapChar.HeatingThresholdTemperature,
          convertedValue
        )
        this.accessory.context.cacheTime = value
        if (!this.disableDeviceLogging) {
          this.log('[%s] updating cooking timer to [%s minutes].', this.name, value)
        }
      }
    } catch (err) {
      const eText = this.funcs.parseError(err)
      this.log.warn('[%s] %s %s.', this.name, this.messages.cantUpd, eText)
    }
  }
}
