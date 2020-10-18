/* jshint -W014, -W033, esversion: 9 */
/* eslint-disable new-cap */
'use strict'
const deviceLink = require('./device-link')
const deviceStandard = require('./device-standard')
const helpers = require('./helpers')
const hbLib = require('homebridge-lib')
const wemoClient = require('wemo-client')
module.exports = class wemoPlatform {
  constructor (log, config, api) {
    if (!log || !api || !config) return
    this.config = config
    this.api = api
    this.log = log
    this.Characteristic = api.hap.Characteristic
    this.EveCharacteristics = new hbLib.EveHomeKitTypes(api).Characteristics
    this.Service = api.hap.Service
    this.accessories = {}
    this.debug = config.debug || false
    this.refreshFlag = true
    this.wemoClient = new wemoClient(config.wemoClient || {})
    this.ignoredDevices = Array.isArray(config.ignoredDevices) ? config.ignoredDevices : []
    this.manualDevices = Array.isArray(config.manualDevices) ? config.manualDevices : []
    this.doorOpenTimer = parseInt(config.doorOpenTimer)
    this.doorOpenTimer = isNaN(this.doorOpenTimer)
      ? helpers.doorOpenTimer
      : this.doorOpenTimer < 0
        ? helpers.doorOpenTimer
        : this.doorOpenTimer
    this.noMotionTimer = parseInt(config.noMotionTimer)
    this.noMotionTimer = isNaN(this.noMotionTimer)
      ? helpers.noMotionTimer
      : this.noMotionTimer < 0
        ? helpers.noMotionTimer
        : this.noMotionTimer
    this.discoveryInterval = parseInt(config.discoveryInterval)
    this.discoveryInterval = isNaN(this.discoveryInterval)
      ? helpers.discoveryInterval
      : this.discoveryInterval <= 0
        ? helpers.discoveryInterval
        : this.discoveryInterval
    this.api
      .on('didFinishLaunching', () => this.wemoSetup())
      .on('shutdown', () => this.wemoShutdown())
  }

  wemoSetup () {
    if (this.config.disablePlugin) {
      Object.values(this.accessories).forEach(a => this.removeAccessory(a))
      this.log.warn('****** Not loading homebridge-platform-wemo ******')
      this.log.warn('*** To change this, set disablePlugin to false ***')
      return
    }
    this.log('Plugin has finished initialising. Finding devices to add to Homebridge.')
    if (!this.config.disableDiscovery) {
      this.wemoClient.discover((err, device) => {
        if (err) {
          this.log.warn('wemoClient.discover() error - %s', err)
          return
        }
        this.addDiscoveredDevice(device)
      })
      setInterval(() => {
        if (this.refreshFlag) {
          this.wemoClient.discover((err, device) => {
            if (err) {
              this.log.warn('wemoClient.discover() error - %s', err)
              return
            }
            this.addDiscoveredDevice(device)
          })
        }
      }, this.discoveryInterval * 1000)
    }
    this.manualDevices.forEach(device => {
      this.wemoClient.load(
        device,
        (err, device) => {
          if (err) {
            this.log.warn('wemoClient.load() error - %s', err)
            return
          }
          this.addDiscoveredDevice(device)
        }
      )
    })
  }

  wemoShutdown () {
    this.refreshFlag = false
  }

  addDiscoveredDevice (device) {
    if (!device) return
    let uuid = this.api.hap.uuid.generate(device.UDN)
    let accessory
    if (device.deviceType === helpers.deviceTypes.Bridge) {
      // *** WEMO LINK DEVICE *** \\
      const client = this.wemoClient.client(device)
      client.getEndDevices((err, enddevices) => {
        if (err) {
          this.log.warn('An error occured getEndDevices() - %s.', err)
          return
        }
        if (!enddevices) {
          this.log.warn('An error occured getEndDevices() - enddevices not defined.')
          return
        }
        for (let i = 0, tot = enddevices.length; i < tot; i++) {
          uuid = this.api.hap.uuid.generate(enddevices[i].deviceId)
          accessory = this.accessories[uuid]
          if (this.ignoredDevices.includes(device.serialNumber)) {
            if (accessory) this.removeAccessory(accessory)
            return
          }
          if (!accessory) {
            this.log('[%s] found and adding to HB [link device].', device.friendlyName)
            this.addLinkAccessory(device, enddevices[i])
          } else if (accessory instanceof deviceLink) {
            this.log('[%s] is back online [link device].', accessory.displayName)
            accessory.setupDevice(device, enddevices[i])
            accessory.observeDevice()
          } else {
            this.log('[%s] initialised from the HB cache [link device].', accessory.displayName)
            this.accessories[uuid] = new deviceLink(this, accessory, device, enddevices[i])
          }
        }
      })
    } else {
      // *** WEMO STANDARD DEVICE *** \\
      accessory = this.accessories[uuid]
      if (this.ignoredDevices.includes(device.serialNumber)) {
        if (accessory) this.removeAccessory(accessory)
        return
      }
      if (!accessory) {
        this.log('[%s] found and adding to HB with mac address [%s].', device.friendlyName, device.macAddress)
        this.addStandardAccessory(device)
      } else if (accessory instanceof deviceStandard) {
        this.log('[%s] is back online with mac address [%s].', accessory.displayName, device.macAddress)
        accessory.setupDevice(device)
        accessory.observeDevice(device)
      } else {
        this.log('[%s] initialised from the HB cache with mac address [%s].', accessory.displayName, device.macAddress)
        this.accessories[uuid] = new deviceStandard(this, accessory, device)
      }
    }
  }

  addStandardAccessory (device) {
    let serviceType
    switch (device.deviceType) {
      case helpers.deviceTypes.Insight:
      case helpers.deviceTypes.Switch:
        serviceType = this.Service.Outlet
        break
      case helpers.deviceTypes.LightSwitch:
        serviceType = this.Service.Switch
        break
      case helpers.deviceTypes.Dimmer:
        serviceType = this.Service.Lightbulb
        break
      case helpers.deviceTypes.Motion:
      case helpers.deviceTypes.NetCamSensor:
        serviceType = this.Service.MotionSensor
        break
      case helpers.deviceTypes.Maker:
        serviceType = this.Service.Switch
        break
      default:
        this.log.warn('[%s] is not supported by this plugin - device type [%s].', device.friendlyName, device.deviceType)
        return
    }
    try {
      const accessory = new this.api.platformAccessory(device.friendlyName, this.api.hap.uuid.generate(device.UDN))
      accessory
        .getService(this.Service.AccessoryInformation)
        .setCharacteristic(this.Characteristic.Manufacturer, 'Belkin Wemo')
        .setCharacteristic(this.Characteristic.Model, device.modelName)
        .setCharacteristic(this.Characteristic.SerialNumber, device.serialNumber)
        .setCharacteristic(this.Characteristic.FirmwareRevision, device.firmwareVersion)
        .setCharacteristic(this.Characteristic.Identify, true)
      accessory.on('identify', (paired, callback) => {
        this.log('[%s] - identify button pressed.', accessory.displayName)
        callback()
      })
      accessory.context.deviceType = device.deviceType
      const service = accessory.addService(serviceType)
      switch (device.deviceType) {
        case helpers.deviceTypes.Insight:
          service.addCharacteristic(this.EveCharacteristics.CurrentConsumption)
          service.addCharacteristic(this.EveCharacteristics.TotalConsumption)
          break
        case helpers.deviceTypes.Dimmer:
          service.addCharacteristic(this.Characteristic.Brightness)
          break
      }
      this.api.registerPlatformAccessories('homebridge-platform-wemo', 'BelkinWeMo', [accessory])
      this.accessories[accessory.UUID] = new deviceStandard(this, accessory, device)
    } catch (err) {
      this.log.warn('[%s] was not added to Homebridge as %s.', device.friendlyName, this.debug ? err : err.message)
    }
  }

  addLinkAccessory (link, device) {
    try {
      const accessory = new this.api.platformAccessory(device.friendlyName, this.api.hap.uuid.generate(device.deviceId))
      accessory
        .getService(this.Service.AccessoryInformation)
        .setCharacteristic(this.Characteristic.Manufacturer, 'Belkin Wemo')
        .setCharacteristic(this.Characteristic.Model, 'LED Bulb (Via Link)')
        .setCharacteristic(this.Characteristic.SerialNumber, device.deviceId)
        .setCharacteristic(this.Characteristic.Identify, true)
      accessory.on('identify', (paired, callback) => {
        this.log('[%s] - identify button pressed.', accessory.displayName)
        callback()
      })
      const service = accessory.addService(this.Service.Lightbulb)
      service.addCharacteristic(this.Characteristic.Brightness)
      if (device.capabilities[helpers.linkAcc.temperature]) {
        service.addCharacteristic(this.Characteristic.ColorTemperature)
      }
      this.accessories[accessory.UUID] = new deviceLink(this, accessory, link, device)
      this.api.registerPlatformAccessories('homebridge-platform-wemo', 'BelkinWeMo', [accessory])
    } catch (err) {
      this.log.warn('[%s] was not added to Homebridge as %s.', device.friendlyName, this.debug ? err : err.message)
    }
  }

  configureAccessory (accessory) {
    this.accessories[accessory.UUID] = accessory
  }

  removeAccessory (accessory) {
    try {
      if (this.accessories[accessory.UUID]) {
        delete this.accessories[accessory.UUID]
      }
      this.api.unregisterPlatformAccessories('homebridge-platform-wemo', 'BelkinWeMo', [accessory])
      this.log('[%s] has been removed from Homebridge.', accessory.displayName)
    } catch (err) {
      this.log.warn('[%s] could not be removed from Homebridge as %s.', accessory.displayName, this.debug ? err : err.message)
    }
  }
}
