/* jshint -W014, -W033, esversion: 9 */
/* eslint-disable new-cap */
'use strict'
const entities = require('entities')
const helpers = require('./../helpers')
const xml2js = require('xml2js')
module.exports = class deviceMakerSwitch {
  constructor (platform, accessory, device) {
    this.log = platform.log
    this.debug = platform.debug
    this.disableDeviceLogging = platform.config.disableDeviceLogging || false
    this.Service = platform.api.hap.Service
    this.Characteristic = platform.api.hap.Characteristic
    if (accessory.getService(this.Service.GarageDoorOpener)) {
      accessory.removeService(accessory.getService(this.Service.GarageDoorOpener))
    }
    const service = accessory.getService(this.Service.Switch) || accessory.addService(this.Service.Switch)
    service
      .getCharacteristic(this.Characteristic.On)
      .removeAllListeners('set')
      .on('set', (value, callback) => this.internalSwitchUpdate(value, callback))
    this.device = device
    this.accessory = accessory
    this.client = accessory.client
    this.getAttributes()
    this.client.on('attributeList', (name, value, prevalue, timestamp) => {
      switch (name) {
        case 'Switch':
          this.externalSwitchUpdate(parseInt(value))
          break
        case 'Sensor':
          this.externalSensorUpdate(parseInt(value), true)
          break
      }
    })
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
      this.externalSwitchUpdate(parseInt(attributes.Switch))
      const contactSensor = this.accessory.getService(this.Service.ContactSensor)
      if (parseInt(attributes.SensorPresent) === 1) {
        if (!contactSensor) this.accessory.addService(this.Service.ContactSensor)
        this.externalSensorUpdate(parseInt(attributes.Sensor))
      } else {
        if (contactSensor) this.accessory.removeService(contactSensor)
      }
    } catch (err) {
      this.log.warn('[%s] getAttributes error: %s.', this.accessory.displayName, this.debug ? '\n' + err : err.message)
    }
  }

  async internalSwitchUpdate (value, callback) {
    const service = this.accessory.getService(this.Service.Switch)
    const prevState = service.getCharacteristic(this.Characteristic.On).value
    try {
      callback()
      await this.client.soapAction('urn:Belkin:service:basicevent:1', 'SetBinaryState', { BinaryState: value ? 1 : 0 })
      if (!this.disableDeviceLogging) this.log('[%s] setting state to [%s].', this.accessory.displayName, value ? 'on' : 'off')
    } catch (err) {
      this.log.warn(
        '[%s] setting state to [%s] error: %s.',
        this.accessory.displayName,
        value ? 'on' : 'off',
        this.debug ? '\n' + err : err.message
      )
      this.log.warn('[%s] reverting HomeKit status due to error.', this.accessory.displayName)
      await helpers.sleep(1000)
      service.updateCharacteristic(this.Characteristic.On, prevState)
      service.updateCharacteristic(this.Characteristic.OutletInUse, prevState)
    }
  }

  externalSwitchUpdate (value) {
    try {
      value = value === 1
      const service = this.accessory.getService(this.Service.Switch)
      const switchState = service.getCharacteristic(this.Characteristic.On).value
      if (switchState !== value) {
        service.updateCharacteristic(this.Characteristic.On, value)
        if (!this.disableDeviceLogging) this.log('[%s] updating state to [%s].', this.accessory.displayName, value ? 'on' : 'off')
      }
    } catch (err) {
      this.log.warn(
        '[%s] updating state to [%s] error: %s.',
        this.accessory.displayName,
        value ? 'on' : 'off',
        this.debug ? '\n' + err : err.message
      )
    }
  }

  externalSensorUpdate (value, wasTriggered) {
    try {
      const service = this.accessory.getService(this.Service.ContactSensor)
      const sensorState = service.getCharacteristic(this.Characteristic.ContactSensorState).value
      if (sensorState !== value) {
        service.updateCharacteristic(this.Characteristic.ContactSensorState, value)
        if (!this.disableDeviceLogging) {
          this.log('[%s] updating sensor state [%sdetected].', this.accessory.displayName, value ? '' : 'not ')
        }
      }
    } catch (err) {
      this.log.warn(
        '[%s] updating sensor state [%sdetected] error: %s.',
        this.accessory.displayName,
        value ? '' : 'not ',
        this.debug ? '\n' + err : err.message
      )
    }
  }
}
