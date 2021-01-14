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
    this.Service = platform.api.hap.Service
    this.Characteristic = platform.api.hap.Characteristic
    this.client = accessory.client
    this.accessory = accessory

    // *** Set up the Eve characteristics *** \\
    const self = this
    this.eveCurrentConsumption = function () {
      self.Characteristic.call(this, 'Current Consumption', 'E863F10D-079E-48FF-8F27-9C2605A29F52')
      this.setProps({
        format: self.Characteristic.Formats.UINT16,
        unit: 'W',
        maxValue: 100000,
        minValue: 0,
        minStep: 1,
        perms: [self.Characteristic.Perms.READ, self.Characteristic.Perms.NOTIFY]
      })
      this.value = this.getDefaultValue()
    }
    this.eveTotalConsumption = function () {
      self.Characteristic.call(this, 'Total Consumption', 'E863F10C-079E-48FF-8F27-9C2605A29F52')
      this.setProps({
        format: self.Characteristic.Formats.FLOAT,
        unit: 'kWh',
        maxValue: 100000000000,
        minValue: 0,
        minStep: 0.01,
        perms: [self.Characteristic.Perms.READ, self.Characteristic.Perms.NOTIFY]
      })
      this.value = this.getDefaultValue()
    }
    this.eveResetTotal = function () {
      self.Characteristic.call(this, 'Reset Total', 'E863F112-079E-48FF-8F27-9C2605A29F52')
      this.setProps({
        format: self.Characteristic.Formats.UINT32,
        perms: [self.Characteristic.Perms.READ, self.Characteristic.Perms.NOTIFY, self.Characteristic.Perms.WRITE]
      })
      this.value = this.getDefaultValue()
    }
    util.inherits(this.eveCurrentConsumption, this.Characteristic)
    util.inherits(this.eveTotalConsumption, this.Characteristic)
    util.inherits(this.eveResetTotal, this.Characteristic)
    this.eveCurrentConsumption.UUID = 'E863F10D-079E-48FF-8F27-9C2605A29F52'
    this.eveTotalConsumption.UUID = 'E863F10C-079E-48FF-8F27-9C2605A29F52'
    this.eveResetTotal.UUID = 'E863F112-079E-48FF-8F27-9C2605A29F52'

    // *** Add the outlet service if it doesn't already exist *** \\
    if (!(this.service = this.accessory.getService(this.Service.Outlet))) {
      this.service = this.accessory.addService(this.Service.Outlet)
      this.service.addCharacteristic(this.eveCurrentConsumption)
      this.service.addCharacteristic(this.eveTotalConsumption)
      this.service.addCharacteristic(this.eveResetTotal)
    }

    // *** Add the set handler to the outlet on/off characteristic *** \\
    this.service.getCharacteristic(this.Characteristic.On)
      .removeAllListeners('set')
      .on('set', this.internalUpdate.bind(this))

    // *** Add the set handler to the switch reset (eve) characteristic *** \\
    this.service.getCharacteristic(this.eveResetTotal)
      .removeAllListeners('set')
      .on('set', (value, callback) => {
        callback()
        this.service.updateCharacteristic(this.eveTotalConsumption, 0)
      })

    // *** Listeners for when the device sends an update to the plugin *** \\
    this.client.on('binaryState', attribute => this.receiveDeviceUpdate(attribute))
    this.client.on('insightParams', attribute => this.receiveDeviceUpdate(attribute))
  }

  receiveDeviceUpdate (attribute) {
    if (this.debug) {
      this.log('[%s] received update [%s: %s]', this.accessory.displayName, attribute.name, attribute.value)
    }
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
      prevStateSwitch = this.service.getCharacteristic(this.Characteristic.On).value
      prevStateOInUse = this.service.getCharacteristic(this.Characteristic.OutletInUse).value
      callback()
      await this.sendDeviceUpdate({
        BinaryState: value ? 1 : 0
      })
      if (!this.disableDeviceLogging) {
        this.log('[%s] setting state to [%s].', this.accessory.displayName, value ? 'on' : 'off')
      }
      if (!value) {
        this.service.updateCharacteristic(this.Characteristic.OutletInUse, false)
        this.service.updateCharacteristic(this.eveCurrentConsumption, 0)
        if (!this.disableDeviceLogging) {
          this.log('[%s] updating outlet-in-use to [no].', this.accessory.displayName)
          this.log('[%s] updating current consumption to [0W].', this.accessory.displayName)
        }
      }
    } catch (err) {
      try {
        const errToShow = this.debug ? '\n' + err : err.message
        this.log.warn('[%s] setting state to [%s] error: %s.', this.accessory.displayName, value ? 'on' : 'off', errToShow)
        this.log.warn('[%s] reverting HomeKit status due to error.', this.accessory.displayName)
        await this.helpers.sleep(1000)
        this.service.updateCharacteristic(this.Characteristic.On, prevStateSwitch)
        this.service.updateCharacteristic(this.Characteristic.OutletInUse, prevStateOInUse)
      } catch (e) {}
    }
  }

  externalInsightUpdate (value, power, data) {
    this.externalSwitchUpdate(value !== 0)
    this.externalOutletInUseUpdate(power > 0)
    this.externalConsumptionUpdate(power)
    this.externalTotalConsumptionUpdate(data.TodayConsumed, data.TodayONTime)
  }

  externalSwitchUpdate (value) {
    try {
      const prevState = this.service.getCharacteristic(this.Characteristic.On).value
      if (prevState !== value) {
        this.service.updateCharacteristic(this.Characteristic.On, value)
        if (!this.disableDeviceLogging) {
          this.log('[%s] updating state to [%s].', this.accessory.displayName, value ? 'on' : 'off')
        }
      }
      if (!value) {
        this.externalOutletInUseUpdate(false)
        this.externalConsumptionUpdate(0)
      }
    } catch (err) {
      const errToShow = this.debug ? '\n' + err : err.message
      this.log.warn('[%s] updating state [%s] error: %s.', this.accessory.displayName, value ? 'on' : 'off', errToShow)
    }
  }

  externalOutletInUseUpdate (value) {
    try {
      const prevState = this.service.getCharacteristic(this.Characteristic.OutletInUse).value
      if (value !== prevState) {
        this.service.updateCharacteristic(this.Characteristic.OutletInUse, value)
        if (!this.disableDeviceLogging) {
          this.log('[%s] updating outlet-in-use [%s].', this.accessory.displayName, value ? 'yes' : 'no')
        }
      }
    } catch (err) {
      const errToShow = this.debug ? '\n' + err : err.message
      this.log.warn('[%s] updating outlet-in-use [%s] error: %s.', this.accessory.displayName, value ? 'yes' : 'no', errToShow)
    }
  }

  externalConsumptionUpdate (power) {
    let consumption
    try {
      consumption = Math.round(power / 1000)
      if (consumption !== this.lastConsumption) {
        this.lastConsumption = consumption
        this.service.updateCharacteristic(this.eveCurrentConsumption, consumption)
        if (!this.disableDeviceLogging) {
          this.log('[%s] updating current consumption to [%sW].', this.accessory.displayName, consumption)
        }
      }
    } catch (err) {
      const errToShow = this.debug ? '\n' + err : err.message
      this.log.warn('[%s] updating current consumption to [%sW] error: %s.', this.accessory.displayName, consumption, errToShow)
    }
  }

  externalTotalConsumptionUpdate (raw, raw2) {
    // raw = data.TodayConsumed in mW minutes; raw2 = data.TodayONTime in seconds
    let value
    try {
      value = Math.round(raw / 60000) // convert to Wh, raw is total mW minutes
      const kWh = value / 1000 // convert to kWh
      const onHours = Math.round(raw2 / 36) / 100 // convert to hours
      if (kWh !== this.totalConsumption) {
        this.totalConsumption = kWh
        this.service.updateCharacteristic(this.eveTotalConsumption, kWh)
        if (!this.disableDeviceLogging) {
          this.log('[%s] updating total on-time [%s hours].', this.accessory.displayName, onHours)
          this.log('[%s] updating total consumption [%s kWh].', this.accessory.displayName, kWh)
        }
      }
    } catch (err) {
      const errToShow = this.debug ? '\n' + err : err.message
      this.log.warn('[%s] updating total consumption error: %s.', this.accessory.displayName, errToShow)
    }
  }
}
