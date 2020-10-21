/* jshint -W014, -W033, esversion: 9 */
/* eslint-disable new-cap */
'use strict'
const hbLib = require('homebridge-lib')
module.exports = class deviceStandard {
  constructor (platform, accessory, device) {
    this.log = platform.log
    this.config = platform.config
    this.debug = this.config.debug || false
    this.client = accessory.client
    this.Service = platform.api.hap.Service
    this.Characteristic = platform.api.hap.Characteristic
    this.EveCharacteristics = new hbLib.EveHomeKitTypes(platform.api).Characteristics
    let service
    if (!(service = accessory.getService(this.Service.Outlet))) {
      accessory.addService(this.Service.Outlet)
      service = accessory.getService(this.Service.Outlet)
      service.addCharacteristic(this.EveCharacteristics.CurrentConsumption)
      service.addCharacteristic(this.EveCharacteristics.TotalConsumption)
    }
    service
      .getCharacteristic(this.Characteristic.On)
      .on('set', (value, callback) => this.internalSwitchUpdate(value, callback))
    accessory.client.on('error', err => this.log.warn('[%s] reported error - %s.', accessory.displayName, err.code))
    accessory.client.on('binaryState', state => this.externalSwitchUpdate(state))
    accessory.client.on('insightParams', (state, power, data) => this.externalInsightUpdate)
    this.accessory = accessory
  }

  internalSwitchUpdate (state, callback) {
    const value = state | 0
    const switchState = this.accessory.getService(this.Service.Outlet).getCharacteristic(this.Characteristic.On)
    if (switchState.value === value) {
      callback()
      return
    }
    this.client.setBinaryState(
      value,
      err => {
        if (err) {
          this.log.warn('[%s] setting state [%s] error - %s', this.accessory.displayName, value ? 'on' : 'off', err.code)
          callback(new Error(err))
        } else {
          if (this.debug) {
            this.log('[%s] setting state to [%s].', this.accessory.displayName, value ? 'on' : 'off')
          }
        }
      }
    )
    callback()
  }

  externalInsightUpdate (state, power, data) {
    this.externalSwitchUpdate(state)
    this.externalInUseUpdate(state)
    this.externalConsumptionUpdate(power)
    // *** TodayConsumed in mW minutes and TodayONTime in seconds *** \\
    this.externalTotalConsumptionUpdate(data.TodayConsumed, data.TodayONTime)
  }

  externalConsumptionUpdate (raw) {
    const value = Math.round(raw / 1000)
    const service = this.accessory.getService(this.Service.Outlet)
    const consumption = service.getCharacteristic(this.EveCharacteristics.CurrentConsumption).value
    if (consumption !== value) {
      service.updateCharacteristic(this.EveCharacteristics.CurrentConsumption, value)
      if (this.debug) this.log('[%s] updating power consumption to [%sw].', this.accessory.displayName, value)
    }
  }

  externalInUseUpdate (state) {
    state = state | 0
    const value = state === 1
    const service = this.accessory.getService(this.Service.Outlet)
    const outletInUse = service.getCharacteristic(this.Characteristic.OutletInUse).value
    if (outletInUse !== value) {
      service.updateCharacteristic(this.Characteristic.OutletInUse, value)
      if (this.debug) this.log('[%s] updated outlet in use [%s].', this.accessory.displayName, value ? 'yes' : 'no')
    }
  }

  externalSwitchUpdate (state) {
    state = state | 0
    const value = state === 1
    const service = this.accessory.getService(this.Service.Outlet)
    const switchState = service.getCharacteristic(this.Characteristic.On).value
    if (switchState !== value) {
      service.updateCharacteristic(this.Characteristic.On, value)
      if (this.debug) this.log('[%s] updating state [%s].', this.accessory.displayName, value ? 'on' : 'off')
      if (!value) {
        this.externalInUseUpdate(0)
        this.externalConsumptionUpdate(0)
      }
    }
  }

  externalTotalConsumptionUpdate (raw, raw2) {
    // raw = data.TodayConsumed in mW minutes; raw2 = data.TodayONTime in seconds
    const value = Math.round(raw / (1000 * 60)) // convert to Wh, raw is total mW minutes
    const kWh = value / 1000 // convert to kWh
    const onHours = Math.round(raw2 / 36) / 100 // convert to hours, raw2 in seconds
    const service = this.accessory.getService(this.Service.Outlet)
    const totalConsumption = service.getCharacteristic(this.EveCharacteristics.TotalConsumption).value
    if (totalConsumption !== value) {
      service.updateCharacteristic(this.EveCharacteristics.TotalConsumption, value)
      if (this.debug) {
        this.log('[%s] total on-time - %s hours.', this.accessory.displayName, onHours)
        this.log('[%s] total consumption - %s kWh.', this.accessory.displayName, kWh)
      }
    }
  }
}
