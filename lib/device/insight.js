/* jshint -W014, -W033, esversion: 9 */
/* eslint-disable new-cap */
'use strict'

module.exports = class deviceInsight {
  constructor (platform, accessory, device) {
    // Set up variables from the platform
    this.debug = platform.config.debug
    this.funcs = platform.funcs
    this.consts = platform.consts
    this.hapServ = platform.api.hap.Service
    this.hapChar = platform.api.hap.Characteristic
    this.eveChar = platform.eveChar
    this.log = platform.log
    this.messages = platform.messages
    this.platform = platform

    // Set up variables from the accessory
    this.accessory = accessory
    this.client = accessory.client
    this.name = accessory.displayName

    // Set up custom variables for this device type
    const deviceConf = platform.wemoInsights[device.serialNumber]
    this.showTodayTC = deviceConf && deviceConf.showTodayTC
    this.wattDiff = deviceConf && deviceConf.wattDiff
      ? deviceConf.wattDiff
      : platform.consts.defaultValues.wattDiff
    this.timeDiff = deviceConf && deviceConf.timeDiff
      ? deviceConf.timeDiff
      : platform.consts.defaultValues.timeDiff
    if (this.timeDiff === 1) {
      this.timeDiff = false
    }
    this.skipTimeDiff = false
    this.disableDeviceLogging = deviceConf && deviceConf.overrideDisabledLogging
      ? false
      : platform.config.disableDeviceLogging

    if (!this.funcs.hasProperty(this.accessory.context, 'cacheLastWM')) {
      this.accessory.context.cacheLastWM = 0
    }
    if (!this.funcs.hasProperty(this.accessory.context, 'cacheLastTC')) {
      this.accessory.context.cacheLastTC = 0
    }
    if (!this.funcs.hasProperty(this.accessory.context, 'cacheTotalTC')) {
      this.accessory.context.cacheTotalTC = 0
    }

    // Add the outlet service if it doesn't already exist
    if (!(this.service = this.accessory.getService(this.hapServ.Outlet))) {
      this.service = this.accessory.addService(this.hapServ.Outlet)
      this.service.addCharacteristic(this.eveChar.CurrentConsumption)
      this.service.addCharacteristic(this.eveChar.TotalConsumption)
      this.service.addCharacteristic(this.eveChar.ResetTotal)
    }

    // Add the set handler to the outlet on/off characteristic
    this.service.getCharacteristic(this.hapChar.On).onSet(async value => {
      await this.internalUpdate(value)
    })

    // Add the set handler to the switch reset (eve) characteristic
    this.service.getCharacteristic(this.eveChar.ResetTotal).onSet(value => {
      this.accessory.context.cacheLastWM = 0
      this.accessory.context.cacheLastTC = 0
      this.accessory.context.cacheTotalTC = 0
      this.service.updateCharacteristic(this.eveChar.TotalConsumption, 0)
    })

    // Pass the accessory to fakegato to setup the Eve info service
    this.accessory.historyService = new platform.eveService('energy', this.accessory, {
      log: platform.config.debugFakegato ? this.log : () => {}
    })

    // Output the customised options to the log if in debug mode
    if (this.debug) {
      const opts = JSON.stringify({
        disableDeviceLogging: this.disableDeviceLogging,
        showTodayTC: this.showTodayTC,
        timeDiff: this.timeDiff,
        wattDiff: this.wattDiff
      })
      this.log('[%s] %s %s.', this.name, this.messages.devInitOpts, opts)
    }

    // Listeners for when the device sends an update to the plugin
    this.client.on('BinaryState', attribute => this.receiveDeviceUpdate(attribute))
    this.client.on('InsightParams', attribute => this.receiveDeviceUpdate(attribute))

    // Request a device update immediately
    this.requestDeviceUpdate()
  }

  receiveDeviceUpdate (attribute) {
    if (this.debug) {
      this.log(
        '[%s] %s [%s: %s].',
        this.name,
        this.messages.recUpd,
        attribute.name,
        attribute.value
      )
    }

    /*
      BinaryState is reported to be:
      0 = off
      8 = standby (low power consumption that is not considered in use)
      1 = on
    */

    switch (attribute.name) {
      case 'BinaryState': {
        const hkValue = attribute.value !== 0
        this.externalSwitchUpdate(hkValue)
        break
      }
      case 'InsightParams':
        this.externalInsightUpdate(
          attribute.value.state,
          attribute.value.power,
          attribute.value.todayOnSeconds,
          attribute.value.todayWm
        )
        break
    }
  }

  async sendDeviceUpdate (value) {
    if (this.debug) {
      this.log('[%s] %s %s.', this.name, this.messages.senUpd, JSON.stringify(value))
    }
    await this.client.sendRequest(
      'urn:Belkin:service:basicevent:1',
      'SetBinaryState',
      value
    )
  }

  async requestDeviceUpdate () {
    try {
      const data = await this.client.sendRequest(
        'urn:Belkin:service:basicevent:1',
        'GetBinaryState'
      )
      if (this.funcs.hasProperty(data, 'BinaryState')) {
        this.receiveDeviceUpdate({
          name: 'BinaryState',
          value: parseInt(data.BinaryState)
        })
      }
    } catch (err) {
      const eText = this.funcs.parseError(err)
      this.log.warn('[%s] %s: %s.', this.name, this.messages.rduErr, eText)
    }
  }

  async internalUpdate (value) {
    try {
      await this.sendDeviceUpdate({
        BinaryState: value ? 1 : 0
      })
      this.cacheOnOff = value
      if (!this.disableDeviceLogging) {
        this.log('[%s] current state [%s].', this.name, value ? 'on' : 'off')
      }
      if (!value) {
        this.service.updateCharacteristic(this.hapChar.OutletInUse, false)
        this.service.updateCharacteristic(this.eveChar.CurrentConsumption, 0)
        this.accessory.historyService.addEntry({ power: 0 })
        if (!this.disableDeviceLogging) {
          this.log('[%s] current outlet-in-use [no].', this.name)
          this.log('[%s] current consumption [0W].', this.name)
        }
      }
    } catch (err) {
      const eText = this.funcs.parseError(err)
      this.log.warn('[%s] %s %s.', this.name, this.messages.cantCtl, eText)

      // Throw a 'no response' error and set a timeout to revert this after 5 seconds
      setTimeout(() => {
        this.service.updateCharacteristic(this.hapChar.On, this.cacheOnOff)
      }, 5000)
      throw new this.platform.api.hap.HapStatusError(this.consts.hapError)
    }
  }

  externalInsightUpdate (value, power, todayWm, todayOnSeconds) {
    this.externalSwitchUpdate(value !== 0)
    this.externalOutletInUseUpdate(value === 1)
    this.externalConsumptionUpdate(power)
    this.externalTotalConsumptionUpdate(todayWm, todayOnSeconds)
  }

  externalSwitchUpdate (value) {
    try {
      if (value !== this.cacheOnOff) {
        this.service.updateCharacteristic(this.hapChar.On, value)
        this.cacheOnOff = value
        if (!this.disableDeviceLogging) {
          this.log('[%s] current state [%s].', this.name, value ? 'on' : 'off')
        }
      }
      if (!value) {
        this.externalOutletInUseUpdate(false)
        this.externalConsumptionUpdate(0)
      }
    } catch (err) {
      const eText = this.funcs.parseError(err)
      this.log.warn('[%s] %s %s.', this.name, this.messages.cantUpd, eText)
    }
  }

  externalOutletInUseUpdate (value) {
    try {
      if (value !== this.cacheOIU) {
        this.service.updateCharacteristic(this.hapChar.OutletInUse, value)
        this.cacheOIU = value
        if (!this.disableDeviceLogging) {
          this.log('[%s] current outlet-in-use [%s].', this.name, value ? 'yes' : 'no')
        }
      }
    } catch (err) {
      const eText = this.funcs.parseError(err)
      this.log.warn('[%s] %s %s.', this.name, this.messages.cantUpd, eText)
    }
  }

  externalConsumptionUpdate (power) {
    try {
      if (power !== this.lastPower) {
        this.lastPower = power
        const consumption = Math.round(power / 1000)
        const diff = Math.abs(consumption - this.prevReading)
        this.prevReading = consumption
        this.service.updateCharacteristic(this.eveChar.CurrentConsumption, consumption)
        this.accessory.historyService.addEntry({ power: consumption })
        if (this.timeDiff) {
          if (this.skipTimeDiff) {
            return
          }
          this.skipTimeDiff = true
          setTimeout(() => {
            this.skipTimeDiff = false
          }, this.timeDiff * 1000)
        }
        if (!this.disableDeviceLogging && diff >= this.wattDiff) {
          this.log('[%s] current consumption [%sW].', this.name, consumption)
        }
      }
    } catch (err) {
      const eText = this.funcs.parseError(err)
      this.log.warn('[%s] %s %s.', this.name, this.messages.cantUpd, eText)
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

        // Convert to hours
        const todayOnHours = Math.round(todayOnSeconds / 36) / 100

        // Calculate the difference (ie extra usage from the last reading)
        const difference = Math.max(todaykWh - this.accessory.context.cacheLastTC, 0)

        // Update the caches
        this.accessory.context.cacheTotalTC += difference
        this.accessory.context.cacheLastTC = todaykWh

        // Update the total consumption characteristic
        this.service.updateCharacteristic(
          this.eveChar.TotalConsumption,
          this.showTodayTC
            ? todaykWh
            : this.accessory.context.cacheTotalTC
        )

        // Don't continue with logging if disabled for some reason
        if (this.disableDeviceLogging || this.skipTimeDiff) {
          return
        }

        // Log the update
        this.log(
          '[%s] today ontime [%s hrs] consumption [%s kWh] total consumption [%s kWh].',
          this.name,
          todayOnHours,
          todaykWh.toFixed(3),
          this.accessory.context.cacheTotalTC.toFixed(3)
        )
      }
    } catch (err) {
      const eText = this.funcs.parseError(err)
      this.log.warn('[%s] %s %s.', this.name, this.messages.cantUpd, eText)
    }
  }
}
