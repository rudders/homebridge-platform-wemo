/* jshint -W014, -W033, esversion: 9 */
/* eslint-disable new-cap */
'use strict'
const xml2js = require('xml2js')
module.exports = class deviceHeater {
  constructor (platform, accessory, device) {
    this.log = platform.log
    this.helpers = platform.helpers
    this.debug = platform.debug
    this.disableDeviceLogging = platform.config.disableDeviceLogging || false
    this.Service = platform.api.hap.Service
    this.Characteristic = platform.api.hap.Characteristic
    this.service = accessory.getService(this.Service.HeaterCooler) || accessory.addService(this.Service.HeaterCooler)
    this.service
      .getCharacteristic(this.Characteristic.Active)
      .removeAllListeners('set')
      .on('set', this.internalActiveUpdate.bind(this))
    this.service
      .getCharacteristic(this.Characteristic.TargetHeaterCoolerState)
      .removeAllListeners('set')
      .setProps({ validValues: [0] })
    this.service
      .getCharacteristic(this.Characteristic.HeatingThresholdTemperature)
      .removeAllListeners('set')
      .on('set', this.internalTargetTempUpdate.bind(this))
      .setProps({
        minStep: 1,
        minValue: 16,
        maxValue: 29
      })
    this.service
      .getCharacteristic(this.Characteristic.RotationSpeed)
      .removeAllListeners('set')
      .on('set', this.internalModeUpdate.bind(this))
      .setProps({ minStep: 33 })
    this.device = device
    this.accessory = accessory
    this.client = accessory.client
    if (!this.accessory.context.cacheLastOnMode || [0, 1].includes(this.accessory.context.cacheLastOnMode)) {
      this.accessory.context.cacheLastOnMode = 4
    }
    if (!this.accessory.context.cacheLastOnTemp) {
      this.accessory.context.cacheLastOnTemp = 16
    }
    this.getAttributes()
    this.client.on('attributeList', (name, value, prevalue, timestamp) => {
      if (this.debug) this.log('[%s] received update [%s: %s].', this.accessory.displayName, name, value)
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
      0: 'off',
      1: 'frost-protect',
      2: 'high',
      3: 'low',
      4: 'eco'
    }
    this.cToF = {
      16: 61,
      17: 63,
      18: 64,
      19: 66,
      20: 68,
      21: 70,
      22: 72,
      23: 73,
      24: 75,
      25: 77,
      26: 79,
      27: 81,
      28: 83,
      29: 84
    }
  }

  async getAttributes () {
    try {
      const data = await this.client.sendRequest('urn:Belkin:service:deviceevent:1', 'GetAttributes')
      const xml = '<attributeList>' + this.helpers.decodeXML(data.attributeList) + '</attributeList>'
      const result = await xml2js.parseStringPromise(xml, { explicitArray: false })
      const attributes = {}
      for (const key in result.attributeList.attribute) {
        if (this.helpers.hasProperty(result.attributeList.attribute, key)) {
          const attribute = result.attributeList.attribute[key]
          attributes[attribute.name] = attribute.value
        }
      }
      if (this.debug) {
        this.log(
          '[%s] received update [Mode: %s], [Temperature: %s], [SetTemperature: %s].',
          this.accessory.displayName,
          attributes.Mode,
          attributes.Temperature,
          attributes.SetTemperature
        )
      }
      this.externalModeUpdate(parseInt(attributes.Mode))
      this.externalCurrentTempUpdate(parseInt(attributes.Temperature))
      this.externalTargetTempUpdate(parseInt(attributes.SetTemperature))
    } catch (err) {
      this.log.warn('[%s] getAttributes error: %s.', this.accessory.displayName, this.debug ? '\n' + err : err.message)
    }
  }

  async setAttributes (attributes) {
    const builder = new xml2js.Builder({ rootName: 'attribute', headless: true, renderOpts: { pretty: false } })
    const xmlAttributes = Object.keys(attributes)
      .map(attributeKey => builder.buildObject({ name: attributeKey, value: attributes[attributeKey] }))
      .join('')
    await this.client.sendRequest('urn:Belkin:service:deviceevent:1', 'SetAttributes', { attributeList: { '#text': xmlAttributes } })
  }

  async internalActiveUpdate (value, callback) {
    const prevState = this.service.getCharacteristic(this.Characteristic.Active).value
    try {
      callback()
      if (value === prevState) return
      let newRotSpeed = 0
      if (value !== 0) {
        switch (this.accessory.context.cacheLastOnMode) {
          case 2:
            newRotSpeed = 99
            break
          case 3:
            newRotSpeed = 66
            break
          default:
            newRotSpeed = 33
        }
      }
      this.service.setCharacteristic(this.Characteristic.RotationSpeed, newRotSpeed)
      if (!this.disableDeviceLogging) this.log('[%s] setting active to [%s].', this.accessory.displayName, value)
    } catch (err) {
      this.log.warn(
        '[%s] setting active to [%s] error: %s.',
        this.accessory.displayName,
        value,
        this.debug ? '\n' + err : err.message
      )
      this.log.warn('[%s] reverting HomeKit status due to error.', this.accessory.displayName)
      await this.helpers.sleep(1000)
      this.service.updateCharacteristic(this.Characteristic.Active, prevState)
    }
  }

  async internalModeUpdate (value, callback) {
    const prevActiveState = this.service.getCharacteristic(this.Characteristic.Active).value
    const prevRotSpeedState = this.service.getCharacteristic(this.Characteristic.RotationSpeed).value
    let newValue = 1
    if (value > 25 && value <= 50) newValue = 4
    else if (value > 50 && value <= 75) newValue = 3
    else if (value > 75) newValue = 2
    try {
      callback()
      if (value === prevRotSpeedState) return
      const updateKeyMode = Math.random().toString(36).substr(2, 8)
      this.accessory.context.updateKeyMode = updateKeyMode
      await this.helpers.sleep(500)
      if (updateKeyMode !== this.accessory.context.updateKeyMode) return
      await this.setAttributes({
        Mode: newValue,
        SetTemperature: this.cToF[parseInt(this.accessory.context.cacheLastOnTemp)]
      })
      if (newValue !== 1) this.accessory.context.cacheLastOnMode = newValue
      if (!this.disableDeviceLogging) this.log('[%s] setting mode to [%s].', this.accessory.displayName, this.modeLabels[newValue])
    } catch (err) {
      this.log.warn(
        '[%s] setting mode to [%s] error: %s.',
        this.accessory.displayName,
        this.modeLabels[newValue],
        this.debug ? '\n' + err : err.message
      )
      this.log.warn('[%s] reverting HomeKit status due to error.', this.accessory.displayName)
      await this.helpers.sleep(1000)
      this.service.updateCharacteristic(this.Characteristic.Active, prevActiveState)
      this.service.updateCharacteristic(this.Characteristic.RotationSpeed, prevRotSpeedState)
    }
  }

  async internalTargetTempUpdate (value, callback) {
    value = parseInt(value)
    const prevState = this.service.getCharacteristic(this.Characteristic.HeatingThresholdTemperature).value
    try {
      callback()
      if (value === prevState) return
      const updateKeyTemp = Math.random().toString(36).substr(2, 8)
      this.accessory.context.updateKeyTemp = updateKeyTemp
      await this.helpers.sleep(500)
      if (updateKeyTemp !== this.accessory.context.updateKeyTemp) return
      await this.setAttributes({ SetTemperature: this.cToF[value] })
      this.accessory.context.cacheLastOnTemp = value
      if (!this.disableDeviceLogging) this.log('[%s] setting target temp to [%s°C].', this.accessory.displayName, value)
    } catch (err) {
      this.log.warn(
        '[%s] setting target temp to [%s°C] error: %s.',
        this.accessory.displayName,
        value,
        this.debug ? '\n' + err : err.message
      )
      this.log.warn('[%s] reverting HomeKit status due to error.', this.accessory.displayName)
      await this.helpers.sleep(1000)
      this.service.updateCharacteristic(this.Characteristic.HeatingThresholdTemperature, prevState)
    }
  }

  externalModeUpdate (value) {
    try {
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
      this.service.updateCharacteristic(this.Characteristic.Active, value !== 1)
      this.service.updateCharacteristic(this.Characteristic.RotationSpeed, rotSpeed)
      if (value !== 1) this.accessory.context.cacheLastOnMode = value
      if (!this.disableDeviceLogging) this.log('[%s] updating mode to [%s].', this.accessory.displayName, this.modeLabels[value])
    } catch (err) {
      this.log.warn(
        '[%s] updating mode to [%s] error: %s.',
        this.accessory.displayName,
        this.modeLabels[value],
        this.debug ? '\n' + err : err.message
      )
    }
  }

  externalTargetTempUpdate (value) {
    if (value === 4 || value === 40) return // frost protect temps
    if (value > 50) value = Math.round((value - 32) * 5 / 9)
    if (value > 29) value = 29
    if (value < 16) value = 16
    try {
      const tempState = this.service.getCharacteristic(this.Characteristic.HeatingThresholdTemperature).value
      if (tempState !== value) {
        this.service.updateCharacteristic(this.Characteristic.HeatingThresholdTemperature, value)
        if (!this.disableDeviceLogging) this.log('[%s] updating target temp to [%s°C].', this.accessory.displayName, value)
      }
      this.accessory.context.cacheLastOnTemp = value
    } catch (err) {
      this.log.warn(
        '[%s] updating target temp to [%s°C] error: %s.',
        this.accessory.displayName,
        value,
        this.debug ? '\n' + err : err.message
      )
    }
  }

  externalCurrentTempUpdate (value) {
    if (value > 50) value = Math.round((value - 32) * 5 / 9)
    try {
      const tempState = this.service.getCharacteristic(this.Characteristic.CurrentTemperature).value
      if (tempState !== value) {
        this.service.updateCharacteristic(this.Characteristic.CurrentTemperature, value)
        if (!this.disableDeviceLogging) this.log('[%s] updating current temp to [%s°C].', this.accessory.displayName, value)
      }
    } catch (err) {
      this.log.warn(
        '[%s] updating current temp to [%s°C] error: %s.',
        this.accessory.displayName,
        value,
        this.debug ? '\n' + err : err.message
      )
    }
  }
}
