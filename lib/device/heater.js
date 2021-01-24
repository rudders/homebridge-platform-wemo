/* jshint -W014, -W033, esversion: 9 */
/* eslint-disable new-cap */
'use strict'
const xml2js = require('xml2js')
module.exports = class deviceHeater {
  constructor (platform, accessory, device) {
    this.log = platform.log
    this.debug = platform.debug
    this.helpers = platform.helpers
    this.disableDeviceLogging = platform.config.disableDeviceLogging
    this.S = platform.api.hap.Service
    this.C = platform.api.hap.Characteristic
    this.client = accessory.client
    this.dName = accessory.displayName
    this.accessory = accessory

    // *** Add the heater service if it doesn't already exist *** \\
    this.service = this.accessory.getService(this.S.HeaterCooler) || this.accessory.addService(this.S.HeaterCooler)

    // *** Add the set handler to the heater active characteristic *** \\
    this.service.getCharacteristic(this.C.Active)
      .removeAllListeners('set')
      .on('set', this.internalActiveUpdate.bind(this))

    // *** Add the set handler to the heater target state characteristic *** \\
    this.service.getCharacteristic(this.C.TargetHeaterCoolerState)
      .removeAllListeners('set')
      .setProps({ validValues: [0] })

    // *** Add the set handler and a range to the heater target temperature characteristic *** \\
    this.service.getCharacteristic(this.C.HeatingThresholdTemperature)
      .removeAllListeners('set')
      .on('set', this.internalTargetTempUpdate.bind(this))
      .setProps({
        minStep: 1,
        minValue: 16,
        maxValue: 29
      })

    // *** Add the set handler to the heater rotation speed characteristic *** \\
    this.service.getCharacteristic(this.C.RotationSpeed)
      .removeAllListeners('set')
      .on('set', this.internalModeUpdate.bind(this))
      .setProps({ minStep: 33 })

    // *** Add a last mode cache value if not already set *** \\
    if (!this.accessory.context.cacheLastOnMode || [0, 1].includes(this.accessory.context.cacheLastOnMode)) {
      this.accessory.context.cacheLastOnMode = 4
    }

    // *** Add a last temperature cache value if not already set *** \\
    if (!this.accessory.context.cacheLastOnTemp) {
      this.accessory.context.cacheLastOnTemp = 16
    }

    // *** A listener for when the device sends an update to the plugin *** \\
    this.client.on('attributeList', attribute => this.receiveDeviceUpdate(attribute))

    // *** Some conversion objects *** \\
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

    // *** Request a device update immediately *** \\
    this.requestDeviceUpdate()
  }

  receiveDeviceUpdate (attribute, value) {
    if (this.debug) {
      this.log('[%s] received update [%s: %s].', this.dName, attribute.name, attribute.value)
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
      const xml = '<attributeList>' + this.helpers.decodeXML(data.attributeList) + '</attributeList>'
      const result = await xml2js.parseStringPromise(xml, { explicitArray: false })
      const attributes = {}
      for (const key in result.attributeList.attribute) {
        if (this.helpers.hasProperty(result.attributeList.attribute, key)) {
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
      const errToShow = this.debug ? '\n' + err : err.message
      this.log.warn('[%s] requestDeviceUpdate error: %s.', this.dName, errToShow)
    }
  }

  async sendDeviceUpdate (attributes) {
    const builder = new xml2js.Builder({ rootName: 'attribute', headless: true, renderOpts: { pretty: false } })
    const xmlAttributes = Object.keys(attributes)
      .map(attributeKey => builder.buildObject({ name: attributeKey, value: attributes[attributeKey] }))
      .join('')
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
      prevState = this.service.getCharacteristic(this.C.Active).value
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
      this.service.setCharacteristic(this.C.RotationSpeed, newRotSpeed)
      if (!this.disableDeviceLogging) {
        this.log('[%s] setting active to [%s].', this.dName, value)
      }
    } catch (err) {
      try {
        const errToShow = this.debug ? '\n' + err : err.message
        this.log.warn('[%s] setting active to [%s] error: %s.', this.dName, value, errToShow)
        this.log.warn('[%s] reverting HomeKit status due to error.', this.dName)
        await this.helpers.sleep(1000)
        this.service.updateCharacteristic(this.C.Active, prevState)
      } catch (e) {}
    }
  }

  async internalModeUpdate (value, callback) {
    let prevActiveState
    let prevRotSpeedState
    let newValue = 1
    try {
      prevActiveState = this.service.getCharacteristic(this.C.Active).value
      prevRotSpeedState = this.service.getCharacteristic(this.C.RotationSpeed).value
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
      await this.helpers.sleep(500)
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
        this.log('[%s] setting mode to [%s].', this.dName, this.modeLabels[newValue])
      }
    } catch (err) {
      try {
        const errToShow = this.debug ? '\n' + err : err.message
        this.log.warn('[%s] setting mode to [%s] error: %s.', this.dName, this.modeLabels[newValue], errToShow)
        this.log.warn('[%s] reverting HomeKit status due to error.', this.dName)
        await this.helpers.sleep(1000)
        this.service.updateCharacteristic(this.C.Active, prevActiveState)
        this.service.updateCharacteristic(this.C.RotationSpeed, prevRotSpeedState)
      } catch (e) {}
    }
  }

  async internalTargetTempUpdate (value, callback) {
    let prevState
    try {
      prevState = this.service.getCharacteristic(this.C.HeatingThresholdTemperature).value
      callback()
      value = parseInt(value)
      if (value === prevState) {
        return
      }
      const updateKeyTemp = Math.random().toString(36).substr(2, 8)
      this.accessory.context.updateKeyTemp = updateKeyTemp
      await this.helpers.sleep(500)
      if (updateKeyTemp !== this.accessory.context.updateKeyTemp) {
        return
      }
      await this.sendDeviceUpdate({ SetTemperature: this.cToF[value] })
      this.accessory.context.cacheLastOnTemp = value
      if (!this.disableDeviceLogging) {
        this.log('[%s] setting target temp to [%s°C].', this.dName, value)
      }
    } catch (err) {
      try {
        const errToShow = this.debug ? '\n' + err : err.message
        this.log.warn('[%s] setting target temp to [%s°C] error: %s.', this.dName, value, errToShow)
        this.log.warn('[%s] reverting HomeKit status due to error.', this.dName)
        await this.helpers.sleep(1000)
        this.service.updateCharacteristic(this.C.HeatingThresholdTemperature, prevState)
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
      this.service.updateCharacteristic(this.C.Active, value !== 1)
      this.service.updateCharacteristic(this.C.RotationSpeed, rotSpeed)
      if (value !== 1) {
        this.accessory.context.cacheLastOnMode = value
      }
      if (!this.disableDeviceLogging) {
        this.log('[%s] updating mode to [%s].', this.dName, this.modeLabels[value])
      }
    } catch (err) {
      const errToShow = this.debug ? '\n' + err : err.message
      this.log.warn('[%s] updating mode to [%s] error: %s.', this.dName, this.modeLabels[value], errToShow)
    }
  }

  externalTargetTempUpdate (value) {
    try {
      if (value === 4 || value === 40) {
        // *** Ignore frost protect temps *** \\
        return
      }
      if (value > 50) {
        value = Math.round((value - 32) * 5 / 9)
      }
      value = Math.max(Math.min(value, 29), 16)
      const tempState = this.service.getCharacteristic(this.C.HeatingThresholdTemperature).value
      if (tempState !== value) {
        this.service.updateCharacteristic(this.C.HeatingThresholdTemperature, value)
        if (!this.disableDeviceLogging) {
          this.log('[%s] updating target temp to [%s°C].', this.dName, value)
        }
      }
      this.accessory.context.cacheLastOnTemp = value
    } catch (err) {
      const errToShow = this.debug ? '\n' + err : err.message
      this.log.warn('[%s] updating target temp to [%s°C] error: %s.', this.dName, value, errToShow)
    }
  }

  externalCurrentTempUpdate (value) {
    try {
      if (value > 50) {
        value = Math.round((value - 32) * 5 / 9)
      }
      const tempState = this.service.getCharacteristic(this.C.CurrentTemperature).value
      if (tempState !== value) {
        this.service.updateCharacteristic(this.C.CurrentTemperature, value)
        if (!this.disableDeviceLogging) {
          this.log('[%s] updating current temp to [%s°C].', this.dName, value)
        }
      }
    } catch (err) {
      const errToShow = this.debug ? '\n' + err : err.message
      this.log.warn('[%s] updating current temp to [%s°C] error: %s.', this.dName, value, errToShow)
    }
  }
}
