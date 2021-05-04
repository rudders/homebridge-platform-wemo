/* jshint -W014, -W033, esversion: 9 */
/* eslint-disable new-cap */
'use strict'

const xml2js = require('xml2js')

module.exports = class deviceHumidifier {
  constructor (platform, accessory, device) {
    // Set up variables from the platform
    this.debug = platform.config.debug
    this.funcs = platform.funcs
    this.consts = platform.consts
    this.hapServ = platform.api.hap.Service
    this.hapChar = platform.api.hap.Characteristic
    this.log = platform.log
    this.lang = platform.lang
    this.platform = platform

    // Set up custom variables for this device type
    const deviceConf = platform.wemoOthers[device.serialNumber]
    this.disableDeviceLogging = deviceConf && deviceConf.overrideDisabledLogging
      ? false
      : platform.config.disableDeviceLogging

    // Set up variables from the accessory
    this.accessory = accessory
    this.client = accessory.client
    this.name = accessory.displayName

    // Add the humidifier service if it doesn't already exist
    this.service = this.accessory.getService(this.hapServ.HumidifierDehumidifier) ||
      this.accessory.addService(this.hapServ.HumidifierDehumidifier)

    // Add the set handler to the humidifier active characteristic
    this.service.getCharacteristic(this.hapChar.Active).onSet(async value => {
      await this.internalActiveUpdate(value)
    })

    // Add options to the heater target state characteristic
    this.service.getCharacteristic(this.hapChar.TargetHumidifierDehumidifierState)
      .setProps({
        minValue: 1,
        maxValue: 1,
        validValues: [1]
      })

    // Add the set handler to the heater target humidity characteristic
    this.service.getCharacteristic(this.hapChar.RelativeHumidityHumidifierThreshold)
      .onSet(async value => {
        await this.internalTargetHumidityUpdate(value)
      })

    // Add the set handler to the humidifier target state characteristic
    this.service.getCharacteristic(this.hapChar.RotationSpeed)
      .setProps({ minStep: 20 })
      .onSet(async value => {
        await this.internalModeUpdate(value)
      })

    // Add a last mode cache value if not already set
    const cacheMode = this.accessory.context.cacheLastOnMode
    if (!cacheMode || cacheMode === 0) {
      this.accessory.context.cacheLastOnMode = 1
    }

    // A listener for when the device sends an update to the plugin
    this.client.on('AttributeList', attribute => this.receiveDeviceUpdate(attribute))

    // Some conversion objects
    this.modeLabels = {
      0: 'off',
      1: 'min',
      2: 'low',
      3: 'med',
      4: 'high',
      5: 'max'
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

    // Output the customised options to the log if in debug mode
    if (this.debug) {
      const opts = JSON.stringify({ disableDeviceLogging: this.disableDeviceLogging })
      this.log('[%s] %s %s.', this.name, this.lang.devInitOpts, opts)
    }

    // Request a device update immediately
    this.requestDeviceUpdate()
  }

  receiveDeviceUpdate (attribute) {
    if (this.debug) {
      this.log(
        '[%s] %s [%s: %s].',
        this.name,
        this.lang.recUpd,
        attribute.name,
        attribute.value
      )
    }
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
    if (this.debug) {
      this.log('[%s] %s %s.', this.name, this.lang.senUpd, JSON.stringify(attributes))
    }
    const builder = new xml2js.Builder({
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

  async internalActiveUpdate (value) {
    const prevState = this.service.getCharacteristic(this.hapChar.Active).value
    try {
      if (value === prevState) {
        return
      }
      if (value === 0) {
        this.service.setCharacteristic(this.hapChar.RotationSpeed, 0)
      } else {
        const newRotSpeed = this.accessory.context.cacheLastOnMode * 20
        this.service.setCharacteristic(this.hapChar.RotationSpeed, newRotSpeed)
      }
    } catch (err) {
      const eText = this.funcs.parseError(err)
      this.log.warn('[%s] %s %s.', this.name, this.lang.cantCtl, eText)

      // Throw a 'no response' error and set a timeout to revert this after 5 seconds
      setTimeout(() => {
        this.service.updateCharacteristic(this.hapChar.Active, prevState)
      }, 5000)
      throw new this.platform.api.hap.HapStatusError(this.consts.hapError)
    }
  }

  async internalTargetHumidityUpdate (value) {
    const prevState = this.service.getCharacteristic(this.hapChar.Active).value
    const charRHHT = this.hapChar.RelativeHumidityHumidifierThreshold
    const prevHumi = this.service.getCharacteristic(charRHHT).value
    try {
      const updateKeyHumi = Math.random().toString(36).substr(2, 8)
      this.updateKeyHumi = updateKeyHumi
      await this.funcs.sleep(500)
      if (updateKeyHumi !== this.updateKeyHumi) {
        return
      }
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
      if (newValue === prevHumi) {
        return
      }
      await this.sendDeviceUpdate({
        DesiredHumidity: this.hToWemoFormat[newValue]
      })
      if (!this.disableDeviceLogging) {
        this.log('[%s] target humidity [%s%].', this.name, newValue)
      }
    } catch (err) {
      const eText = this.funcs.parseError(err)
      this.log.warn('[%s] %s %s.', this.name, this.lang.cantCtl, eText)

      // Throw a 'no response' error and set a timeout to revert this after 5 seconds
      setTimeout(() => {
        this.service.updateCharacteristic(this.hapChar.Active, prevState)
      }, 5000)
      throw new this.platform.api.hap.HapStatusError(this.consts.hapError)
    }
  }

  async internalModeUpdate (value) {
    const prevState = this.service.getCharacteristic(this.hapChar.Active).value
    const prevSpeed = this.service.getCharacteristic(this.hapChar.RotationSpeed).value
    let newValue = 0
    try {
      const updateKeyMode = Math.random().toString(36).substr(2, 8)
      this.updateKeyMode = updateKeyMode
      await this.funcs.sleep(500)
      if (updateKeyMode !== this.updateKeyMode) {
        return
      }
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
      if (value === prevSpeed) {
        return
      }
      await this.sendDeviceUpdate({
        FanMode: newValue.toString()
      })
      if (newValue !== 0) {
        this.accessory.context.cacheLastOnMode = newValue
      }
      if (!this.disableDeviceLogging) {
        this.log('[%s] current mode [%s].', this.name, this.modeLabels[newValue])
      }
    } catch (err) {
      const eText = this.funcs.parseError(err)
      this.log.warn('[%s] %s %s.', this.name, this.lang.cantCtl, eText)

      // Throw a 'no response' error and set a timeout to revert this after 5 seconds
      setTimeout(() => {
        this.service.updateCharacteristic(this.hapChar.Active, prevState)
      }, 5000)
      throw new this.platform.api.hap.HapStatusError(this.consts.hapError)
    }
  }

  externalModeUpdate (value) {
    try {
      const rotSpeed = value * 20
      this.service.updateCharacteristic(this.hapChar.Active, value !== 0)
      this.service.updateCharacteristic(this.hapChar.RotationSpeed, rotSpeed)
      if (value !== 0) {
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

  externalCurrentHumidityUpdate (value) {
    try {
      const tempState = this.service
        .getCharacteristic(this.hapChar.CurrentRelativeHumidity).value
      if (tempState !== value) {
        this.service.updateCharacteristic(this.hapChar.CurrentRelativeHumidity, value)
        if (!this.disableDeviceLogging) {
          this.log('[%s] current humidity [%s%].', this.name, value)
        }
      }
    } catch (err) {
      const eText = this.funcs.parseError(err)
      this.log.warn('[%s] %s %s.', this.name, this.lang.cantUpd, eText)
    }
  }

  externalTargetHumidityUpdate (value) {
    try {
      value = this.wemoFormatToH[value]
      const tempState = this.service
        .getCharacteristic(this.hapChar.RelativeHumidityHumidifierThreshold).value
      if (tempState !== value) {
        this.service.updateCharacteristic(
          this.hapChar.RelativeHumidityHumidifierThreshold,
          value
        )
        if (!this.disableDeviceLogging) {
          this.log('[%s] target humidity [%s%].', this.name, value)
        }
      }
    } catch (err) {
      const eText = this.funcs.parseError(err)
      this.log.warn('[%s] %s %s.', this.name, this.lang.cantUpd, eText)
    }
  }
}
