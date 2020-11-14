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

    // *** ONLY FOR BETA REMOVE AND READD THE SERVICE EACH HB RESTART
    if (accessory.getService(this.Service.HeaterCooler)) {
      accessory.removeService(accessory.getService(this.Service.HeaterCooler))
    }
    // *** END

    this.service = accessory.getService(this.Service.HeaterCooler) || accessory.addService(this.Service.HeaterCooler)
    this.service
      .getCharacteristic(this.Characteristic.Active)
      .removeAllListeners('set')
      .on('set', this.internalActiveUpdate.bind(this))
    this.service
      .getCharacteristic(this.Characteristic.TargetHeaterCoolerState)
      .removeAllListeners('set')
      .setProps({
        validValues: [0]
      })
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
      .setProps({
        minStep: 33
      })
    this.device = device
    this.accessory = accessory
    this.client = accessory.client
    this.getAttributes()
    // this.service.updateCharacteristic(this.Characteristic.CurrentTemperature, 20) USED TO TEST WITH OUTLET!
    // this.service.updateCharacteristic(this.Characteristic.HeatingThresholdTemperature, 18) USED TO TEST WITH OUTLET!
    if (!this.accessory.context.cacheLastOnMode || this.accessory.context.cacheLastOnMode === 1) {
      this.accessory.context.cacheLastOnMode = 4
    }
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
      this.log.warn('[%s] getAttributes error: %s.', this.accessory.displayName, this.debug ? '\n' + err : err.message)
    }
  }

  async setAttributes (attributes) {
    const builder = new xml2js.Builder({ rootName: 'attribute', headless: true, renderOpts: { pretty: false } })
    const xmlAttributes = Object.keys(attributes)
      .map(attributeKey => builder.buildObject({ name: attributeKey, value: attributes[attributeKey] }))
      .join('')
    await this.client.soapAction('urn:Belkin:service:deviceevent:1', 'SetAttributes', { attributeList: { '#text': xmlAttributes } })
  }

  async internalActiveUpdate (value, callback) {
    /*
    called when pushing the on/off button
    this doesn't send anything to the device, but
    will set the fan rotation speed to 0 if value=off, or
    33,66,99 depending on the last mode if value=on
    which will in turn update the device accordingly
    */
    const prevState = this.service.getCharacteristic(this.Characteristic.Active).value
    try {
      callback()
      if (value === prevState) return
      if (value === 0) {
        this.service.setCharacteristic(this.Characteristic.RotationSpeed, 0)
      } else {
        let newRotSpeed = 33
        if (this.accessory.context.cacheLastOnMode === 2) {
          newRotSpeed = 99
        } else if (this.accessory.context.cacheLastOnMode === 3) {
          newRotSpeed = 66
        }
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
      await helpers.sleep(1000)
      this.service.updateCharacteristic(this.Characteristic.Active, prevState)
    }
  }

  async internalTargetTempUpdate (value, callback) {
    /*
    called when the slider changes the target temp
    device needs it in Fahrenheit
    */
    const prevState = this.service.getCharacteristic(this.Characteristic.HeatingThresholdTemperature).value
    try {
      callback()
      if (value === prevState) return
      const updateKeyTemp = Math.random().toString(36).substr(2, 8)
      this.accessory.context.updateKeyTemp = updateKeyTemp
      await helpers.sleep(500)
      if (updateKeyTemp !== this.accessory.context.updateKeyTemp) return
      await this.setAttributes({ SetTemperature: this.cToF[parseInt(value)] })
      if (!this.disableDeviceLogging) this.log('[%s] setting target temp to [%s°C].', this.accessory.displayName, value)
    } catch (err) {
      this.log.warn(
        '[%s] setting target temp to [%s°C] error: %s.',
        this.accessory.displayName,
        value,
        this.debug ? '\n' + err : err.message
      )
      this.log.warn('[%s] reverting HomeKit status due to error.', this.accessory.displayName)
      await helpers.sleep(1000)
      this.service.updateCharacteristic(this.Characteristic.HeatingThresholdTemperature, prevState)
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
      await helpers.sleep(500)
      if (updateKeyMode !== this.accessory.context.updateKeyMode) return
      await this.setAttributes({ Mode: newValue.toString() })
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
      await helpers.sleep(1000)
      this.service.updateCharacteristic(this.Characteristic.Active, prevActiveState)
      this.service.updateCharacteristic(this.Characteristic.RotationSpeed, prevRotSpeedState)
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

  externalTargetTempUpdate (value) {
    if (value > 50) value = Math.round((value - 32) * 5 / 9)
    if (value < 16) value = 16
    if (value > 29) value = 29
    try {
      const tempState = this.service.getCharacteristic(this.Characteristic.HeatingThresholdTemperature).value
      if (tempState !== value) {
        this.service.updateCharacteristic(this.Characteristic.HeatingThresholdTemperature, value)
        if (!this.disableDeviceLogging) this.log('[%s°C] updating target temp to [%s].', this.accessory.displayName, value)
      }
    } catch (err) {
      this.log.warn(
        '[%s] updating target temp to [%s°C] error: %s.',
        this.accessory.displayName,
        value,
        this.debug ? '\n' + err : err.message
      )
    }
  }
}
