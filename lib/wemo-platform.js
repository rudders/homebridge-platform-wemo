/* jshint -W014, -W033, esversion: 9 */
/* eslint-disable new-cap */
'use strict'
const deviceInsight = require('./device/insight')
const deviceLightDimmer = require('./device/light-dimmer')
const deviceLightSwitch = require('./device/light-switch')
const deviceLink = require('./device/link')
const deviceMakerGarage = require('./device/maker-garage')
const deviceMakerSwitch = require('./device/maker-switch')
const deviceMotion = require('./device/motion')
const deviceSwitch = require('./device/switch')
const helpers = require('./helpers')
const wemoClient = require('./wemo-client/index')
module.exports = class wemoPlatform {
  constructor (log, config, api) {
    if (!log || !api || !config) return
    this.config = config
    this.api = api
    this.log = log
    this.Characteristic = api.hap.Characteristic
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
      if (this.ignoredDevices.includes(device.serialNumber)) return
      let uuid = this.api.hap.uuid.generate(device.UDN)
      if (device.deviceType === helpers.deviceTypes.Bridge) {
        /**************************
        WEMO LINK SUBDEVICE [BULBS]
        **************************/
        try {
          const client = this.wemoClient.client(device)
          client.getsubDevices((err, subdevices) => {
            if (err) {
              this.log.warn('An error occured getsubDevices() - %s.', err)
              return
            }
            if (!subdevices) {
              this.log.warn('An error occured getsubDevices() - subDevices not defined.')
              return
            }
            subdevices.forEach(subdevice => {
              if (this.ignoredDevices.includes(subdevice.deviceId)) return
              uuid = this.api.hap.uuid.generate(subdevice.deviceId)
              accessory = this.devicesInHB.has(uuid)
                ? this.devicesInHB.get(uuid)
                : this.addAccessory(subdevice, false)
              accessory.client = client
              accessory.control = new deviceLink(this, accessory, device, subdevice)
              this.devicesInHB.set(uuid, accessory)
            })
          })
        } catch (err) {
          this.log.warn('[%s] an error occurred requesting subdevices - %s', device.friendlyName, err)
          return
        }
      } else if (device.deviceType === helpers.deviceTypes.Insight) {
        /***********
        WEMO INSIGHT
        ***********/
        accessory = this.devicesInHB.has(uuid)
          ? this.devicesInHB.get(uuid)
          : this.addAccessory(device, true)
        accessory.client = this.wemoClient.client(device)
        accessory.control = new deviceInsight(this, accessory, device)
        this.devicesInHB.set(uuid, accessory)
      } else if (device.deviceType === helpers.deviceTypes.Dimmer) {
        /****************
        WEMO LIGHT DIMMER
        ****************/
        accessory = this.devicesInHB.has(uuid)
          ? this.devicesInHB.get(uuid)
          : this.addAccessory(device, true)
        accessory.client = this.wemoClient.client(device)
        accessory.control = new deviceLightDimmer(this, accessory, device)
        this.devicesInHB.set(uuid, accessory)
      } else if (device.deviceType === helpers.deviceTypes.LightSwitch) {
        /****************
        WEMO LIGHT SWITCH
        ****************/
        accessory = this.devicesInHB.has(uuid)
          ? this.devicesInHB.get(uuid)
          : this.addAccessory(device, true)
        accessory.client = this.wemoClient.client(device)
        accessory.control = new deviceLightSwitch(this, accessory, device)
        this.devicesInHB.set(uuid, accessory)
      } else if (device.deviceType === helpers.deviceTypes.Maker) {
        /*********
        WEMO MAKER
        *********/
        accessory = this.devicesInHB.has(uuid)
          ? this.devicesInHB.get(uuid)
          : this.addAccessory(device, true)
        const usage = helpers.hasProperty(this.makerTypes, device.serialNumber)
          ? ['garageDoor', 'switch'].includes(this.makerTypes[device.serialNumber])
            ? this.makerTypes[device.serialNumber]
            : 'switch'
          : 'switch'
        accessory.client = this.wemoClient.client(device)
        accessory.control = usage === 'switch'
          ? new deviceMakerSwitch(this, accessory, device)
          : new deviceMakerGarage(this, accessory, device)
        this.devicesInHB.set(uuid, accessory)
      } else if ([helpers.deviceTypes.Motion, helpers.deviceTypes.NetCamSensor].includes(device.deviceType)) {
        /*****************
        WEMO MOTION SENSOR
        *****************/
        accessory = this.devicesInHB.has(uuid)
          ? this.devicesInHB.get(uuid)
          : this.addAccessory(device, true)
        accessory.client = this.wemoClient.client(device)
        accessory.control = new deviceMotion(this, accessory, device)
        this.devicesInHB.set(uuid, accessory)
      } else if (device.deviceType === helpers.deviceTypes.Switch) {
        /**********
        WEMO SWITCH
        **********/
        accessory = this.devicesInHB.has(uuid)
          ? this.devicesInHB.get(uuid)
          : this.addAccessory(device, true)
        accessory.client = this.wemoClient.client(device)
        accessory.control = new deviceSwitch(this, accessory, device)
      } else {
        this.log.warn('[%s] is not a supported device type.', device.friendlyName)
        return
      }
      this.log('[%s] initialised from your network.', accessory.displayName)
    } catch (err) {
      this.log.warn('[%s] could not be initialised as %s.', device.friendlyName, err)
    }
  }

  addAccessory (device, isPrimary) {
    try {
      if (this.ignoredDevices.includes(isPrimary ? device.serialNumber : device.deviceId)) return
      const accessory = new this.api.platformAccessory(
        device.friendlyName,
        this.api.hap.uuid.generate(isPrimary ? device.UDN : device.deviceId))
      accessory
        .getService(this.Service.AccessoryInformation)
        .setCharacteristic(this.Characteristic.Manufacturer, 'Belkin Wemo')
        .setCharacteristic(this.Characteristic.Model, isPrimary ? device.modelName : 'LED Bulb (Via Link)')
        .setCharacteristic(this.Characteristic.SerialNumber, isPrimary ? device.serialNumber : device.deviceId)
        .setCharacteristic(this.Characteristic.FirmwareRevision, isPrimary ? device.firmwareVersion : null)
        .setCharacteristic(this.Characteristic.Identify, true)
      accessory.on('identify', (paired, callback) => {
        this.log('[%s] - identify button pressed.', accessory.displayName)
        callback()
      })
      this.api.registerPlatformAccessories('homebridge-platform-wemo', 'BelkinWeMo', [accessory])
      this.log('[%s] added to Homebridge with mac address.', device.friendlyName)
      return accessory
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
