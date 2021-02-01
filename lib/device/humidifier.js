/* jshint -W014, -W033, esversion: 9 */
/* eslint-disable new-cap */
'use strict'

const xml2js = require('xml2js')

module.exports = class deviceHumidifier {
  constructor (platform, accessory, device) {
    this.log = platform.log
    this.debug = platform.debug
    this.funcs = platform.funcs
    this.disableDeviceLogging = platform.config.disableDeviceLogging
    this.S = platform.api.hap.Service
    this.C = platform.api.hap.Characteristic
    this.client = accessory.client
    this.dName = accessory.displayName
    this.accessory = accessory

    // *** Add the humidifier service if it doesn't already exist *** \\
    this.service = this.accessory.getService(this.S.HumidifierDehumidifier) ||
      this.accessory.addService(this.S.HumidifierDehumidifier)

    // *** Add the set handler to the humidifier active characteristic *** \\
    this.service.getCharacteristic(this.C.Active)
      .removeAllListeners('set')
      .on('set', this.internalActiveUpdate.bind(this))

    // *** Add the set handler to the heater target state characteristic *** \\
    this.service.getCharacteristic(this.C.TargetHumidifierDehumidifierState)
      .removeAllListeners('set')
      .setProps({ validValues: [1] })

    // *** Add the set handler to the heater target humidity characteristic *** \\
    this.service.getCharacteristic(this.C.RelativeHumidityHumidifierThreshold)
      .removeAllListeners('set')
      .on('set', this.internalTargetHumidityUpdate.bind(this))

    // *** Add the set handler to the humidifier target state characteristic *** \\
    this.service.getCharacteristic(this.C.RotationSpeed)
      .removeAllListeners('set')
      .on('set', this.internalModeUpdate.bind(this))
      .setProps({ minStep: 20 })

    // *** Add a last mode cache value if not already set *** \\
    if (!this.accessory.context.cacheLastOnMode || this.accessory.context.cacheLastOnMode === 0) {
      this.accessory.context.cacheLastOnMode = 1
    }

    // *** A listener for when the device sends an update to the plugin *** \\
    this.client.on('attributeList', attribute => this.receiveDeviceUpdate(attribute))

    // *** Some conversion objects *** \\
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

    // *** Request a device update immediately *** \\
    this.requestDeviceUpdate()
  }

  receiveDeviceUpdate (attribute) {
    if (this.debug) {
      this.log('[%s] received update [%s: %s].', this.dName, attribute.name, attribute.value)
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
      const xml = '<attributeList>' + this.funcs.decodeXML(data.attributeList) + '</attributeList>'
      const result = await xml2js.parseStringPromise(xml, { explicitArray: false })
      const attributes = {}
      for (const key in result.attributeList.attribute) {
        if (this.funcs.hasProperty(result.attributeList.attribute, key)) {
          const attribute = result.attributeList.attribute[key]
          attributes[attribute.name] = parseInt(attribute.value)
        }
      }
      if (attributes.FanMode) {
        this.externalModeUpdate(attributes.FanMode)
      }
      if (attributes.CurrentHumidity) {
        this.externalCurrentHumidityUpdate(attributes.CurrentHumidity)
      }
      if (attributes.DesiredHumidity) {
        this.externalTargetHumidityUpdate(attributes.DesiredHumidity)
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
        attributeList: {
          '#text': xmlAttributes
        }
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
      if (value === 0) {
        this.service.setCharacteristic(this.C.RotationSpeed, 0)
      } else {
        const newRotSpeed = this.accessory.context.cacheLastOnMode * 20
        this.service.setCharacteristic(this.C.RotationSpeed, newRotSpeed)
      }
      if (!this.disableDeviceLogging) {
        this.log('[%s] setting active to [%s].', this.dName, value)
      }
    } catch (err) {
      const errToShow = this.debug ? '\n' + err : err.message
      this.log.warn('[%s] setting active to [%s] error: %s.', this.dName, value, errToShow)
      this.log.warn('[%s] reverting HomeKit status due to error.', this.dName)
      await this.funcs.sleep(1000)
      this.service.updateCharacteristic(this.C.Active, prevState)
    }
  }

  async internalTargetHumidityUpdate (value, callback) {
    let prevState
    let newValue = 45
    try {
      prevState = this.service.getCharacteristic(this.C.RelativeHumidityHumidifierThreshold).value
      callback()
      if (value >= 47 && value < 52) {
        newValue = 50
      } else if (value >= 52 && value < 57) {
        newValue = 55
      } else if (value >= 57 && value < 80) {
        newValue = 60
      } else if (value >= 80) {
        newValue = 100
      }
      if (value === prevState) {
        return
      }
      const updateKeyHumi = Math.random().toString(36).substr(2, 8)
      this.updateKeyHumi = updateKeyHumi
      await this.funcs.sleep(500)
      if (updateKeyHumi !== this.updateKeyHumi) {
        return
      }
      await this.sendDeviceUpdate({
        DesiredHumidity: this.hToWemoFormat[newValue]
      })
      this.service.updateCharacteristic(this.C.RelativeHumidityHumidifierThreshold, newValue)
      if (!this.disableDeviceLogging) {
        this.log('[%s] setting target humidity to [%s%].', this.dName, newValue)
      }
    } catch (err) {
      try {
        const errToShow = this.debug ? '\n' + err : err.message
        this.log.warn('[%s] setting target humidity to [%s%] error: %s.', this.dName, newValue, errToShow)
        this.log.warn('[%s] reverting HomeKit status due to error.', this.dName)
        await this.funcs.sleep(1000)
        this.service.updateCharacteristic(this.C.RelativeHumidityHumidifierThreshold, prevState)
      } catch (e) {}
    }
  }

  async internalModeUpdate (value, callback) {
    let prevActiveState
    let prevRotSpeedState
    let newValue = 0
    try {
      prevActiveState = this.service.getCharacteristic(this.C.Active).value
      prevRotSpeedState = this.service.getCharacteristic(this.C.RotationSpeed).value
      callback()
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
        FanMode: newValue.toString()
      })
      if (newValue !== 0) {
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
        await this.funcs.sleep(1000)
        this.service.updateCharacteristic(this.C.Active, prevActiveState)
        this.service.updateCharacteristic(this.C.RotationSpeed, prevRotSpeedState)
      } catch (e) {}
    }
  }

  externalModeUpdate (value) {
    try {
      const rotSpeed = value * 20
      this.service.updateCharacteristic(this.C.Active, value !== 0)
      this.service.updateCharacteristic(this.C.RotationSpeed, rotSpeed)
      if (value !== 0) {
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

  externalCurrentHumidityUpdate (value) {
    try {
      const tempState = this.service.getCharacteristic(this.C.CurrentRelativeHumidity).value
      if (tempState !== value) {
        this.service.updateCharacteristic(this.C.CurrentRelativeHumidity, value)
        if (!this.disableDeviceLogging) {
          this.log('[%s] updating current humidity to [%s%].', this.dName, value)
        }
      }
    } catch (err) {
      const errToShow = this.debug ? '\n' + err : err.message
      this.log.warn('[%s] updating current humidity to [%s%] error: %s.', this.dName, value, errToShow)
    }
  }

  externalTargetHumidityUpdate (value) {
    try {
      value = this.wemoFormatToH[value]
      const tempState = this.service.getCharacteristic(this.C.RelativeHumidityHumidifierThreshold).value
      if (tempState !== value) {
        this.service.updateCharacteristic(this.C.RelativeHumidityHumidifierThreshold, value)
        if (!this.disableDeviceLogging) {
          this.log('[%s] updating target humidity to [%s%].', this.dName, value)
        }
      }
    } catch (err) {
      const errToShow = this.debug ? '\n' + err : err.message
      this.log.warn('[%s] updating target humidity to [%s%] error: %s.', this.dName, value, errToShow)
    }
  }
}
