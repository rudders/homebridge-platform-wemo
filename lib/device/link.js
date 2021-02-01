/* jshint -W014, -W033, esversion: 9 */
/* eslint-disable new-cap */
'use strict'

const xmlbuilder = require('xmlbuilder')
const xml2js = require('xml2js')

module.exports = class deviceLink {
  constructor (platform, accessory, link, device) {
    this.log = platform.log
    this.debug = platform.debug
    this.funcs = platform.funcs
    this.disableDeviceLogging = platform.config.disableDeviceLogging
    this.S = platform.api.hap.Service
    this.C = platform.api.hap.Characteristic
    this.client = accessory.client
    this.dName = accessory.displayName
    this.accessory = accessory
    this.deviceID = device.deviceId

    // *** Objects containing mapping info for the device capabilities *** \\
    this.linkCodes = {
      switch: '10006',
      brightness: '10008',
      color: '10300',
      temperature: '30301'
    }
    this.linkCodesRev = {
      10600: 'switch',
      10008: 'brightness',
      10300: 'color',
      30301: 'temperature'
    }

    // *** Quick check variables for later use *** \\
    this.hasBRSupport = device.capabilities[this.linkCodes.brightness]
    this.hasCTSupport = device.capabilities[this.linkCodes.temperature]

    // *** Add the lightbulb service if it doesn't already exist *** \\
    if (!(this.service = this.accessory.getService(this.S.Lightbulb))) {
      this.service = this.accessory.addService(this.S.Lightbulb)

      // *** Add the brightness characteristic if supported *** \\
      if (this.hasBRSupport) {
        this.service.addCharacteristic(this.C.Brightness)
      }

      // *** Add the colour temperature characteristic if supported *** \\
      if (this.hasCTSupport) {
        this.service.addCharacteristic(this.C.ColorTemperature)
      }
    }

    // *** Add the set handler to the lightbulb on/off characteristic *** \\
    this.service.getCharacteristic(this.C.On)
      .removeAllListeners('set')
      .on('set', this.internalSwitchUpdate.bind(this))

    // *** Add the set handler to the cbrightness characteristic if supported *** \\
    if (this.hasBRSupport) {
      this.service.getCharacteristic(this.C.Brightness)
        .removeAllListeners('set')
        .on('set', this.internalBrightnessUpdate.bind(this))
    }

    // *** Add the set handler to the colour temperature characteristic if supported *** \\
    if (this.hasCTSupport) {
      this.service.getCharacteristic(this.C.ColorTemperature)
        .removeAllListeners('set')
        .on('set', this.internalColourUpdate.bind(this))

      // *** Add support for adaptive lighting if supported *** \\
      if (platform.api.versionGreaterOrEqual && platform.api.versionGreaterOrEqual('1.3.0-beta.46')) {
        this.alController = new platform.api.hap.AdaptiveLightingController(this.service)
        this.accessory.configureController(this.alController)
      }
    }

    // *** Listeners for when the device sends an update to the plugin *** \\
    this.client.on('statusChange', (deviceId, attribute) => {
      // *** First check that the update is for this particular device *** \\
      if (this.deviceID === deviceId) {
        this.receiveDeviceUpdate(attribute)
      }
    })

    // *** Request a device update immediately *** \\
    this.requestDeviceUpdate()
  }

  receiveDeviceUpdate (attribute) {
    if (this.debug) {
      this.log('[%s] received update [%s: %s]', this.dName, this.linkCodesRev[attribute.name], attribute.value)
    }
    let hkValue
    switch (attribute.name) {
      case this.linkCodes.switch:
        hkValue = parseInt(attribute.value) !== 0
        this.externalSwitchUpdate(hkValue)
        break
      case this.linkCodes.brightness:
        hkValue = Math.round(attribute.value.split(':').shift() / 2.55)
        this.externalBrightnessUpdate(hkValue)
        break
      case this.linkCodes.temperature:
        hkValue = Math.round(attribute.value.split(':').shift())
        this.externalColourUpdate(hkValue)
        break
    }
  }

  async sendDeviceUpdate (capability, value) {
    const deviceStatusList = xmlbuilder.create('DeviceStatus', {
      version: '1.0',
      encoding: 'utf-8'
    }).ele({
      IsGroupAction: (this.deviceID.length === 10) ? 'YES' : 'NO',
      DeviceID: this.deviceID,
      CapabilityID: capability,
      CapabilityValue: value
    }).end()
    await this.client.sendRequest(
      'urn:Belkin:service:bridge:1',
      'SetDeviceStatus',
      {
        DeviceStatusList: {
          '#text': deviceStatusList
        }
      }
    )
  }

  async requestDeviceUpdate () {
    try {
      const data = await this.client.sendRequest(
        'urn:Belkin:service:bridge:1',
        'GetDeviceStatus',
        {
          DeviceIDs: this.deviceID
        }
      )
      const result = await xml2js.parseStringPromise(data.DeviceStatusList, { explicitArray: false })
      const deviceStatus = result.DeviceStatusList.DeviceStatus
      const values = deviceStatus.CapabilityValue.split(',')
      const capabilities = {}
      deviceStatus.CapabilityID.split(',').forEach((val, index) => (capabilities[val] = values[index]))
      if (capabilities[this.linkCodes.switch] === undefined || !capabilities[this.linkCodes.switch].length) {
        throw new Error('device appears to be offline.')
      }
      let hkValue
      if (capabilities[this.linkCodes.switch]) {
        hkValue = parseInt(capabilities[this.linkCodes.switch]) !== 0
        this.externalSwitchUpdate(hkValue)
      }
      if (capabilities[this.linkCodes.brightness] && this.hasBRSupport) {
        hkValue = Math.round(capabilities[this.linkCodes.brightness].split(':').shift() / 2.55)
        this.externalBrightnessUpdate(hkValue)
      }
      if (capabilities[this.linkCodes.temperature] && this.hasCTSupport) {
        hkValue = Math.round(capabilities[this.linkCodes.temperature].split(':').shift())
        this.externalColourUpdate(hkValue)
      }
    } catch (err) {
      this.log.warn('[%s] requestDeviceUpdate error: %s.', this.dName, this.debug ? '\n' + err : err.message)
    }
  }

  async internalSwitchUpdate (value, callback) {
    let prevState
    try {
      prevState = this.service.getCharacteristic(this.C.On).value
      callback()
      await this.sendDeviceUpdate(
        this.linkCodes.switch,
        value ? 1 : 0
      )
      if (!this.disableDeviceLogging) {
        this.log('[%s] setting state to [%s].', this.dName, value ? 'on' : 'off')
      }
    } catch (err) {
      try {
        const errToShow = this.debug ? '\n' + err : err.message
        this.log.warn('[%s] setting state to [%s] error: %s.', this.dName, value ? 'on' : 'off', errToShow)
        this.log.warn('[%s] reverting HomeKit status due to error.', this.dName)
        await this.funcs.sleep(1000)
        this.service.updateCharacteristic(this.C.On, prevState)
      } catch (e) {}
    }
  }

  async internalBrightnessUpdate (value, callback) {
    let prevState
    try {
      prevState = this.service.getCharacteristic(this.C.Brightness).value
      callback()
      const updateKeyBrightness = Math.random().toString(36).substr(2, 8)
      this.updateKeyBrightness = updateKeyBrightness
      await this.funcs.sleep(350)
      if (updateKeyBrightness !== this.updateKeyBrightness) {
        return
      }
      await this.sendDeviceUpdate(
        this.linkCodes.brightness,
        value * 2.55
      )
      if (!this.disableDeviceLogging) {
        this.log('[%s] setting brightness to [%s%].', this.dName, value)
      }
    } catch (err) {
      try {
        const errToShow = this.debug ? '\n' + err : err.message
        this.log.warn('[%s] setting brightness to [%s%] error: %s.', this.dName, value, errToShow)
        this.log.warn('[%s] reverting HomeKit status due to error.', this.dName)
        await this.funcs.sleep(1000)
        this.service.updateCharacteristic(this.C.Brightness, prevState)
      } catch (e) {}
    }
  }

  async internalColourUpdate (value, callback) {
    let prevState
    let mToK
    try {
      prevState = this.service.getCharacteristic(this.C.ColorTemperature).value

      // *** Value needs to be between 154 and 370 *** \\
      value = Math.min(Math.max(value, 154), 370)

      // *** Convert mired value to kelvin for logging *** \\
      mToK = Math.round(1000000 / value)

      callback()
      if (this.lastSentColour === value) {
        return
      }
      this.lastSentColour = value
      const updateKeyColour = Math.random().toString(36).substr(2, 8)
      this.updateKeyColour = updateKeyColour
      await this.funcs.sleep(700)
      if (updateKeyColour !== this.updateKeyColour) {
        return
      }
      await this.sendDeviceUpdate(
        this.linkCodes.temperature,
        value + ':0'
      )
      if (!this.disableDeviceLogging) {
        if (this.alController && this.alController.isAdaptiveLightingActive()) {
          this.log('[%s] setting cct to [%sK] via adaptive lighting.', this.dName, mToK)
        } else {
          this.log('[%s] setting cct to [%sK].', this.dName, mToK)
        }
      }
    } catch (err) {
      try {
        const errToShow = this.debug ? '\n' + err : err.message
        this.log.warn('[%s] setting cct to [%sK] error: %s.', this.dName, mToK, errToShow)
        this.log.warn('[%s] reverting HomeKit status due to error.', this.dName)
        await this.funcs.sleep(1000)
        this.service.updateCharacteristic(this.C.ColorTemperature, prevState)
      } catch (e) {}
    }
  }

  externalSwitchUpdate (value) {
    try {
      const prevState = this.service.getCharacteristic(this.C.On).value
      if (prevState !== value) {
        this.service.updateCharacteristic(this.C.On, value)
        if (!this.disableDeviceLogging) {
          this.log('[%s] updating state to [%s].', this.dName, value ? 'on' : 'off')
        }
      }
    } catch (err) {
      const errToShow = this.debug ? '\n' + err : err.message
      this.log.warn('[%s] updating state to [%s] error: %s.', this.dName, value ? 'on' : 'off', errToShow)
    }
  }

  externalBrightnessUpdate (value) {
    try {
      const prevBrightness = this.service.getCharacteristic(this.C.Brightness).value
      if (prevBrightness !== value) {
        this.service.updateCharacteristic(this.C.Brightness, value)
        if (!this.disableDeviceLogging) {
          this.log('[%s] updating brightness to [%s%].', this.dName, value)
        }
      }
    } catch (err) {
      const errToShow = this.debug ? '\n' + err : err.message
      this.log.warn('[%s] updating brightness to [%s%] error: %s.', this.dName, value, errToShow)
    }
  }

  externalColourUpdate (value) {
    let mToK
    try {
      mToK = Math.round(1000000 / value)
      const prevTemp = this.service.getCharacteristic(this.C.ColorTemperature).value
      if (prevTemp !== value) {
        this.service.updateCharacteristic(this.C.ColorTemperature, value)
        if (!this.disableDeviceLogging) {
          this.log('[%s] updating cct to [%sK].', this.dName, mToK)
        }
      }
    } catch (err) {
      const errToShow = this.debug ? '\n' + err : err.message
      this.log.warn('[%s] updating cct to [%sK] error: %s.', this.dName, mToK, errToShow)
    }
  }
}
