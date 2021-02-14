/* jshint -W014, -W033, esversion: 9 */
/* eslint-disable new-cap */
'use strict'

module.exports = class deviceLink {
  constructor (platform, accessory, link, device) {
    // Set up variables from the platform
    this.debug = platform.config.debug
    this.funcs = platform.funcs
    this.hapServ = platform.api.hap.Service
    this.hapChar = platform.api.hap.Characteristic
    this.log = platform.log
    this.messages = platform.messages
    this.xml2js = platform.xml2js
    this.xmlbuilder = platform.xmlbuilder

    // Set up variables from the accessory
    this.accessory = accessory
    this.client = accessory.client
    this.name = accessory.displayName

    // Set up variables from the device
    this.deviceID = device.deviceId

    // Set up custom variables for this device type
    const deviceConf = platform.wemoLights[this.deviceID]
    this.alShift = deviceConf && deviceConf.adaptiveLightingShift
      ? deviceConf.adaptiveLightingShift
      : platform.consts.defaultValues.adaptiveLightingShift
    this.disableDeviceLogging = deviceConf && deviceConf.overrideDisabledLogging
      ? false
      : platform.config.disableDeviceLogging

    // Objects containing mapping info for the device capabilities
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

    // Quick check variables for later use
    this.hasBRSupport = device.capabilities[this.linkCodes.brightness]
    this.hasCTSupport = device.capabilities[this.linkCodes.temperature]

    // Add the lightbulb service if it doesn't already exist
    if (!(this.service = this.accessory.getService(this.hapServ.Lightbulb))) {
      this.service = this.accessory.addService(this.hapServ.Lightbulb)

      // Add the brightness characteristic if supported
      if (this.hasBRSupport) {
        this.service.addCharacteristic(this.hapChar.Brightness)
      }

      // Add the colour temperature characteristic if supported
      if (this.hasCTSupport) {
        this.service.addCharacteristic(this.hapChar.ColorTemperature)
      }
    }

    // Add the set handler to the lightbulb on/off characteristic
    this.service.getCharacteristic(this.hapChar.On)
      .removeAllListeners('set')
      .on('set', this.internalSwitchUpdate.bind(this))

    // Add the set handler to the cbrightness characteristic if supported
    if (this.hasBRSupport) {
      this.service.getCharacteristic(this.hapChar.Brightness)
        .removeAllListeners('set')
        .on('set', this.internalBrightnessUpdate.bind(this))
    }

    // Add the set handler to the colour temperature characteristic if supported
    if (this.hasCTSupport) {
      this.service.getCharacteristic(this.hapChar.ColorTemperature)
        .removeAllListeners('set')
        .on('set', this.internalColourUpdate.bind(this))

      // Add support for adaptive lighting if supported
      if (
        platform.api.versionGreaterOrEqual &&
        platform.api.versionGreaterOrEqual('1.3.0-beta.46')
      ) {
        this.alController = new platform.api.hap.AdaptiveLightingController(this.service, {
          customTemperatureAdjustment: this.alShift
        })
        this.accessory.configureController(this.alController)
      }
    }

    // Listeners for when the device sends an update to the plugin
    this.client.on('statusChange', (deviceId, attribute) => {
      // First check that the update is for this particular device
      if (this.deviceID === deviceId) {
        this.receiveDeviceUpdate(attribute)
      }
    })

    // Request a device update immediately
    this.requestDeviceUpdate()
  }

  receiveDeviceUpdate (attribute) {
    if (this.debug) {
      this.log(
        '[%s] %s [%s: %s].',
        this.name,
        this.messages.recUpd,
        this.linkCodesRev[attribute.name],
        attribute.value
      )
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
    const deviceStatusList = this.xmlbuilder.create('DeviceStatus', {
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
      const result = await this.xml2js.parseStringPromise(data.DeviceStatusList, {
        explicitArray: false
      })
      const deviceStatus = result.DeviceStatusList.DeviceStatus
      const values = deviceStatus.CapabilityValue.split(',')
      const caps = {}
      deviceStatus.CapabilityID.split(',').forEach((val, index) => {
        caps[val] = values[index]
      })
      if (!caps[this.linkCodes.switch] || !caps[this.linkCodes.switch].length) {
        this.log.warn('[%s] device appears to be offline.', this.name)
        return
      }
      let hkValue
      if (caps[this.linkCodes.switch]) {
        hkValue = parseInt(caps[this.linkCodes.switch]) !== 0
        this.externalSwitchUpdate(hkValue)
      }
      if (caps[this.linkCodes.brightness] && this.hasBRSupport) {
        hkValue = Math.round(caps[this.linkCodes.brightness].split(':').shift() / 2.55)
        this.externalBrightnessUpdate(hkValue)
      }
      if (caps[this.linkCodes.temperature] && this.hasCTSupport) {
        hkValue = Math.round(caps[this.linkCodes.temperature].split(':').shift())
        this.externalColourUpdate(hkValue)
      }
    } catch (err) {
      const eText = this.funcs.parseError(err)
      this.log.warn('[%s] %s: %s.', this.name, this.messages.rduErr, eText)
    }
  }

  async internalSwitchUpdate (value, callback) {
    let prevState
    try {
      prevState = this.service.getCharacteristic(this.hapChar.On).value
      callback()
      await this.sendDeviceUpdate(
        this.linkCodes.switch,
        value ? 1 : 0
      )
      if (!this.disableDeviceLogging) {
        this.log('[%s] setting state to [%s].', this.name, value ? 'on' : 'off')
      }
    } catch (err) {
      try {
        const eText = this.funcs.parseError(err)
        this.log.warn('[%s] %s %s.', this.name, this.messages.cantCtl, eText)
        await this.funcs.sleep(1000)
        this.service.updateCharacteristic(this.hapChar.On, prevState)
      } catch (e) {}
    }
  }

  async internalBrightnessUpdate (value, callback) {
    let prevState
    try {
      prevState = this.service.getCharacteristic(this.hapChar.Brightness).value
      callback()
      const updateKeyBrightness = Math.random().toString(36).substr(2, 8)
      this.updateKeyBrightness = updateKeyBrightness
      await this.funcs.sleep(500)
      if (updateKeyBrightness !== this.updateKeyBrightness) {
        return
      }
      await this.sendDeviceUpdate(
        this.linkCodes.brightness,
        value * 2.55
      )
      if (!this.disableDeviceLogging) {
        this.log('[%s] setting brightness to [%s%].', this.name, value)
      }
    } catch (err) {
      try {
        const eText = this.funcs.parseError(err)
        this.log.warn('[%s] %s %s.', this.name, this.messages.cantCtl, eText)
        await this.funcs.sleep(1000)
        this.service.updateCharacteristic(this.hapChar.Brightness, prevState)
      } catch (e) {}
    }
  }

  async internalColourUpdate (value, callback) {
    let prevState
    let mToK
    try {
      prevState = this.service.getCharacteristic(this.hapChar.ColorTemperature).value

      // Value needs to be between 154 and 370
      value = Math.min(Math.max(value, 154), 370)

      // Convert mired value to kelvin for logging
      mToK = Math.round(1000000 / value)

      callback()
      if (this.lastSentColour === value) {
        return
      }
      this.lastSentColour = value
      const updateKeyColour = Math.random().toString(36).substr(2, 8)
      this.updateKeyColour = updateKeyColour
      await this.funcs.sleep(400)
      if (updateKeyColour !== this.updateKeyColour) {
        return
      }
      await this.sendDeviceUpdate(
        this.linkCodes.temperature,
        value + ':0'
      )
      if (!this.disableDeviceLogging) {
        if (this.alController && this.alController.isAdaptiveLightingActive()) {
          this.log('[%s] setting cct to [%sK] via adaptive lighting.', this.name, mToK)
        } else {
          this.log('[%s] setting cct to [%sK].', this.name, mToK)
        }
      }
    } catch (err) {
      try {
        const eText = this.funcs.parseError(err)
        this.log.warn('[%s] %s %s.', this.name, this.messages.cantCtl, eText)
        await this.funcs.sleep(1000)
        this.service.updateCharacteristic(this.hapChar.ColorTemperature, prevState)
      } catch (e) {}
    }
  }

  externalSwitchUpdate (value) {
    try {
      const prevState = this.service.getCharacteristic(this.hapChar.On).value
      if (prevState !== value) {
        this.service.updateCharacteristic(this.hapChar.On, value)
        if (!this.disableDeviceLogging) {
          this.log('[%s] updating state to [%s].', this.name, value ? 'on' : 'off')
        }
      }
    } catch (err) {
      const eText = this.funcs.parseError(err)
      this.log.warn('[%s] %s %s.', this.name, this.messages.cantUpd, eText)
    }
  }

  externalBrightnessUpdate (value) {
    try {
      const prevBrightness = this.service.getCharacteristic(this.hapChar.Brightness).value
      if (prevBrightness !== value) {
        this.service.updateCharacteristic(this.hapChar.Brightness, value)
        if (!this.disableDeviceLogging) {
          this.log('[%s] updating brightness to [%s%].', this.name, value)
        }
      }
    } catch (err) {
      const eText = this.funcs.parseError(err)
      this.log.warn('[%s] %s %s.', this.name, this.messages.cantUpd, eText)
    }
  }

  externalColourUpdate (value) {
    let mToK
    try {
      mToK = Math.round(1000000 / value)
      const prevTemp = this.service.getCharacteristic(this.hapChar.ColorTemperature).value
      if (prevTemp !== value) {
        this.service.updateCharacteristic(this.hapChar.ColorTemperature, value)
        if (!this.disableDeviceLogging) {
          this.log('[%s] updating cct to [%sK].', this.name, mToK)
        }

        // If the difference is significant (>10) then disable adaptive lighting
        if (
          this.alController &&
          this.alController.isAdaptiveLightingActive() &&
          Math.abs(value - prevTemp) > 10
        ) {
          this.alController.disableAdaptiveLighting()
          this.log('[%s] adaptive lighting disabled due to significant colour change.', this.name)
        }
      }
    } catch (err) {
      const eText = this.funcs.parseError(err)
      this.log.warn('[%s] %s %s.', this.name, this.messages.cantUpd, eText)
    }
  }
}
