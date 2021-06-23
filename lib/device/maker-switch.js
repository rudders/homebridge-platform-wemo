/* jshint -W014, -W033, esversion: 9 */
/* eslint-disable new-cap */
'use strict'

const xml2js = require('xml2js')

module.exports = class deviceMakerSwitch {
  constructor (platform, accessory, device) {
    // Set up variables from the platform
    this.consts = platform.consts
    this.funcs = platform.funcs
    this.hapChar = platform.api.hap.Characteristic
    this.hapErr = platform.api.hap.HapStatusError
    this.hapServ = platform.api.hap.Service
    this.lang = platform.lang
    this.log = platform.log

    // Set up variables from the accessory
    this.accessory = accessory
    this.client = accessory.client
    this.name = accessory.displayName

    // Set up custom variables for this device type
    const deviceConf = platform.wemoMakers[device.serialNumber]

    // Set the correct logging variables for this accessory
    this.enableLogging = !platform.config.disableDeviceLogging
    this.enableDebugLogging = platform.config.debug
    if (deviceConf && deviceConf.overrideLogging) {
      switch (deviceConf.overrideLogging) {
        case 'standard':
          this.enableLogging = true
          this.enableDebugLogging = false
          break
        case 'debug':
          this.enableLogging = true
          this.enableDebugLogging = true
          break
        case 'disable':
          this.enableLogging = false
          this.enableDebugLogging = false
          break
      }
    }

    // If the accessory has a garage door service then remove it
    if (this.accessory.getService(this.hapServ.GarageDoorOpener)) {
      this.accessory.removeService(this.accessory.getService(this.hapServ.GarageDoorOpener))
    }

    // Add the switch service if it doesn't already exist
    this.service =
      this.accessory.getService(this.hapServ.Switch) ||
      this.accessory.addService(this.hapServ.Switch)

    // Add the set handler to the switch on/off characteristic
    this.service.getCharacteristic(this.hapChar.On).onSet(async value => {
      await this.internalStateUpdate(value)
    })

    // Output the customised options to the log
    const opts = JSON.stringify({
      logging: this.enableDebugLogging ? 'debug' : this.enableLogging ? 'standard' : 'disable'
    })
    this.log('[%s] %s %s.', this.name, this.lang.devInitOpts, opts)

    // A listener for when the device sends an update to the plugin
    this.client.on('AttributeList', attribute => this.receiveDeviceUpdate(attribute))

    // Request a device update immediately
    this.requestDeviceUpdate()
  }

  receiveDeviceUpdate (attribute) {
    if (this.enableDebugLogging) {
      this.log('[%s] %s [%s: %s].', this.name, this.lang.recUpd, attribute.name, attribute.value)
    }
    switch (attribute.name) {
      case 'Switch': {
        const hkValue = attribute.value === 1
        this.externalStateUpdate(hkValue)
        break
      }
      case 'Sensor':
        this.externalSensorUpdate(attribute.value)
        break
    }
  }

  async sendDeviceUpdate (value) {
    if (this.enableDebugLogging) {
      this.log('[%s] %s %s.', this.name, this.lang.senUpd, JSON.stringify(value))
    }
    await this.client.sendRequest('urn:Belkin:service:basicevent:1', 'SetBinaryState', value)
  }

  async requestDeviceUpdate () {
    try {
      const data = await this.client.sendRequest(
        'urn:Belkin:service:deviceevent:1',
        'GetAttributes'
      )
      const decoded = this.funcs.decodeXML(data.attributeList)
      const xml = '<attributeList>' + decoded + '</attributeList>'
      const result = await xml2js.parseStringPromise(xml, { explicitArray: false })
      const attributes = {}
      for (const key in result.attributeList.attribute) {
        if (this.funcs.hasProperty(result.attributeList.attribute, key)) {
          const attribute = result.attributeList.attribute[key]
          attributes[attribute.name] = parseInt(attribute.value)
        }
      }
      let hkValue
      if (attributes.Switch) {
        hkValue = attributes.Switch === 1
        this.externalStateUpdate(hkValue)
      }
      const contactSensor = this.accessory.getService(this.hapServ.ContactSensor)
      if (attributes.SensorPresent === 1) {
        if (!contactSensor) {
          this.accessory.addService(this.hapServ.ContactSensor)
        }
        if (attributes.Sensor) {
          this.externalSensorUpdate(attributes.Sensor)
        }
      } else {
        if (contactSensor) {
          this.accessory.removeService(contactSensor)
        }
      }
    } catch (err) {
      const eText = this.funcs.parseError(err)
      this.log.warn('[%s] %s: %s.', this.name, this.lang.rduErr, eText)
    }
  }

  async internalStateUpdate (value) {
    try {
      await this.sendDeviceUpdate({
        BinaryState: value ? 1 : 0
      })
      this.cacheState = value
      if (this.enableLogging) {
        this.log('[%s] current state [%s].', this.name, value ? 'on' : 'off')
      }
    } catch (err) {
      const eText = this.funcs.parseError(err)
      this.log.warn('[%s] %s %s.', this.name, this.lang.cantCtl, eText)

      // Throw a 'no response' error and set a timeout to revert this after 2 seconds
      setTimeout(() => {
        this.service.updateCharacteristic(this.hapChar.On, this.cacheState)
      }, 2000)
      throw new this.hapErr(-70402)
    }
  }

  externalStateUpdate (value) {
    try {
      if (value !== this.cacheState) {
        this.service.updateCharacteristic(this.hapChar.On, value)
        this.cacheState = value
        if (this.enableLogging) {
          this.log('[%s] current state [%s].', this.name, value ? 'on' : 'off')
        }
      }
    } catch (err) {
      const eText = this.funcs.parseError(err)
      this.log.warn('[%s] %s %s.', this.name, this.lang.cantUpd, eText)
    }
  }

  externalSensorUpdate (value) {
    try {
      if (value !== this.cacheContact) {
        const cService = this.accessory.getService(this.hapServ.ContactSensor)
        cService.updateCharacteristic(this.hapChar.ContactSensorState, value)
        this.cacheContact = value
        if (this.enableLogging) {
          this.log('[%s] current contact [%sdetected].', this.name, value ? '' : 'not ')
        }
      }
    } catch (err) {
      const eText = this.funcs.parseError(err)
      this.log.warn('[%s] %s %s.', this.name, this.lang.cantUpd, eText)
    }
  }
}
