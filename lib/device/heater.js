/* jshint -W014, -W033, esversion: 9 */
/* eslint-disable new-cap */
'use strict'

const xml2js = require('xml2js')

module.exports = class deviceHeater {
  constructor (platform, accessory, device) {
    // Set up variables from the platform
    this.consts = platform.consts
    this.debug = platform.config.debug
    this.funcs = platform.funcs
    this.hapChar = platform.api.hap.Characteristic
    this.hapErr = platform.api.hap.HapStatusError
    this.hapServ = platform.api.hap.Service
    this.lang = platform.lang
    this.log = platform.log

    // Set up custom variables for this device type
    const deviceConf = platform.wemoOthers[device.serialNumber]
    this.disableDeviceLogging =
      deviceConf && deviceConf.overrideDisabledLogging
        ? false
        : platform.config.disableDeviceLogging

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
      0: 'off',
      1: 'frost-protect',
      2: 'high',
      3: 'low',
      4: 'eco'
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

    // Output the customised options to the log if in debug mode
    if (this.debug) {
      const opts = JSON.stringify({ disableDeviceLogging: this.disableDeviceLogging })
      this.log('[%s] %s %s.', this.name, this.lang.devInitOpts, opts)
    }

    // A listener for when the device sends an update to the plugin
    this.client.on('AttributeList', attribute => this.receiveDeviceUpdate(attribute))

    // Request a device update immediately
    this.requestDeviceUpdate()
  }

  receiveDeviceUpdate (attribute, value) {
    if (this.debug) {
      this.log('[%s] %s [%s: %s].', this.name, this.lang.recUpd, attribute.name, attribute.value)
    }
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
      const data = await this.client.sendRequest(
        'urn:Belkin:service:deviceevent:1',
        'GetAttributes'
      )
      const decoded = this.funcs.decodeXML(data.attributeList)
      const xml = '<attributeList>' + decoded + '</attributeList>'
      const result = await xml2js.parseStringPromise(xml, { explicitArray: false })
      for (const key in result.attributeList.attribute) {
        if (this.funcs.hasProperty(result.attributeList.attribute, key)) {
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
    if (this.debug) {
      this.log('[%s] %s %s.', this.name, this.lang.senUpd, JSON.stringify(attributes))
    }
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
    await this.client.sendRequest('urn:Belkin:service:deviceevent:1', 'SetAttributes', {
      attributeList: { '#text': xmlAttributes }
    })
  }

  async internalStateUpdate (value) {
    const prevState = this.service.getCharacteristic(this.hapChar.Active).value
    try {
      if (value === prevState) {
        return
      }
      let newRotSpeed = 0
      if (value !== 0) {
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
      const updateKeyMode = Math.random()
        .toString(36)
        .substr(2, 8)
      this.updateKeyMode = updateKeyMode
      await this.funcs.sleep(500)
      if (updateKeyMode !== this.updateKeyMode) {
        return
      }
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
      if (newSpeed === prevSpeed) {
        return
      }
      await this.sendDeviceUpdate({
        Mode: newValue,
        SetTemperature: this.cToF[parseInt(this.accessory.context.cacheLastOnTemp)]
      })
      if (newValue !== 1) {
        this.accessory.context.cacheLastOnMode = newValue
      }
      if (!this.disableDeviceLogging) {
        this.log('[%s] current mode [%s].', this.name, this.modeLabels[newValue])
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
      const updateKeyTemp = Math.random()
        .toString(36)
        .substr(2, 8)
      this.updateKeyTemp = updateKeyTemp
      await this.funcs.sleep(500)
      if (updateKeyTemp !== this.updateKeyTemp) {
        return
      }
      value = parseInt(value)
      if (value === prevTemp) {
        return
      }
      await this.sendDeviceUpdate({ SetTemperature: this.cToF[value] })
      this.accessory.context.cacheLastOnTemp = value
      if (!this.disableDeviceLogging) {
        this.log('[%s] target temp [%s°C].', this.name, value)
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
      this.service.updateCharacteristic(this.hapChar.Active, value !== 1)
      this.service.updateCharacteristic(this.hapChar.RotationSpeed, rotSpeed)
      if (value !== 1) {
        this.accessory.context.cacheLastOnMode = value
      }
      if (!this.disableDeviceLogging) {
        this.log('[%s] current mode [%s].', this.name, this.modeLabels[value])
      }
    } catch (err) {
      const eText = this.funcs.parseError(err)
      this.log.warn('[%s] %s %s.', this.name, this.lang.cantUpd, eText)
    }
  }

  externalTargetTempUpdate (value) {
    try {
      if (value === 4 || value === 40) {
        // Ignore frost protect temps
        return
      }
      if (value > 50) {
        value = Math.round(((value - 32) * 5) / 9)
      }
      value = Math.max(Math.min(value, 29), 16)
      const charHTT = this.hapChar.HeatingThresholdTemperature
      const tempState = this.service.getCharacteristic(charHTT).value
      if (tempState !== value) {
        this.service.updateCharacteristic(charHTT, value)
        if (!this.disableDeviceLogging) {
          this.log('[%s] target temp [%s°C].', this.name, value)
        }
      }
      this.accessory.context.cacheLastOnTemp = value
    } catch (err) {
      const eText = this.funcs.parseError(err)
      this.log.warn('[%s] %s %s.', this.name, this.lang.cantUpd, eText)
    }
  }

  externalCurrentTempUpdate (value) {
    try {
      if (value > 50) {
        value = Math.round(((value - 32) * 5) / 9)
      }
      const temp = this.service.getCharacteristic(this.hapChar.CurrentTemperature).value
      if (temp !== value) {
        this.service.updateCharacteristic(this.hapChar.CurrentTemperature, value)
        if (!this.disableDeviceLogging) {
          this.log('[%s] current temp [%s°C].', this.name, value)
        }
      }
    } catch (err) {
      const eText = this.funcs.parseError(err)
      this.log.warn('[%s] %s %s.', this.name, this.lang.cantUpd, eText)
    }
  }
}
