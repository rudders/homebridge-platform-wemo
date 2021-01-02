/* jshint -W014, -W033, esversion: 9 */
/* eslint-disable new-cap */
'use strict'
const xml2js = require('xml2js')
module.exports = class devicePurifier {
  constructor (platform, accessory, device) {
    this.log = platform.log
    this.helpers = platform.helpers
    this.debug = platform.debug
    this.disableDeviceLogging = platform.config.disableDeviceLogging || false
    this.Service = platform.api.hap.Service
    this.Characteristic = platform.api.hap.Characteristic
    this.service = accessory.getService(this.Service.AirPurifier) || accessory.addService(this.Service.AirPurifier)
    this.airService = accessory.getService(this.Service.AirQualitySensor) || accessory.addService(this.Service.AirQualitySensor)
    this.ioService = accessory.getService(this.Service.Switch) || accessory.addService(this.Service.Switch)
    this.service
      .getCharacteristic(this.Characteristic.Active)
      .removeAllListeners('set')
      .on('set', this.internalActiveUpdate.bind(this))
    this.service
      .getCharacteristic(this.Characteristic.TargetAirPurifierState)
      .removeAllListeners('set')
      .setProps({ validValues: [1] })
    this.service
      .getCharacteristic(this.Characteristic.RotationSpeed)
      .removeAllListeners('set')
      .setProps({ minStep: 25 })
      .on('set', this.internalModeUpdate.bind(this))
    this.ioService
      .getCharacteristic(this.Characteristic.On)
      .removeAllListeners('set')
      .on('set', this.internalIonizerUpdate.bind(this))
    this.device = device
    this.accessory = accessory
    this.client = accessory.client

    if (![1, 2, 3, 4].includes(this.accessory.context.cacheLastOnMode)) {
      this.accessory.context.cacheLastOnMode = 1
    }
    if (![0, 1].includes(this.accessory.context.cacheIonizerOn)) {
      this.accessory.context.cacheIonizerOn = 0
    }

    this.getAttributes()

    this.client.on('attributeList', (name, value, prevalue, timestamp) => {
      if (this.debug) this.log('[%s] has changed attribute [%s] to [%s].', this.accessory.displayName, name, value)
      switch (name) {
        case 'AirQuality':
          this.externalAirQualityUpdate(parseInt(value))
          break
        case 'Ionizer':
          this.externalIonizerUpdate(parseInt(value))
          break
        case 'Mode':
          this.externalModeUpdate(parseInt(value))
          break
      }
    })

    this.aqW2HK = {
      0: 5, // poor -> poor
      1: 3, // moderate -> fair
      2: 1 // good -> excellent
    }

    this.aqLabels = {
      5: 'poor',
      3: 'fair',
      1: 'excellent'
    }

    this.modeLabels = {
      0: 'off',
      1: 'low',
      2: 'med',
      3: 'high',
      4: 'auto'
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
          this.log('[%s] initial attribute [%s] is [%s].', this.accessory.displayName, attribute.name, attribute.value)
        }
      }

      this.externalAirQualityUpdate(parseInt(attributes.AirQuality))
      this.externalIonizerUpdate(parseInt(attributes.Ionizer))
      this.externalModeUpdate(parseInt(attributes.Mode))
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
            newRotSpeed = 50
            break
          case 3:
            newRotSpeed = 75
            break
          case 4:
            newRotSpeed = 100
            break
          default:
            newRotSpeed = 25
        }
      }
      this.service.setCharacteristic(this.Characteristic.RotationSpeed, newRotSpeed)
      this.service.updateCharacteristic(this.Characteristic.CurrentAirPurifierState, newRotSpeed === 0 ? 0 : 2)
      this.ioService.updateCharacteristic(this.Characteristic.On, value === 1 && this.accessory.context.cacheIonizerOn === 1)
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
    let newValue = 0
    if (value > 10 && value <= 35) newValue = 1
    else if (value > 35 && value <= 60) newValue = 2
    else if (value > 60 && value <= 85) newValue = 3
    else if (value > 85) newValue = 4
    try {
      callback()
      if (value === prevRotSpeedState) return
      const updateKey = Math.random().toString(36).substr(2, 8)
      this.updateKey = updateKey
      await this.helpers.sleep(500)
      if (updateKey !== this.updateKey) return
      await this.setAttributes({ Mode: newValue.toString() })
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

  async internalIonizerUpdate (value, callback) {
    const prevState = this.ioService.getCharacteristic(this.Characteristic.On).value
    try {
      callback()
      if (value && this.service.getCharacteristic(this.Characteristic.Active).value === 0) {
        await this.helpers.sleep(1000)
        this.ioService.updateCharacteristic(this.Characteristic.On, false)
        return
      }
      await this.setAttributes({ Ionizer: value ? '1' : '0' })
      this.accessory.context.cacheIonizerOn = value ? 1 : 0
      if (!this.disableDeviceLogging) this.log('[%s] setting ionizer to [%s].', this.accessory.displayName, value ? 'on' : 'off')
    } catch (err) {
      this.log.warn(
        '[%s] setting ionizer to [%s] error: %s.',
        this.accessory.displayName,
        value ? 'on' : 'off',
        this.debug ? '\n' + err : err.message
      )
      this.log.warn('[%s] reverting HomeKit status due to error.', this.accessory.displayName)
      await this.helpers.sleep(1000)
      this.ioService.updateCharacteristic(this.Characteristic.On, prevState)
    }
  }

  externalModeUpdate (value) {
    try {
      let rotSpeed = 0
      switch (value) {
        case 1: {
          rotSpeed = 25
          break
        }
        case 2: {
          rotSpeed = 50
          break
        }
        case 3: {
          rotSpeed = 75
          break
        }
        case 4: {
          rotSpeed = 100
          break
        }
      }
      this.service.updateCharacteristic(this.Characteristic.Active, value !== 0)
      this.service.updateCharacteristic(this.Characteristic.RotationSpeed, rotSpeed)
      if (value === 0) {
        this.ioService.updateCharacteristic(this.Characteristic.On, false)
      } else {
        this.ioService.updateCharacteristic(this.Characteristic.On, this.accessory.context.cacheIonizerOn === 1)
        this.accessory.context.cacheLastOnMode = value
      }
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

  externalAirQualityUpdate (value) {
    const newValue = this.aqW2HK[value]
    try {
      const state = this.airService.getCharacteristic(this.Characteristic.AirQuality).value
      if (state !== newValue) {
        this.airService.updateCharacteristic(this.Characteristic.AirQuality, newValue)
        if (!this.disableDeviceLogging) {
          this.log('[%s] updating air quality [%s].', this.accessory.displayName, this.aqLabels[newValue])
        }
      }
    } catch (err) {
      this.log.warn(
        '[%s] updating air quality to [%s] error: %s.',
        this.accessory.displayName,
        this.aqLabels[newValue],
        this.debug ? '\n' + err : err.message
      )
    }
  }

  externalIonizerUpdate (value) {
    try {
      const state = this.ioService.getCharacteristic(this.Characteristic.Switch).value ? 1 : 0
      if (state !== value) {
        this.ioService.updateCharacteristic(this.Characteristic.On, value === 1)
        this.accessory.context.cacheIonizerOn = value
        if (!this.disableDeviceLogging) this.log('[%s] current ionizer [%s].', this.accessory.displayName, value === 1 ? 'on' : 'off')
      }
    } catch (err) {
      this.log.warn(
        '[%s] updating ionizer to [%s] error: %s.',
        this.accessory.displayName,
        value === 1 ? 'on' : 'off',
        this.debug ? '\n' + err : err.message
      )
    }
  }
}
