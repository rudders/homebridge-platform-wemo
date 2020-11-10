/* jshint -W014, -W033, esversion: 9 */
/* eslint-disable new-cap */
'use strict'
const entities = require('entities')
const helpers = require('./../helpers')
const xml2js = require('xml2js')
module.exports = class deviceHeater {
  constructor (platform, accessory, device) {
    this.log = platform.log
    this.debug = platform.debug
    this.disableDeviceLogging = platform.config.disableDeviceLogging || false
    this.Service = platform.api.hap.Service
    this.Characteristic = platform.api.hap.Characteristic
    const service = accessory.getService(this.Service.HeaterCooler) || accessory.addService(this.Service.HeaterCooler)
    service
      .getCharacteristic(this.Characteristic.TargetHeaterCoolerState)
      .on('set', (value, callback) => this.internalStateUpdate(value, callback))
      .setProps({
        validValues: [0, 1]
      })
    service
      .getCharacteristic(this.Characteristic.HeatingThresholdTemperature)
      .on('set', (value, callback) => this.internalTargetTempUpdate(value, callback))
    service
      .getCharacteristic(this.Characteristic.RotationSpeed)
      .on('set', (value, callback) => this.internalModeUpdate(value, callback))
      .setProps({
        minStep: 33
      })
    this.device = device
    this.accessory = accessory
    this.client = accessory.client
    this.getAttributes()
    this.client.on('attributeList', (name, value, prevalue, timestamp) => {
      this.log.error('[%s] has changed attribute [%s] to [%s].', this.accessory.displayName, name, value)
      /*
      switch (name) {
        case 'Mode':
          this.externalModeUpdate(parseInt(value))
          break
        case 'SetTemperature':
          this.externalTargetTempUpdate(parseFloat(value))
          break
      }
      */
    })
    service.updateCharacteristic(this.Characteristic.CurrentTemperature, 20)
    service.updateCharacteristic(this.Characteristic.HeatingThresholdTemperature, 25)
  }

  async getAttributes () {
    try {
      const data = await this.client.soapAction('urn:Belkin:service:deviceevent:1', 'GetAttributes', null)
      const xml = '<attributeList>' + entities.decodeXML(data.attributeList) + '</attributeList>'
      const result = await xml2js.parseStringPromise(xml, { explicitArray: false })
      const attributes = {}
      for (const key in result.attributeList.attribute) {
        if (helpers.hasProperty(result.attributeList.attribute, key)) {
          const attribute = result.attributeList.attribute[key]
          attributes[attribute.name] = attribute.value
        }
      }
      /*
      this.log.error('---- heater getAttributes output ----')
      this.log.warn(attributes)
      this.log.error('---- end heater getAttributes output ----')

      ===EXAMPLE===
      Mode: '1',
      Temperature: '20.0',
      SetTemperature: '4.0',
      AutoOffTime: '0',
      RunMode: '0',
      TimeRemaining: '0',
      WemoDisabled: '0',
      TempUnit: '0'

      */
      this.device.attributes = attributes
    } catch (err) {
      this.log.warn('[%s] getAttributes error - %s.', this.accessory.displayName, err)
    }
  }

  async internalStateUpdate (value, callback) {
    /*
    called between off/heat (auto mode calls this automatically?)
    */
    const service = this.accessory.getService(this.Service.HeaterCooler)
    const prevState = service.getCharacteristic(this.Characteristic.TargetHeaterCoolerState).value
    try {
      callback()
      if (!this.disableDeviceLogging) this.log('[%s] setting state to [%s].', this.accessory.displayName, value)
    } catch (err) {
      this.log.warn(
        '[%s] setting state to [%s] error:\n%s',
        this.accessory.displayName,
        value,
        this.debug ? err : err.message
      )
      this.log.warn('[%s] Reverting HomeKit status due to error.', this.accessory.displayName)
      await helpers.sleep(1000)
      service.updateCharacteristic(this.Characteristic.TargetHeaterCoolerState, prevState)
    }
  }

  async internalTargetTempUpdate (value, callback) {
    /*
    called when the slider changes the (minimum) target temp
    */
    const service = this.accessory.getService(this.Service.HeaterCooler)
    const prevState = service.getCharacteristic(this.Characteristic.HeatingThresholdTemperature).value
    try {
      callback()
      const updateKeyTemp = Math.random().toString(36).substr(2, 8)
      this.accessory.context.updateKeyTemp = updateKeyTemp
      await helpers.sleep(500)
      if (updateKeyTemp !== this.accessory.context.updateKeyTemp) return
      if (!this.disableDeviceLogging) this.log('[%s] setting target temp to [%s].', this.accessory.displayName, value)
    } catch (err) {
      this.log.warn(
        '[%s] setting target temp to [%s] error:\n%s',
        this.accessory.displayName,
        value,
        this.debug ? err : err.message
      )
      this.log.warn('[%s] Reverting HomeKit status due to error.', this.accessory.displayName)
      await helpers.sleep(1000)
      service.updateCharacteristic(this.Characteristic.HeatingThresholdTemperature, prevState)
    }
  }

  async internalModeUpdate (value, callback) {
    /*
    called when the fan speed is changed; plan is:
    value =  0 turns the heater off
    value = 33 for eco mode
    value = 66 for low mode
    value = 99 for high mode
    */
    const service = this.accessory.getService(this.Service.HeaterCooler)
    const prevState = service.getCharacteristic(this.Characteristic.RotationSpeed).value
    try {
      callback()

      const updateKeyMode = Math.random().toString(36).substr(2, 8)
      this.accessory.context.updateKeyMode = updateKeyMode
      await helpers.sleep(500)
      if (updateKeyMode !== this.accessory.context.updateKeyMode) return

      if (!this.disableDeviceLogging) this.log('[%s] setting mode to [%s].', this.accessory.displayName, value)
    } catch (err) {
      this.log.warn(
        '[%s] setting mode to [%s] error:\n%s',
        this.accessory.displayName,
        value,
        this.debug ? err : err.message
      )
      this.log.warn('[%s] Reverting HomeKit status due to error.', this.accessory.displayName)
      await helpers.sleep(1000)
      service.updateCharacteristic(this.Characteristic.RotationSpeed, prevState)
    }
  }

  externalModeUpdate (value) {
    try {
      const service = this.accessory.getService(this.Service.HeaterCooler)
      const switchState = service.getCharacteristic(this.Characteristic.Active).value
      if (switchState !== value) {
        service.updateCharacteristic(this.Characteristic.On, value)
        if (!this.disableDeviceLogging) this.log('[%s] updating state to [%s].', this.accessory.displayName, value ? 'on' : 'off')
      }
    } catch (err) {
      this.log.warn('[%s] updating state to [%s] error - %s', this.accessory.displayName, value ? 'on' : 'off', err)
    }
  }

  externalTargetTempUpdate (value) {
    try {
      const service = this.accessory.getService(this.Service.HeaterCooler)
      const tempState = service.getCharacteristic(this.Characteristic.HeatingThresholdTemperature).value
      if (tempState !== value) {
        service.updateCharacteristic(this.Characteristic.HeatingThresholdTemperature, value)
        if (!this.disableDeviceLogging) this.log('[%s] updating target temp to [%s].', this.accessory.displayName, value)
      }
    } catch (err) {
      this.log.warn('[%s] updating target temp to [%s] error - %s', this.accessory.displayName, value, err)
    }
  }
}
