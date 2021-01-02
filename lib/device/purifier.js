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

    // BETA
    if (accessory.getService(this.Service.AirPurifier)) {
      accessory.removeService(accessory.getService(this.Service.AirPurifier))
    }
    //

    /* todo
      internalActiveUpdate()
      internalModeUpdate()
      externalModeUpdate()
    */

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
      .setProps({
        validValues: [1]
      })

    this.service
      .getCharacteristic(this.Characteristic.RotationSpeed)
      .removeAllListeners('set')
      .setProps({
        minStep: 25
      })
      .on('set', this.internalModeUpdate.bind(this))

    this.ioService
      .getCharacteristic(this.Characteristic.On)
      .removeAllListeners('set')
      .on('set', this.internalIonizerUpdate.bind(this))

    this.device = device
    this.accessory = accessory
    this.client = accessory.client

    this.getAttributes()

    // USED FOR MIMIC TESTING ON A OUTLET
    // this.airService.updateCharacteristic(this.Characteristic.AirQuality, 3)
    // this.ioService.updateCharacteristic(this.Characteristic.On, true)
    // END USED FOR MIMIC TESTING ON A OUTLET

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
    try {
      callback()
    } catch (err) {
      //
    }
  }

  async internalModeUpdate (value, callback) {
    try {
      callback()
    } catch (err) {
      //
    }
  }

  async internalIonizerUpdate (value, callback) {
    const prevState = this.ioService.getCharacteristic(this.Characteristic.On).value
    try {
      callback()
      await this.setAttributes({ Ionizer: value ? '1' : '0' })
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
      //
    } catch (err) {
      //
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
