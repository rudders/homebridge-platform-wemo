/* jshint node: true,esversion: 9, -W014, -W033 */
/* eslint-disable new-cap */
'use strict'

const xmlbuilder = require('xmlbuilder')
const xml2js = require('xml2js')

module.exports = class deviceLink {
  constructor (platform, accessory, link, device) {
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

    // Set up variables from the device
    this.deviceID = device.deviceId

    // Set up custom variables for this device type
    const deviceConf = platform.wemoLights[this.deviceID]
    this.brightStep =
      deviceConf && deviceConf.brightnessStep
        ? Math.min(deviceConf.brightnessStep, 100)
        : platform.consts.defaultValues.brightnessStep
    this.alShift =
      deviceConf && deviceConf.adaptiveLightingShift
        ? deviceConf.adaptiveLightingShift
        : platform.consts.defaultValues.adaptiveLightingShift
    this.transitionTime =
      deviceConf && deviceConf.transitionTime
        ? deviceConf.transitionTime
        : platform.consts.defaultValues.transitionTime

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
    this.hasBrightSupport = device.capabilities[this.linkCodes.brightness]
    this.hasColourSupport = device.capabilities[this.linkCodes.color]
    this.hasCTempSupport = device.capabilities[this.linkCodes.temperature]

    // Add the lightbulb service if it doesn't already exist
    this.service =
      this.accessory.getService(this.hapServ.Lightbulb) ||
      this.accessory.addService(this.hapServ.Lightbulb)

    // If adaptive lighting has just been disabled then remove and re-add service to hide AL icon
    if (this.alShift === -1 && this.accessory.context.adaptiveLighting) {
      this.accessory.removeService(this.service)
      this.service = this.accessory.addService(this.hapServ.Lightbulb)
      this.accessory.context.adaptiveLighting = false
    }

    // Add the set handler to the lightbulb on/off characteristic
    this.service.getCharacteristic(this.hapChar.On).onSet(async value => {
      await this.internalStateUpdate(value)
    })

    // Add the set handler to the brightness characteristic if supported
    if (this.hasBrightSupport) {
      this.service
        .getCharacteristic(this.hapChar.Brightness)
        .setProps({ minStep: this.brightStep })
        .onSet(async value => {
          await this.internalBrightnessUpdate(value)
        })
    }

    // Colour support to do?
    if (this.hasColourSupport) {
      /*
      WemoClient.prototype.setLightColor = function(deviceId, red, green, blue, cb) {
        var color = WemoClient.rgb2xy(red, green, blue);
        this.setDeviceStatus(deviceId, 10300, color.join(':') + ':0', cb);
      };
      */
    }

    // Add the set handler to the colour temperature characteristic if supported
    if (this.hasCTempSupport) {
      this.service.getCharacteristic(this.hapChar.ColorTemperature).onSet(async value => {
        await this.internalCTUpdate(value)
      })

      // Add support for adaptive lighting if not disabled by user
      if (this.alShift !== -1) {
        this.alController = new platform.api.hap.AdaptiveLightingController(this.service, {
          customTemperatureAdjustment: this.alShift
        })
        this.accessory.configureController(this.alController)
      }
    }

    // Output the customised options to the log
    const opts = JSON.stringify({
      adaptiveLightingShift: this.alShift,
      brightnessStep: this.brightStep,
      logging: this.enableDebugLogging ? 'debug' : this.enableLogging ? 'standard' : 'disable',
      transitionTime: this.transitionTime
    })
    this.log('[%s] %s %s.', this.name, this.lang.devInitOpts, opts)

    // Listeners for when the device sends an update to the plugin
    this.client.on('StatusChange', (deviceId, attribute) => {
      // First check that the update is for this particular device
      if (this.deviceID === deviceId) {
        this.receiveDeviceUpdate(attribute)
      }
    })

    // Request a device update immediately
    this.requestDeviceUpdate()
  }

  receiveDeviceUpdate (attribute) {
    // Log the receiving update if debug is enabled
    if (this.enableDebugLogging) {
      this.log(
        '[%s] %s [%s: %s].',
        this.name,
        this.lang.recUpd,
        this.linkCodesRev[attribute.name],
        attribute.value
      )
    }

    // Check which attribute we are getting
    switch (attribute.name) {
      case this.linkCodes.switch:
        // Need a HomeKit true/false value for the state update
        this.externalStateUpdate(parseInt(attribute.value) !== 0)
        break
      case this.linkCodes.brightness:
        // Need a HomeKit int value for the brightness update
        this.externalBrightnessUpdate(Math.round(attribute.value.split(':').shift() / 2.55))
        break
      case this.linkCodes.color:
        // To do?
        break
      case this.linkCodes.temperature:
        // Need a HomeKit int value for the colour temperature update
        this.externalCTUpdate(Math.round(attribute.value.split(':').shift()))
        break
    }
  }

  async sendDeviceUpdate (capability, value) {
    // Log the sending update if debug is enabled
    if (this.enableDebugLogging) {
      this.log('[%s] %s {%s: %s}.', this.name, this.lang.senUpd, capability, value)
    }

    // Generate the XML to send
    const deviceStatusList = xmlbuilder
      .create('DeviceStatus', {
        version: '1.0',
        encoding: 'utf-8'
      })
      .ele({
        IsGroupAction: this.deviceID.length === 10 ? 'YES' : 'NO',
        DeviceID: this.deviceID,
        CapabilityID: capability,
        CapabilityValue: value
      })
      .end()

    // Send the update
    await this.client.sendRequest('urn:Belkin:service:bridge:1', 'SetDeviceStatus', {
      DeviceStatusList: { '#text': deviceStatusList }
    })
  }

  async requestDeviceUpdate () {
    try {
      // Request the update
      const data = await this.client.sendRequest('urn:Belkin:service:bridge:1', 'GetDeviceStatus', {
        DeviceIDs: this.deviceID
      })

      // Parse the response
      const res = await xml2js.parseStringPromise(data.DeviceStatusList, { explicitArray: false })
      const deviceStatus = res.DeviceStatusList.DeviceStatus
      const values = deviceStatus.CapabilityValue.split(',')
      const caps = {}
      deviceStatus.CapabilityID.split(',').forEach((val, index) => {
        caps[val] = values[index]
      })

      // If no capability values received then device must be offline
      if (!caps[this.linkCodes.switch] || !caps[this.linkCodes.switch].length) {
        this.log.warn('[%s] %s.', this.name, this.lang.devOffline)
        return
      }

      // Need a HomeKit true/false value for the state update
      if (caps[this.linkCodes.switch]) {
        this.externalStateUpdate(parseInt(caps[this.linkCodes.switch]) !== 0)
      }

      // Need a HomeKit int value for the brightness update
      if (caps[this.linkCodes.brightness] && this.hasBrightSupport) {
        this.externalBrightnessUpdate(
          Math.round(caps[this.linkCodes.brightness].split(':').shift() / 2.55)
        )
      }

      // Need a HomeKit int value for the colour update
      if (caps[this.linkCodes.color] && this.hasColourSupport) {
        // To do?
      }

      // Need a HomeKit int value for the colour temperature update
      if (caps[this.linkCodes.temperature] && this.hasCTempSupport) {
        this.externalCTUpdate(Math.round(caps[this.linkCodes.temperature].split(':').shift()))
      }
    } catch (err) {
      const eText = this.funcs.parseError(err)
      this.log.warn('[%s] %s: %s.', this.name, this.lang.rduErr, eText)
    }
  }

  async internalStateUpdate (value) {
    try {
      // Wait a longer time than the brightness so in scenes brightness is sent first
      await this.funcs.sleep(500)

      // Send the update
      await this.sendDeviceUpdate(this.linkCodes.switch, value ? 1 : 0)

      // Update the cache and log if appropriate
      this.cacheState = value
      if (this.enableLogging) {
        this.log('[%s] %s [%s].', this.name, this.lang.curState, value ? 'on' : 'off')
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

  async internalBrightnessUpdate (value) {
    try {
      // Avoid multiple updates in quick succession
      const updateKey = Math.random()
        .toString(36)
        .substr(2, 8)
      this.updateKeyBR = updateKey
      await this.funcs.sleep(300)
      if (updateKey !== this.updateKeyBR) {
        return
      }

      // Don't continue if this value is same as before
      if (this.cacheBright === value) {
        return
      }

      // Send the update - value = brightness:transition_time
      await this.sendDeviceUpdate(
        this.linkCodes.brightness,
        value * 2.55 + ':' + this.transitionTime
      )

      // Update the cache and log if appropriate
      this.cacheBright = value
      if (this.enableLogging) {
        this.log('[%s] %s [%s%].', this.name, this.lang.curBright, value)
      }
    } catch (err) {
      const eText = this.funcs.parseError(err)
      this.log.warn('[%s] %s %s.', this.name, this.lang.cantCtl, eText)

      // Throw a 'no response' error and set a timeout to revert this after 2 seconds
      setTimeout(() => {
        this.service.updateCharacteristic(this.hapChar.Brightness, this.cacheBright)
      }, 2000)
      throw new this.hapErr(-70402)
    }
  }

  async internalCTUpdate (value) {
    try {
      // Avoid multiple updates in quick succession
      const updateKey = Math.random()
        .toString(36)
        .substr(2, 8)
      this.updateKeyCT = updateKey
      await this.funcs.sleep(400)
      if (updateKey !== this.updateKeyCT) {
        return
      }

      // Value needs to be between 170 and 370
      value = Math.min(Math.max(value, 170), 370)

      // Don't continue if this value is same as before
      if (this.cacheMired === value) {
        return
      }

      // Send the update - value = ct:transition_time
      await this.sendDeviceUpdate(this.linkCodes.temperature, value + ':' + this.transitionTime)

      // Update the cache and log if appropriate
      this.cacheMired = value
      if (this.enableLogging) {
        // Convert mired value to kelvin for logging
        const mToK = Math.round(1000000 / value)
        if (this.alController && this.alController.isAdaptiveLightingActive()) {
          this.log(
            '[%s] %s [%sK / %sM] %s.',
            this.name,
            this.lang.curCCT,
            mToK,
            value,
            this.lang.viaAL
          )
        } else {
          this.log('[%s] %s [%sK / %sM].', this.name, this.lang.curCCT, mToK, value)
        }
      }
    } catch (err) {
      const eText = this.funcs.parseError(err)
      this.log.warn('[%s] %s %s.', this.name, this.lang.cantCtl, eText)

      // Throw a 'no response' error and set a timeout to revert this after 2 seconds
      setTimeout(() => {
        this.service.updateCharacteristic(this.hapChar.ColorTemperature, this.cacheMired)
      }, 2000)
      throw new this.hapErr(-70402)
    }
  }

  externalStateUpdate (value) {
    try {
      // Don't continue if the state is the same as before
      if (value === this.cacheState) {
        return
      }

      // Update the state HomeKit characteristic
      this.service.updateCharacteristic(this.hapChar.On, value)

      // Update the cache and log if appropriate
      this.cacheState = value
      if (this.enableLogging) {
        this.log('[%s] %s [%s].', this.name, this.lang.curState, value ? 'on' : 'off')
      }
    } catch (err) {
      const eText = this.funcs.parseError(err)
      this.log.warn('[%s] %s %s.', this.name, this.lang.cantUpd, eText)
    }
  }

  externalBrightnessUpdate (value) {
    try {
      // Don't continue if the brightness is the same as before
      if (value === this.cacheBright) {
        return
      }

      // Update the brightness HomeKit characteristic
      this.service.updateCharacteristic(this.hapChar.Brightness, value)

      // Update the cache and log if appropriate
      this.cacheBright = value
      if (this.enableLogging) {
        this.log('[%s] %s [%s%].', this.name, this.lang.curBright, value)
      }
    } catch (err) {
      const eText = this.funcs.parseError(err)
      this.log.warn('[%s] %s %s.', this.name, this.lang.cantUpd, eText)
    }
  }

  externalCTUpdate (value) {
    try {
      // Don't continue if the mired value is the same as before
      if (value === this.cacheMired) {
        return
      }

      // Update the mired HomeKit characteristic
      this.service.updateCharacteristic(this.hapChar.ColorTemperature, value)

      // Log the change if appropriate
      if (this.enableLogging) {
        const mToK = Math.round(1000000 / value)
        this.log('[%s] %s [%sK / %sM].', this.name, this.lang.curCCT, mToK, value)
      }

      // If the difference is significant (>20) then disable adaptive lighting
      if (!isNaN(this.cacheMired)) {
        const diff = Math.abs(value - this.cacheMired) > 20
        if (this.alController && this.alController.isAdaptiveLightingActive() && diff) {
          this.alController.disableAdaptiveLighting()
          this.log.warn('[%s] %s.', this.name, this.lang.alDisabled)
        }
      }

      // Update the cache value after the adaptive lighting check
      this.cacheMired = value
    } catch (err) {
      const eText = this.funcs.parseError(err)
      this.log.warn('[%s] %s %s.', this.name, this.lang.cantUpd, eText)
    }
  }
}
