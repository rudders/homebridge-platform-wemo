/* jshint -W014, -W033, esversion: 9 */
/* eslint-disable new-cap */
'use strict'
const hbLib = require('homebridge-lib')
module.exports = class deviceStandard {
  constructor (platform, accessory, device) {
    this.log = platform.log
    this.config = platform.config
    this.debug = this.config.debug || false
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
    this.accessory = accessory
    this.client = accessory.client
    this.client.on('error', err => this.log.warn('[%s] reported error - %s.', this.accessory.displayName, err.code))
    this.client.on('binaryState', state => this.externalSwitchUpdate(state))
    this.client.on('insightParams', (state, power, data) => this.externalInsightUpdate)
  }

  internalSwitchUpdate (state, callback) {
    const value = state | 0
    try {
      const switchState = this.accessory.getService(this.Service.Outlet).getCharacteristic(this.Characteristic.On)
      if (switchState.value === value) {
        callback()
        return
      }
      this.client.setBinaryState(value, err => {
        if (err) throw new Error(err)
        if (this.debug) this.log('[%s] setting state to [%s].', this.accessory.displayName, value ? 'on' : 'off')
      })
      callback()
    } catch(err) {
      this.log.warn('[%s] setting state [%s] error - %s', this.accessory.displayName, value ? 'on' : 'off', err)
      callback(err)
    }
  }

  externalSwitchUpdate (state) {
    state = state | 0
    const value = state === 1
    try {
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
    } catch(err) {
      this.log.warn('[%s] updating state [%s] error - %s', this.accessory.displayName, value ? 'on' : 'off', err)
    }
  }

  externalInsightUpdate (state, power, data) {
    this.externalSwitchUpdate(state)
    this.externalInUseUpdate(state)
    this.externalConsumptionUpdate(power)
    this.externalTotalConsumptionUpdate(data.TodayConsumed, data.TodayONTime)
  }


  externalInUseUpdate (state) {
    state = state | 0
    const value = state === 1
    try {
      const service = this.accessory.getService(this.Service.Outlet)
      const outletInUse = service.getCharacteristic(this.Characteristic.OutletInUse).value
      if (outletInUse !== value) {
        service.updateCharacteristic(this.Characteristic.OutletInUse, value)
        if (this.debug) this.log('[%s] updating outlet in use [%s].', this.accessory.displayName, value ? 'yes' : 'no')
      }
    } catch(err) {
      this.log.warn('[%s] updating outlet in use [%s] error - %s', this.accessory.displayName, value ? 'yes' : 'no', err)
    }
  }

externalConsumptionUpdate (raw) {
  const value = Math.round(raw / 1000)
  try {
    const service = this.accessory.getService(this.Service.Outlet)
    const consumption = service.getCharacteristic(this.EveCharacteristics.CurrentConsumption).value
    if (consumption !== value) {
      service.updateCharacteristic(this.EveCharacteristics.CurrentConsumption, value)
      if (this.debug) this.log('[%s] updating consumption to [%sw].', this.accessory.displayName, value)
    }
  } catch(err) {
    this.log.warn('[%s] updating consumption to [%sw] error - %s', this.accessory.displayName, value, err)
  }
}
  externalTotalConsumptionUpdate (raw, raw2) {
    // raw = data.TodayConsumed in mW minutes; raw2 = data.TodayONTime in seconds
    const value = Math.round(raw / (1000 * 60)) // convert to Wh, raw is total mW minutes
    try {
      const kWh = value / 1000 // convert to kWh
      const onHours = Math.round(raw2 / 36) / 100 // convert to hours
      const service = this.accessory.getService(this.Service.Outlet)
      const totalConsumption = service.getCharacteristic(this.EveCharacteristics.TotalConsumption).value
      if (totalConsumption !== value) {
        service.updateCharacteristic(this.EveCharacteristics.TotalConsumption, value)
        if (this.debug) {
          this.log('[%s] updating total on-time - %s hours.', this.accessory.displayName, onHours)
          this.log('[%s] updating total consumption - %s kWh.', this.accessory.displayName, kWh)
        }
      }
    } catch(err) {
      this.log.warn('[%s] updating total consumption error - %s', this.accessory.displayName, err)
    }
  }
}
