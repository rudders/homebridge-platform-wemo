/* jshint -W014, -W033, esversion: 9 */
/* eslint-disable new-cap */
'use strict'

module.exports = class deviceCrockpot {
  constructor (platform, accessory, device) {
    // Set up variables from the platform
    this.consts = platform.consts
    this.debug = platform.config.debug
    this.funcs = platform.funcs
    this.hapChar = platform.api.hap.Characteristic
    this.hapErr = platform.api.hap.HapStatusError
    this.hapServ = platform.api.hap.Service
    this.lang = platform.lang
    this.log = platform.log

    // Set up custom variables for this device type
    const deviceConf = platform.wemoOthers[device.serialNumber]
    this.disableDeviceLogging = deviceConf && deviceConf.overrideDisabledLogging
      ? false
      : platform.config.disableDeviceLogging

    // Set up variables from the accessory
    this.accessory = accessory
    this.client = accessory.client
    this.name = accessory.displayName

    // Add the heater service if it doesn't already exist
    this.service = this.accessory.getService(this.hapServ.HeaterCooler) ||
      this.accessory.addService(this.hapServ.HeaterCooler)

    // Add the set handler to the heater active characteristic
    this.service.getCharacteristic(this.hapChar.Active).onSet(async value => {
      await this.internalStateUpdate(value)
    })

    // Add options to the heater target state characteristic
    this.service.getCharacteristic(this.hapChar.TargetHeaterCoolerState).setProps({
      minValue: 0,
      maxValue: 0,
      validValues: [0]
    })

    // Add the set handler and a range to the heater target temperature characteristic
    this.service.getCharacteristic(this.hapChar.HeatingThresholdTemperature)
      .setProps({
        minValue: 0,
        maxValue: 24,
        minStep: 0.5
      })
      .onSet(async value => {
        await this.internalCookingTimeUpdate(value)
      })

    // Add the set handler to the heater rotation speed characteristic
    this.service.getCharacteristic(this.hapChar.RotationSpeed)
      .setProps({ minStep: 33 })
      .onSet(async value => {
        await this.internalModeUpdate(value)
      })

    // Add a range to the heater current temperature characteristic
    this.service.getCharacteristic(this.hapChar.CurrentTemperature).setProps({
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

    // Output the customised options to the log if in debug mode
    if (this.debug) {
      const opts = JSON.stringify({ disableDeviceLogging: this.disableDeviceLogging })
      this.log('[%s] %s %s.', this.name, this.lang.devInitOpts, opts)
    }

    // Request a device update immediately
    this.requestDeviceUpdate()

    // Crockpot doesn't send device updates so poll the status every 30 seconds
    this.pollInterval = setInterval(() => this.requestDeviceUpdate(), 30000)

    // Stop the polling interval on any client error
    this.client.on('error', () => clearInterval(this.pollInterval))

    // Stop the polling on Homebridge shutdown
    platform.api.on('shutdown', () => clearInterval(this.pollInterval))
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
          this.log('[%s] %s [mode: %s].', this.lang.recUpd, this.name, data.mode)
        }
        this.externalModeUpdate(parseInt(data.mode))
      }

      // data.time can be 0 so check for existence
      if (this.funcs.hasProperty(data, 'time')) {
        if (this.debug) {
          this.log('[%s] %s [time: %s].', this.name, this.lang.recUpd, data.time)
        }
        this.externalTimeLeftUpdate(parseInt(data.time))
      }
    } catch (err) {
      const eText = this.funcs.parseError(err)
      this.log.warn('[%s] %s: %s.', this.name, this.lang.rduErr, eText)
    }
  }

  async sendDeviceUpdate (mode, time) {
    if (this.debug) {
      this.log('[%s] %s {"mode": %s, "time": %s}.', this.name, this.lang.senUpd, mode, time)
    }
    await this.client.sendRequest(
      'urn:Belkin:service:basicevent:1',
      'SetCrockpotState',
      {
        mode: { '#text': mode },
        time: { '#text': time }
      }
    )
  }

  async internalStateUpdate (value) {
    const prevState = this.service.getCharacteristic(this.hapChar.Active).value
    try {
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
      const eText = this.funcs.parseError(err)
      this.log.warn('[%s] %s %s.', this.name, this.lang.cantCtl, eText)

      // Throw a 'no response' error and set a timeout to revert this after 2 seconds
      setTimeout(() => {
        this.service.updateCharacteristic(this.hapChar.Active, prevState)
      }, 2000)
      throw new this.hapErr(-70402)
    }
  }

  async internalModeUpdate (value) {
    const prevSpeed = this.service.getCharacteristic(this.hapChar.RotationSpeed).value
    try {
      const updateKeyMode = Math.random().toString(36).substr(2, 8)
      this.updateKeyMode = updateKeyMode
      await this.funcs.sleep(500)
      if (updateKeyMode !== this.updateKeyMode) {
        return
      }
      const prevSpeed = this.service.getCharacteristic(this.hapChar.RotationSpeed).value
      let newValue = 0
      let newSpeed = 0
      if (value > 25 && value <= 50) {
        newValue = 50
        newSpeed = 33
      } else if (value > 50 && value <= 75) {
        newValue = 51
        newSpeed = 66
      } else if (value > 75) {
        newValue = 52
        newSpeed = 99
      }
      if (prevSpeed === newSpeed) {
        return
      }
      await this.funcs.sleep(500)
      if ([0, 33].includes(newSpeed)) {
        // reset the cooking times to 0 if turned off or set to warm
        this.service.updateCharacteristic(this.hapChar.CurrentTemperature, 0)
        this.service.updateCharacteristic(this.hapChar.HeatingThresholdTemperature, 0)
        this.accessory.context.cacheTime = 0
        if (!this.disableDeviceLogging) {
          this.log('[%s] current timer [0 minutes].', this.name)
        }
      }
      await this.sendDeviceUpdate(newValue, this.accessory.context.cacheTime)
      this.accessory.context.cacheMode = newValue
      if (!this.disableDeviceLogging) {
        this.log('[%s] current mode [%s].', this.name, this.modeLabels[newValue])
      }
    } catch (err) {
      const eText = this.funcs.parseError(err)
      this.log.warn('[%s] %s %s.', this.name, this.lang.cantCtl, eText)

      // Throw a 'no response' error and set a timeout to revert this after 2 seconds
      setTimeout(() => {
        this.service.updateCharacteristic(this.hapChar.RotationSpeed, prevSpeed)
      }, 2000)
      throw new this.hapErr(-70402)
    }
  }

  async internalCookingTimeUpdate (value) {
    const prevTemp = this.service.getCharacteristic(this.hapChar.HeatingThresholdTemperature).value
    try {
      const updateKeyTemp = Math.random().toString(36).substr(2, 8)
      this.updateKeyTemp = updateKeyTemp
      await this.funcs.sleep(500)
      if (updateKeyTemp !== this.updateKeyTemp) {
        return
      }
      if (value === 24) {
        value = 23.5
      }
      if (value === prevTemp) {
        return
      }
      const prevSpeed = this.service.getCharacteristic(this.hapChar.RotationSpeed).value
      let modeChange = this.accessory.context.cacheMode
      // if cooking time is changed to above zero and mode is OFF or WARM, then set to LOW
      if (value !== 0 && [0, 33].includes(prevSpeed)) {
        this.service.updateCharacteristic(this.hapChar.RotationSpeed, 66)
        if (!this.disableDeviceLogging) {
          this.log('[%s] current mode [low].', this.name)
        }
        modeChange = 51
        this.accessory.context.cacheMode = 51
      }
      await this.sendDeviceUpdate(modeChange, value * 60)
      if (!this.disableDeviceLogging) {
        this.log('[%s] current timer [%s minutes].', this.name, value * 60)
      }
    } catch (err) {
      const eText = this.funcs.parseError(err)
      this.log.warn('[%s] %s %s.', this.name, this.lang.cantCtl, eText)

      // Throw a 'no response' error and set a timeout to revert this after 2 seconds
      setTimeout(() => {
        this.service.updateCharacteristic(this.hapChar.HeatingThresholdTemperature, prevTemp)
      }, 2000)
      throw new this.hapErr(-70402)
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
          this.log('[%s] current mode [%s].', this.name, this.modeLabels[value])
        }
        if (value === 0) {
          this.service.updateCharacteristic(this.hapChar.CurrentTemperature, 0)
          this.service.updateCharacteristic(this.hapChar.HeatingThresholdTemperature, 0)
        }
      }
    } catch (err) {
      const eText = this.funcs.parseError(err)
      this.log.warn('[%s] %s %s.', this.name, this.lang.cantUpd, eText)
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
        this.service.updateCharacteristic(this.hapChar.CurrentTemperature, convertedValue)
        this.service.updateCharacteristic(this.hapChar.HeatingThresholdTemperature, convertedValue)
        this.accessory.context.cacheTime = value
        if (!this.disableDeviceLogging) {
          this.log('[%s] current timer [%s minutes].', this.name, value)
        }
      }
    } catch (err) {
      const eText = this.funcs.parseError(err)
      this.log.warn('[%s] %s %s.', this.name, this.lang.cantUpd, eText)
    }
  }
}
