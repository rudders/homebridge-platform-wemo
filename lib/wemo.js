'use strict'
let Accessory, Characteristic, EveService, Service, UUIDGen
const constants = require('./constants')
const hbLib = require('homebridge-lib')
const WemoClient = require('wemo-client')
const WemoAcc = require('./wemoAcc')
const WemoLinkAcc = require('./wemoLinkAcc')
class Wemo {
  constructor (log, config, api) {
    if (!log || !api || !config) return
    this.config = config
    this.api = api
    this.log = log
    this.debug = this.config.debug || false
    this.wemoClient = new WemoClient(this.config.wemoClient || {})
    if (this.config.ignoredDevices && this.config.ignoredDevices.constructor !== Array) {
      delete this.config.ignoredDevices
    }
    if (this.config.manualDevices && this.config.manualDevices.constructor !== Array) {
      delete this.config.manualDevices
    }
    this.ignoredDevices = this.config.ignoredDevices || []
    this.manualDevices = this.config.manualDevices || []
    this.accessories = {}
    this.config.doorOpenTimer = this.config.doorOpenTimer || 20
    this.config.noMotionTimer = this.config.noMotionTimer || this.config.no_motion_timer || 60
    this.api.on('didFinishLaunching', () => this.wemoSetup())
  }

  wemoSetup () {
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
        this.wemoClient.discover((err, device) => {
          if (err) {
            this.log.warn('wemoClient.discover() error - %s', err)
            return
          }
          this.addDiscoveredDevice(device)
        })
      }, (this.config.discoveryInterval || 30) * 1000)
    }
    this.manualDevices.forEach(device => {
      this.wemoClient.load(
        device,
        (err, device) => {
          if (err) {
            this.log.warn('wemoClient.discover() error - %s', err)
            return
          }
          this.addDiscoveredDevice(device)
        }
      )
    })
  }

  addDiscoveredDevice (device) {
    if (!device) return
    let uuid = UUIDGen.generate(device.UDN)
    let accessory
    if (device.deviceType === WemoClient.DEVICE_TYPE.Bridge) {
      //* ** BRIDGED DEVICE ***\\
      const client = this.wemoClient.client(device)
      client.getEndDevices((err, enddevices) => {
        if (err) {
          this.log.warn('An error occured getEndDevices() - %s.', err)
          return
        }
        for (let i = 0, tot = enddevices.length; i < tot; i++) {
          uuid = UUIDGen.generate(enddevices[i].deviceId)
          accessory = this.accessories[uuid]
          if (this.ignoredDevices.includes(device.serialNumber)) {
            if (accessory !== undefined) this.removeAccessory(accessory)
            return
          }
          if (accessory === undefined) {
            this.log('[%s] found and adding to HB [bridged device].', device.friendlyName)
            this.addLinkAccessory(device, enddevices[i])
          } else if (accessory instanceof WemoLinkAcc) {
            this.log('[%s] is back online [bridged device].', accessory.displayName)
            accessory.setupDevice(device, enddevices[i])
            accessory.observeDevice()
          } else {
            this.log('[%s] initialised from the HB cache [bridged device].', accessory.displayName)
            this.accessories[uuid] = new WemoLinkAcc(this, accessory, device, enddevices[i])
          }
        }
      })
    } else {
      //* ** NON-BRIDGED DEVICE ***\\
      accessory = this.accessories[uuid]
      if (this.ignoredDevices.includes(device.serialNumber)) {
        if (accessory !== undefined) this.removeAccessory(accessory)
        return
      }
      if (accessory === undefined) {
        this.log('[%s] found and adding to HB with mac address [%s].', device.friendlyName, device.macAddress)
        this.addAccessory(device)
      } else if (accessory instanceof WemoAcc) {
        this.log('[%s] is back online with mac address [%s].', accessory.displayName, device.macAddress)
        accessory.setupDevice(device)
        accessory.observeDevice(device)
      } else {
        this.log('[%s] initialised from the HB cache with mac address [%s].', accessory.displayName, device.macAddress)
        this.accessories[uuid] = new WemoAcc(this, accessory, device)
      }
    }
  }

  addAccessory (device) {
    let serviceType
    switch (device.deviceType) {
      case WemoClient.DEVICE_TYPE.Insight:
      case WemoClient.DEVICE_TYPE.Switch:
        serviceType = Service.Outlet
        break
      case WemoClient.DEVICE_TYPE.LightSwitch:
        serviceType = Service.Switch
        break
      case WemoClient.DEVICE_TYPE.Dimmer:
        serviceType = Service.Lightbulb
        break
      case WemoClient.DEVICE_TYPE.Motion:
      case 'urn:Belkin:device:NetCamSensor:1':
        serviceType = Service.MotionSensor
        break
      case WemoClient.DEVICE_TYPE.Maker:
        serviceType = Service.Switch
        break
      default:
        this.log.warn('[%s] is not supported by this plugin - device type [%s].', device.friendlyName, device.deviceType)
        return
    }
    try {
      const accessory = new Accessory(device.friendlyName, UUIDGen.generate(device.UDN))
      const service = accessory.addService(serviceType)
      switch (device.deviceType) {
        case WemoClient.DEVICE_TYPE.Insight:
          service.addCharacteristic(EveService.Characteristics.CurrentConsumption)
          service.addCharacteristic(EveService.Characteristics.TotalConsumption)
          break
        case WemoClient.DEVICE_TYPE.Dimmer:
          service.addCharacteristic(Characteristic.Brightness)
          break
      }
      this.api.registerPlatformAccessories('homebridge-platform-wemo', 'BelkinWeMo', [accessory])
      this.accessories[accessory.UUID] = new WemoAcc(this, accessory, device)
    } catch (err) {
      this.log.warn('[%s] was not added to Homebridge as %s.', device.friendlyName, this.debug ? err : err.message)
    }
  }

  addLinkAccessory (link, device) {
    try {
      const accessory = new Accessory(device.friendlyName, UUIDGen.generate(device.deviceId))
      const service = accessory.addService(Service.Lightbulb)
      service.addCharacteristic(Characteristic.Brightness)
      if (device.capabilities[constants.linkAcc.temperature] !== undefined) {
        service.addCharacteristic(Characteristic.ColorTemperature)
      }
      this.accessories[accessory.UUID] = new WemoLinkAcc(this, accessory, link, device)
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
module.exports = function (homebridge) {
  Accessory = homebridge.platformAccessory
  Characteristic = homebridge.hap.Characteristic
  EveService = new hbLib.EveHomeKitTypes(homebridge)
  Service = homebridge.hap.Service
  UUIDGen = homebridge.hap.uuid
  return Wemo
}
