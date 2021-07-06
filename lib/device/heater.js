/* jshint -W014, -W033, esversion: 9 */
/* eslint-disable new-cap */
'use strict'

const xml2js = require('xml2js')

module.exports = class deviceHeater {
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

    // Add the heater service if it doesn't already exist
    this.service =
      this.accessory.getService(this.hapServ.HeaterCooler) ||
      this.accessory.addService(this.hapServ.HeaterCooler)

    // Add the set handler to the heater active characteristic
    this.service.getCharacteristic(this.hapChar.Active).onSet(async value => {
      await this.internalStateUpdate(value)
    })

    // Add options to the heater target state characteristic
    this.service.getCharacteristic(this.hapChar.TargetHeaterCoolerState).setProps({
      minValue: 0,
      maxValue: 0,
      validValues: [0]
    })

    // Add the set handler and a range to the heater target temperature characteristic
    this.service
      .getCharacteristic(this.hapChar.HeatingThresholdTemperature)
      .setProps({
        minStep: 1,
        minValue: 16,
        maxValue: 29
      })
      .onSet(async value => {
        await this.internalTargetTempUpdate(value)
      })

    // Add the set handler to the heater rotation speed characteristic
    this.service
      .getCharacteristic(this.hapChar.RotationSpeed)
      .setProps({ minStep: 33 })
      .onSet(async value => {
        await this.internalModeUpdate(value)
      })

    // Add a last mode cache value if not already set
    const cacheMode = this.accessory.context.cacheLastOnMode
    if (!cacheMode || [0, 1].includes(cacheMode)) {
      this.accessory.context.cacheLastOnMode = 4
    }

    // Add a last temperature cache value if not already set
    if (!this.accessory.context.cacheLastOnTemp) {
      this.accessory.context.cacheLastOnTemp = 16
    }

    // Some conversion objects
    this.modeLabels = {
      0: this.lang.labelOff,
      1: this.lang.labelFP,
      2: this.lang.labelHigh,
      3: this.lang.labelLow,
      4: this.lang.labelEco
    }
    this.cToF = {
      16: 61,
      17: 63,
      18: 64,
      19: 66,
      20: 68,
      21: 70,
      22: 72,
      23: 73,
      24: 75,
      25: 77,
      26: 79,
      27: 81,
      28: 83,
      29: 84
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

  receiveDeviceUpdate (attribute, value) {
    // Log the receiving update if debug is enabled
    if (this.enableDebugLogging) {
      this.log('[%s] %s [%s: %s].', this.name, this.lang.recUpd, attribute.name, attribute.value)
    }

    // Check which attribute we are getting
    switch (attribute.name) {
      case 'Mode':
        this.externalModeUpdate(attribute.value)
        break
      case 'Temperature':
        this.externalCurrentTempUpdate(attribute.value)
        break
      case 'SetTemperature':
        this.externalTargetTempUpdate(attribute.value)
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
            case 'Mode':
            case 'Temperature':
            case 'SetTemperature':
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
      let newRotSpeed = 0
      if (value !== 0) {
        // If turning on then we want to show the last used mode (by rotation speed)
        switch (this.accessory.context.cacheLastOnMode) {
          case 2:
            newRotSpeed = 99
            break
          case 3:
            newRotSpeed = 66
            break
          default:
            newRotSpeed = 33
        }
      }

      // Update the rotation speed, use setCharacteristic so the set handler is run to send updates
      this.service.setCharacteristic(this.hapChar.RotationSpeed, newRotSpeed)
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
      const updateKeyMode = Math.random()
        .toString(36)
        .substr(2, 8)
      this.updateKeyMode = updateKeyMode
      await this.funcs.sleep(500)
      if (updateKeyMode !== this.updateKeyMode) {
        return
      }

      // Generate newValue for the needed mode and newSpeed in 33% multiples
      let newValue = 1
      let newSpeed = 0
      if (value > 25 && value <= 50) {
        newValue = 4
        newSpeed = 33
      } else if (value > 50 && value <= 75) {
        newValue = 3
        newSpeed = 66
      } else if (value > 75) {
        newValue = 2
        newSpeed = 99
      }

      // Don't continue if the speed is the same as before
      if (newSpeed === prevSpeed) {
        return
      }

      // Send the update
      await this.sendDeviceUpdate({
        Mode: newValue,
        SetTemperature: this.cToF[parseInt(this.accessory.context.cacheLastOnTemp)]
      })

      // Update the cache last used mode if not turning off
      if (newValue !== 1) {
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

  async internalTargetTempUpdate (value) {
    const prevTemp = this.service.getCharacteristic(this.hapChar.HeatingThresholdTemperature).value
    try {
      // Avoid multiple updates in quick succession
      const updateKeyTemp = Math.random()
        .toString(36)
        .substr(2, 8)
      this.updateKeyTemp = updateKeyTemp
      await this.funcs.sleep(500)
      if (updateKeyTemp !== this.updateKeyTemp) {
        return
      }

      // We want an integer target temp value and to not continue if this is the same as before
      value = parseInt(value)
      if (value === prevTemp) {
        return
      }

      // Send the update
      await this.sendDeviceUpdate({ SetTemperature: this.cToF[value] })

      // Update the cache and log if appropriate
      this.accessory.context.cacheLastOnTemp = value
      if (this.enableLogging) {
        this.log('[%s] %s [%s°C].', this.name, this.lang.tarTemp, value)
      }
    } catch (err) {
      const eText = this.funcs.parseError(err)
      this.log.warn('[%s] %s %s.', this.name, this.lang.cantCtl, eText)

      // Throw a 'no response' error and set a timeout to revert this after 2 seconds
      setTimeout(() => {
        this.service.updateCharacteristic(this.hapChar.HeatingThresholdTemperature, prevTemp)
      }, 2000)
      throw new this.hapErr(-70402)
    }
  }

  externalModeUpdate (value) {
    try {
      // We want to find a rotation speed based on the given mode
      let rotSpeed = 0
      switch (value) {
        case 2: {
          rotSpeed = 99
          break
        }
        case 3: {
          rotSpeed = 66
          break
        }
        case 4: {
          rotSpeed = 33
          break
        }
      }

      // Update the HomeKit characteristics
      this.service.updateCharacteristic(this.hapChar.Active, value !== 1 ? 1 : 0)
      this.service.updateCharacteristic(this.hapChar.RotationSpeed, rotSpeed)

      // Update the last used mode if the device is not off
      if (value !== 1) {
        this.accessory.context.cacheLastOnMode = value
      }

      // Log the change of mode if appropriate
      if (this.enableLogging) {
        this.log('[%s] %s [%s].', this.name, this.lang.curMode, this.modeLabels[value])
      }
    } catch (err) {
      const eText = this.funcs.parseError(err)
      this.log.warn('[%s] %s %s.', this.name, this.lang.cantUpd, eText)
    }
  }

  externalTargetTempUpdate (value) {
    try {
      // Don't continue if receiving frost-protect temperature (°C or °F)
      if (value === 4 || value === 40) {
        return
      }

      // A value greater than 50 normally means °F, so convert to °C
      if (value > 50) {
        value = Math.round(((value - 32) * 5) / 9)
      }

      // Make sure the value is in the [16, 29] range
      value = Math.max(Math.min(value, 29), 16)

      // Check if the new target temperature is different from the current target temperature
      if (
        this.service.getCharacteristic(this.hapChar.HeatingThresholdTemperature).value !== value
      ) {
        // Update the target temperature HomeKit characteristic
        this.service.updateCharacteristic(this.hapChar.HeatingThresholdTemperature, value)

        // Log the change if appropriate
        if (this.enableLogging) {
          this.log('[%s] %s [%s°C].', this.name, this.lang.tarTemp, value)
        }
      }

      // Update the last-ON-target-temp cache
      this.accessory.context.cacheLastOnTemp = value
    } catch (err) {
      const eText = this.funcs.parseError(err)
      this.log.warn('[%s] %s %s.', this.name, this.lang.cantUpd, eText)
    }
  }

  externalCurrentTempUpdate (value) {
    try {
      // A value greater than 50 normally means °F, so convert to °C
      if (value > 50) {
        value = Math.round(((value - 32) * 5) / 9)
      }

      // Don't continue if new current temperature is the same as before
      if (this.cacheTemp === value) {
        return
      }

      // Update the current temperature HomeKit characteristic
      this.service.updateCharacteristic(this.hapChar.CurrentTemperature, value)

      // Update the cache and log the change if appropriate
      this.cacheTemp = value
      if (this.enableLogging) {
        this.log('[%s] %s [%s°C].', this.name, this.lang.curTemp, this.cacheTemp)
      }
    } catch (err) {
      const eText = this.funcs.parseError(err)
      this.log.warn('[%s] %s %s.', this.name, this.lang.cantUpd, eText)
    }
  }
}
