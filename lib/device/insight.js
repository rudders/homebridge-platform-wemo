/* jshint -W014, -W033, esversion: 9 */
/* eslint-disable new-cap */
'use strict'

module.exports = class deviceInsight {
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

    // Set up custom variables for this device type
    this.showTodayTC = platform.wemoInsights[device.serialNumber] &&
      platform.wemoInsights[device.serialNumber].showTodayTC
    this.wattDiff = platform.wemoInsights[device.serialNumber] &&
      platform.wemoInsights[device.serialNumber].wattDiff
      ? platform.wemoInsights[device.serialNumber].wattDiff
      : platform.consts.defaultValues.wattDiff
    const eveCC = 'E863F10D-079E-48FF-8F27-9C2605A29F52'
    const eveTC = 'E863F10C-079E-48FF-8F27-9C2605A29F52'
    const eveRS = 'E863F112-079E-48FF-8F27-9C2605A29F52'

    // Require libraries needed here
    const util = require('util')

    // Set up the Eve characteristics
    const self = this
    this.eveCurrentConsumption = function () {
      self.hapChar.call(this, 'Current Consumption', self.eveCC)
      this.setProps({
        format: self.hapChar.Formats.UINT16,
        unit: 'W',
        maxValue: 100000,
        minValue: 0,
        minStep: 1,
        perms: [self.hapChar.Perms.READ, self.hapChar.Perms.NOTIFY]
      })
      this.value = this.getDefaultValue()
    }
    this.eveTotalConsumption = function () {
      self.hapChar.call(this, 'Total Consumption', self.eveTC)
      this.setProps({
        format: self.hapChar.Formats.FLOAT,
        unit: 'kWh',
        maxValue: 100000000000,
        minValue: 0,
        minStep: 0.01,
        perms: [self.hapChar.Perms.READ, self.hapChar.Perms.NOTIFY]
      })
      this.value = this.getDefaultValue()
    }
    this.eveResetTotal = function () {
      self.hapChar.call(this, 'Reset Total', self.eveRS)
      this.setProps({
        format: self.hapChar.Formats.UINT32,
        perms: [
          self.hapChar.Perms.READ,
          self.hapChar.Perms.NOTIFY,
          self.hapChar.Perms.WRITE
        ]
      })
      this.value = this.getDefaultValue()
    }
    util.inherits(this.eveCurrentConsumption, this.hapChar)
    util.inherits(this.eveTotalConsumption, this.hapChar)
    util.inherits(this.eveResetTotal, this.hapChar)
    this.eveCurrentConsumption.UUID = eveCC
    this.eveTotalConsumption.UUID = eveTC
    this.eveResetTotal.UUID = eveRS

    if (!this.funcs.hasProperty(this.accessory.context, 'cacheLastTC')) {
      this.accessory.context.cacheLastTC = 0
    }
    if (!this.funcs.hasProperty(this.accessory.context, 'cacheTotalTC')) {
      this.accessory.context.cacheTotalTC = 0
    }

    // Add the outlet service if it doesn't already exist
    if (!(this.service = this.accessory.getService(this.hapServ.Outlet))) {
      this.service = this.accessory.addService(this.hapServ.Outlet)
      this.service.addCharacteristic(this.eveCurrentConsumption)
      this.service.addCharacteristic(this.eveTotalConsumption)
      this.service.addCharacteristic(this.eveResetTotal)
    }

    // Add the set handler to the outlet on/off characteristic
    this.service.getCharacteristic(this.hapChar.On)
      .removeAllListeners('set')
      .on('set', this.internalUpdate.bind(this))

    // Add the set handler to the switch reset (eve) characteristic
    this.service.getCharacteristic(this.eveResetTotal)
      .removeAllListeners('set')
      .on('set', (value, callback) => {
        callback()
        this.accessory.context.cacheLastTC = 0
        this.accessory.context.cacheTotalTC = 0
        this.service.updateCharacteristic(this.eveTotalConsumption, 0)
      })

    // Pass the accessory to fakegato to setup the Eve info service
    this.accessory.log = platform.config.debugFakegato ? this.log : () => {}
    this.accessory.historyService = new platform.eveService('energy', this.accessory, {
      storage: 'fs',
      path: platform.eveLogPath
    })

    // Listeners for when the device sends an update to the plugin
    this.client.on('binaryState', attribute => this.receiveDeviceUpdate(attribute))
    this.client.on('insightParams', attribute => this.receiveDeviceUpdate(attribute))
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
      case 'binaryState': {
        const hkValue = attribute.value !== 0
        this.externalSwitchUpdate(hkValue)
        break
      }
      case 'insightParams':
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
    await this.client.sendRequest(
      'urn:Belkin:service:basicevent:1',
      'SetBinaryState',
      value
    )
  }

  async internalUpdate (value, callback) {
    let prevStateSwitch
    let prevStateOInUse
    try {
      prevStateSwitch = this.service.getCharacteristic(this.hapChar.On).value
      prevStateOInUse = this.service.getCharacteristic(this.hapChar.OutletInUse).value
      callback()
      await this.sendDeviceUpdate({
        BinaryState: value ? 1 : 0
      })
      if (!this.disableDeviceLogging) {
        this.log('[%s] setting state to [%s].', this.name, value ? 'on' : 'off')
      }
      if (!value) {
        this.service.updateCharacteristic(this.hapChar.OutletInUse, false)
        this.service.updateCharacteristic(this.eveCurrentConsumption, 0)
        if (!this.disableDeviceLogging) {
          this.log('[%s] updating outlet-in-use to [no].', this.name)
          this.log('[%s] updating current consumption to [0W].', this.name)
        }
      }
    } catch (err) {
      try {
        const eText = this.funcs.parseError(err)
        this.log.warn('[%s] %s %s.', this.name, this.messages.cantCtl, eText)
        await this.funcs.sleep(1000)
        this.service.updateCharacteristic(this.hapChar.On, prevStateSwitch)
        this.service.updateCharacteristic(this.hapChar.OutletInUse, prevStateOInUse)
      } catch (e) {}
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
      const prevState = this.service.getCharacteristic(this.hapChar.On).value
      if (prevState !== value) {
        this.service.updateCharacteristic(this.hapChar.On, value)
        if (!this.disableDeviceLogging) {
          this.log('[%s] updating state to [%s].', this.name, value ? 'on' : 'off')
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
      const prevState = this.service.getCharacteristic(this.hapChar.OutletInUse).value
      if (value !== prevState) {
        this.service.updateCharacteristic(this.hapChar.OutletInUse, value)
        if (!this.disableDeviceLogging) {
          this.log('[%s] updating outlet-in-use [%s].', this.name, value ? 'yes' : 'no')
        }
      }
    } catch (err) {
      const eText = this.funcs.parseError(err)
      this.log.warn('[%s] %s %s.', this.name, this.messages.cantUpd, eText)
    }
  }

  externalConsumptionUpdate (power) {
    let consumption
    try {
      consumption = Math.round(power / 1000)
      if (consumption !== this.lastConsumption) {
        this.lastConsumption = consumption
        this.service.updateCharacteristic(this.eveCurrentConsumption, consumption)
        this.accessory.historyService.addEntry({
          time: Math.round(new Date().valueOf() / 1000),
          power: consumption
        })
        const diff = Math.abs(this.lastConsumption - this.prevReading)
        if (!this.disableDeviceLogging && diff >= this.wattDiff) {
          this.log('[%s] updating current consumption to [%sW].', this.name, consumption)
        }
        this.prevReading = this.lastConsumption
      }
    } catch (err) {
      const eText = this.funcs.parseError(err)
      this.log.warn('[%s] %s %s.', this.name, this.messages.cantUpd, eText)
    }
  }

  externalTotalConsumptionUpdate (todayWm, todayOnSeconds) {
    try {
      // Convert to Wh (hours) from raw data of Wm (minutes)
      const todayWh = Math.round(todayWm / 60000)

      // Convert to kWh
      const todaykWh = todayWh / 1000

      // Convert to hours
      const todayOnHours = Math.round(todayOnSeconds / 36) / 100

      if (todaykWh !== this.accessory.context.cacheLastTC) {
        const difference = Math.max(todaykWh - this.accessory.context.cacheLastTC, 0)
        this.accessory.context.cacheTotalTC += difference
        this.accessory.context.cacheLastTC = todaykWh
        this.service.updateCharacteristic(
          this.eveTotalConsumption,
          this.showTodayTC
            ? todaykWh
            : this.accessory.context.cacheTotalTC
        )
        if (this.disableDeviceLogging) {
          return
        }
        this.log(
          '[%s] updating today ontime [%s] consumption [%s] total consumption [%s].',
          this.name,
          todayOnHours + ' hours',
          todaykWh.toFixed(3) + ' kWh',
          this.accessory.context.cacheTotalTC.toFixed(3) + ' kWh'
        )
      }
    } catch (err) {
      const eText = this.funcs.parseError(err)
      this.log.warn('[%s] %s %s.', this.name, this.messages.cantUpd, eText)
    }
  }
}
