/* jshint -W014, -W033, esversion: 9 */
/* eslint-disable new-cap */
'use strict'
const util = require('util')
module.exports = class deviceInsight {
  constructor (platform, accessory, device) {
    this.log = platform.log
    this.helpers = platform.helpers
    this.debug = platform.debug
    this.disableDeviceLogging = platform.config.disableDeviceLogging || false
    this.Service = platform.api.hap.Service
    this.Characteristic = platform.api.hap.Characteristic
    this.lastConsumption = 0
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
    if (!(this.service = accessory.getService(this.Service.Outlet))) {
      this.service = accessory.addService(this.Service.Outlet)
      this.service.addCharacteristic(this.eveCurrentConsumption)
      this.service.addCharacteristic(this.eveTotalConsumption)
      this.service.addCharacteristic(this.eveResetTotal)
    }
    this.service
      .getCharacteristic(this.Characteristic.On)
      .removeAllListeners('set')
      .on('set', this.internalUpdate.bind(this))
    this.service
      .getCharacteristic(this.eveResetTotal)
      .removeAllListeners('set')
      .on('set', (value, callback) => {
        callback()
        this.service.updateCharacteristic(this.eveTotalConsumption, 0)
      })
    this.accessory = accessory
    this.client = accessory.client
    this.client.on('binaryState', value => this.externalSwitchUpdate(parseInt(value)))
    this.client.on('insightParams', (state, power, data) => this.externalInsightUpdate(parseInt(state), parseInt(power), data))
  }

  async internalUpdate (value, callback) {
    const prevStateSwitch = this.service.getCharacteristic(this.Characteristic.On).value
    const prevStateOInUse = this.service.getCharacteristic(this.Characteristic.OutletInUse).value
    try {
      callback()
      await this.client.soapAction('urn:Belkin:service:basicevent:1', 'SetBinaryState', { BinaryState: value ? 1 : 0 })
      if (!this.disableDeviceLogging) this.log('[%s] setting state to [%s].', this.accessory.displayName, value ? 'on' : 'off')
      if (!value) {
        this.service.updateCharacteristic(this.Characteristic.OutletInUse, false)
        if (!this.disableDeviceLogging) this.log('[%s] setting outlet-in-use to [no].', this.accessory.displayName)
        this.service.updateCharacteristic(this.eveCurrentConsumption, 0)
        if (!this.disableDeviceLogging) this.log('[%s] setting consumption to [0W].', this.accessory.displayName)
      }
    } catch (err) {
      this.log.warn(
        '[%s] setting state and outlet-in-use to [%s] error: %s.',
        this.accessory.displayName,
        value ? 'on' : 'off',
        this.debug ? '\n' + err : err.message
      )
      this.log.warn('[%s] reverting HomeKit status due to error.', this.accessory.displayName)
      await this.helpers.sleep(1000)
      this.service.updateCharacteristic(this.Characteristic.On, prevStateSwitch)
      this.service.updateCharacteristic(this.Characteristic.OutletInUse, prevStateOInUse)
    }
  }

  externalSwitchUpdate (value) {
    try {
      value = value !== 0
      const switchState = this.service.getCharacteristic(this.Characteristic.On).value
      if (switchState !== value) {
        this.service.updateCharacteristic(this.Characteristic.On, value)
        if (!this.disableDeviceLogging) this.log('[%s] updating state to [%s].', this.accessory.displayName, value ? 'on' : 'off')
      }
      if (!value) {
        this.externalOutletInUseUpdate(0)
        this.externalConsumptionUpdate(0)
      }
    } catch (err) {
      this.log.warn(
        '[%s] updating state [%s] error: %s.',
        this.accessory.displayName,
        value ? 'on' : 'off',
        this.debug ? '\n' + err : err.message
      )
    }
  }

  externalInsightUpdate (value, power, data) {
    this.externalSwitchUpdate(value)
    this.externalOutletInUseUpdate(value)
    this.externalConsumptionUpdate(power)
    this.externalTotalConsumptionUpdate(data.TodayConsumed, data.TodayONTime)
  }

  externalOutletInUseUpdate (value) {
    try {
      value = value !== 0
      if (value !== this.service.getCharacteristic(this.Characteristic.OutletInUse).value) {
        this.service.updateCharacteristic(this.Characteristic.OutletInUse, value)
        if (!this.disableDeviceLogging) this.log('[%s] updating outlet-in-use [%s].', this.accessory.displayName, value ? 'yes' : 'no')
      }
    } catch (err) {
      this.log.warn(
        '[%s] updating outlet-in-use [%s] error: %s.',
        this.accessory.displayName,
        value ? 'yes' : 'no',
        this.debug ? '\n' + err : err.message
      )
    }
  }

  externalConsumptionUpdate (power) {
    const consumption = Math.round(power / 1000)
    try {
      if (consumption !== this.lastConsumption) {
        this.service.updateCharacteristic(this.eveCurrentConsumption, consumption)
        this.lastConsumption = consumption
        if (!this.disableDeviceLogging) this.log('[%s] updating consumption to [%sW].', this.accessory.displayName, consumption)
      }
    } catch (err) {
      this.log.warn(
        '[%s] updating consumption to [%sW] error: %s.',
        this.accessory.displayName,
        consumption,
        this.debug ? '\n' + err : err.message
      )
    }
  }

  externalTotalConsumptionUpdate (raw, raw2) {
    // raw = data.TodayConsumed in mW minutes; raw2 = data.TodayONTime in seconds
    const value = Math.round(raw / 60000) // convert to Wh, raw is total mW minutes
    try {
      const kWh = value / 1000 // convert to kWh
      const onHours = Math.round(raw2 / 36) / 100 // convert to hours
      if (kWh !== this.totalConsumption) {
        this.service.updateCharacteristic(this.eveTotalConsumption, kWh)
        this.totalConsumption = kWh
        if (!this.disableDeviceLogging) this.log('[%s] updating total on-time - %s hours.', this.accessory.displayName, onHours)
        if (!this.disableDeviceLogging) this.log('[%s] updating total consumption - %s kWh.', this.accessory.displayName, kWh)
      }
    } catch (err) {
      this.log.warn(
        '[%s] updating total consumption error: %s.',
        this.accessory.displayName,
        this.debug ? '\n' + err : err.message
      )
    }
  }
}
