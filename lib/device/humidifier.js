/* jshint node: true,esversion: 9, -W014, -W033 */
/* eslint-disable new-cap */
'use strict'

const xml2js = require('xml2js')

module.exports = class deviceHumidifier {
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

    // Add the humidifier service if it doesn't already exist
    this.service =
      this.accessory.getService(this.hapServ.HumidifierDehumidifier) ||
      this.accessory.addService(this.hapServ.HumidifierDehumidifier)

    // Add the set handler to the humidifier active characteristic
    this.service.getCharacteristic(this.hapChar.Active).onSet(async value => {
      await this.internalStateUpdate(value)
    })

    // Add options to the humidifier target state characteristic
    this.service.getCharacteristic(this.hapChar.TargetHumidifierDehumidifierState).setProps({
      minValue: 1,
      maxValue: 1,
      validValues: [1]
    })

    // Add the set handler to the humidifier target relative humidity characteristic
    this.service
      .getCharacteristic(this.hapChar.RelativeHumidityHumidifierThreshold)
      .onSet(async value => {
        await this.internalTargetHumidityUpdate(value)
      })

    // Add the set handler to the humidifier target state characteristic
    this.service
      .getCharacteristic(this.hapChar.RotationSpeed)
      .setProps({ minStep: 20 })
      .onSet(async value => {
        await this.internalModeUpdate(value)
      })

    // Add a last mode cache value if not already set
    const cacheMode = this.accessory.context.cacheLastOnMode
    if (!cacheMode || cacheMode === 0) {
      this.accessory.context.cacheLastOnMode = 1
    }

    // Some conversion objects
    this.modeLabels = {
      0: this.lang.labelOff,
      1: this.lang.labelMin,
      2: this.lang.labelLow,
      3: this.lang.labelMed,
      4: this.lang.labelHigh,
      5: this.lang.labelMax
    }
    this.hToWemoFormat = {
      45: 0,
      50: 1,
      55: 2,
      60: 3,
      100: 4
    }
    this.wemoFormatToH = {
      0: 45,
      1: 50,
      2: 55,
      3: 60,
      4: 100
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
      case 'FanMode':
        this.externalModeUpdate(attribute.value)
        break
      case 'CurrentHumidity':
        this.externalCurrentHumidityUpdate(attribute.value)
        break
      case 'DesiredHumidity':
        this.externalTargetHumidityUpdate(attribute.value)
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
            case 'FanMode':
            case 'CurrentHumidity':
            case 'DesiredHumidity':
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

      // We also want to update the mode by rotation speed when turning on/off
      // Use the set handler to run the RotationSpeed set handler, to send updates to device
      this.service.setCharacteristic(
        this.hapChar.RotationSpeed,
        value === 0 ? 0 : this.accessory.context.cacheLastOnMode * 20
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
      const updateKeyMode = Math.random()
        .toString(36)
        .substr(2, 8)
      this.updateKeyMode = updateKeyMode
      await this.funcs.sleep(500)
      if (updateKeyMode !== this.updateKeyMode) {
        return
      }

      // Find the new needed mode from the given rotation speed
      let newValue = 0
      if (value > 10 && value <= 30) {
        newValue = 1
      } else if (value > 30 && value <= 50) {
        newValue = 2
      } else if (value > 50 && value <= 70) {
        newValue = 3
      } else if (value > 70 && value <= 90) {
        newValue = 4
      } else if (value > 90) {
        newValue = 5
      }

      // Don't continue if the rotation speed is the same as before
      if (value === prevSpeed) {
        return
      }

      // Send the update
      await this.sendDeviceUpdate({
        FanMode: newValue.toString()
      })

      // Update the last used mode cache if rotation speed is not 0
      if (newValue !== 0) {
        this.accessory.context.cacheLastOnMode = newValue
      }

      // Log the update if appropriate
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

  async internalTargetHumidityUpdate (value) {
    const prevHumi = this.service.getCharacteristic(
      this.hapChar.RelativeHumidityHumidifierThreshold
    ).value
    try {
      // Avoid multiple updates in quick succession
      const updateKeyHumi = Math.random()
        .toString(36)
        .substr(2, 8)
      this.updateKeyHumi = updateKeyHumi
      await this.funcs.sleep(500)
      if (updateKeyHumi !== this.updateKeyHumi) {
        return
      }

      // Find the new target humidity mode from the target humidity given
      let newValue = 45
      if (value >= 47 && value < 52) {
        newValue = 50
      } else if (value >= 52 && value < 57) {
        newValue = 55
      } else if (value >= 57 && value < 80) {
        newValue = 60
      } else if (value >= 80) {
        newValue = 100
      }

      // Don't continue if the new mode is the same as before
      if (newValue === prevHumi) {
        return
      }

      // Send the update
      await this.sendDeviceUpdate({
        DesiredHumidity: this.hToWemoFormat[newValue]
      })

      // Log the change if appropriate
      if (this.enableLogging) {
        this.log('[%s] %s [%s%].', this.name, this.lang.tarHumi, newValue)
      }
    } catch (err) {
      const eText = this.funcs.parseError(err)
      this.log.warn('[%s] %s %s.', this.name, this.lang.cantCtl, eText)

      // Throw a 'no response' error and set a timeout to revert this after 2 seconds
      setTimeout(() => {
        this.service.updateCharacteristic(
          this.hapChar.RelativeHumidityHumidifierThreshold,
          prevHumi
        )
      }, 2000)
      throw new this.hapErr(-70402)
    }
  }

  externalModeUpdate (value) {
    try {
      // Find the needed rotation speed from the given mode
      const rotSpeed = value * 20

      // Update the HomeKit characteristics
      this.service.updateCharacteristic(this.hapChar.Active, value !== 0 ? 1 : 0)
      this.service.updateCharacteristic(this.hapChar.RotationSpeed, rotSpeed)

      // Update the last used mode if not off
      if (value !== 0) {
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

  externalTargetHumidityUpdate (value) {
    try {
      // Find the HomeKit value version from the given target humidity mode
      value = this.wemoFormatToH[value]

      // Don't continue if the new target is the same as the current target
      const t = this.service.getCharacteristic(this.hapChar.RelativeHumidityHumidifierThreshold)
        .value
      if (t === value) {
        return
      }

      // Update the target humidity HomeKit characteristics
      this.service.updateCharacteristic(this.hapChar.RelativeHumidityHumidifierThreshold, value)

      // Log the change if appropriate
      if (this.enableLogging) {
        this.log('[%s] %s [%s%].', this.name, this.lang.tarHumi, value)
      }
    } catch (err) {
      const eText = this.funcs.parseError(err)
      this.log.warn('[%s] %s %s.', this.name, this.lang.cantUpd, eText)
    }
  }

  externalCurrentHumidityUpdate (value) {
    try {
      // Don't continue if the new current humidity is the same as before
      if (this.service.getCharacteristic(this.hapChar.CurrentRelativeHumidity).value === value) {
        return
      }

      // Update the current relative humidity HomeKit characteristic
      this.service.updateCharacteristic(this.hapChar.CurrentRelativeHumidity, value)

      // Log the change if appropriate
      if (this.enableLogging) {
        this.log('[%s] %s [%s%].', this.name, this.lang.curHumi, value)
      }
    } catch (err) {
      const eText = this.funcs.parseError(err)
      this.log.warn('[%s] %s %s.', this.name, this.lang.cantUpd, eText)
    }
  }
}
