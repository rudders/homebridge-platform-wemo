/* jshint -W014, -W033, esversion: 9 */
/* eslint-disable new-cap */
'use strict'
const xml2js = require('xml2js')
module.exports = class deviceMakerSwitch {
  constructor (platform, accessory, device) {
    this.log = platform.log
    this.debug = platform.debug
    this.helpers = platform.helpers
    this.disableDeviceLogging = platform.config.disableDeviceLogging
    this.Service = platform.api.hap.Service
    this.Characteristic = platform.api.hap.Characteristic
    this.client = accessory.client
    this.accessory = accessory

    // *** If the accessory has a garage door service, then remove it *** \\
    if (this.accessory.getService(this.Service.GarageDoorOpener)) {
      this.accessory.removeService(this.accessory.getService(this.Service.GarageDoorOpener))
    }

    // *** Add the switch service if it doesn't already exist *** \\
    this.service = this.accessory.getService(this.Service.Switch) || this.accessory.addService(this.Service.Switch)

    // *** Add the set handler to the switch on/off characteristic *** \\
    this.service
      .getCharacteristic(this.Characteristic.On)
      .removeAllListeners('set')
      .on('set', this.internalSwitchUpdate.bind(this))

    // *** A listener for when the device sends an update to the plugin *** \\
    this.client.on('attributeList', (name, value, prevalue, timestamp) => this.receiveDeviceUpdate(name, value))

    // *** Request a device update immediately *** \\
    this.requestDeviceUpdate()
  }

  receiveDeviceUpdate (attribute, value) {
    if (this.debug) {
      this.log('[%s] received update [%s: %s]', this.accessory.displayName, attribute, value)
    }
    let hkValue
    switch (attribute) {
      case 'Switch':
        hkValue = parseInt(value) === 1
        this.externalSwitchUpdate(hkValue)
        break
      case 'Sensor':
        hkValue = parseInt(value)
        this.externalSensorUpdate(hkValue)
        break
    }
  }

  async sendDeviceUpdate (value) {
    await this.client.sendRequest(
      'urn:Belkin:service:basicevent:1',
      'SetBinaryState',
      value
    )
  }

  async requestDeviceUpdate () {
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
      let hkValue
      if (attributes.Switch) {
        hkValue = parseInt(attributes.Switch) === 1
        this.externalSwitchUpdate(hkValue)
      }
      const contactSensor = this.accessory.getService(this.Service.ContactSensor)
      if (attributes.SensorPresent && parseInt(attributes.SensorPresent) === 1) {
        if (!contactSensor) {
          this.accessory.addService(this.Service.ContactSensor)
        }
        if (attributes.Sensor) {
          hkValue = parseInt(attributes.Sensor)
          this.externalSensorUpdate(hkValue)
        }
      } else {
        if (contactSensor) {
          this.accessory.removeService(contactSensor)
        }
      }
    } catch (err) {
      const errToShow = this.debug ? '\n' + err : err.message
      this.log.warn('[%s] requestDeviceUpdate error: %s.', this.accessory.displayName, errToShow)
    }
  }

  async internalSwitchUpdate (value, callback) {
    let prevState
    try {
      prevState = this.service.getCharacteristic(this.Characteristic.On).value
      callback()
      await this.sendDeviceUpdate({
        BinaryState: value ? 1 : 0
      })
      if (!this.disableDeviceLogging) {
        this.log('[%s] setting state to [%s].', this.accessory.displayName, value ? 'on' : 'off')
      }
    } catch (err) {
      try {
        const errToShow = this.debug ? '\n' + err : err.message
        this.log.warn('[%s] setting state to [%s] error: %s.', this.accessory.displayName, value ? 'on' : 'off', errToShow)
        this.log.warn('[%s] reverting HomeKit status due to error.', this.accessory.displayName)
        await this.helpers.sleep(1000)
        this.service.updateCharacteristic(this.Characteristic.On, prevState)
      } catch (e) {}
    }
  }

  externalSwitchUpdate (value) {
    try {
      const prevState = this.service.getCharacteristic(this.Characteristic.On).value
      if (prevState !== value) {
        this.service.updateCharacteristic(this.Characteristic.On, value)
        if (!this.disableDeviceLogging) {
          this.log('[%s] updating state to [%s].', this.accessory.displayName, value ? 'on' : 'off')
        }
      }
    } catch (err) {
      const errToShow = this.debug ? '\n' + err : err.message
      this.log.warn('[%s] updating state to [%s] error: %s.', this.accessory.displayName, value ? 'on' : 'off', errToShow)
    }
  }

  externalSensorUpdate (value) {
    try {
      const sensorService = this.accessory.getService(this.Service.ContactSensor)
      const prevState = sensorService.getCharacteristic(this.Characteristic.ContactSensorState).value
      if (prevState !== value) {
        sensorService.updateCharacteristic(this.Characteristic.ContactSensorState, value)
        if (!this.disableDeviceLogging) {
          this.log('[%s] updating sensor [%sdetected].', this.accessory.displayName, value ? '' : 'not ')
        }
      }
    } catch (err) {
      const errToShow = this.debug ? '\n' + err : err.message
      this.log.warn('[%s] updating sensor [%sdetected] error: %s.', this.accessory.displayName, value ? '' : 'not ', errToShow)
    }
  }
}
