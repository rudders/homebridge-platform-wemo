/* jshint -W014, -W033, esversion: 9 */
/* eslint-disable new-cap */
'use strict'
const helpers = require('./../helpers')
const xmlbuilder = require('xmlbuilder')
const xml2js = require('xml2js')
module.exports = class deviceLink {
  constructor (platform, accessory, link, device) {
    this.log = platform.log
    this.debug = platform.debug
    this.disableDeviceLogging = platform.config.disableDeviceLogging || false
    this.Service = platform.api.hap.Service
    this.Characteristic = platform.api.hap.Characteristic
    let service
    if (!(service = accessory.getService(this.Service.Lightbulb))) {
      accessory.addService(this.Service.Lightbulb)
      service = accessory.getService(this.Service.Lightbulb)
      service.addCharacteristic(this.Characteristic.Brightness)
      if (device.capabilities[helpers.linkAcc.temperature]) {
        service.addCharacteristic(this.Characteristic.ColorTemperature)
      }
    }
    service
      .getCharacteristic(this.Characteristic.On)
      .on('set', (value, callback) => this.internalSwitchUpdate(value, callback))
    service
      .getCharacteristic(this.Characteristic.Brightness)
      .on('set', (value, callback) => this.internalBrightnessUpdate(value, callback))
    if (device.capabilities[helpers.linkAcc.temperature]) {
      service
        .getCharacteristic(this.Characteristic.ColorTemperature)
        .on('set', (value, callback) => this.internalColourUpdate(value, callback))
    }
    this.accessory = accessory
    this.device = device
    this.client = accessory.client
    this.link = link
    this.getDeviceStatus()
    this.client.on('error', err => this.log.warn('[%s] reported error:\n%s.', accessory.displayName, err))
    this.client.on('statusChange', (deviceId, capabilityId, value) => {
      if (this.device.deviceId !== deviceId) return
      if (this.device.capabilities[capabilityId] === value) return
      this.device.capabilities[capabilityId] = value
      switch (capabilityId) {
        case helpers.linkAcc.switch:
          this.externalSwitchUpdate(parseInt(value))
          break
        case helpers.linkAcc.brightness:
          this.externalBrightnessUpdate(value)
          break
        case helpers.linkAcc.temperature:
          this.externalColourUpdate(value)
          break
        default:
          this.log.warn('Capability [%s] is not implemented.', capabilityId)
      }
    })
  }

  async getDeviceStatus () {
    try {
      const data = await this.client.soapAction('urn:Belkin:service:bridge:1', 'GetDeviceStatus', { DeviceIDs: this.device.deviceId })
      const result = await xml2js.parseStringPromise(data.DeviceStatusList, { explicitArray: false })
      const deviceStatus = result.DeviceStatusList.DeviceStatus
      const capabilities = this.client.mapCapabilities(deviceStatus.CapabilityID, deviceStatus.CapabilityValue)
      if (capabilities[helpers.linkAcc.switch] === undefined || !capabilities[helpers.linkAcc.switch].length) {
        throw new Error('device appears to be offline.')
      }
      this.externalSwitchUpdate(parseInt(capabilities[helpers.linkAcc.switch]))
      this.externalBrightnessUpdate(capabilities[helpers.linkAcc.brightness])
      if (!this.device.capabilities[helpers.linkAcc.temperature]) return
      this.externalColourUpdate(capabilities[helpers.linkAcc.temperature])
    } catch (err) {
      this.log.warn('[%s] wemoClient.getDeviceStatus error - %s.', this.accessory.displayName, err)
    }
  }

  async setDeviceStatus (capability, value) {
    const deviceStatusList = xmlbuilder.create('DeviceStatus', {
      version: '1.0',
      encoding: 'utf-8'
    }).ele({
      IsGroupAction: (this.device.deviceId.length === 10) ? 'YES' : 'NO',
      DeviceID: this.device.deviceId,
      CapabilityID: capability,
      CapabilityValue: value
    }).end()
    await this.client.soapAction('urn:Belkin:service:bridge:1', 'SetDeviceStatus', { DeviceStatusList: { '#text': deviceStatusList } })
  }

  async internalSwitchUpdate (value, callback) {
    const service = this.accessory.getService(this.Service.Lightbulb)
    const prevState = service.getCharacteristic(this.Characteristic.On).value
    try {
      callback()
      await this.setDeviceStatus(helpers.linkAcc.switch, value ? 1 : 0)
      this.device.capabilities[helpers.linkAcc.switch] = value ? 1 : 0
      if (!this.disableDeviceLogging) this.log('[%s] setting state to [%s].', this.accessory.displayName, value ? 'on' : 'off')
    } catch (err) {
      this.log.warn('[%s] setting state to [%s] error:\n%s', this.accessory.displayName, value ? 'on' : 'off', err)
      this.log.warn('[%s] Reverting HomeKit status due to error.', this.accessory.displayName)
      await helpers.sleep(1000)
      service.updateCharacteristic(this.Characteristic.On, prevState)
    }
  }

  async internalBrightnessUpdate (value, callback) {
    const service = this.accessory.getService(this.Service.Lightbulb)
    const prevState = service.getCharacteristic(this.Characteristic.Brightness).value
    try {
      callback()
      const updateKey = Math.random().toString(36).substr(2, 8)
      this.accessory.context.updateKey = updateKey
      await helpers.sleep(250)
      if (updateKey !== this.accessory.context.updateKey) return
      await this.setDeviceStatus(helpers.linkAcc.brightness, value * 2.55)
      this.device.capabilities[helpers.linkAcc.brightness] = value * 2.55
      if (!this.disableDeviceLogging) this.log('[%s] setting brightness to [%s%].', this.accessory.displayName, value)
    } catch (err) {
      this.log.warn('[%s] setting brightness to [%s%] error:\n%s', this.accessory.displayName, value, err)
      this.log.warn('[%s] Reverting HomeKit status due to error.', this.accessory.displayName)
      await helpers.sleep(1000)
      service.updateCharacteristic(this.Characteristic.Brightness, prevState)
    }
  }

  async internalColourUpdate (value, callback) {
    const service = this.accessory.getService(this.Service.Lightbulb)
    const prevState = service.getCharacteristic(this.Characteristic.ColorTemperature).value
    try {
      callback()
      if (value < 154) value = 154
      else if (value > 370) value = 370
      const updateKey = Math.random().toString(36).substr(2, 8)
      this.accessory.context.updateKey = updateKey
      await helpers.sleep(250)
      if (updateKey !== this.accessory.context.updateKey) return
      await this.setDeviceStatus(helpers.linkAcc.temperature, value + ':0')
      this.device.capabilities[helpers.linkAcc.temperature] = value
      if (!this.disableDeviceLogging) {
        this.log('[%s] setting ctemp to [%s / %sK].', this.accessory.displayName, value, this.miredKelvin(value))
      }
    } catch (err) {
      this.log.warn('[%s] setting ctemp [%s / %sK] error - %s', this.accessory.displayName, value, this.miredKelvin(value), err)
      this.log.warn('[%s] Reverting HomeKit status due to error.', this.accessory.displayName)
      await helpers.sleep(1000)
      service.updateCharacteristic(this.Characteristic.ColorTemperature, prevState)
    }
  }

  externalSwitchUpdate (value) {
    try {
      value = value !== 0
      const service = this.accessory.getService(this.Service.Lightbulb)
      const switchState = service.getCharacteristic(this.Characteristic.On).value
      if (switchState !== value) {
        service.updateCharacteristic(this.Characteristic.On, value)
        this.switchState = value
        if (!this.disableDeviceLogging) this.log('[%s] updating state to [%s].', this.accessory.displayName, value ? 'on' : 'off')
      }
    } catch (err) {
      this.log.warn('[%s] updating state to [%s] error - %s', this.accessory.displayName, value ? 'on' : 'off', err)
    }
  }

  externalBrightnessUpdate (value) {
    value = Math.round(value.split(':').shift() / 2.55)
    try {
      const service = this.accessory.getService(this.Service.Lightbulb)
      const brightness = service.getCharacteristic(this.Characteristic.Brightness).value
      if (brightness !== value) {
        service.updateCharacteristic(this.Characteristic.Brightness, value)
        this.brightness = value
        if (!this.disableDeviceLogging) this.log('[%s] updating brightness to [%s%].', this.accessory.displayName, value)
      }
    } catch (err) {
      this.log.warn('[%s] updating brightness to [%s%] error - %s', this.accessory.displayName, value, err)
    }
  }

  externalColourUpdate (value) {
    try {
      const service = this.accessory.getService(this.Service.Lightbulb)
      if (!service.testCharacteristic(this.Characteristic.ColorTemperature) || value === undefined) return
      value = Math.round(value.split(':').shift())
      const temperature = service.getCharacteristic(this.Characteristic.ColorTemperature).value
      if (temperature !== value) {
        service.updateCharacteristic(this.Characteristic.ColorTemperature, value)
        this.temperature = value
        if (!this.disableDeviceLogging) {
          this.log('[%s] updating ctemp to [%s / %sK].', this.accessory.displayName, value, this.miredKelvin(value))
        }
      }
    } catch (err) {
      this.log.warn('[%s] updating ctemp to [%s / %sK].', this.accessory.displayName, value, this.miredKelvin(value), err)
    }
  }

  miredKelvin (value) {
    return Math.round(100000 / (5 * value)) * 50
  }
}
