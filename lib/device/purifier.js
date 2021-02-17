/* jshint -W014, -W033, esversion: 9 */
/* eslint-disable new-cap */
'use strict'

module.exports = class devicePurifier {
  constructor (platform, accessory, device) {
    // Set up variables from the platform
    this.debug = platform.config.debug
    this.funcs = platform.funcs
    this.hapServ = platform.api.hap.Service
    this.hapChar = platform.api.hap.Characteristic
    this.log = platform.log
    this.messages = platform.messages

    // Set up custom variables for this device type
    const deviceConf = platform.wemoOthers[device.serialNumber]
    this.disableDeviceLogging = deviceConf && deviceConf.overrideDisabledLogging
      ? false
      : platform.config.disableDeviceLogging

    // Set up variables from the accessory
    this.accessory = accessory
    this.client = accessory.client
    this.name = accessory.displayName

    // Add the purifier service if it doesn't already exist
    this.service = this.accessory.getService(this.hapServ.AirPurifier) ||
      this.accessory.addService(this.hapServ.AirPurifier)

    // Add the air quality service if it doesn't already exist
    this.airService = this.accessory.getService(this.hapServ.AirQualitySensor) ||
      this.accessory.addService(
        this.hapServ.AirQualitySensor,
        'Air Quality',
        'airquality'
      )

    // Add the (ionizer) switch service if it doesn't already exist
    this.ioService = this.accessory.getService(this.hapServ.Switch) ||
      this.accessory.addService(this.hapServ.Switch, 'Ionizer', 'ionizer')

    // Add the set handler to the purifier active characteristic
    this.service.getCharacteristic(this.hapChar.Active)
      .removeAllListeners('set')
      .on('set', this.internalActiveUpdate.bind(this))

    // Add the set handler to the purifier target state characteristic
    this.service.getCharacteristic(this.hapChar.TargetAirPurifierState)
      .removeAllListeners('set')
      .setProps({
        minValue: 1,
        maxValue: 1,
        validValues: [1]
      })

    // Add the set handler to the purifier rotation speed (for mode) characteristic
    this.service.getCharacteristic(this.hapChar.RotationSpeed)
      .removeAllListeners('set')
      .setProps({ minStep: 25 })
      .on('set', this.internalModeUpdate.bind(this))

    // Add the set handler to the switch (for ionizer) characteristic
    this.ioService.getCharacteristic(this.hapChar.On)
      .removeAllListeners('set')
      .on('set', this.internalIonizerUpdate.bind(this))

    // Add a last mode cache value if not already set
    if (![1, 2, 3, 4].includes(this.accessory.context.cacheLastOnMode)) {
      this.accessory.context.cacheLastOnMode = 1
    }

    // Add a ionizer on/off cache value if not already set
    if (![0, 1].includes(this.accessory.context.cacheIonizerOn)) {
      this.accessory.context.cacheIonizerOn = 0
    }

    // Some conversion objects
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

    // Output the customised options to the log if in debug mode
    if (this.debug) {
      const opts = JSON.stringify({ disableDeviceLogging: this.disableDeviceLogging })
      this.log('[%s] %s %s.', this.name, this.messages.devInitOpts, opts)
    }

    // A listener for when the device sends an update to the plugin
    this.client.on('attributeList', attribute => this.receiveDeviceUpdate(attribute))

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
      case 'AirQuality':
        this.externalAirQualityUpdate(attribute.value)
        break
      case 'Ionizer':
        this.externalIonizerUpdate(attribute.value)
        break
      case 'Mode':
        this.externalModeUpdate(attribute.value)
        break
    }
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
      if (attributes.AirQuality) {
        this.externalAirQualityUpdate(attributes.AirQuality)
      }
      if (attributes.Ionizer) {
        this.externalIonizerUpdate(attributes.Ionizer)
      }
      if (attributes.Mode) {
        this.externalModeUpdate(attributes.Mode)
      }
    } catch (err) {
      const eText = this.funcs.parseError(err)
      this.log.warn('[%s] %s: %s.', this.name, this.messages.rduErr, eText)
    }
  }

  async sendDeviceUpdate (attributes) {
    const builder = new this.xml2js.Builder({
      rootName: 'attribute',
      headless: true,
      renderOpts: { pretty: false }
    })
    const xmlAttributes = Object.keys(attributes)
      .map(attributeKey => builder.buildObject({
        name: attributeKey,
        value: attributes[attributeKey]
      })).join('')
    await this.client.sendRequest(
      'urn:Belkin:service:deviceevent:1',
      'SetAttributes',
      {
        attributeList: {
          '#text': xmlAttributes
        }
      }
    )
  }

  async internalActiveUpdate (value, callback) {
    let prevState
    try {
      prevState = this.service.getCharacteristic(this.hapChar.Active).value
      callback()
      if (value === prevState) {
        return
      }
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
      this.service.setCharacteristic(this.hapChar.RotationSpeed, newRotSpeed)
      this.service.updateCharacteristic(
        this.hapChar.CurrentAirPurifierState,
        newRotSpeed === 0 ? 0 : 2
      )
      this.ioService.updateCharacteristic(
        this.hapChar.On,
        value === 1 && this.accessory.context.cacheIonizerOn === 1
      )
      if (!this.disableDeviceLogging) {
        this.log('[%s] setting active to [%s].', this.name, value)
      }
    } catch (err) {
      try {
        const eText = this.funcs.parseError(err)
        this.log.warn('[%s] %s %s.', this.name, this.messages.cantCtl, eText)
        await this.funcs.sleep(1000)
        this.service.updateCharacteristic(this.hapChar.Active, prevState)
      } catch (e) {}
    }
  }

  async internalModeUpdate (value, callback) {
    let prevActiveState
    let prevRotSpeedState
    let newValue = 0
    try {
      prevActiveState = this.service.getCharacteristic(this.hapChar.Active).value
      prevRotSpeedState = this.service.getCharacteristic(this.hapChar.RotationSpeed).value
      callback()
      if (value > 10 && value <= 35) {
        newValue = 1
      } else if (value > 35 && value <= 60) {
        newValue = 2
      } else if (value > 60 && value <= 85) {
        newValue = 3
      } else if (value > 85) {
        newValue = 4
      }
      if (value === prevRotSpeedState) {
        return
      }
      const updateKey = Math.random().toString(36).substr(2, 8)
      this.updateKey = updateKey
      await this.funcs.sleep(500)
      if (updateKey !== this.updateKey) {
        return
      }
      await this.sendDeviceUpdate({
        Mode: newValue.toString()
      })
      if (newValue !== 0) {
        this.accessory.context.cacheLastOnMode = newValue
      }
      if (!this.disableDeviceLogging) {
        this.log('[%s] setting mode to [%s].', this.name, this.modeLabels[newValue])
      }
    } catch (err) {
      try {
        const eText = this.funcs.parseError(err)
        this.log.warn('[%s] %s %s.', this.name, this.messages.cantCtl, eText)
        await this.funcs.sleep(1000)
        this.service.updateCharacteristic(this.hapChar.Active, prevActiveState)
        this.service.updateCharacteristic(this.hapChar.RotationSpeed, prevRotSpeedState)
      } catch (e) {}
    }
  }

  async internalIonizerUpdate (value, callback) {
    let prevState
    try {
      prevState = this.ioService.getCharacteristic(this.hapChar.On).value
      callback()
      if (value && this.service.getCharacteristic(this.hapChar.Active).value === 0) {
        await this.funcs.sleep(1000)
        this.ioService.updateCharacteristic(this.hapChar.On, false)
        return
      }
      await this.sendDeviceUpdate({
        Ionizer: value ? 1 : 0
      })
      this.accessory.context.cacheIonizerOn = value ? 1 : 0
      if (!this.disableDeviceLogging) {
        this.log('[%s] setting ionizer to [%s].', this.name, value ? 'on' : 'off')
      }
    } catch (err) {
      try {
        const eText = this.funcs.parseError(err)
        this.log.warn('[%s] %s %s.', this.name, this.messages.cantCtl, eText)
        await this.funcs.sleep(1000)
        this.ioService.updateCharacteristic(this.hapChar.On, prevState)
      } catch (e) {}
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
      this.service.updateCharacteristic(this.hapChar.Active, value !== 0)
      this.service.updateCharacteristic(this.hapChar.RotationSpeed, rotSpeed)
      if (value === 0) {
        this.ioService.updateCharacteristic(this.hapChar.On, false)
      } else {
        this.ioService.updateCharacteristic(
          this.hapChar.On,
          this.accessory.context.cacheIonizerOn === 1
        )
        this.accessory.context.cacheLastOnMode = value
      }
      if (!this.disableDeviceLogging) {
        this.log('[%s] updating mode to [%s].', this.name, this.modeLabels[value])
      }
    } catch (err) {
      const eText = this.funcs.parseError(err)
      this.log.warn('[%s] %s %s.', this.name, this.messages.cantUpd, eText)
    }
  }

  externalAirQualityUpdate (value) {
    let newValue
    try {
      newValue = this.aqW2HK[value]
      const state = this.airService.getCharacteristic(this.hapChar.AirQuality).value
      if (state !== newValue) {
        this.airService.updateCharacteristic(this.hapChar.AirQuality, newValue)
        if (!this.disableDeviceLogging) {
          this.log('[%s] updating air quality [%s].', this.name, this.aqLabels[newValue])
        }
      }
    } catch (err) {
      const eText = this.funcs.parseError(err)
      this.log.warn('[%s] %s %s.', this.name, this.messages.cantUpd, eText)
    }
  }

  externalIonizerUpdate (value) {
    try {
      const state = this.ioService.getCharacteristic(this.hapChar.On).value ? 1 : 0
      if (state !== value) {
        this.ioService.updateCharacteristic(this.hapChar.On, value === 1)
        this.accessory.context.cacheIonizerOn = value
        if (!this.disableDeviceLogging) {
          this.log('[%s] current ionizer [%s].', this.name, value === 1 ? 'on' : 'off')
        }
      }
    } catch (err) {
      const eText = this.funcs.parseError(err)
      this.log.warn('[%s] %s %s.', this.name, this.messages.cantUpd, eText)
    }
  }
}
