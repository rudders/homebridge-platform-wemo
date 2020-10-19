/* jshint -W014, -W033, esversion: 9 */
/* eslint-disable new-cap */
'use strict'
const deviceInsight = require('./device/insight')
const deviceLightDimmer = require('./device/light-dimmer')
const deviceLightSwitch = require('./device/light-switch')
const deviceLink = require('./device/link')
const deviceMakerGD = require('./device/maker-gd')
const deviceMakerSwitch = require('./device/maker-switch')
const deviceMotion = require('./device/motion')
const deviceSwitch = require('./device/switch')
const helpers = require('./helpers')
const hbLib = require('homebridge-lib')
const wemoClient = require('./wemo-client/index')
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
    this.devicesInHB = new Map()
    this.refreshFlag = true
    this.wemoClient = new wemoClient(config.wemoClient || {})
    this.ignoredDevices = Array.isArray(config.ignoredDevices) ? config.ignoredDevices : []
    this.manualDevices = Array.isArray(config.manualDevices) ? config.manualDevices : []
    this.makerTypes = {}
    if (this.config.makerTypes) this.config.makerTypes.forEach(x => (this.MakerTypes[x.serialNumber] = x.makerType))
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
      this.devicesInHB.forEach(a => this.removeAccessory(a))
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
        this.initialiseDevice(device)
      })
      setInterval(() => {
        if (this.refreshFlag) {
          this.wemoClient.discover((err, device) => {
            if (err) {
              this.log.warn('wemoClient.discover() error - %s', err)
              return
            }
            this.initialiseDevice(device)
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
          this.initialiseDevice(device)
        }
      )
    })
  }

  wemoShutdown () {
    this.refreshFlag = false
  }

  initialiseDevice (device) {
    try {
      let accessory
      let uuid

      //
      //
      //

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
        uuid = this.api.hap.uuid.generate(device.UDN)
        accessory = this.devicesInHB.has(uuid)
          ? this.devicesInHB.get(uuid)
          : this.addAccessory(device)
        if (!accessory) return
        if (this.ignoredDevices.includes(device.serialNumber)) {
          this.removeAccessory(accessory)
          return
        }
        accessory.client = this.wemoClient.client(device)
        if (device.deviceType === helpers.deviceTypes.Insight) {
          /***********
          WEMO INSIGHT
          ***********/
          accessory.control = new deviceInsight(this, accessory, device)
        } else if (device.deviceType === helpers.deviceTypes.Dimmer) {
          /****************
          WEMO LIGHT DIMMER
          ****************/
          accessory.control = new deviceLightDimmer(this, accessory, device)
        } else if (device.deviceType === helpers.deviceTypes.LightSwitch) {
          /****************
          WEMO LIGHT SWITCH
          ****************/
          accessory.control = new deviceLightSwitch(this, accessory, device)
        } else if (device.deviceType === helpers.deviceTypes.Maker) {
          /*********
          WEMO MAKER
          *********/
          const usage = helpers.hasProperty(this.makerTypes, device.serialNumber)
            ? ['gd', 'switch'].includes(this.makerTypes[device.serialNumber])
              ? this.makerTypes[device.serialNumber]
              : 'switch'
            : 'switch'
          accessory.control = usage === 'switch'
            ? new deviceMakerSwitch(this, accessory, device)
            : new deviceMakerGD(this, accessory, device)
        } else if ([helpers.deviceTypes.Motion, helpers.deviceTypes.NetCamSensor].includes(device.deviceType)) {
          /*****************
          WEMO MOTION SENSOR
          *****************/
          accessory.control = new deviceMotion(this, accessory, device)
        } else if (device.deviceType === helpers.deviceTypes.Switch) {
          /**********
          WEMO SWITCH
          **********/
          accessory.control = new deviceSwitch(this, accessory, device)
        } else {
          this.removeAccessory(accessory)
          this.log.warn('[%s] is not a supported device type.', device.friendlyName)
          return
        }
      }

      this.devicesInHB.set(uuid, accessory)
      this.log('[%s] initialised from your network.', accessory.displayName)
    } catch (err) {
      this.log.warn('[%s] could not be initialised as %s.', device.friendlyName, err)
    }
  }

  addAccessory (device) {
    try {
      if (this.ignoredDevices.includes(device.serialNumber)) return
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
      this.api.registerPlatformAccessories('homebridge-platform-wemo', 'BelkinWeMo', [accessory])
      this.log('[%s] added to Homebridge with mac address [%s].', device.friendlyName, device.macAddress)
      return accessory
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
      // this.accessories[accessory.UUID] = new deviceLink(this, accessory, link, device)
      this.api.registerPlatformAccessories('homebridge-platform-wemo', 'BelkinWeMo', [accessory])
    } catch (err) {
      this.log.warn('[%s] was not added to Homebridge as %s.', device.friendlyName, this.debug ? err : err.message)
    }
  }

  configureAccessory (accessory) {
    if (!this.log) return
    this.devicesInHB.set(accessory.UUID, accessory)
  }

  removeAccessory (accessory) {
    try {
      this.devicesInHB.delete(accessory.UUID)
      this.api.unregisterPlatformAccessories('homebridge-platform-wemo', 'BelkinWeMo', [accessory])
      this.log('[%s] has been removed from Homebridge.', accessory.displayName)
    } catch (err) {
      this.log.warn('[%s] could not be removed from Homebridge as %s.', accessory.displayName, this.debug ? err : err.message)
    }
  }
}
