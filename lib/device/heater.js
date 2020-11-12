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
      .removeAllListeners('set')
      .on('set', (value, callback) => this.internalStateUpdate(value, callback))
      .setProps({
        validValues: [0, 1]
      })
    service
      .getCharacteristic(this.Characteristic.HeatingThresholdTemperature)
      .removeAllListeners('set')
      .on('set', (value, callback) => this.internalTargetTempUpdate(value, callback))
      .setProps({
        minStep: 1,
        minValue: 16,
        maxValue: 29
      })
    service
      .getCharacteristic(this.Characteristic.RotationSpeed)
      .removeAllListeners('set')
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
      switch (name) {
        case 'Mode':
          this.externalModeUpdate(parseInt(value))
          break
        case 'Temperature':
          this.externalCurrentTempUpdate(parseInt(value))
          break
        case 'SetTemperature':
          this.externalTargetTempUpdate(parseInt(value))
          break
      }
    })
    this.modeLabels = {
      1: 'off',
      2: 'high',
      3: 'low',
      4: 'eco'
    }
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
      this.device.attributes = attributes
      this.externalModeUpdate(parseInt(attributes.Mode))
      this.externalCurrentTempUpdate(parseInt(attributes.Temperature))
      this.externalTargetTempUpdate(parseInt(attributes.SetTemperature))
    } catch (err) {
      this.log.warn('[%s] getAttributes error - %s.', this.accessory.displayName, err)
    }
  }

  async setAttributes (attributes) {
    const builder = new xml2js.Builder({ rootName: 'attribute', headless: true, renderOpts: { pretty: false } })
    const xmlAttributes = Object.keys(attributes)
      .map(attributeKey => builder.buildObject({ name: attributeKey, value: attributes[attributeKey] }))
      .join('')
    await this.client.soapAction('urn:Belkin:service:deviceevent:1', 'SetAttributes', { attributeList: { '#text': xmlAttributes } })
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
    called when the slider changes the target temp
    */
    const service = this.accessory.getService(this.Service.HeaterCooler)
    const prevState = service.getCharacteristic(this.Characteristic.HeatingThresholdTemperature).value
    try {
      callback()
      const updateKeyTemp = Math.random().toString(36).substr(2, 8)
      this.accessory.context.updateKeyTemp = updateKeyTemp
      await helpers.sleep(500)
      if (updateKeyTemp !== this.accessory.context.updateKeyTemp) return
      await this.setAttributes({ SetTemperature: value.toString() + '.0' })
      if (!this.disableDeviceLogging) this.log('[%s] setting target temp to [%s°C].', this.accessory.displayName, value)
    } catch (err) {
      this.log.warn(
        '[%s] setting target temp to [%s°C] error:\n%s',
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
    const service = this.accessory.getService(this.Service.HeaterCooler)
    const prevActiveState = service.getCharacteristic(this.Characteristic.Active).value
    const prevRotSpeedState = service.getCharacteristic(this.Characteristic.RotationSpeed).value
    let newValue = 1
    if (value > 25 && value <= 50) newValue = 4
    else if (value > 50 && value <= 75) newValue = 3
    else if (value > 75) newValue = 2
    try {
      callback()
      const updateKeyMode = Math.random().toString(36).substr(2, 8)
      this.accessory.context.updateKeyMode = updateKeyMode
      await helpers.sleep(500)
      if (updateKeyMode !== this.accessory.context.updateKeyMode) return
      await this.setAttributes({ Mode: newValue.toString() })
      if (!this.disableDeviceLogging) this.log('[%s] setting mode to [%s].', this.accessory.displayName, this.modeLabels[newValue])
    } catch (err) {
      this.log.warn(
        '[%s] setting mode to [%s] error:\n%s',
        this.accessory.displayName,
        this.modeLabels[newValue],
        this.debug ? err : err.message
      )
      this.log.warn('[%s] Reverting HomeKit status due to error.', this.accessory.displayName)
      await helpers.sleep(1000)
      service.updateCharacteristic(this.Characteristic.Active, prevActiveState)
      service.updateCharacteristic(this.Characteristic.RotationSpeed, prevRotSpeedState)
    }
  }

  externalModeUpdate (value) {
    try {
      const service = this.accessory.getService(this.Service.HeaterCooler)
      let rotSpeed = 0
      switch (value) {
        case 2: {
          rotSpeed = 99
          break
        }
        case 3: {
          rotSpeed = 66
          break
        }
        case 4: {
          rotSpeed = 33
          break
        }
      }
      service.updateCharacteristic(this.Characteristic.Active, value !== 1)
      service.updateCharacteristic(this.Characteristic.RotationSpeed, rotSpeed)
      if (value !== 1) this.accessory.context.cacheLastOnMode = value
      if (!this.disableDeviceLogging) this.log('[%s] updating mode to [%s].', this.accessory.displayName, this.modeLabels[value])
    } catch (err) {
      this.log.warn('[%s] updating mode to [%s] error - %s', this.accessory.displayName, this.modeLabels[value], err)
    }
  }

  externalCurrentTempUpdate (value) {
    if (value > 50) value = Math.round((value - 32) * 5 / 9)
    if (value < 16) value = 16
    if (value > 29) value = 29
    try {
      const service = this.accessory.getService(this.Service.HeaterCooler)
      const tempState = service.getCharacteristic(this.Characteristic.CurrentTemperature).value
      if (tempState !== value) {
        service.updateCharacteristic(this.Characteristic.CurrentTemperature, value)
        if (!this.disableDeviceLogging) this.log('[%s] updating current temp to [%s°C].', this.accessory.displayName, value)
      }
    } catch (err) {
      this.log.warn('[%s] updating current temp to [%s°C] error - %s', this.accessory.displayName, value, err)
    }
  }

  externalTargetTempUpdate (value) {
    if (value > 50) value = Math.round((value - 32) * 5 / 9)
    if (value < 16) value = 16
    if (value > 29) value = 29
    try {
      const service = this.accessory.getService(this.Service.HeaterCooler)
      const tempState = service.getCharacteristic(this.Characteristic.HeatingThresholdTemperature).value
      if (tempState !== value) {
        service.updateCharacteristic(this.Characteristic.HeatingThresholdTemperature, value)
        if (!this.disableDeviceLogging) this.log('[%s°C] updating target temp to [%s].', this.accessory.displayName, value)
      }
    } catch (err) {
      this.log.warn('[%s] updating target temp to [%s°C] error - %s', this.accessory.displayName, value, err)
    }
  }
}
