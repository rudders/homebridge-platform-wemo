/* jshint -W014, -W033, esversion: 9 */
/* eslint-disable new-cap */
'use strict'

module.exports = class deviceSimSwitchInsight {
  constructor (platform, accessory, device) {
    // Set up variables from the platform
    this.consts = platform.consts
    this.eveChar = platform.eveChar
    this.funcs = platform.funcs
    this.hapChar = platform.api.hap.Characteristic
    this.hapErr = platform.api.hap.HapStatusError
    this.hapServ = platform.api.hap.Service
    this.lang = platform.lang
    this.log = platform.log

    // Set up variables from the accessory
    this.accessory = accessory
    this.client = accessory.client
    this.name = accessory.displayName

    // Set up custom variables for this device type
    const deviceConf = platform.wemoInsights[device.serialNumber]
    this.showTodayTC = deviceConf && deviceConf.showTodayTC
    this.wattDiff =
      deviceConf && deviceConf.wattDiff
        ? deviceConf.wattDiff
        : platform.consts.defaultValues.wattDiff
    this.timeDiff =
      deviceConf && deviceConf.timeDiff
        ? deviceConf.timeDiff
        : platform.consts.defaultValues.timeDiff
    if (this.timeDiff === 1) {
      this.timeDiff = false
    }
    this.skipTimeDiff = false

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

    if (!this.funcs.hasProperty(this.accessory.context, 'cacheLastWM')) {
      this.accessory.context.cacheLastWM = 0
    }
    if (!this.funcs.hasProperty(this.accessory.context, 'cacheLastTC')) {
      this.accessory.context.cacheLastTC = 0
    }
    if (!this.funcs.hasProperty(this.accessory.context, 'cacheTotalTC')) {
      this.accessory.context.cacheTotalTC = 0
    }

    // If the accessory has an air purifier service then remove it
    if (this.accessory.getService(this.hapServ.AirPurifier)) {
      this.accessory.removeService(this.accessory.getService(this.hapServ.AirPurifier))
    }

    // If the accessory has an outlet service then remove it
    if (this.accessory.getService(this.hapServ.Outlet)) {
      this.accessory.removeService(this.accessory.getService(this.hapServ.Outlet))
    }

    // Add the switch service if it doesn't already exist
    if (!(this.service = this.accessory.getService(this.hapServ.Switch))) {
      this.service = this.accessory.addService(this.hapServ.Switch)
      this.service.addCharacteristic(this.eveChar.CurrentConsumption)
      this.service.addCharacteristic(this.eveChar.TotalConsumption)
      this.service.addCharacteristic(this.eveChar.ResetTotal)
    }

    // Add the set handler to the switch on/off characteristic
    this.service.getCharacteristic(this.hapChar.On).onSet(async value => {
      await this.internalStateUpdate(value)
    })

    // Add the set handler to the switch reset (eve) characteristic
    this.service.getCharacteristic(this.eveChar.ResetTotal).onSet(value => {
      this.accessory.context.cacheLastWM = 0
      this.accessory.context.cacheLastTC = 0
      this.accessory.context.cacheTotalTC = 0
      this.service.updateCharacteristic(this.eveChar.TotalConsumption, 0)
    })

    // Pass the accessory to fakegato to setup the Eve info service
    this.accessory.historyService = new platform.eveService('switch', this.accessory, {
      log: platform.config.debugFakegato ? this.log : () => {}
    })

    // Output the customised options to the log
    const opts = JSON.stringify({
      logging: this.enableDebugLogging ? 'debug' : this.enableLogging ? 'standard' : 'disable',
      showAs: 'switch',
      showTodayTC: this.showTodayTC,
      timeDiff: this.timeDiff,
      wattDiff: this.wattDiff
    })
    this.log('[%s] %s %s.', this.name, this.lang.devInitOpts, opts)

    // Listeners for when the device sends an update to the plugin
    this.client.on('BinaryState', attribute => this.receiveDeviceUpdate(attribute))
    this.client.on('InsightParams', attribute => this.receiveDeviceUpdate(attribute))

    // Request a device update immediately
    this.requestDeviceUpdate()
  }

  receiveDeviceUpdate (attribute) {
    // Log the receiving update if debug is enabled
    if (this.enableDebugLogging) {
      this.log('[%s] %s [%s: %s].', this.name, this.lang.recUpd, attribute.name, attribute.value)
    }

    // Let's see which attribute has been provided
    switch (attribute.name) {
      case 'BinaryState': {
        // BinaryState is reported as 0=off, 1=on, 8=standby
        // Send a HomeKit needed true/false argument (0=false, 1,8=true)
        this.externalStateUpdate(attribute.value !== 0)
        break
      }
      case 'InsightParams':
        // Send the insight data straight to the function
        this.externalInsightUpdate(
          attribute.value.state,
          attribute.value.power,
          attribute.value.todayWm,
          attribute.value.todayOnSeconds
        )
        break
    }
  }

  async sendDeviceUpdate (value) {
    // Log the sending update if debug is enabled
    if (this.enableDebugLogging) {
      this.log('[%s] %s %s.', this.name, this.lang.senUpd, JSON.stringify(value))
    }

    // Send the update
    await this.client.sendRequest('urn:Belkin:service:basicevent:1', 'SetBinaryState', value)
  }

  async requestDeviceUpdate () {
    try {
      // Request the update
      const data = await this.client.sendRequest(
        'urn:Belkin:service:basicevent:1',
        'GetBinaryState'
      )

      // Check for existence since BinaryState can be int 0
      if (this.funcs.hasProperty(data, 'BinaryState')) {
        this.receiveDeviceUpdate({
          name: 'BinaryState',
          value: parseInt(data.BinaryState)
        })
      }
    } catch (err) {
      const eText = this.funcs.parseError(err)
      this.log.warn('[%s] %s: %s.', this.name, this.lang.rduErr, eText)
    }
  }

  async internalStateUpdate (value) {
    try {
      // Send the update
      await this.sendDeviceUpdate({
        BinaryState: value ? 1 : 0
      })

      // Update the cache value
      this.cacheState = value

      // Log the change if appropriate
      if (this.enableLogging) {
        this.log('[%s] current state [%s].', this.name, value ? 'on' : 'off')
      }

      // If turning the switch off then update the current consumption
      if (!value) {
        // Update the HomeKit characteristics
        this.service.updateCharacteristic(this.eveChar.CurrentConsumption, 0)

        // Add an Eve entry for no power
        this.accessory.historyService.addEntry({ power: 0 })

        // Log the change if appropriate
        if (this.enableLogging) {
          this.log('[%s] current consumption [0W].', this.name)
        }
      }
    } catch (err) {
      const eText = this.funcs.parseError(err)
      this.log.warn('[%s] %s %s.', this.name, this.lang.cantCtl, eText)

      // Throw a 'no response' error and set a timeout to revert this after 2 seconds
      setTimeout(() => {
        this.service.updateCharacteristic(this.hapChar.On, this.cacheState)
      }, 2000)
      throw new this.hapErr(-70402)
    }
  }

  externalInsightUpdate (value, power, todayWm, todayOnSeconds) {
    // Update whether the switch is ON (value=1) or OFF (value=0)
    this.externalStateUpdate(value !== 0)

    // Update the current consumption
    this.externalConsumptionUpdate(power)

    // Update the total consumption
    this.externalTotalConsumptionUpdate(todayWm, todayOnSeconds)
  }

  externalStateUpdate (value) {
    try {
      // Check to see if the cache value is different
      if (value !== this.cacheState) {
        // Update the HomeKit characteristics
        this.service.updateCharacteristic(this.hapChar.On, value)

        // Update the cache value
        this.cacheState = value

        // Log the change if appropriate
        if (this.enableLogging) {
          this.log('[%s] current state [%s].', this.name, value ? 'on' : 'off')
        }
      }

      // If the device has turned off then update the consumption
      if (!value) {
        this.externalConsumptionUpdate(0)
      }
    } catch (err) {
      // Catch any errors
      const eText = this.funcs.parseError(err)
      this.log.warn('[%s] %s %s.', this.name, this.lang.cantUpd, eText)
    }
  }

  externalConsumptionUpdate (power) {
    try {
      // Check to see if the cache value is different
      if (power !== this.cachePower) {
        // Update the cache value
        this.cachePower = power

        // Divide by 1000 to get the power value in W
        const powerInWatts = Math.round(power / 1000)

        // Calculate a difference from the last reading (only used for logging)
        const diff = Math.abs(powerInWatts - this.cachePowerInWatts)

        // Update the power in watts cache
        this.cachePowerInWatts = powerInWatts

        // Update the HomeKit characteristic
        this.service.updateCharacteristic(this.eveChar.CurrentConsumption, powerInWatts)

        // Add the Eve wattage entry
        this.accessory.historyService.addEntry({ power: powerInWatts })

        // Don't continue with logging if the user has set a timeout between entries
        if (this.timeDiff) {
          if (this.skipTimeDiff) {
            return
          }
          this.skipTimeDiff = true
          setTimeout(() => {
            this.skipTimeDiff = false
          }, this.timeDiff * 1000)
        }

        // Don't continue with logging if the user has set min difference between entries
        if (diff < this.wattDiff) {
          return
        }

        // Log the change if appropriate
        if (this.enableLogging) {
          this.log('[%s] current consumption [%sW].', this.name, powerInWatts)
        }
      }
    } catch (err) {
      // Catch any errors
      const eText = this.funcs.parseError(err)
      this.log.warn('[%s] %s %s.', this.name, this.lang.cantUpd, eText)
    }
  }

  externalTotalConsumptionUpdate (todayWm, todayOnSeconds) {
    try {
      if (todayWm !== this.accessory.context.cacheLastWM) {
        // Update the cache last value
        this.accessory.context.cacheLastWM = todayWm

        // Convert to Wh (hours) from raw data of Wm (minutes)
        const todayWh = Math.round(todayWm / 60000)

        // Convert to kWh
        const todaykWh = todayWh / 1000

        // Convert to hours, minutes and seconds (HH:MM:SS)
        const todayOnHours = new Date(todayOnSeconds * 1000).toISOString().substr(11, 8)

        // Calculate the difference (ie extra usage from the last reading)
        const difference = Math.max(todaykWh - this.accessory.context.cacheLastTC, 0)

        // Update the caches
        this.accessory.context.cacheTotalTC += difference
        this.accessory.context.cacheLastTC = todaykWh

        // Update the total consumption characteristic
        this.service.updateCharacteristic(
          this.eveChar.TotalConsumption,
          this.showTodayTC ? todaykWh : this.accessory.context.cacheTotalTC
        )

        // Don't continue with logging if disabled for some reason
        if (this.disableDeviceLogging || this.skipTimeDiff) {
          return
        }

        // Log the change
        this.log(
          '[%s] today ontime [%s] consumption [%s kWh] total consumption [%s kWh].',
          this.name,
          todayOnHours,
          todaykWh.toFixed(3),
          this.accessory.context.cacheTotalTC.toFixed(3)
        )
      }
    } catch (err) {
      // Catch any errors
      const eText = this.funcs.parseError(err)
      this.log.warn('[%s] %s %s.', this.name, this.lang.cantUpd, eText)
    }
  }
}
