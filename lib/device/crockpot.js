/* jshint -W014, -W033, esversion: 9 */
/* eslint-disable new-cap */
'use strict'

module.exports = class deviceCrockpot {
  constructor (platform, accessory, device) {
    // Set up variables from the platform
    this.consts = platform.consts
    this.funcs = platform.funcs
    this.hapChar = platform.api.hap.Characteristic
    this.hapErr = platform.api.hap.HapStatusError
    this.hapServ = platform.api.hap.Service
    this.lang = platform.lang
    this.log = platform.log

    // Set up custom variables for this device type
    const deviceConf = platform.wemoOthers[device.serialNumber]

    // Set the correct logging variables for this accessory
    this.enableLogging = !platform.config.disableDeviceLogging
    this.enableDebugLogging = platform.config.debug
    if (deviceConf && deviceConf.overrideLogging) {
      switch (deviceConf.overrideLogging) {
        case 'standard':
          this.enableLogging = true
          this.enableDebugLogging = false
          break
        case 'debug':
          this.enableLogging = true
          this.enableDebugLogging = true
          break
        case 'disable':
          this.enableLogging = false
          this.enableDebugLogging = false
          break
      }
    }

    // Set up variables from the accessory
    this.accessory = accessory
    this.client = accessory.client
    this.name = accessory.displayName

    // Add the heater service if it doesn't already exist
    this.service =
      this.accessory.getService(this.hapServ.HeaterCooler) ||
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
    this.service
      .getCharacteristic(this.hapChar.HeatingThresholdTemperature)
      .setProps({
        minValue: 0,
        maxValue: 24,
        minStep: 0.5
      })
      .onSet(async value => {
        await this.internalCookingTimeUpdate(value)
      })

    // Add the set handler to the heater rotation speed characteristic
    this.service
      .getCharacteristic(this.hapChar.RotationSpeed)
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
      0: this.lang.labelOff,
      50: this.lang.labelWarm,
      51: this.lang.labelLow,
      52: this.lang.labelHigh
    }

    // Output the customised options to the log
    const opts = JSON.stringify({
      logging: this.enableDebugLogging ? 'debug' : this.enableLogging ? 'standard' : 'disable'
    })
    this.log('[%s] %s %s.', this.name, this.lang.devInitOpts, opts)

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
      // Request the update
      const data = await this.client.sendRequest(
        'urn:Belkin:service:basicevent:1',
        'GetCrockpotState'
      )

      // Check for existence since data.mode can be 0
      if (this.funcs.hasProperty(data, 'mode')) {
        // Log the receiving update if debug is enabled
        if (this.enableDebugLogging) {
          this.log('[%s] %s [mode: %s].', this.name, this.lang.recUpd, data.mode)
        }

        // Send the data to the receive function
        this.externalModeUpdate(parseInt(data.mode))
      }

      // data.time can be 0 so check for existence
      if (this.funcs.hasProperty(data, 'time')) {
        // Log the receiving update if debug is enabled
        if (this.enableDebugLogging) {
          this.log('[%s] %s [time: %s].', this.name, this.lang.recUpd, data.time)
        }

        // Send the data to the receive function
        this.externalTimeLeftUpdate(parseInt(data.time))
      }
    } catch (err) {
      const eText = this.funcs.parseError(err)
      this.log.warn('[%s] %s: %s.', this.name, this.lang.rduErr, eText)
    }
  }

  async sendDeviceUpdate (mode, time) {
    // Log the sending update if debug is enabled
    if (this.enableDebugLogging) {
      this.log('[%s] %s {"mode": %s, "time": %s}.', this.name, this.lang.senUpd, mode, time)
    }

    // Send the update
    await this.client.sendRequest('urn:Belkin:service:basicevent:1', 'SetCrockpotState', {
      mode: { '#text': mode },
      time: { '#text': time }
    })
  }

  async internalStateUpdate (value) {
    const prevState = this.service.getCharacteristic(this.hapChar.Active).value
    try {
      // Don't continue if the new value is the same as before
      if (value === prevState) {
        return
      }

      // A slight pause seems to make Home app more responsive for characteristic updates later
      await this.funcs.sleep(500)

      // Note value === 0 is OFF, value === 1 is ON
      if (value === 0) {
        // Turn everything off
        this.service.setCharacteristic(this.hapChar.RotationSpeed, 0)
        this.service.updateCharacteristic(this.hapChar.CurrentTemperature, 0)
        this.service.updateCharacteristic(this.hapChar.HeatingThresholdTemperature, 0)
        this.accessory.context.cacheTime = 0
      } else {
        // Set rotation speed to the lowest ON value
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
      // Avoid multiple updates in quick succession
      const updateKeyMode = Math.random()
        .toString(36)
        .substr(2, 8)
      this.updateKeyMode = updateKeyMode
      await this.funcs.sleep(500)
      if (updateKeyMode !== this.updateKeyMode) {
        return
      }

      // Generate newValue for the needed mode and newSpeed in 33% multiples
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

      // Don't continue if the speed is the same as before
      if (prevSpeed === newSpeed) {
        return
      }

      // A slight pause seems to make Home app more responsive for characteristic updates later
      await this.funcs.sleep(500)
      if ([0, 33].includes(newSpeed)) {
        // Reset the cooking times to 0 if turned off or set to warm
        this.service.updateCharacteristic(this.hapChar.CurrentTemperature, 0)
        this.service.updateCharacteristic(this.hapChar.HeatingThresholdTemperature, 0)
        this.accessory.context.cacheTime = 0

        // Log the change if appropriate
        if (this.enableLogging) {
          this.log('[%s] %s [0:00].', this.name, this.lang.curTimer)
        }
      }

      // Send the update
      await this.sendDeviceUpdate(newValue, this.accessory.context.cacheTime)

      // Update the cache and log if appropriate
      this.accessory.context.cacheMode = newValue
      if (this.enableLogging) {
        this.log('[%s] %s [%s].', this.name, this.lang.curMode, this.modeLabels[newValue])
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
      // Avoid multiple updates in quick succession
      const updateKeyTemp = Math.random()
        .toString(36)
        .substr(2, 8)
      this.updateKeyTemp = updateKeyTemp
      await this.funcs.sleep(500)
      if (updateKeyTemp !== this.updateKeyTemp) {
        return
      }

      // The value is cooking hours, I don't think device can be set to cook for 24 hours as max
      if (value === 24) {
        value = 23.5
      }

      // Don't continue if the value is the same as before
      if (value === prevTemp) {
        return
      }

      // Find the needed mode based on the new value
      const prevSpeed = this.service.getCharacteristic(this.hapChar.RotationSpeed).value
      let modeChange = this.accessory.context.cacheMode
      // If cooking time is changed to above zero and mode is OFF or WARM, then set to LOW
      if (value !== 0 && [0, 33].includes(prevSpeed)) {
        this.service.updateCharacteristic(this.hapChar.RotationSpeed, 66)
        modeChange = 51
        this.accessory.context.cacheMode = 51

        // Log the mode change if appropriate
        if (this.enableLogging) {
          this.log('[%s] %s [%s].', this.name, this.lang.curMode, this.modeLabels[51])
        }
      }

      // Send the update
      const minutes = value * 60
      await this.sendDeviceUpdate(modeChange, minutes)

      // Log the change of cooking minutes if appropriate
      if (this.enableLogging) {
        this.log('[%s] %s [%s:%s].', this.name, this.lang.curTimer, Math.floor(value), minutes % 60)
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
      // Don't continue if the given mode is the same as before
      if (value === this.accessory.context.cacheMode) {
        return
      }

      // Find the needed rotation speed based on the given mode
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
      // Update the HomeKit characteristics
      this.service.updateCharacteristic(this.hapChar.Active, value !== 0 ? 1 : 0)
      this.service.updateCharacteristic(this.hapChar.RotationSpeed, rotSpeed)

      // Update the cache and log if appropriate
      this.accessory.context.cacheMode = value
      if (this.enableLogging) {
        this.log('[%s] %s [%s].', this.name, this.lang.curMode, this.modeLabels[value])
      }

      // If turned off then set the cooking time characteristics to 0
      if (value === 0) {
        this.service.updateCharacteristic(this.hapChar.CurrentTemperature, 0)
        this.service.updateCharacteristic(this.hapChar.HeatingThresholdTemperature, 0)
      }
    } catch (err) {
      const eText = this.funcs.parseError(err)
      this.log.warn('[%s] %s %s.', this.name, this.lang.cantUpd, eText)
    }
  }

  externalTimeLeftUpdate (value) {
    try {
      // Don't continue if the rounded cooking time is the same as before
      if (value === this.accessory.context.cacheTime) {
        return
      }

      // The value is passed in minutes (cooking time remaining)
      let hkValue = 0
      if (value > 0) {
        /*
          (1) convert to half-hour units (e.g. 159 -> 5.3)
          (2) round to nearest 0.5 hour unit (e.g. 5.3 -> 5)
          (3) if 0 then raise to 0.5 (as technically still cooking even if 1 minute)
        */
        hkValue = Math.max(Math.round(value / 30) / 2, 0.5)
      }

      const rotSpeed = this.service.getCharacteristic(this.hapChar.RotationSpeed).value

      // Change to LOW mode if cooking but cache is OFF
      if (hkValue > 0 && rotSpeed === 0) {
        this.service.updateCharacteristic(this.hapChar.RotationSpeed, 33)
        this.accessory.context.cacheMode = 50
      }

      // Update the cooking time HomeKit characteristics
      this.service.updateCharacteristic(this.hapChar.CurrentTemperature, hkValue)
      this.service.updateCharacteristic(this.hapChar.HeatingThresholdTemperature, hkValue)

      // Update the cache and log if appropriate
      this.accessory.context.cacheTime = value
      if (this.enableLogging) {
        this.log(
          '[%s] %s [%s:%s].',
          this.name,
          this.lang.curTimer,
          Math.floor(value / 60),
          value % 60
        )
      }
    } catch (err) {
      const eText = this.funcs.parseError(err)
      this.log.warn('[%s] %s %s.', this.name, this.lang.cantUpd, eText)
    }
  }
}
