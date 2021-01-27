/* jshint -W014, -W033, esversion: 9 */
/* eslint-disable new-cap */
'use strict'
const axios = require('axios')
const http = require('http')
const ip = require('ip')
const os = require('os')
const PLUGIN = require('./../package.json')
const portScanner = require('portscanner')
const SSDPClient = require('node-ssdp').Client
const URL = require('url').URL
const xml2js = require('xml2js')
class WemoPlatform {
  constructor (log, config, api) {
    if (!log || !api) {
      return
    }
    try {
      if (!config) {
        throw new Error('Plugin has not been configured')
      }
      this.config = config
      this.api = api
      this.log = log
      this.helpers = require('./utils/helpers')
      this.debug = config.debug
      this.eveService = require('./fakegato/fakegato-history')(api)
      this.devicesInHB = new Map()
      this.discoveryRun = 0
      this.devicesToConnect = {}
      this.mode = ['auto', 'manual'].includes(config.mode) ? config.mode : 'auto'
      this.discoveryInterval = parseInt(config.discoveryInterval)
      this.discoveryInterval = isNaN(this.discoveryInterval) || this.discoveryInterval < 15
        ? this.helpers.defaults.discoveryInterval
        : this.discoveryInterval
      this.manualDevices = Array.isArray(config.manualDevices) ? config.manualDevices : []
      this.ignoredDevices = []
      ;(Array.isArray(config.ignoredDevices) ? config.ignoredDevices : [])
        .forEach(sn => {
          this.ignoredDevices.push(sn.replace(/[\s'"]+/g, '').toUpperCase())
        })
      this.wemoInsights = {}
      ;(Array.isArray(config.wemoInsights) ? config.wemoInsights : [])
        .filter(x => x.serialNumber && x.serialNumber.length > 0)
        .forEach(x => {
          this.wemoInsights[x.serialNumber.replace(/[\s'"]+/g, '').toUpperCase()] = x.showTodayTC
        })
      this.wemoMakers = {}
      ;(Array.isArray(config.makerTypes) ? config.makerTypes : [])
        .filter(x => x.serialNumber && x.serialNumber.length > 0)
        .forEach(x => {
          this.wemoMakers[x.serialNumber.replace(/[\s'"]+/g, '').toUpperCase()] = {
            type: x.makerType,
            timer: x.makerTimer
          }
        })
      this.wemoMotions = {}
      ;(Array.isArray(config.wemoMotions) ? config.wemoMotions : [])
        .filter(x => x.serialNumber && x.serialNumber.length > 0)
        .forEach(x => {
          this.wemoMotions[x.serialNumber.replace(/[\s'"]+/g, '').toUpperCase()] = x.noMotionTimer
        })
      this.doorOpenTimer = parseInt(config.doorOpenTimer)
      this.doorOpenTimer = isNaN(this.doorOpenTimer) || this.doorOpenTimer < 0
        ? this.helpers.defaults.doorOpenTimer
        : this.doorOpenTimer
      this.noMotionTimer = parseInt(config.noMotionTimer)
      this.noMotionTimer = isNaN(this.noMotionTimer) || this.noMotionTimer < 0
        ? this.helpers.defaults.noMotionTimer
        : this.noMotionTimer
      this.listenerOpts = config.wemoClient || {}
      this.ssdpOpts = this.listenerOpts.discover_opts || {}
      if (!this.helpers.hasProperty(this.ssdpOpts, 'explicitSocketBind')) {
        this.ssdpOpts.explicitSocketBind = true
      }
      this.eveLogPath = api.user.storagePath() + '/persist/'
      this.api.on('didFinishLaunching', this.wemoSetup.bind(this))
      this.api.on('shutdown', this.wemoShutdown.bind(this))
    } catch (err) {
      const errToShow = err.message + ' [line ' + err.lineNumber + ']'
      log.warn('*** Disabling plugin [v%s] ***', PLUGIN.version)
      log.warn('*** %s. ***', errToShow)
    }
  }

  wemoSetup () {
    try {
      if (this.config.disablePlugin) {
        this.devicesInHB.forEach(a => this.removeAccessory(a))
        throw new Error('To change this, set disablePlugin to false')
      }
      this.log('Plugin [v%s] initialised. Setting up device discovery...', PLUGIN.version)
      this.devicesInHB.forEach(accessory => {
        if (
          this.ignoredDevices.includes(accessory.context.serialNumber) ||
          (this.config.removeByName || '').split(',').includes(accessory.displayName)
        ) {
          this.removeAccessory(accessory)
        } else {
          this.devicesToConnect[accessory.UUID] = accessory.displayName
          accessory.context.controllable = false
          this.api.updatePlatformAccessories(PLUGIN.name, PLUGIN.alias, [accessory])
          this.devicesInHB.set(accessory.UUID, accessory)
        }
      })
      this.deviceClients = {}
      this.listenerPort = this.listenerOpts.port || 0
      this.listenerInterface = this.listenerOpts.listen_interface
      this.listenerServer = http.createServer((req, res) => {
        let body = ''
        const udn = req.url.substring(1)
        if (req.method === 'NOTIFY' && this.deviceClients[udn]) {
          req.on('data', chunk => (body += chunk.toString()))
          req.on('end', () => {
            if (this.debug) {
              this.log('[%s] incoming notification:\n%s', udn, body)
            }
            this.deviceClients[udn].receiveRequest(body)
            res.writeHead(200)
            res.end()
          })
        } else {
          if (this.debug) {
            this.log('[%s] incoming notification from unknown accessory.', udn)
          }
          res.writeHead(404)
          res.end()
        }
      })
      if (this.listenerInterface) {
        this.listenerServer.listen(this.listenerPort, this.getLocalInterfaceAddress(), err => {
          if (err) {
            this.log.warn('Listener server error: %s.', err)
          }
        })
      } else {
        this.listenerServer.listen(this.listenerPort, err => {
          if (err) {
            this.log.warn('Listener server error: %s', err)
          }
        })
      }
      if (this.debug) {
        this.log('Listener server listening on port [%s].', this.listenerServer.address().port)
      }
      if (this.mode !== 'manual') {
        this.ssdpClient = new SSDPClient(this.ssdpOpts)
      }
      this.log('✓ Setup complete. %s', this.helpers.logMessages[Math.floor(Math.random() * this.helpers.logMessages.length)])
      this.discoverDevices()
      this.interval = setInterval(() => this.discoverDevices(), this.discoveryInterval * 1000)
    } catch (err) {
      const errToShow = err.message + ' [line ' + err.lineNumber + ']'
      this.log.warn('*** Disabling plugin [v%s] ***', PLUGIN.version)
      this.log.warn('*** %s ***', errToShow)
      this.wemoShutdown()
    }
  }

  wemoShutdown () {
    try {
      if (this.interval) {
        clearInterval(this.interval)
      }
      if (this.listenerServer) {
        this.listenerServer.close(() => {
          if (this.debug) {
            this.log('Listener server gracefully closed.')
          }
        })
      }
      if (this.ssdpClient) {
        this.ssdpClient.stop()
        if (this.debug) {
          this.log('SSDP client gracefully stopped.')
        }
      }
    } catch (err) {}
  }

  discoverDevices () {
    this.discoveryRun++
    this.manualDevices.forEach(async deviceURL => {
      try {
        if (deviceURL.includes(':')) {
          this.loadDevice(deviceURL, true)
        } else {
          // *** Perform a port scan *** \\
          const port = await portScanner.findAPortInUse([49152, 49153, 49154], deviceURL)
          this.loadDevice('http://' + deviceURL + ':' + port + '/setup.xml', true)
        }
      } catch (err) {
        if (this.discoveryRun === 1 || this.discoveryRun % 3 === 2) {
          const errToShow = this.debug ? '\n' + err : ' ' + err.message + ' [line ' + err.lineNumber + '].'
          this.log.warn('[%s] connection error:%s', deviceURL, errToShow)
        }
      }
    })
    if (this.mode !== 'manual') {
      this.ssdpClient.removeAllListeners('response')
      this.ssdpClient.on('response', (msg, statusCode, rinfo) => {
        if (msg.ST === 'urn:Belkin:service:basicevent:1' && !this.manualDevices.includes(msg.LOCATION)) {
          this.loadDevice(msg.LOCATION, false)
        }
      })
      this.ssdpClient.search('urn:Belkin:service:basicevent:1')
    }
    if (this.discoveryRun % 3 === 2) {
      // discovery runs 2, 5, 8 - just to limit the logging to an extent
      for (const i in this.devicesToConnect) {
        if (this.helpers.hasProperty(this.devicesToConnect, i)) {
          this.log.warn(
            '[%s] still awaiting (re)connection and will retry in %s seconds.',
            this.devicesToConnect[i],
            this.discoveryInterval
          )
        }
      }
    }
  }

  async loadDevice (setupUrl, manual) {
    try {
      const location = new URL(setupUrl)
      const res = await axios.get(setupUrl)
      const json = await xml2js.parseStringPromise(res.data, { explicitArray: false })
      const device = json.root.device
      device.host = location.hostname
      device.port = location.port
      device.callbackURL = 'http://' + this.getLocalInterfaceAddress(location.hostname) + ':' + this.listenerServer.address().port
      if (!this.deviceClients[device.UDN] || this.deviceClients[device.UDN].error) {
        this.initialiseDevice(device)
      }
    } catch (err) {
      const errToShow = this.debug ? '\n' + err : ' ' + err.message + ' [line ' + err.lineNumber + '].'
      this.log.warn('[%s] connection error:%s', setupUrl, errToShow)
      if (manual) {
        this.log.warn('The above is a manually loaded device so check the IP and port are correct.')
      }
    }
  }

  async initialiseDevice (device) {
    try {
      let accessory
      let instance
      const uuid = this.api.hap.uuid.generate(device.UDN)
      delete this.devicesToConnect[uuid]
      if (this.ignoredDevices.includes(device.serialNumber)) {
        return
      }
      this.deviceClients[device.UDN] = new (require('./connection/upnp'))(this, device)
      switch (device.deviceType) {
        case 'urn:Belkin:device:bridge:1': {
          try {
            const parseDeviceInfo = data => {
              const device = {}
              if (data.GroupID) {
                // *** Treat device group as if it were a single device *** \\
                device.friendlyName = data.GroupName[0]
                device.deviceId = data.GroupID[0]
                const values = data.GroupCapabilityValues[0].split(',')
                device.capabilities = {}
                data.GroupCapabilityIDs[0].split(',').forEach((val, index) => (device.capabilities[val] = values[index]))
              } else {
                // *** Single device *** \\
                device.friendlyName = data.FriendlyName[0]
                device.deviceId = data.DeviceID[0]
                const values = data.CurrentState[0].split(',')
                device.capabilities = {}
                data.CapabilityIDs[0].split(',').forEach((val, index) => (device.capabilities[val] = values[index]))
              }
              return device
            }
            const data = await this.deviceClients[device.UDN].sendRequest(
              'urn:Belkin:service:bridge:1',
              'GetEndDevices',
              {
                DevUDN: device.UDN,
                ReqListType: 'PAIRED_LIST'
              }
            )
            const subdevices = []
            const result = await xml2js.parseStringPromise(data.DeviceLists)
            const deviceInfos = result.DeviceLists.DeviceList[0].DeviceInfos[0].DeviceInfo
            if (deviceInfos) {
              Array.prototype.push.apply(subdevices, deviceInfos.map(parseDeviceInfo))
            }
            if (result.DeviceLists.DeviceList[0].GroupInfos) {
              const groupInfos = result.DeviceLists.DeviceList[0].GroupInfos[0].GroupInfo
              Array.prototype.push.apply(subdevices, groupInfos.map(parseDeviceInfo))
            }
            subdevices.forEach(subdevice => {
              const uuidSub = this.api.hap.uuid.generate(subdevice.deviceId)
              delete this.devicesToConnect[uuidSub]
              if (this.ignoredDevices.includes(subdevice.deviceId)) {
                return
              }
              if (!(
                accessory = this.devicesInHB.has(uuidSub)
                  ? this.devicesInHB.get(uuidSub)
                  : this.addAccessory(subdevice, false)
              )) {
                return
              }
              accessory.client = this.deviceClients[device.UDN]
              accessory.control = new (require('./device/link'))(this, accessory, device, subdevice)
              accessory.context.serialNumber = subdevice.deviceId
              accessory.context.ipAddress = device.host
              accessory.context.port = device.port
              accessory.context.macAddress = device.macAddress.replace(/..\B/g, '$&:')
              accessory.context.icon = device.iconList && device.iconList.icon && device.iconList.icon.url
                ? device.iconList.icon.url
                : false
              accessory.context.controllable = true
              this.api.updatePlatformAccessories(PLUGIN.name, PLUGIN.alias, [accessory])
              this.devicesInHB.set(uuidSub, accessory)
              this.log(
                '[%s] initialised with id %s and mac address %s (link s/n %s).',
                accessory.displayName,
                subdevice.deviceId,
                accessory.context.macAddress,
                device.serialNumber
              )
            })
          } catch (e) {
            const eToShow = this.debug ? ':\n' + e : ' ' + e.message + ' [line ' + e.lineNumber + '].'
            this.log.warn('[%s] could not request subdevices as%s', device.friendlyName, eToShow)
          }
          return
        }
        case 'urn:Belkin:device:insight:1': {
          instance = 'insight'
          break
        }
        case 'urn:Belkin:device:dimmer:1': {
          instance = 'dimmer'
          break
        }
        case 'urn:Belkin:device:lightswitch:1': {
          instance = 'switch'
          break
        }
        case 'urn:Belkin:device:Maker:1': {
          const usage = this.helpers.hasProperty(this.makerTypes, device.serialNumber)
            ? ['garageDoor', 'switch'].includes(this.makerTypes[device.serialNumber].type)
              ? this.makerTypes[device.serialNumber].type
              : 'switch'
            : 'switch'
          instance = usage === 'switch'
            ? 'maker-switch'
            : 'maker-garage'
          break
        }
        case 'urn:Belkin:device:sensor:1':
        case 'urn:Belkin:device:NetCamSensor:1': {
          instance = 'motion'
          break
        }
        case 'urn:Belkin:device:controllee:1':
        case 'urn:Belkin:device:outdoor:1': {
          const usage = this.config.outletAsSwitch || ''
          instance = usage.replace(/[\s'"]+/g, '').toUpperCase().split(',').includes(device.serialNumber)
            ? 'switch'
            : 'outlet'
          break
        }
        case 'urn:Belkin:device:HeaterA:1':
        case 'urn:Belkin:device:HeaterB:1': {
          instance = 'heater'
          break
        }
        case 'urn:Belkin:device:Humidifier:1': {
          instance = 'humidifier'
          break
        }
        case 'urn:Belkin:device:AirPurifier:1': {
          instance = 'purifier'
          break
        }
        case 'urn:Belkin:device:crockpot:1': {
          instance = 'crockpot'
          break
        }
        default: {
          this.log.warn('[%s] is unsupported [%s]. Feel free to create a GitHub issue!', device.friendlyName, device.deviceType)
          return
        }
      }
      if (!(
        accessory = this.devicesInHB.has(uuid)
          ? this.devicesInHB.get(uuid)
          : this.addAccessory(device, true)
      )) {
        return
      }
      accessory.client = this.deviceClients[device.UDN]
      accessory.control = new (require('./device/' + instance))(this, accessory, device)
      accessory.context.serialNumber = device.serialNumber
      accessory.context.ipAddress = device.host
      accessory.context.port = device.port
      accessory.context.macAddress = device.macAddress
        ? device.macAddress.replace(/..\B/g, '$&:')
        : false
      accessory.context.icon = device.iconList && device.iconList.icon && device.iconList.icon.url
        ? device.iconList.icon.url
        : false
      accessory.context.controllable = true
      this.api.updatePlatformAccessories(PLUGIN.name, PLUGIN.alias, [accessory])
      this.devicesInHB.set(uuid, accessory)
      this.log(
        '[%s] initialised with s/n %s and mac address %s.',
        accessory.displayName,
        device.serialNumber,
        accessory.context.macAddress
      )
      this.deviceClients[device.UDN].on('error', err => {
        if (err) {
          const errToShow = this.debug ? '.\n' + err : ' [' + err.code + ': ' + err.message + '].'
          this.log.warn(
            '[%s] reported error and will retry connection within %s seconds%s',
            accessory.displayName,
            this.discoveryInterval,
            errToShow
          )
          this.devicesToConnect[accessory.UUID] = accessory.displayName
          this.deviceClients[device.UDN] = undefined
          accessory.context.controllable = false
          this.api.updatePlatformAccessories(PLUGIN.name, PLUGIN.alias, [accessory])
          this.devicesInHB.set(uuid, accessory)
        }
      })
    } catch (err) {
      const errToShow = this.debug ? ':\n' + err : ' ' + err.message + ' [line ' + err.lineNumber + '].'
      this.log.warn('[%s] could not be initialised as%s', device.friendlyName, errToShow)
    }
  }

  addAccessory (device, isPri) {
    try {
      if (this.ignoredDevices.includes(isPri ? device.serialNumber : device.deviceId)) {
        return
      }
      const newUUID = this.api.hap.uuid.generate(isPri ? device.UDN : device.deviceId)
      const accessory = new this.api.platformAccessory(device.friendlyName, newUUID)
      accessory.getService(this.api.hap.Service.AccessoryInformation)
        .setCharacteristic(this.api.hap.Characteristic.Manufacturer, 'Belkin Wemo')
        .setCharacteristic(this.api.hap.Characteristic.Model, isPri ? device.modelName : 'LED Bulb (Via Link)')
        .setCharacteristic(this.api.hap.Characteristic.SerialNumber, isPri ? device.serialNumber : device.deviceId)
        .setCharacteristic(this.api.hap.Characteristic.FirmwareRevision, isPri ? device.firmwareVersion : null)
        .setCharacteristic(this.api.hap.Characteristic.Identify, true)
      accessory.on('identify', (paired, callback) => {
        callback()
        this.log('[%s] - identify button pressed.', accessory.displayName)
      })
      accessory.context.serialNumber = isPri ? device.serialNumber : device.deviceId
      this.api.registerPlatformAccessories(PLUGIN.name, PLUGIN.alias, [accessory])
      this.log('[%s] has been added to Homebridge.', device.friendlyName)
      return accessory
    } catch (err) {
      const errToShow = this.debug ? ':\n' + err : ' ' + err.message + ' [line ' + err.lineNumber + '].'
      this.log.warn('[%s] could not be added to Homebridge as%s', device.friendlyName, errToShow)
    }
  }

  configureAccessory (accessory) {
    try {
      if (!this.log) {
        return
      }
      this.devicesInHB.set(accessory.UUID, accessory)
    } catch (err) {
      const errToShow = this.debug ? ':\n' + err : ' ' + err.message + ' [line ' + err.lineNumber + '].'
      this.log.warn('[%s] could not be configured as%s', accessory.displayName, errToShow)
    }
  }

  removeAccessory (accessory) {
    try {
      this.devicesInHB.delete(accessory.UUID)
      this.api.unregisterPlatformAccessories(PLUGIN.name, PLUGIN.alias, [accessory])
      this.log('[%s] has been removed from Homebridge.', accessory.displayName)
    } catch (err) {
      const errToShow = this.debug ? ':\n' + err : ' ' + err.message + ' [line ' + err.lineNumber + '].'
      this.log.warn('[%s] could not be removed from Homebridge as%s', accessory.displayName, errToShow)
    }
  }

  getLocalInterfaceAddress (targetNetwork) {
    let interfaces = os.networkInterfaces()
    if (this.listenerInterface) {
      if (interfaces[this.listenerInterface]) {
        interfaces = [interfaces[this.listenerInterface]]
      } else {
        return new Error('Unable to find interface ' + this.listenerInterface)
      }
    }
    const addresses = []
    for (const k in interfaces) {
      if (this.helpers.hasProperty(interfaces, k)) {
        for (const k2 in interfaces[k]) {
          if (this.helpers.hasProperty(interfaces[k], k2)) {
            const address = interfaces[k][k2]
            if (address.family === 'IPv4' && !address.internal) {
              if (targetNetwork && ip.subnet(address.address, address.netmask).contains(targetNetwork)) {
                addresses.unshift(address.address)
              } else {
                addresses.push(address.address)
              }
            }
          }
        }
      }
    }
    return addresses.shift()
  }
}

module.exports = hb => hb.registerPlatform(PLUGIN.alias, WemoPlatform)
