/* jshint -W014, -W033, esversion: 9 */
/* eslint-disable new-cap */
'use strict'
const xml2js = require('xml2js')
module.exports = class deviceHumidifier {
  constructor (platform, accessory, device) {
    this.log = platform.log
    this.helpers = platform.helpers
    this.debug = platform.debug
    this.disableDeviceLogging = platform.config.disableDeviceLogging || false
    this.Service = platform.api.hap.Service
    this.Characteristic = platform.api.hap.Characteristic

    // BETA
    if (accessory.getService(this.Service.HumidifierDehumidifier)) {
      accessory.removeService(accessory.getService(this.Service.HumidifierDehumidifier))
    }
    //

    this.service = accessory.getService(this.Service.HumidifierDehumidifier) || accessory.addService(this.Service.HumidifierDehumidifier)
    this.service
      .getCharacteristic(this.Characteristic.Active)
      .removeAllListeners('set')
      .on('set', this.internalActiveUpdate.bind(this))
    this.service
      .getCharacteristic(this.Characteristic.TargetHumidifierDehumidifierState)
      .removeAllListeners('set')
      .setProps({
        validValues: [1]
      })
    this.service
      .getCharacteristic(this.Characteristic.RelativeHumidityHumidifierThreshold)
      .removeAllListeners('set')
      .on('set', this.internalTargetHumidityUpdate.bind(this))
    this.service
      .getCharacteristic(this.Characteristic.RotationSpeed)
      .removeAllListeners('set')
      .on('set', this.internalModeUpdate.bind(this))
      .setProps({
        minStep: 20
      })
    this.device = device
    this.accessory = accessory
    this.client = accessory.client

    this.getAttributes()
    // USED FOR MIMIC TESTING ON A OUTLET
    // this.service.updateCharacteristic(this.Characteristic.CurrentHumidifierDehumidifierState, 1)
    // this.service.updateCharacteristic(this.Characteristic.CurrentRelativeHumidity, 30)

    /* Characteristic.CurrentH..D..State
      0 ”Inactive”
      1 ”Idle”
      2 ”Humidifying”
      3 ”Dehumidifying”
    */

    if (!this.accessory.context.cacheLastOnMode || this.accessory.context.cacheLastOnMode === 0) {
      this.accessory.context.cacheLastOnMode = 1
    }
    this.client.on('attributeList', (name, value, prevalue, timestamp) => {
      if (this.debug) this.log('[%s] has changed attribute [%s] to [%s].', this.accessory.displayName, name, value)
      switch (name) {
        case 'FanMode':
          this.externalModeUpdate(parseInt(value))
          break
        case 'CurrentHumidity':
          this.externalCurrentHumidityUpdate(parseInt(value))
          break
        case 'DesiredHumidity':
          this.externalTargetHumidityUpdate(parseInt(value))
          break
      }
    })
    this.modeLabels = {
      0: 'off',
      1: 'min',
      2: 'low',
      3: 'med',
      4: 'high',
      5: 'max'
    }
    this.hToWemoFormat = {
      45: 0,
      50: 1,
      55: 2,
      60: 3,
      100: 4
    }
    this.wemoFormatToH = {
      0: 45,
      1: 50,
      2: 55,
      3: 60,
      4: 100
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
      this.externalModeUpdate(parseInt(attributes.FanMode))
      this.externalCurrentHumidityUpdate(parseInt(attributes.CurrentHumidity))
      this.externalTargetHumidityUpdate(parseInt(attributes.DesiredHumidity))
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
      if (value === 0) {
        this.service.setCharacteristic(this.Characteristic.RotationSpeed, 0)
      } else {
        const newRotSpeed = this.accessory.context.cacheLastOnMode * 20
        this.service.setCharacteristic(this.Characteristic.RotationSpeed, newRotSpeed)
      }
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

  async internalTargetHumidityUpdate (value, callback) {
    const prevState = this.service.getCharacteristic(this.Characteristic.RelativeHumidityHumidifierThreshold).value
    let newValue = 45
    if (value >= 47 && value < 52) newValue = 50
    else if (value >= 52 && value < 57) newValue = 55
    else if (value >= 57 && value < 80) newValue = 60
    else if (value >= 80) newValue = 100
    try {
      callback()
      if (value === prevState) return
      const updateKeyHumi = Math.random().toString(36).substr(2, 8)
      this.accessory.context.updateKeyHumi = updateKeyHumi
      await this.helpers.sleep(500)
      if (updateKeyHumi !== this.accessory.context.updateKeyHumi) return
      await this.setAttributes({ DesiredHumidity: this.hToWemoFormat[newValue] })
      this.service.updateCharacteristic(this.Characteristic.RelativeHumidityHumidifierThreshold, newValue)
      if (!this.disableDeviceLogging) this.log('[%s] setting target humidity to [%s%].', this.accessory.displayName, newValue)
    } catch (err) {
      this.log.warn(
        '[%s] setting target humidity to [%s%] error: %s.',
        this.accessory.displayName,
        newValue,
        this.debug ? '\n' + err : err.message
      )
      this.log.warn('[%s] reverting HomeKit status due to error.', this.accessory.displayName)
      await this.helpers.sleep(1000)
      this.service.updateCharacteristic(this.Characteristic.RelativeHumidityHumidifierThreshold, prevState)
    }
  }

  async internalModeUpdate (value, callback) {
    const prevActiveState = this.service.getCharacteristic(this.Characteristic.Active).value
    const prevRotSpeedState = this.service.getCharacteristic(this.Characteristic.RotationSpeed).value
    let newValue = 0
    if (value > 10 && value <= 30) newValue = 1
    else if (value > 30 && value <= 50) newValue = 2
    else if (value > 50 && value <= 70) newValue = 3
    else if (value > 70 && value <= 90) newValue = 4
    else if (value > 90) newValue = 5
    try {
      callback()
      if (value === prevRotSpeedState) return
      const updateKeyMode = Math.random().toString(36).substr(2, 8)
      this.accessory.context.updateKeyMode = updateKeyMode
      await this.helpers.sleep(500)
      if (updateKeyMode !== this.accessory.context.updateKeyMode) return
      await this.setAttributes({ FanMode: newValue.toString() })
      if (newValue !== 0) this.accessory.context.cacheLastOnMode = newValue
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

  externalModeUpdate (value) {
    try {
      const rotSpeed = value * 20
      this.service.updateCharacteristic(this.Characteristic.Active, value !== 0)
      this.service.updateCharacteristic(this.Characteristic.RotationSpeed, rotSpeed)
      if (value !== 0) this.accessory.context.cacheLastOnMode = value
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

  externalCurrentHumidityUpdate (value) {
    try {
      const tempState = this.service.getCharacteristic(this.Characteristic.CurrentRelativeHumidity).value
      if (tempState !== value) {
        this.service.updateCharacteristic(this.Characteristic.CurrentRelativeHumidity, value)
        if (!this.disableDeviceLogging) this.log('[%s] updating current humidity to [%s%].', this.accessory.displayName, value)
      }
    } catch (err) {
      this.log.warn(
        '[%s] updating current humidity to [%s%] error: %s.',
        this.accessory.displayName,
        value,
        this.debug ? '\n' + err : err.message
      )
    }
  }

  externalTargetHumidityUpdate (value) {
    value = this.wemoFormatToH[value]
    try {
      const tempState = this.service.getCharacteristic(this.Characteristic.RelativeHumidityHumidifierThreshold).value
      if (tempState !== value) {
        this.service.updateCharacteristic(this.Characteristic.RelativeHumidityHumidifierThreshold, value)
        if (!this.disableDeviceLogging) this.log('[%s] updating target humidity to [%s%].', this.accessory.displayName, value)
      }
    } catch (err) {
      this.log.warn(
        '[%s] updating target humidity to [%s%] error: %s.',
        this.accessory.displayName,
        value,
        this.debug ? '\n' + err : err.message
      )
    }
  }
}
