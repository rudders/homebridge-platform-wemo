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
    // *** Disable the plugin if not configured correctly *** \\
    if (!log || !api) {
      return
    }
    try {
      if (!config) {
        throw new Error('Plugin has not been configured')
      }

      // *** Set up our variables *** \\
      this.config = config
      this.api = api
      this.log = log
      this.helpers = require('./utils/helpers')
      this.debug = config.debug
      this.eveService = require('./fakegato/fakegato-history')(api)
      this.devicesInHB = new Map()
      this.discoveryRun = 0
      this.devicesToConnect = {}
      this.deviceClients = {}
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
      this.wemoOutlets = {}

      // *** Deprecated Setting *** \\
      if (config.outletAsSwitch && config.outletAsSwitch.length > 0) {
        config.outletAsSwitch.split(',').forEach(sn => {
          this.wemoOutlets[sn.replace(/[\s'"]+/g, '').toUpperCase()] = {
            showAsSwitch: true
          }
        })
      }
      // *** End Deprecated Setting *** \\

      ;(Array.isArray(config.wemoOutlets) ? config.wemoOutlets : [])
        .filter(x => x.serialNumber && x.serialNumber.length > 0)
        .forEach(x => {
          this.wemoOutlets[x.serialNumber.replace(/[\s'"]+/g, '').toUpperCase()] = {
            showAsSwitch: x.showAsSwitch || false
          }
        })
      this.wemoInsights = {}
      ;(Array.isArray(config.wemoInsights) ? config.wemoInsights : [])
        .filter(x => x.serialNumber && x.serialNumber.length > 0)
        .forEach(x => {
          this.wemoInsights[x.serialNumber.replace(/[\s'"]+/g, '').toUpperCase()] = {
            showTodayTC: x.showTodayTC,
            wattDiff: x.wattDiff
          }
        })
      this.wemoMakers = {}
      ;(Array.isArray(config.makerTypes) ? config.makerTypes : [])
        .filter(x => x.serialNumber && x.serialNumber.length > 0)
        .forEach(x => {
          this.wemoMakers[x.serialNumber.replace(/[\s'"]+/g, '').toUpperCase()] = {
            showAsGarage: x.makerType === 'garageDoor',
            timer: x.makerTimer
          }
        })
      this.wemoMotions = {}
      ;(Array.isArray(config.wemoMotions) ? config.wemoMotions : [])
        .filter(x => x.serialNumber && x.serialNumber.length > 0)
        .forEach(x => {
          this.wemoMotions[x.serialNumber.replace(/[\s'"]+/g, '').toUpperCase()] = x.noMotionTimer
        })

      // *** Deprecated Settings *** \\
      this.doorOpenTimer = parseInt(config.doorOpenTimer)
      this.doorOpenTimer = isNaN(this.doorOpenTimer) || this.doorOpenTimer < 0
        ? this.helpers.defaults.doorOpenTimer
        : this.doorOpenTimer
      this.noMotionTimer = parseInt(config.noMotionTimer)
      this.noMotionTimer = isNaN(this.noMotionTimer) || this.noMotionTimer < 0
        ? this.helpers.defaults.noMotionTimer
        : this.noMotionTimer
      // *** End Deprecated Settings *** \\

      this.listenerOpts = config.wemoClient || {}
      this.listenerPort = this.listenerOpts.port || 0
      this.listenerInterface = this.listenerOpts.listen_interface
      this.ssdpOpts = this.listenerOpts.discover_opts || {}
      if (!this.helpers.hasProperty(this.ssdpOpts, 'explicitSocketBind')) {
        this.ssdpOpts.explicitSocketBind = true
      }
      this.eveLogPath = api.user.storagePath() + '/persist/'

      // *** Set up Homebridge API events *** \\
      this.api.on('didFinishLaunching', this.wemoSetup.bind(this))
      this.api.on('shutdown', this.wemoShutdown.bind(this))
    } catch (err) {
      const errToShow = err.message + (err.lineNumber ? ' [line ' + err.lineNumber + ']' : '')
      log.warn('*** Disabling plugin [v%s] ***', PLUGIN.version)
      log.warn('*** %s. ***', errToShow)
    }
  }

  wemoSetup () {
    try {
      // *** Check to see if the user has disabled the plugin *** \\
      if (this.config.disablePlugin) {
        this.devicesInHB.forEach(a => this.removeAccessory(a))
        throw new Error('To change this, set disablePlugin to false')
      }
      this.log('Plugin [v%s] initialised. Setting up device discovery...', PLUGIN.version)

      // *** this.devicesInHB is our map of restored accessories *** \\
      this.devicesInHB.forEach(accessory => {
        // *** Check to see if we need to remove it from the cache *** \\
        if (
          this.ignoredDevices.includes(accessory.context.serialNumber) ||
          (this.config.removeByName || '').split(',').includes(accessory.displayName)
        ) {
          this.removeAccessory(accessory)
          return
        }

        // *** Add the accessory to the pending connection list *** \\
        this.devicesToConnect[accessory.UUID] = accessory.displayName

        // *** Update that the device is not yet controllable *** \\
        accessory.context.controllable = false
        this.api.updatePlatformAccessories(PLUGIN.name, PLUGIN.alias, [accessory])
        this.devicesInHB.set(accessory.UUID, accessory)
      })

      // *** Set up the listener server for device notifications *** \\
      this.listenerServer = http.createServer((req, res) => {
        let body = ''
        const udn = req.url.substring(1)
        if (req.method === 'NOTIFY' && this.deviceClients[udn]) {
          // *** A notification from a known device *** \\
          req.on('data', chunk => (body += chunk.toString()))
          req.on('end', () => {
            if (this.debug) {
              this.log('[%s] incoming notification:\n%s', udn, body)
            }

            // *** Send the notification to be dealt with in the device's client *** \\
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

      // *** Start listening on the above created server *** \\
      if (this.listenerInterface) {
        // *** User has defined a specific network interface to listen on *** \\
        this.listenerServer.listen(this.listenerPort, this.getLocalInterfaceAddress(), err => {
          if (err) {
            this.log.warn('Listener server error: %s.', err)
          }
        })
      } else {
        // *** User has not defined a specific network interface to listen on *** \\
        this.listenerServer.listen(this.listenerPort, err => {
          if (err) {
            this.log.warn('Listener server error: %s', err)
          }
        })
      }
      if (this.debug) {
        this.log('Listener server listening on port [%s].', this.listenerServer.address().port)
      }

      // *** Set up the SSDP client if the user has not specified manual devices only *** \\
      if (this.mode === 'auto') {
        this.ssdpClient = new SSDPClient(this.ssdpOpts)
      }

      // *** Log that we are done and show a lovely message from the list *** \\
      this.log('✓ Setup complete. %s', this.helpers.logMessages[Math.floor(Math.random() * this.helpers.logMessages.length)])

      // *** Perform the first discovery run and setup the interval for subsequent runs *** \\
      this.discoverDevices()
      this.interval = setInterval(() => this.discoverDevices(), this.discoveryInterval * 1000)
    } catch (err) {
      // *** An error occurred somewhere so log it *** \\
      const errToShow = err.message + (err.lineNumber ? ' [line ' + err.lineNumber + ']' : '')
      this.log.warn('*** Disabling plugin [v%s] ***', PLUGIN.version)
      this.log.warn('*** %s ***', errToShow)

      // *** Plugin failed to initialise so undo anything that has been setup *** \\
      this.wemoShutdown()
    }
  }

  wemoShutdown () {
    try {
      // *** Stop the discovery interval if it's running *** \\
      if (this.interval) {
        clearInterval(this.interval)
      }

      // Shutdown the listener server if it's running *** \\
      if (this.listenerServer) {
        this.listenerServer.close(() => {
          if (this.debug) {
            this.log('Listener server gracefully closed.')
          }
        })
      }

      // Stop the SSDP client if it's running *** \\
      if (this.ssdpClient) {
        this.ssdpClient.stop()
        if (this.debug) {
          this.log('SSDP client gracefully stopped.')
        }
      }
    } catch (err) {
      // *** Suppress any errors on shutdown *** \\
    }
  }

  discoverDevices () {
    this.discoveryRun++

    /**************************
    MANUALLY CONFIGURED DEVICES
    **************************/
    this.manualDevices.forEach(async deviceURL => {
      try {
        // *** Check to see if it is a full address or just an IP *** \\
        if (deviceURL.includes(':')) {
          // *** It's a full address so send it straight to load *** \\
          this.loadDevice(deviceURL, true)
        } else {
          // *** It's an IP so perform a port scan *** \\
          const port = await portScanner.findAPortInUse(this.helpers.portsToScan, deviceURL)

          // *** It's found an open port so send it to load *** \\
          this.loadDevice('http://' + deviceURL + ':' + port + '/setup.xml', true)
        }
      } catch (err) {
        // *** Show errors on runs 1, 2, 5, 8, 11, ... just to limit logging to an extent *** \\
        if (this.discoveryRun === 1 || this.discoveryRun % 3 === 2) {
          const errToShow = this.debug
            ? ':\n' + err
            : ' ' + err.message + (err.lineNumber ? ' [line ' + err.lineNumber + '].' : '')
          this.log.warn('[%s] connection error:%s', deviceURL, errToShow)
        }
      }
    })
    /*************************/

    /*********************
    AUTO DISCOVERY DEVICES
    *********************/
    if (this.mode === 'auto') {
      // *** Set up the listener for a detected device *** \\
      this.ssdpClient.removeAllListeners('response')
      this.ssdpClient.on('response', (msg, statusCode, rinfo) => {
        if (msg.ST === 'urn:Belkin:service:basicevent:1') {
          this.loadDevice(msg.LOCATION, false)
        }
      })

      // *** Search for Belkin Wemo service types *** \\
      this.ssdpClient.search('urn:Belkin:service:basicevent:1')
    }
    /********************/

    // *** Log pending devices on every third discovery run to limit logging to an extent *** \\
    if (this.discoveryRun % 3 !== 2) {
      return
    }

    // *** Loop through the devices that are pending (re)connection and log *** \\
    for (const i in this.devicesToConnect) {
      if (!this.helpers.hasProperty(this.devicesToConnect, i)) {
        continue
      }
      this.log.warn('[%s] awaiting (re)connection, will retry in %s seconds.', this.devicesToConnect[i], this.discoveryInterval)
    }
  }

  async loadDevice (setupUrl, manual) {
    // *** Here we are passed a device URL to setup *** \\
    try {
      const location = new URL(setupUrl)

      // *** Check to see if an auto discovery device is actually set up manually *** \\
      if (!manual && (this.manualDevices.includes(setupUrl) || this.manualDevices.includes(location.hostname))) {
        return
      }

      // *** Get the device information from the URL *** \\
      const res = await axios.get(setupUrl)

      // *** Parse the XML response from the device *** \\
      const json = await xml2js.parseStringPromise(res.data, { explicitArray: false })
      const device = json.root.device

      // *** Add extra properties to the device variable *** \\
      device.host = location.hostname
      device.port = location.port
      device.callbackURL = 'http://' + this.getLocalInterfaceAddress(location.hostname) + ':' + this.listenerServer.address().port

      // *** If it's a new device or a previously errored device, then initialise into Homebridge *** \\
      if (!this.deviceClients[device.UDN] || this.deviceClients[device.UDN].error) {
        this.initialiseDevice(device)
      }
    } catch (err) {
      // *** Catch any errors during this setup *** \\
      const errToShow = this.debug
        ? '\n' + err
        : ' ' + err.message + (err.lineNumber ? ' [line ' + err.lineNumber + '].' : '')
      this.log.warn('[%s] connection error:%s', setupUrl, errToShow)

      // *** User may have a manual URL setup for which the IP/port has changed *** \\
      if (manual) {
        this.log.warn('The above is a manually loaded device so check the IP and port are correct.')
      }
    }
  }

  async initialiseDevice (device) {
    try {
      let accessory
      let instance

      // *** Generate the uuid for this device from the device UDN *** \\
      const uuid = this.api.hap.uuid.generate(device.UDN)

      // *** Remove the device from the pending connection list *** \\
      delete this.devicesToConnect[uuid]

      // *** No need to add a device that is on the ignore list *** \\
      if (this.ignoredDevices.includes(device.serialNumber)) {
        return
      }

      // *** Set up the client for the device (formerly wemo-client library) *** \\
      this.deviceClients[device.UDN] = new (require('./connection/upnp'))(this, device)

      // *** Get the correct device type instance *** \\
      switch (device.deviceType) {
        // *** WEMO LINK + BULBS *** \\
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
            const eToShow = this.debug
              ? ':\n' + e
              : ' ' + e.message + (e.lineNumber ? ' [line ' + e.lineNumber + '].' : '')
            this.log.warn('[%s] could not request subdevices as%s', device.friendlyName, eToShow)
          }
          return
        }
        case 'urn:Belkin:device:insight:1': {
          // *** WEMO INSIGHT *** \\
          instance = 'insight'
          break
        }
        case 'urn:Belkin:device:dimmer:1': {
          // *** WEMO DIMMER *** \\
          instance = 'dimmer'
          break
        }
        case 'urn:Belkin:device:lightswitch:1': {
          // *** WEMO LIGHT SWITCH *** \\
          instance = 'switch'
          break
        }
        case 'urn:Belkin:device:Maker:1': {
          // *** WEMO MAKER *** \\
          instance = this.wemoMakers[device.serialNumber] && this.wemoMakers[device.serialNumber].showAsGarage
            ? 'maker-garage'
            : 'maker-switch'
          break
        }
        case 'urn:Belkin:device:sensor:1':
        case 'urn:Belkin:device:NetCamSensor:1': {
          // *** WEMO MOTION *** \\
          instance = 'motion'
          break
        }
        case 'urn:Belkin:device:controllee:1':
        case 'urn:Belkin:device:outdoor:1': {
          // *** WEMO SWITCH *** \\
          instance = this.wemoOutlets[device.serialNumber] && this.wemoOutlets[device.serialNumber].showAsSwitch
            ? 'switch'
            : 'outlet'
          break
        }
        case 'urn:Belkin:device:HeaterA:1':
        case 'urn:Belkin:device:HeaterB:1': {
          // *** WEMO HEATER *** \\
          instance = 'heater'
          break
        }
        case 'urn:Belkin:device:Humidifier:1': {
          // *** WEMO HUMIDIFIER *** \\
          instance = 'humidifier'
          break
        }
        case 'urn:Belkin:device:AirPurifier:1': {
          // *** WEMO AIR PURIFIER *** \\
          instance = 'purifier'
          break
        }
        case 'urn:Belkin:device:crockpot:1': {
          // *** WEMO CROCKPOT *** \\
          instance = 'crockpot'
          break
        }
        default: {
          // *** UNSUPPORTED *** \\
          this.log.warn('[%s] is unsupported [%s]. Feel free to create a GitHub issue!', device.friendlyName, device.deviceType)
          return
        }
      }

      // *** Get the corresponding cached accessory or add to Homebridge now *** \\
      if (!(
        accessory = this.devicesInHB.has(uuid)
          ? this.devicesInHB.get(uuid)
          : this.addAccessory(device, true)
      )) {
        return
      }

      // *** Add the device client to accessory *** \\
      accessory.client = this.deviceClients[device.UDN]

      // *** Create the device type instance *** \\
      accessory.control = new (require('./device/' + instance))(this, accessory, device)

      // *** Add context info which is used for the Homebridge UI plugin settings screen *** \\
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

      // *** Update this information into Homebridge *** \\
      this.api.updatePlatformAccessories(PLUGIN.name, PLUGIN.alias, [accessory])
      this.devicesInHB.set(uuid, accessory)

      // *** Log the successfully initialised device... phew! *** \\
      this.log(
        '[%s] initialised with s/n %s and mac address %s.',
        accessory.displayName,
        device.serialNumber,
        accessory.context.macAddress
      )

      // *** Listen for any errors on the device client *** \\
      this.deviceClients[device.UDN].on('error', err => {
        if (!err) {
          return
        }
        // *** Log the error immediately *** \\
        const errToShow = this.debug ? '.\n' + err : ' [' + err.code + ': ' + err.message + '].'
        this.log.warn(
          '[%s] reported error and will retry connection within %s seconds%s',
          accessory.displayName,
          this.discoveryInterval,
          errToShow
        )

        // *** Add the device back to the pending connection list and throw away the bad client instance *** \\
        this.devicesToConnect[accessory.UUID] = accessory.displayName
        this.deviceClients[device.UDN] = undefined

        // *** Update the context now the device is uncontrollable again *** \\
        accessory.context.controllable = false
        this.api.updatePlatformAccessories(PLUGIN.name, PLUGIN.alias, [accessory])
        this.devicesInHB.set(uuid, accessory)
      })
    } catch (err) {
      // *** Catch any errors during the process *** \\
      const errToShow = this.debug
        ? ':\n' + err
        : ' ' + err.message + (err.lineNumber ? ' [line ' + err.lineNumber + '].' : '')
      this.log.warn('[%s] could not be initialised as%s', device.friendlyName, errToShow)
    }
  }

  addAccessory (device, isPri) {
    try {
      // *** Make sure we aren't adding an ignored device (this check should be redundant) *** \\
      if (this.ignoredDevices.includes(isPri ? device.serialNumber : device.deviceId)) {
        return
      }

      // *** Add the new accessory to Homebridge *** \\
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

      // *** Add helpful context values to the accessory *** \\
      accessory.context.serialNumber = isPri ? device.serialNumber : device.deviceId

      // *** Register the accessory into Homebridge *** \\
      this.api.registerPlatformAccessories(PLUGIN.name, PLUGIN.alias, [accessory])
      this.log('[%s] has been added to Homebridge.', device.friendlyName)

      // *** Return the new accessory *** \\
      return accessory
    } catch (err) {
      // *** Catch any errors whilst trying to add the accessory *** \\
      const errToShow = this.debug
        ? ':\n' + err
        : ' ' + err.message + (err.lineNumber ? ' [line ' + err.lineNumber + '].' : '')
      this.log.warn('[%s] could not be added to Homebridge as%s', device.friendlyName, errToShow)
      return false
    }
  }

  configureAccessory (accessory) {
    // *** Function is called for each device on HB start *** \\
    try {
      if (!this.log) {
        return
      }

      // *** Add each cached device to our devicesInHB map *** \\
      this.devicesInHB.set(accessory.UUID, accessory)
    } catch (err) {
      const errToShow = this.debug
        ? ':\n' + err
        : ' ' + err.message + (err.lineNumber ? ' [line ' + err.lineNumber + '].' : '')
      this.log.warn('[%s] could not be configured as%s', accessory.displayName, errToShow)
    }
  }

  removeAccessory (accessory) {
    try {
      // *** Unregister the accessory from HB and remove it from our devicesInHB map *** \\
      this.api.unregisterPlatformAccessories(PLUGIN.name, PLUGIN.alias, [accessory])
      this.devicesInHB.delete(accessory.UUID)
      this.log('[%s] has been removed from Homebridge.', accessory.displayName)
    } catch (err) {
      const errToShow = this.debug
        ? ':\n' + err
        : ' ' + err.message + (err.lineNumber ? ' [line ' + err.lineNumber + '].' : '')
      this.log.warn('[%s] could not be removed from Homebridge as%s', accessory.displayName, errToShow)
    }
  }

  getLocalInterfaceAddress (targetNetwork) {
    // *** Get a list of available network interfaces *** \\
    let interfaces = os.networkInterfaces()

    // *** Has the user specified a network interface to listen on? *** \\
    if (this.listenerInterface) {
      // *** Specific interface in config, so check it exists in list *** \\
      if (interfaces[this.listenerInterface]) {
        // *** Filter the interfaces object down to the specific interface *** \\
        interfaces = [interfaces[this.listenerInterface]]
      } else {
        // *** Specified interface doesn't exist *** \\
        return new Error('Unable to find interface ' + this.listenerInterface)
      }
    }

    // *** Get an appropriate IP address for the system *** \\
    const addresses = []
    for (const k in interfaces) {
      if (!this.helpers.hasProperty(interfaces, k)) {
        continue
      }
      for (const k2 in interfaces[k]) {
        if (!this.helpers.hasProperty(interfaces[k], k2)) {
          continue
        }
        const address = interfaces[k][k2]
        if (address.family === 'IPv4' && !address.internal) {
          if (targetNetwork && ip.subnet(address.address, address.netmask).contains(targetNetwork)) {
            // *** Try to find an IP address on the same IP network as a Wemo device's location *** \\
            addresses.unshift(address.address)
          } else {
            addresses.push(address.address)
          }
        }
      }
    }

    // *** Return the IP address *** \\
    return addresses.shift()
  }
}

module.exports = hb => hb.registerPlatform(PLUGIN.alias, WemoPlatform)
