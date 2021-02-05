/* jshint -W014, -W033, esversion: 9 */
/* eslint-disable new-cap */
'use strict'

module.exports = class deviceHeater {
  constructor (platform, accessory, device) {
    // Setup variables from the platform
    this.debug = platform.config.debug
    this.disableDeviceLogging = platform.config.disableDeviceLogging
    this.funcs = platform.funcs
    this.hapServ = platform.api.hap.Service
    this.hapChar = platform.api.hap.Characteristic
    this.log = platform.log
    this.messages = platform.messages
    this.xml2js = platform.xml2js

    // Setup variables from the accessory
    this.accessory = accessory
    this.client = accessory.client
    this.name = accessory.displayName

    // Add the heater service if it doesn't already exist
    this.service = this.accessory.getService(this.hapServ.HeaterCooler) ||
      this.accessory.addService(this.hapServ.HeaterCooler)

    // Add the set handler to the heater active characteristic
    this.service.getCharacteristic(this.hapChar.Active)
      .removeAllListeners('set')
      .on('set', this.internalActiveUpdate.bind(this))

    // Add the set handler to the heater target state characteristic
    this.service.getCharacteristic(this.hapChar.TargetHeaterCoolerState)
      .removeAllListeners('set')
      .setProps({ validValues: [0] })

    // Add the set handler and a range to the heater target temperature characteristic
    this.service.getCharacteristic(this.hapChar.HeatingThresholdTemperature)
      .removeAllListeners('set')
      .on('set', this.internalTargetTempUpdate.bind(this))
      .setProps({
        minStep: 1,
        minValue: 16,
        maxValue: 29
      })

    // Add the set handler to the heater rotation speed characteristic
    this.service.getCharacteristic(this.hapChar.RotationSpeed)
      .removeAllListeners('set')
      .on('set', this.internalModeUpdate.bind(this))
      .setProps({ minStep: 33 })

    // Add a last mode cache value if not already set
    if (
      !this.accessory.context.cacheLastOnMode ||
      [0, 1].includes(this.accessory.context.cacheLastOnMode)
    ) {
      this.accessory.context.cacheLastOnMode = 4
    }

    // Add a last temperature cache value if not already set
    if (!this.accessory.context.cacheLastOnTemp) {
      this.accessory.context.cacheLastOnTemp = 16
    }

    // A listener for when the device sends an update to the plugin
    this.client.on('attributeList', attribute => this.receiveDeviceUpdate(attribute))

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

    // Request a device update immediately
    this.requestDeviceUpdate()
  }

  receiveDeviceUpdate (attribute, value) {
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
      const result = await this.xml2js.parseStringPromise(xml, { explicitArray: false })
      const attributes = {}
      for (const key in result.attributeList.attribute) {
        if (this.funcs.hasProperty(result.attributeList.attribute, key)) {
          const attribute = result.attributeList.attribute[key]
          attributes[attribute.name] = parseInt(attribute.value)
        }
      }
      if (attributes.Mode) {
        this.externalModeUpdate(attributes.Mode)
      }
      if (attributes.Temperature) {
        this.externalCurrentTempUpdate(attributes.Temperature)
      }
      if (attributes.SetTemperature) {
        this.externalTargetTempUpdate(attributes.SetTemperature)
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
        attributeList: { '#text': xmlAttributes }
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
    let newValue = 1
    try {
      prevActiveState = this.service.getCharacteristic(this.hapChar.Active).value
      prevRotSpeedState = this.service.getCharacteristic(this.hapChar.RotationSpeed).value
      callback()
      if (value > 25 && value <= 50) {
        newValue = 4
      } else if (value > 50 && value <= 75) {
        newValue = 3
      } else if (value > 75) {
        newValue = 2
      }
      if (value === prevRotSpeedState) {
        return
      }
      const updateKeyMode = Math.random().toString(36).substr(2, 8)
      this.updateKeyMode = updateKeyMode
      await this.funcs.sleep(500)
      if (updateKeyMode !== this.updateKeyMode) {
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

  async internalTargetTempUpdate (value, callback) {
    let prevState
    try {
      prevState = this.service
        .getCharacteristic(this.hapChar.HeatingThresholdTemperature).value
      callback()
      value = parseInt(value)
      if (value === prevState) {
        return
      }
      const updateKeyTemp = Math.random().toString(36).substr(2, 8)
      this.accessory.context.updateKeyTemp = updateKeyTemp
      await this.funcs.sleep(500)
      if (updateKeyTemp !== this.accessory.context.updateKeyTemp) {
        return
      }
      await this.sendDeviceUpdate({ SetTemperature: this.cToF[value] })
      this.accessory.context.cacheLastOnTemp = value
      if (!this.disableDeviceLogging) {
        this.log('[%s] setting target temp to [%s°C].', this.name, value)
      }
    } catch (err) {
      try {
        const eText = this.funcs.parseError(err)
        this.log.warn('[%s] %s %s.', this.name, this.messages.cantCtl, eText)
        await this.funcs.sleep(1000)
        this.service.updateCharacteristic(
          this.hapChar.HeatingThresholdTemperature,
          prevState
        )
      } catch (e) {}
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
        this.log('[%s] updating mode to [%s].', this.name, this.modeLabels[value])
      }
    } catch (err) {
      const eText = this.funcs.parseError(err)
      this.log.warn('[%s] %s %s.', this.name, this.messages.cantUpd, eText)
    }
  }

  externalTargetTempUpdate (value) {
    try {
      if (value === 4 || value === 40) {
        // Ignore frost protect temps
        return
      }
      if (value > 50) {
        value = Math.round((value - 32) * 5 / 9)
      }
      value = Math.max(Math.min(value, 29), 16)
      const tempState = this.service
        .getCharacteristic(this.hapChar.HeatingThresholdTemperature).value
      if (tempState !== value) {
        this.service.updateCharacteristic(this.hapChar.HeatingThresholdTemperature, value)
        if (!this.disableDeviceLogging) {
          this.log('[%s] updating target temp to [%s°C].', this.name, value)
        }
      }
      this.accessory.context.cacheLastOnTemp = value
    } catch (err) {
      const eText = this.funcs.parseError(err)
      this.log.warn('[%s] %s %s.', this.name, this.messages.cantUpd, eText)
    }
  }

  externalCurrentTempUpdate (value) {
    try {
      if (value > 50) {
        value = Math.round((value - 32) * 5 / 9)
      }
      const tempState = this.service
        .getCharacteristic(this.hapChar.CurrentTemperature).value
      if (tempState !== value) {
        this.service.updateCharacteristic(this.hapChar.CurrentTemperature, value)
        if (!this.disableDeviceLogging) {
          this.log('[%s] updating current temp to [%s°C].', this.name, value)
        }
      }
    } catch (err) {
      const eText = this.funcs.parseError(err)
      this.log.warn('[%s] %s %s.', this.name, this.messages.cantUpd, eText)
    }
  }
}
