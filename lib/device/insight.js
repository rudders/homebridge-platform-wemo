/* jshint -W014, -W033, esversion: 9 */
/* eslint-disable new-cap */
'use strict'
const util = require('util')
module.exports = class deviceInsight {
  constructor (platform, accessory, device) {
    this.log = platform.log
    this.debug = platform.debug
    this.helpers = platform.helpers
    this.disableDeviceLogging = platform.config.disableDeviceLogging
    this.showTodayTC = platform.wemoInsights[device.serialNumber] && platform.wemoInsights[device.serialNumber].showTodayTC
    this.wattDiff = platform.wemoInsights[device.serialNumber] && platform.wemoInsights[device.serialNumber].wattDiff
    this.wattDiff = isNaN(this.wattDiff) || this.wattDiff < 1
      ? this.helpers.defaults.wattDiff
      : this.wattDiff
    this.S = platform.api.hap.Service
    this.C = platform.api.hap.Characteristic
    this.client = accessory.client
    this.dName = accessory.displayName
    this.accessory = accessory

    // *** Set up the Eve characteristics *** \\
    const self = this
    this.eveCurrentConsumption = function () {
      self.C.call(this, 'Current Consumption', 'E863F10D-079E-48FF-8F27-9C2605A29F52')
      this.setProps({
        format: self.C.Formats.UINT16,
        unit: 'W',
        maxValue: 100000,
        minValue: 0,
        minStep: 1,
        perms: [self.C.Perms.READ, self.C.Perms.NOTIFY]
      })
      this.value = this.getDefaultValue()
    }
    this.eveTotalConsumption = function () {
      self.C.call(this, 'Total Consumption', 'E863F10C-079E-48FF-8F27-9C2605A29F52')
      this.setProps({
        format: self.C.Formats.FLOAT,
        unit: 'kWh',
        maxValue: 100000000000,
        minValue: 0,
        minStep: 0.01,
        perms: [self.C.Perms.READ, self.C.Perms.NOTIFY]
      })
      this.value = this.getDefaultValue()
    }
    this.eveResetTotal = function () {
      self.C.call(this, 'Reset Total', 'E863F112-079E-48FF-8F27-9C2605A29F52')
      this.setProps({
        format: self.C.Formats.UINT32,
        perms: [self.C.Perms.READ, self.C.Perms.NOTIFY, self.C.Perms.WRITE]
      })
      this.value = this.getDefaultValue()
    }
    util.inherits(this.eveCurrentConsumption, this.C)
    util.inherits(this.eveTotalConsumption, this.C)
    util.inherits(this.eveResetTotal, this.C)
    this.eveCurrentConsumption.UUID = 'E863F10D-079E-48FF-8F27-9C2605A29F52'
    this.eveTotalConsumption.UUID = 'E863F10C-079E-48FF-8F27-9C2605A29F52'
    this.eveResetTotal.UUID = 'E863F112-079E-48FF-8F27-9C2605A29F52'

    if (!this.helpers.hasProperty(this.accessory.context, 'cacheLastTC')) {
      this.accessory.context.cacheLastTC = 0
    }
    if (!this.helpers.hasProperty(this.accessory.context, 'cacheTotalTC')) {
      this.accessory.context.cacheTotalTC = 0
    }

    // *** Add the outlet service if it doesn't already exist *** \\
    if (!(this.service = this.accessory.getService(this.S.Outlet))) {
      this.service = this.accessory.addService(this.S.Outlet)
      this.service.addCharacteristic(this.eveCurrentConsumption)
      this.service.addCharacteristic(this.eveTotalConsumption)
      this.service.addCharacteristic(this.eveResetTotal)
    }

    // *** Add the set handler to the outlet on/off characteristic *** \\
    this.service.getCharacteristic(this.C.On)
      .removeAllListeners('set')
      .on('set', this.internalUpdate.bind(this))

    // *** Add the set handler to the switch reset (eve) characteristic *** \\
    this.service.getCharacteristic(this.eveResetTotal)
      .removeAllListeners('set')
      .on('set', (value, callback) => {
        callback()
        this.accessory.context.cacheLastTC = 0
        this.accessory.context.cacheTotalTC = 0
        this.service.updateCharacteristic(this.eveTotalConsumption, 0)
      })

    // *** Pass the accessory to fakegato to setup the Eve info service *** \\
    this.accessory.log = platform.config.debugFakegato ? this.log : () => {}
    this.accessory.historyService = new platform.eveService('energy', accessory, {
      storage: 'fs',
      path: platform.eveLogPath
    })

    // *** Listeners for when the device sends an update to the plugin *** \\
    this.client.on('binaryState', attribute => this.receiveDeviceUpdate(attribute))
    this.client.on('insightParams', attribute => this.receiveDeviceUpdate(attribute))
  }

  receiveDeviceUpdate (attribute) {
    if (this.debug) {
      this.log('[%s] received update [%s: %s]', this.dName, attribute.name, attribute.value)
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
        this.externalInsightUpdate(attribute.value.state, attribute.value.power, attribute.value.data)
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
      prevStateSwitch = this.service.getCharacteristic(this.C.On).value
      prevStateOInUse = this.service.getCharacteristic(this.C.OutletInUse).value
      callback()
      await this.sendDeviceUpdate({
        BinaryState: value ? 1 : 0
      })
      if (!this.disableDeviceLogging) {
        this.log('[%s] setting state to [%s].', this.dName, value ? 'on' : 'off')
      }
      if (!value) {
        this.service.updateCharacteristic(this.C.OutletInUse, false)
        this.service.updateCharacteristic(this.eveCurrentConsumption, 0)
        if (!this.disableDeviceLogging) {
          this.log('[%s] updating outlet-in-use to [no].', this.dName)
          this.log('[%s] updating current consumption to [0W].', this.dName)
        }
      }
    } catch (err) {
      try {
        const errToShow = this.debug ? '\n' + err : err.message
        this.log.warn('[%s] setting state to [%s] error: %s.', this.dName, value ? 'on' : 'off', errToShow)
        this.log.warn('[%s] reverting HomeKit status due to error.', this.dName)
        await this.helpers.sleep(1000)
        this.service.updateCharacteristic(this.C.On, prevStateSwitch)
        this.service.updateCharacteristic(this.C.OutletInUse, prevStateOInUse)
      } catch (e) {}
    }
  }

  externalInsightUpdate (value, power, data) {
    this.externalSwitchUpdate(value !== 0)
    this.externalOutletInUseUpdate(value === 1)
    this.externalConsumptionUpdate(power)
    this.externalTotalConsumptionUpdate(data.TodayConsumed, data.TodayONTime)
  }

  externalSwitchUpdate (value) {
    try {
      const prevState = this.service.getCharacteristic(this.C.On).value
      if (prevState !== value) {
        this.service.updateCharacteristic(this.C.On, value)
        if (!this.disableDeviceLogging) {
          this.log('[%s] updating state to [%s].', this.dName, value ? 'on' : 'off')
        }
      }
      if (!value) {
        this.externalOutletInUseUpdate(false)
        this.externalConsumptionUpdate(0)
      }
    } catch (err) {
      const errToShow = this.debug ? '\n' + err : err.message
      this.log.warn('[%s] updating state [%s] error: %s.', this.dName, value ? 'on' : 'off', errToShow)
    }
  }

  externalOutletInUseUpdate (value) {
    try {
      const prevState = this.service.getCharacteristic(this.C.OutletInUse).value
      if (value !== prevState) {
        this.service.updateCharacteristic(this.C.OutletInUse, value)
        if (!this.disableDeviceLogging) {
          this.log('[%s] updating outlet-in-use [%s].', this.dName, value ? 'yes' : 'no')
        }
      }
    } catch (err) {
      const errToShow = this.debug ? '\n' + err : err.message
      this.log.warn('[%s] updating outlet-in-use [%s] error: %s.', this.dName, value ? 'yes' : 'no', errToShow)
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
        if (!this.disableDeviceLogging && Math.abs(this.lastConsumption - this.prevReading) >= this.wattDiff) {
          this.log('[%s] updating current consumption to [%sW].', this.dName, consumption)
        }
        this.prevReading = this.lastConsumption
      }
    } catch (err) {
      const errToShow = this.debug ? '\n' + err : err.message
      this.log.warn('[%s] updating current consumption to [%sW] error: %s.', this.dName, consumption, errToShow)
    }
  }

  externalTotalConsumptionUpdate (raw, raw2) {
    // *** raw = data.TodayConsumed in mW minutes; raw2 = data.TodayONTime in seconds *** \\
    let value
    try {
      // *** Convert to Wh, raw is total mW minutes *** \\
      value = Math.round(raw / 60000)

      // *** Convert to kWh *** \\
      const todayConsumption = value / 1000

      // *** Convert to hours *** \\
      const todayOnTime = Math.round(raw2 / 36) / 100

      if (todayConsumption !== this.accessory.context.cacheLastTC) {
        const difference = Math.max(todayConsumption - this.accessory.context.cacheLastTC, 0)
        this.accessory.context.cacheTotalTC += difference
        this.accessory.context.cacheLastTC = todayConsumption
        this.service.updateCharacteristic(
          this.eveTotalConsumption,
          this.showTodayTC
            ? todayConsumption
            : this.accessory.context.cacheTotalTC
        )
        if (!this.disableDeviceLogging) {
          this.log(
            '[%s] updating today on-time [%s hours] today consumption [%s kWh] total consumption [%s kWh].',
            this.dName,
            todayOnTime,
            todayConsumption,
            this.accessory.context.cacheTotalTC
          )
        }
      }
    } catch (err) {
      const errToShow = this.debug ? '\n' + err : err.message
      this.log.warn('[%s] updating total consumption error: %s.', this.dName, errToShow)
    }
  }
}
