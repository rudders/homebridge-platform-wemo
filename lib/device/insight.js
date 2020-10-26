/* jshint -W014, -W033, esversion: 9 */
/* eslint-disable new-cap */
'use strict'
const util = require('util')
module.exports = class deviceStandard {
  constructor (platform, accessory, device) {
    this.log = platform.log
    this.debug = platform.config.debug || false
    this.Service = platform.api.hap.Service
    this.Characteristic = platform.api.hap.Characteristic
    this.inUseThreshold = platform.config.inUsePowerThreshold || 0
    const self = this
    this.eveCurrentConsumption = function () {
      self.Characteristic.call(this, 'Current Consumption', 'E863F10D-079E-48FF-8F27-9C2605A29F52')
      this.setProps({
        format: self.Characteristic.Formats.FLOAT,
        unit: 'W',
        perms: [self.Characteristic.Perms.READ, self.Characteristic.Perms.NOTIFY]
      })
      this.value = this.getDefaultValue()
    }
    this.eveTotalConsumption = function () {
      self.Characteristic.call(this, 'Total Consumption', 'E863F10C-079E-48FF-8F27-9C2605A29F52')
      this.setProps({
        format: self.Characteristic.Formats.FLOAT,
        unit: 'kWh',
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
    let service
    if (!(service = accessory.getService(this.Service.Outlet))) {
      accessory.addService(this.Service.Outlet)
      service = accessory.getService(this.Service.Outlet)
      service.addCharacteristic(this.eveCurrentConsumption)
      service.addCharacteristic(this.eveTotalConsumption)
      service.addCharacteristic(this.eveResetTotal)
    }
    service
      .getCharacteristic(this.Characteristic.On)
      .on('set', (value, callback) => this.internalSwitchUpdate(value, callback))
    this.accessory = accessory
    this.client = accessory.client
    this.client.on('error', err => this.log.warn('[%s] reported error - %s.', this.accessory.displayName, err.code))
    this.client.on('binaryState', value => this.externalSwitchUpdate(parseInt(value)))
    this.client.on('insightParams', (state, power, data) => this.externalInsightUpdate(parseInt(state), parseFloat(power), data))
  }

  internalSwitchUpdate (value, callback) {
    try {
      const service = this.accessory.getService(this.Service.Outlet)
      const switchState = service.getCharacteristic(this.Characteristic.On).value
      if (switchState === value) {
        callback()
        return
      }
      this.client.setBinaryState(value ? 1 : 0, err => {
        if (err) throw new Error(err)
        this.log('[%s] setting state to [%s].', this.accessory.displayName, value ? 'on' : 'off')
        if (!value) {
          service.updateCharacteristic(this.Characteristic.OutletInUse, false)
          this.log('[%s] setting outlet-in-use to [no].', this.accessory.displayName)
          service.updateCharacteristic(this.eveCurrentConsumption, 0)
          this.log('[%s] setting consumption to [0W].', this.accessory.displayName)
        }
      })
      callback()
    } catch (err) {
      this.log.warn('[%s] setting state [%s] error - %s', this.accessory.displayName, value ? 'on' : 'off', err)
      callback(err)
    }
  }

  externalSwitchUpdate (value) {
    try {
      value = value === 1
      const service = this.accessory.getService(this.Service.Outlet)
      const switchState = service.getCharacteristic(this.Characteristic.On).value
      if (switchState !== value) {
        service.updateCharacteristic(this.Characteristic.On, value)
        this.log('[%s] updating state [%s].', this.accessory.displayName, value ? 'on' : 'off')
      }
    } catch (err) {
      this.log.warn('[%s] updating state [%s] error - %s', this.accessory.displayName, value ? 'on' : 'off', err)
    }
  }

  externalInsightUpdate (value, power, data) {
    this.externalSwitchUpdate(value)
    this.externalConsumptionUpdate(power)
    this.externalTotalConsumptionUpdate(data.TodayConsumed, data.TodayONTime)
  }

  externalConsumptionUpdate (power) {
    const consumption = Math.round(power / 1000)
    const inUseNow = consumption > this.inUseThreshold
    const service = this.accessory.getService(this.Service.Outlet)
    try {
      if (consumption !== service.getCharacteristic(this.eveCurrentConsumption)) {
        service.updateCharacteristic(this.eveCurrentConsumption, consumption)
        this.log('[%s] updating consumption to [%sW].', this.accessory.displayName, consumption)
      }
    } catch (err) {
      this.log.warn('[%s] updating consumption to [%sW] error - %s', this.accessory.displayName, consumption, err)
    }
    try {
      if (inUseNow !== service.getCharacteristic(this.Characteristic.OutletInUse).value) {
        service.updateCharacteristic(this.Characteristic.OutletInUse, inUseNow)
        this.log('[%s] updating outlet-in-use [%s].', this.accessory.displayName, inUseNow ? 'yes' : 'no')
      }
    } catch (err) {
      this.log.warn('[%s] updating outlet-in-use [%s] error - %s', this.accessory.displayName, inUseNow ? 'yes' : 'no', err)
    }

  }

  externalTotalConsumptionUpdate (raw, raw2) {
    // raw = data.TodayConsumed in mW minutes; raw2 = data.TodayONTime in seconds
    const value = Math.round(raw / (1000 * 60)) // convert to Wh, raw is total mW minutes
    try {
      const kWh = value / 1000 // convert to kWh
      const onHours = Math.round(raw2 / 36) / 100 // convert to hours
      const service = this.accessory.getService(this.Service.Outlet)
      const totalConsumption = service.getCharacteristic(this.eveTotalConsumption).value
      if (totalConsumption !== value) {
        service.updateCharacteristic(this.eveTotalConsumption, value)
        if (this.debug) {
          this.log('[%s] updating total on-time - %s hours.', this.accessory.displayName, onHours)
          this.log('[%s] updating total consumption - %s kWh.', this.accessory.displayName, kWh)
        }
      }
    } catch (err) {
      this.log.warn('[%s] updating total consumption error - %s', this.accessory.displayName, err)
    }
  }
}
