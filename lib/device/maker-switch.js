/* jshint -W014, -W033, esversion: 9 */
/* eslint-disable new-cap */
'use strict'

module.exports = class deviceMakerSwitch {
  constructor (platform, accessory, device) {
    // Set up variables from the platform
    this.debug = platform.config.debug
    this.funcs = platform.funcs
    this.consts = platform.consts
    this.hapServ = platform.api.hap.Service
    this.hapChar = platform.api.hap.Characteristic
    this.log = platform.log
    this.messages = platform.messages
    this.platform = platform

    // Set up variables from the accessory
    this.accessory = accessory
    this.client = accessory.client
    this.name = accessory.displayName

    // Set up custom variables for this device type
    const deviceConf = platform.wemoMakers[device.serialNumber]
    this.disableDeviceLogging = deviceConf && deviceConf.overrideDisabledLogging
      ? false
      : platform.config.disableDeviceLogging

    // If the accessory has a garage door service then remove it
    if (this.accessory.getService(this.hapServ.GarageDoorOpener)) {
      this.accessory.removeService(
        this.accessory.getService(this.hapServ.GarageDoorOpener)
      )
    }

    // Add the switch service if it doesn't already exist
    this.service = this.accessory.getService(this.hapServ.Switch) ||
      this.accessory.addService(this.hapServ.Switch)

    // Add the set handler to the switch on/off characteristic
    this.service.getCharacteristic(this.hapChar.On).onSet(async value => {
      await this.internalSwitchUpdate(value)
    })

    // Output the customised options to the log if in debug mode
    if (this.debug) {
      const opts = JSON.stringify({ disableDeviceLogging: this.disableDeviceLogging })
      this.log('[%s] %s %s.', this.name, this.messages.devInitOpts, opts)
    }

    // A listener for when the device sends an update to the plugin
    this.client.on('AttributeList', attribute => this.receiveDeviceUpdate(attribute))

    // Request a device update immediately
    this.requestDeviceUpdate()
  }

  receiveDeviceUpdate (attribute) {
    if (this.debug) {
      this.log(
        '[%s] %s [%s: %s].',
        this.name,
        this.messages.recUpd,
        attribute.name,
        attribute.value
      )
    }
    switch (attribute.name) {
      case 'Switch': {
        const hkValue = attribute.value === 1
        this.externalSwitchUpdate(hkValue)
        break
      }
      case 'Sensor':
        this.externalSensorUpdate(attribute.value)
        break
    }
  }

  async sendDeviceUpdate (value) {
    if (this.debug) {
      this.log('[%s] %s %s.', this.name, this.messages.senUpd, JSON.stringify(value))
    }
    await this.client.sendRequest(
      'urn:Belkin:service:basicevent:1',
      'SetBinaryState',
      value
    )
  }

  async requestDeviceUpdate () {
    try {
      const data = await this.client.sendRequest(
        'urn:Belkin:service:deviceevent:1',
        'GetAttributes'
      )
      const decoded = this.funcs.decodeXML(data.attributeList)
      const xml = '<attributeList>' + decoded + '</attributeList>'
      const result = await this.xml2js.parseStringPromise(xml, { explicitArray: false })
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
        this.externalSwitchUpdate(hkValue)
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
      this.log.warn('[%s] %s: %s.', this.name, this.messages.rduErr, eText)
    }
  }

  async internalSwitchUpdate (value) {
    try {
      await this.sendDeviceUpdate({
        BinaryState: value ? 1 : 0
      })
      this.cacheOnOff = value
      if (!this.disableDeviceLogging) {
        this.log('[%s] current state [%s].', this.name, value ? 'on' : 'off')
      }
    } catch (err) {
      const eText = this.funcs.parseError(err)
      this.log.warn('[%s] %s %s.', this.name, this.messages.cantCtl, eText)

      // Throw a 'no response' error and set a timeout to revert this after 5 seconds
      setTimeout(() => {
        this.service.updateCharacteristic(this.hapChar.On, this.cacheOnOff)
      }, 5000)
      throw new this.platform.api.hap.HapStatusError(this.consts.hapError)
    }
  }

  externalSwitchUpdate (value) {
    try {
      if (value !== this.cacheOnOff) {
        this.service.updateCharacteristic(this.hapChar.On, value)
        this.cacheOnOff = value
        if (!this.disableDeviceLogging) {
          this.log('[%s] current state [%s].', this.name, value ? 'on' : 'off')
        }
      }
    } catch (err) {
      const eText = this.funcs.parseError(err)
      this.log.warn('[%s] %s %s.', this.name, this.messages.cantUpd, eText)
    }
  }

  externalSensorUpdate (value) {
    try {
      if (value !== this.cacheContact) {
        const cService = this.accessory.getService(this.hapServ.ContactSensor)
        cService.updateCharacteristic(this.hapChar.ContactSensorState, value)
        this.cacheContact = value
        if (!this.disableDeviceLogging) {
          this.log('[%s] current contact [%sdetected].', this.name, value ? '' : 'not ')
        }
      }
    } catch (err) {
      const eText = this.funcs.parseError(err)
      this.log.warn('[%s] %s %s.', this.name, this.messages.cantUpd, eText)
    }
  }
}
