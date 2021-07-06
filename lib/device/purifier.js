/* jshint -W014, -W033, esversion: 9 */
/* eslint-disable new-cap */
'use strict'

const xml2js = require('xml2js')

module.exports = class devicePurifier {
  constructor (platform, accessory, device) {
    // Set up variables from the platform
    this.consts = platform.consts
    this.funcs = platform.funcs
    this.hapChar = platform.api.hap.Characteristic
    this.hapErr = platform.api.hap.HapStatusError
    this.hapServ = platform.api.hap.Service
    this.lang = platform.lang
    this.log = platform.log

    // Set up custom variables for this device type
    const deviceConf = platform.wemoOthers[device.serialNumber]

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

    // Set up variables from the accessory
    this.accessory = accessory
    this.client = accessory.client
    this.name = accessory.displayName

    // Add the purifier service if it doesn't already exist
    this.service =
      this.accessory.getService(this.hapServ.AirPurifier) ||
      this.accessory.addService(this.hapServ.AirPurifier)

    // Add the air quality service if it doesn't already exist
    this.airService =
      this.accessory.getService(this.hapServ.AirQualitySensor) ||
      this.accessory.addService(this.hapServ.AirQualitySensor, 'Air Quality', 'airquality')

    // Add the (ionizer) switch service if it doesn't already exist
    this.ioService =
      this.accessory.getService(this.hapServ.Switch) ||
      this.accessory.addService(this.hapServ.Switch, 'Ionizer', 'ionizer')

    // Add the set handler to the purifier active characteristic
    this.service.getCharacteristic(this.hapChar.Active).onSet(async value => {
      await this.internalStateUpdate(value)
    })

    // Add options to the purifier target state characteristic
    this.service.getCharacteristic(this.hapChar.TargetAirPurifierState).setProps({
      minValue: 1,
      maxValue: 1,
      validValues: [1]
    })

    // Add the set handler to the purifier rotation speed (for mode) characteristic
    this.service
      .getCharacteristic(this.hapChar.RotationSpeed)
      .setProps({ minStep: 25 })
      .onSet(async value => {
        await this.internalModeUpdate(value)
      })

    // Add the set handler to the switch (for ionizer) characteristic
    this.ioService.getCharacteristic(this.hapChar.On).onSet(async value => {
      await this.internalIonizerUpdate(value)
    })

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
      5: this.lang.labelPoor,
      3: this.lang.labelFair,
      1: this.lang.labelExc
    }
    this.modeLabels = {
      0: this.lang.labelOff,
      1: this.lang.labelLow,
      2: this.lang.labelMed,
      3: this.lang.labelHigh,
      4: this.lang.labelAuto
    }

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
    // Log the receiving update if debug is enabled
    if (this.enableDebugLogging) {
      this.log('[%s] %s [%s: %s].', this.name, this.lang.recUpd, attribute.name, attribute.value)
    }

    // Check which attribute we are getting
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
      // Request the update
      const data = await this.client.sendRequest(
        'urn:Belkin:service:deviceevent:1',
        'GetAttributes'
      )

      // Parse the response
      const decoded = this.funcs.decodeXML(data.attributeList)
      const xml = '<attributeList>' + decoded + '</attributeList>'
      const result = await xml2js.parseStringPromise(xml, { explicitArray: false })
      for (const key in result.attributeList.attribute) {
        if (this.funcs.hasProperty(result.attributeList.attribute, key)) {
          // Only send the required attributes to the receiveDeviceUpdate function
          switch (result.attributeList.attribute[key].name) {
            case 'AirQuality':
            case 'Ionizer':
            case 'Mode':
              this.receiveDeviceUpdate({
                name: result.attributeList.attribute[key].name,
                value: parseInt(result.attributeList.attribute[key].value)
              })
              break
          }
        }
      }
    } catch (err) {
      const eText = this.funcs.parseError(err)
      this.log.warn('[%s] %s: %s.', this.name, this.lang.rduErr, eText)
    }
  }

  async sendDeviceUpdate (attributes) {
    // Log the sending update if debug is enabled
    if (this.enableDebugLogging) {
      this.log('[%s] %s %s.', this.name, this.lang.senUpd, JSON.stringify(attributes))
    }

    // Generate the XML to send
    const builder = new xml2js.Builder({
      rootName: 'attribute',
      headless: true,
      renderOpts: { pretty: false }
    })
    const xmlAttributes = Object.keys(attributes)
      .map(attributeKey =>
        builder.buildObject({
          name: attributeKey,
          value: attributes[attributeKey]
        })
      )
      .join('')

    // Send the update
    await this.client.sendRequest('urn:Belkin:service:deviceevent:1', 'SetAttributes', {
      attributeList: { '#text': xmlAttributes }
    })
  }

  async internalStateUpdate (value) {
    const prevState = this.service.getCharacteristic(this.hapChar.Active).value
    try {
      // Don't continue if the state is the same as before
      if (value === prevState) {
        return
      }

      // We also want to update the mode (by rotation speed)
      let newSpeed = 0
      if (value !== 0) {
        // If turning on then we want to show the last used mode (by rotation speed)
        switch (this.accessory.context.cacheLastOnMode) {
          case 2:
            newSpeed = 50
            break
          case 3:
            newSpeed = 75
            break
          case 4:
            newSpeed = 100
            break
          default:
            newSpeed = 25
        }
      }

      // Update the rotation speed, use setCharacteristic so the set handler is run to send updates
      this.service.setCharacteristic(this.hapChar.RotationSpeed, newSpeed)

      // Update the characteristic if we are now ON ie purifying air
      this.service.updateCharacteristic(
        this.hapChar.CurrentAirPurifierState,
        newSpeed === 0 ? 0 : 2
      )

      // Update the ionizer characteristic if the purifier is on and the ionizer was on before
      this.ioService.updateCharacteristic(
        this.hapChar.On,
        value === 1 && this.accessory.context.cacheIonizerOn === 1
      )
    } catch (err) {
      const eText = this.funcs.parseError(err)
      this.log.warn('[%s] %s %s.', this.name, this.lang.cantCtl, eText)

      // Throw a 'no response' error and set a timeout to revert this after 2 seconds
      setTimeout(() => {
        this.service.updateCharacteristic(this.hapChar.Active, prevState)
      }, 2000)
      throw new this.hapErr(-70402)
    }
  }

  async internalModeUpdate (value) {
    const prevSpeed = this.service.getCharacteristic(this.hapChar.RotationSpeed).value
    try {
      // Avoid multiple updates in quick succession
      const updateKey = Math.random()
        .toString(36)
        .substr(2, 8)
      this.updateKey = updateKey
      await this.funcs.sleep(500)
      if (updateKey !== this.updateKey) {
        return
      }

      // Don't continue if the speed is the same as before
      if (value === prevSpeed) {
        return
      }

      // Generate newValue for the needed mode depending on the new rotation speed value
      let newValue = 0
      if (value > 10 && value <= 35) {
        newValue = 1
      } else if (value > 35 && value <= 60) {
        newValue = 2
      } else if (value > 60 && value <= 85) {
        newValue = 3
      } else if (value > 85) {
        newValue = 4
      }

      // Send the update
      await this.sendDeviceUpdate({
        Mode: newValue.toString()
      })

      // Update the cache last used mode if not turning off
      if (newValue !== 0) {
        this.accessory.context.cacheLastOnMode = newValue
      }

      // Log the new mode if appropriate
      if (this.enableLogging) {
        this.log('[%s] %s [%s].', this.name, this.lang.curMode, this.modeLabels[newValue])
      }
    } catch (err) {
      const eText = this.funcs.parseError(err)
      this.log.warn('[%s] %s %s.', this.name, this.lang.cantCtl, eText)

      // Throw a 'no response' error and set a timeout to revert this after 2 seconds
      setTimeout(() => {
        this.service.updateCharacteristic(this.hapChar.RotationSpeed, prevSpeed)
      }, 2000)
      throw new this.hapErr(-70402)
    }
  }

  async internalIonizerUpdate (value) {
    const prevState = this.ioService.getCharacteristic(this.hapChar.On).value
    try {
      // If turning on, but the purifier device is off, then turn the ionizer back off
      if (value && this.service.getCharacteristic(this.hapChar.Active).value === 0) {
        await this.funcs.sleep(1000)
        this.ioService.updateCharacteristic(this.hapChar.On, false)
        return
      }

      // Send the update
      await this.sendDeviceUpdate({
        Ionizer: value ? 1 : 0
      })

      // Update the cache state of the ionizer
      this.accessory.context.cacheIonizerOn = value ? 1 : 0

      // Log the update if appropriate
      if (this.enableLogging) {
        this.log('[%s] %s [%s].', this.name, this.lang.curIon, value ? 'on' : 'off')
      }
    } catch (err) {
      const eText = this.funcs.parseError(err)
      this.log.warn('[%s] %s %s.', this.name, this.lang.cantCtl, eText)

      // Throw a 'no response' error and set a timeout to revert this after 2 seconds
      setTimeout(() => {
        this.ioService.updateCharacteristic(this.hapChar.On, prevState)
      }, 2000)
      throw new this.hapErr(-70402)
    }
  }

  externalModeUpdate (value) {
    try {
      // We want to find a rotation speed based on the given mode
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

      // Update the HomeKit characteristics
      this.service.updateCharacteristic(this.hapChar.Active, value !== 0 ? 1 : 0)
      this.service.updateCharacteristic(this.hapChar.RotationSpeed, rotSpeed)

      // Turn the ionizer on or off based on whether the purifier is on or off
      if (value === 0) {
        this.ioService.updateCharacteristic(this.hapChar.On, false)
      } else {
        this.ioService.updateCharacteristic(
          this.hapChar.On,
          this.accessory.context.cacheIonizerOn === 1
        )
        this.accessory.context.cacheLastOnMode = value
      }

      // Log the change if appropriate
      if (this.enableLogging) {
        this.log('[%s] %s [%s].', this.name, this.lang.curMode, this.modeLabels[value])
      }
    } catch (err) {
      const eText = this.funcs.parseError(err)
      this.log.warn('[%s] %s %s.', this.name, this.lang.cantUpd, eText)
    }
  }

  externalAirQualityUpdate (value) {
    try {
      const newValue = this.aqW2HK[value]
      // Don't continue if the value is the same as before
      if (this.airService.getCharacteristic(this.hapChar.AirQuality).value === newValue) {
        return
      }

      // Update the HomeKit characteristics
      this.airService.updateCharacteristic(this.hapChar.AirQuality, newValue)

      // Log the change if appropriate
      if (this.enableLogging) {
        this.log('[%s] %s [%s].', this.name, this.lang.curAir, this.aqLabels[newValue])
      }
    } catch (err) {
      const eText = this.funcs.parseError(err)
      this.log.warn('[%s] %s %s.', this.name, this.lang.cantUpd, eText)
    }
  }

  externalIonizerUpdate (value) {
    try {
      // Don't continue if the value is the same as before
      const state = this.ioService.getCharacteristic(this.hapChar.On).value ? 1 : 0
      if (state === value) {
        return
      }

      // Update the HomeKit characteristics
      this.ioService.updateCharacteristic(this.hapChar.On, value === 1)

      // Update the cache value and log the change if appropriate
      this.accessory.context.cacheIonizerOn = value
      if (this.enableLogging) {
        this.log('[%s] %s [%s].', this.name, this.lang.curIon, value === 1 ? 'on' : 'off')
      }
    } catch (err) {
      const eText = this.funcs.parseError(err)
      this.log.warn('[%s] %s %s.', this.name, this.lang.cantUpd, eText)
    }
  }
}
