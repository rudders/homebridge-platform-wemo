/* jshint -W014, -W033, esversion: 9 */
/* eslint-disable new-cap */
'use strict'

// Packages and constant variables for this class
const axios = require('axios')
const deviceClients = {}
const devicesInHB = new Map()
const devicesToConnect = {}
const http = require('http')
const ip = require('ip')
const os = require('os')
const plugin = require('./../package.json')
const { default: PQueue } = require('p-queue')
const queue = new PQueue({
  interval: 250,
  intervalCap: 1
})
const ssdp = require('node-ssdp').Client
const url = require('url').URL
const xml2js = require('xml2js')

// Variables for this class to use later
let listenerServer
let ssdpClient

// Create the platform class
class WemoPlatform {
  constructor (log, config, api) {
    // Don't load the plugin if these aren't accessible for any reason
    if (!log || !api) {
      return
    }

    // Begin plugin initialisation
    try {
      this.api = api
      this.consts = require('./utils/constants')
      this.funcs = require('./utils/functions')
      this.log = log

      // Configuration objects for accessories
      this.wemoInsights = {}
      this.wemoLights = {}
      this.wemoMakers = {}
      this.wemoMotions = {}
      this.wemoOthers = {}
      this.wemoOutlets = {}

      // Retrieve the user's chosen language file
      this.lang = require('./utils/lang-en')

      // Make sure user is running Homebridge v1.3 or above
      if (!api.versionGreaterOrEqual || !api.versionGreaterOrEqual('1.3.0')) {
        throw new Error(this.lang.hbVersionFail)
      }

      // Check the user has configured the plugin
      if (!config) {
        throw new Error(this.lang.notConfigured)
      }

      // Apply the user's configuration
      this.config = this.consts.defaultConfig
      this.applyUserConfig(config)

      // Set up the Homebridge events
      this.api.on('didFinishLaunching', () => this.pluginSetup())
      this.api.on('shutdown', () => this.pluginShutdown())
    } catch (err) {
      // Catch any errors during initialisation
      const hideErrLines = [this.lang.hbVersionFail, this.lang.notConfigured]
      const eText = hideErrLines.includes(err.message) ? err.message : this.funcs.parseError(err)
      log.warn('***** %s [v%s]. *****', this.lang.disabling, plugin.version)
      log.warn('***** %s. *****', eText)
    }
  }

  applyUserConfig (config) {
    // These shorthand functions save line space during config parsing
    const logDefault = (k, def) => {
      this.log.warn('%s [%s] %s %s.', this.lang.cfgItem, k, this.lang.cfgDef, def)
    }
    const logIgnore = k => {
      this.log.warn('%s [%s] %s.', this.lang.cfgItem, k, this.lang.cfgIgn)
    }
    const logIgnoreItem = k => {
      this.log.warn('%s [%s] %s.', this.lang.cfgItem, k, this.lang.cfgIgnItem)
    }
    const logIncrease = (k, min) => {
      this.log.warn('%s [%s] %s %s.', this.lang.cfgItem, k, this.lang.cfgLow, min)
    }
    const logQuotes = k => {
      this.log.warn('%s [%s] %s.', this.lang.cfgItem, k, this.lang.cfgQts)
    }
    const logRemove = k => {
      this.log.warn('%s [%s] %s.', this.lang.cfgItem, k, this.lang.cfgRmv)
    }

    // wemoMakers is actually configured as makerTypes
    if (this.funcs.hasProperty(config, 'makerTypes')) {
      config.wemoMakers = config.makerTypes
      delete config.makerTypes
    }

    // Begin applying the user's config
    for (const [key, val] of Object.entries(config)) {
      switch (key) {
        case 'debug':
        case 'debugFakegato':
        case 'disableDeviceLogging':
        case 'disablePlugin':
          if (typeof val === 'string') {
            logQuotes(key)
          }
          this.config[key] = val === 'false' ? false : !!val
          break
        case 'discoveryInterval': {
          if (typeof val === 'string') {
            logQuotes(key)
          }
          const intVal = parseInt(val)
          if (isNaN(intVal)) {
            logDefault(key, this.consts.defaultValues[key])
            this.config[key] = this.consts.defaultValues[key]
          } else if (intVal < this.consts.minValues[key]) {
            logIncrease(key, this.consts.minValues[key])
            this.config[key] = this.consts.minValues[key]
          } else {
            this.config[key] = intVal
          }
          break
        }
        case 'ignoredDevices': {
          if (Array.isArray(val)) {
            if (val.length > 0) {
              val.forEach(serialNumber => {
                this.config.ignoredDevices.push(
                  serialNumber
                    .toString()
                    .toUpperCase()
                    .replace(/[\s'"]+/g, '')
                )
              })
            } else {
              logRemove(key)
            }
          } else {
            logIgnore(key)
          }
          break
        }
        case 'wemoInsights':
        case 'wemoLights':
        case 'wemoMakers':
        case 'wemoMotions':
        case 'wemoOthers':
        case 'wemoOutlets':
          if (Array.isArray(val) && val.length > 0) {
            val.forEach(x => {
              if (!x.serialNumber) {
                logIgnoreItem(key)
                return
              }
              const id = this.funcs.parseSerialNumber(x.serialNumber)
              const entries = Object.entries(x)
              if (entries.length === 1) {
                logRemove(key + '.' + id)
                return
              }
              this[key][id] = {}
              for (const [k, v] of Object.entries(x)) {
                if (!this.consts.allowed[key].includes(k)) {
                  logRemove(key + '.' + id + '.' + k)
                  continue
                }
                switch (k) {
                  case 'adaptiveLightingShift':
                  case 'brightnessStep':
                  case 'makerTimer':
                  case 'noMotionTimer':
                  case 'pollingInterval':
                  case 'timeDiff':
                  case 'wattDiff': {
                    if (typeof v === 'string') {
                      logQuotes(key + '.' + id + '.' + k)
                    }
                    const intVal = parseInt(v)
                    if (isNaN(intVal)) {
                      logDefault(key + '.' + id + '.' + k, this.consts.defaultValues[k])
                      this[key][id][k] = this.consts.defaultValues[k]
                    } else if (intVal < this.consts.minValues[k]) {
                      logIncrease(key + '.' + id + '.' + k, this.consts.minValues[k])
                      this[key][id][k] = this.consts.minValues[k]
                    } else {
                      this[key][id][k] = intVal
                    }
                    break
                  }
                  case 'label':
                  case 'serialNumber':
                    break
                  case 'makerType':
                    this[key][id].showAsGarage = x[k].toString() === 'garageDoor'
                    break
                  case 'overrideDisabledLogging':
                  case 'showAsSwitch':
                  case 'showTodayTC':
                    if (typeof v === 'string') {
                      logQuotes(key + '.' + id + '.' + k)
                    }
                    this[key][id][k] = v === 'false' ? false : !!v
                    break
                  case 'showAsType': {
                    const inSet = ['outlet', 'switch', 'purifier'].includes(v)
                    if (typeof v !== 'string' || !inSet) {
                      logIgnore(key + '.' + id + '.' + k)
                    }
                    this[key][id][k] = inSet ? v : 'outlet'
                    break
                  }
                }
              }
            })
          } else {
            logIgnore(key)
          }
          break
        case 'manualDevices': {
          if (Array.isArray(val)) {
            if (val.length > 0) {
              val.forEach(manualDevice => {
                this.config.manualDevices.push(
                  manualDevice
                    .toString()
                    .toLowerCase()
                    .replace(/[\s'"]+/g, '')
                )
              })
            } else {
              logRemove(key)
            }
          } else {
            logIgnore(key)
          }
          break
        }
        case 'mode': {
          const inSet = ['auto', 'manual'].includes(val)
          if (typeof val !== 'string' || !inSet) {
            logIgnore(key)
          }
          this.config.mode = inSet ? val : 'auto'
          break
        }
        case 'name':
        case 'platform':
        case 'plugin_map':
          break
        case 'removeByName':
          if (typeof val !== 'string' || val === '') {
            logIgnore(key)
          }
          this.config.removeByName = val
          break
        case 'wemoClient':
          if (typeof val === 'object' && Object.keys(val).length > 0) {
            for (const [k1, v1] of Object.entries(val)) {
              switch (k1) {
                case 'discover_opts':
                  if (typeof v1 === 'object' && Object.keys(v1).length > 0) {
                    for (const [k2, v2] of Object.entries(v1)) {
                      switch (k2) {
                        case 'explicitSocketBind':
                          if (typeof v2 === 'string') {
                            logQuotes(key + '.' + k1 + '.' + k2)
                          }
                          this.config[key][k1][k2] = v2 === 'false' ? false : !!v2
                          break
                        case 'interfaces':
                          if (typeof v2 !== 'string' || v2 === '') {
                            logIgnore(key + '.' + k1 + '.' + k2)
                          }
                          this.config[key][k1][k2] = v2.toString()
                          break
                        default:
                          logRemove(key + '.' + k1 + '.' + k2)
                          break
                      }
                    }
                  } else {
                    logIgnore(key + '.' + k1)
                  }
                  break
                case 'listen_interface':
                  if (typeof v1 !== 'string' || v1 === '') {
                    logIgnore(key + '.' + k1)
                  }
                  this.config[key][k1] = v1
                  break
                case 'port': {
                  if (typeof val === 'string') {
                    logQuotes(key + '.' + k1)
                  }
                  const intVal = parseInt(v1)
                  if (isNaN(intVal)) {
                    logDefault(key + '.' + k1, this.consts.defaultValues[k1])
                    this.config[key][k1] = this.consts.defaultValues[k1]
                  } else if (intVal < this.consts.minValues[k1]) {
                    logIncrease(key + '.' + k1, this.consts.minValues[k1])
                    this.config[key][k1] = this.consts.minValues[k1]
                  } else {
                    this.config[key][k1] = intVal
                  }
                  break
                }
                default:
                  logRemove(key + '.' + k1)
                  break
              }
            }
          } else {
            logIgnore(key)
          }
          break
        default:
          logRemove(key)
          break
      }
    }
  }

  pluginSetup () {
    // Plugin has finished initialising so now onto setup
    try {
      // If the user has disabled the plugin then remove all accessories
      if (this.config.disablePlugin) {
        devicesInHB.forEach(accessory => {
          this.removeAccessory(accessory)
        })
        throw new Error(this.lang.disabled)
      }

      // Log that the plugin initialisation has been successful
      this.log('[v%s] %s.', plugin.version, this.lang.initialised)

      // Set up the discovery run counter
      this.discoveryRun = 0

      // Require any libraries that the accessory instances use
      this.eveService = require('./fakegato/fakegato-history')(this.api)
      this.eveChar = new (require('./utils/eve-chars'))(this.api)

      // Configure each accessory restored from the cache
      devicesInHB.forEach(accessory => {
        // If it's in the ignore list or the removeByName option then remove
        if (
          this.config.ignoredDevices.includes(accessory.context.serialNumber) ||
          this.config.removeByName === accessory.displayName
        ) {
          this.removeAccessory(accessory)
          return
        }

        // Add the device to the pending connection list
        devicesToConnect[accessory.UUID] = accessory.displayName

        // Make the accessory show as 'No Response' until it has been discovered
        const services = accessory.services
        services.forEach(service => {
          let charToError
          switch (service.constructor.name) {
            case 'AirPurifier':
            case 'HeaterCooler':
            case 'HumidifierDehumidifier':
              charToError = 'Active'
              break
            case 'GarageDoorOpener':
              charToError = 'TargetDoorState'
              break
            case 'Lightbulb':
            case 'Outlet':
            case 'Switch':
              charToError = 'On'
              break
            default:
              return
          }
          service.updateCharacteristic(
            this.api.hap.Characteristic[charToError],
            new this.api.hap.HapStatusError(-70402)
          )
        })

        // Update the context that the accessory can't be controlled until discovered
        accessory.context.controllable = false

        // Update the changes to the accessory to the platform
        this.api.updatePlatformAccessories(plugin.name, plugin.alias, [accessory])
        devicesInHB.set(accessory.UUID, accessory)
      })

      // Set up the listener server for device notifications
      listenerServer = http.createServer((req, res) => {
        let body = ''
        const udn = req.url.substring(1)
        if (req.method === 'NOTIFY' && deviceClients[udn]) {
          // A notification from a known device
          req.on('data', chunk => {
            body += chunk.toString()
          })
          req.on('end', () => {
            if (this.config.debug) {
              this.log('[%s] %s:\n%s', udn, this.lang.incKnown, body)
            }

            // Send the notification to be dealt with in the device's client
            deviceClients[udn].receiveRequest(body)
            res.writeHead(200)
            res.end()
          })
        } else {
          // A notification from an unknown device
          if (this.config.debug) {
            this.log('[%s] %s.', udn, this.lang.incUnknown)
          }
          res.writeHead(404)
          res.end()
        }
      })

      // Start listening on the above created server
      if (this.config.wemoClient.listen_interface) {
        // User has defined a specific network interface to listen on
        listenerServer.listen(this.config.wemoClient.port, this.getLocalInterfaceAddress(), err => {
          if (err) {
            this.log.warn('%s: %s.', this.lang.listenerError, err)
          } else {
            // Log the port of the listener server in debug mode
            if (this.config.debug) {
              this.log('%s [%s].', this.lang.listenerPort, listenerServer.address().port)
            }
          }
        })
      } else {
        // User has not defined a specific network interface to listen on
        listenerServer.listen(this.config.wemoClient.port, err => {
          if (err) {
            this.log.warn('%s: %s', this.lang.listenerError, err)
          } else {
            // Log the port of the listener server in debug mode
            if (this.config.debug) {
              this.log('%s [%s].', this.lang.listenerPort, listenerServer.address().port)
            }
          }
        })
      }

      // Set up the SSDP client if the user has not specified manual devices only
      if (this.config.mode === 'auto') {
        ssdpClient = new ssdp(this.config.wemoClient.discover_opts)
      }

      // Log that the plugin setup has been successful with a welcome message
      const randIndex = Math.floor(Math.random() * this.lang.zWelcome.length)

      // Set a small timeout so the message should appear after the listener port log entry
      setTimeout(() => {
        this.log('%s. %s', this.lang.complete, this.lang.zWelcome[randIndex])
      }, 2000)

      // Perform the first discovery run and setup the interval for subsequent runs
      this.discoverDevices()
      this.refreshInterval = setInterval(
        () => this.discoverDevices(),
        this.config.discoveryInterval * 1000
      )
    } catch (err) {
      // Catch any errors during setup
      const eText = err.message === this.lang.disabled ? err.message : this.funcs.parseError(err)
      this.log.warn('***** %s [v%s]. *****', this.lang.disabling, plugin.version)
      this.log.warn('***** %s. *****', eText)
      this.pluginShutdown()
    }
  }

  pluginShutdown () {
    try {
      // Stop the discovery interval if it's running
      if (this.refreshInterval) {
        clearInterval(this.refreshInterval)
      }

      // Shutdown the listener server if it's running
      if (listenerServer) {
        listenerServer.close(() => {
          if (this.config.debug) {
            this.log('%s.', this.lang.listenerClosed)
          }
        })
      }

      // Stop the SSDP client if it's running
      if (ssdpClient) {
        ssdpClient.stop()
        if (this.config.debug) {
          this.log('%s.', this.lang.ssdpStopped)
        }
      }
    } catch (err) {
      // No need to show errors at this point
    }
  }

  discoverDevices () {
    // Increment the discovery run count
    this.discoveryRun++

    // ********************* \\
    // Auto Detected Devices \\
    // ********************* \\
    if (this.config.mode === 'auto') {
      // Remove all previous listeners as we don't want duplications on each interval
      ssdpClient.removeAllListeners('response')

      // Set up the listener for a detected device
      ssdpClient.on('response', async (msg, statusCode, rinfo) => {
        // Don't continue if it's not a Wemo device (service type)
        if (msg.ST !== 'urn:Belkin:service:basicevent:1') {
          return
        }

        // Get some information from the USN and location for checks
        const urlParts = new url(msg.LOCATION)
        const usnParts = msg.USN.split('::')
        const deviceIP = urlParts.hostname
        const devicePort = urlParts.port
        const deviceUDN = usnParts[0]
        try {
          // Flags for if the device is manually configured and if the device is ignored
          const manualX = this.config.manualDevices.some(el => el.indexOf(deviceIP) >= 0)
          let ignoreX = false
          this.config.ignoredDevices.forEach(sn => {
            if (deviceUDN.includes(sn)) {
              ignoreX = true
            }
          })

          // Don't continue if either of the above flags are true
          if (manualX || ignoreX) {
            return
          }

          // Don't continue if this device already has a valid client
          if (deviceClients[deviceUDN] && !deviceClients[deviceUDN].error) {
            return
          }

          const deviceData = await this.getDeviceInfo(deviceIP, devicePort)

          // Don't continue if we haven't found the correct port
          if (!deviceData) {
            throw new Error('[' + deviceIP + '] ' + this.lang.noPort)
          }

          // Device doesn't have a valid client so sent it to the queue to load
          queue.add(async () => await this.initialiseDevice(deviceData))
        } catch (e2) {
          // Show warnings on runs 1, 2, 5, 8, 11, ... just to limit logging to an extent
          if (this.discoveryRun === 1 || this.discoveryRun % 3 === 2) {
            const eText = this.funcs.parseError(e2)
            this.log.warn('[%s] %s: %s.', deviceIP, this.lang.connError, eText)
          }
        }
      })

      // Perform the scan
      try {
        ssdpClient.search('urn:Belkin:service:basicevent:1')
      } catch (e) {
        const eText = this.funcs.parseError(e)
        this.log.warn('%s %s.', this.lang.ssdpFail, eText)
      }
    }

    // *************************** \\
    // Manually Configured Devices \\
    // *************************** \\
    this.config.manualDevices.forEach(async device => {
      try {
        // Check to see if the entry is a full address or an IP
        let deviceIP, devicePort
        if (device.includes(':')) {
          // It's a full address so get some information from the address
          const urlParts = new url(device)
          deviceIP = urlParts.hostname
          devicePort = urlParts.port
        } else {
          // It's an IP so perform a port scan
          deviceIP = device
          devicePort = null
        }
        const deviceData = await this.getDeviceInfo(deviceIP, devicePort)

        // Don't continue if we haven't found the correct port
        if (!deviceData) {
          throw new Error('[' + device + '] ' + this.lang.noPort)
        }

        // Send the device to initialise
        queue.add(async () => await this.initialiseDevice(deviceData))
      } catch (err) {
        // Show warnings on runs 1, 2, 5, 8, 11, ... just to limit logging to an extent
        if (this.discoveryRun === 1 || this.discoveryRun % 3 === 2) {
          const eText = this.funcs.parseError(err)
          this.log.warn('[%s] %s: %s.', device, this.lang.connError, eText)
        }
      }
    })

    // ************************ \\
    // Erroneous Device Logging \\
    // ************************ \\
    if (this.discoveryRun % 3 !== 2) {
      return
    }

    // Add a small delay in case devices were discovered on this round
    setTimeout(() => {
      // Loop through the devices that are pending (re)connection and log
      for (const i in devicesToConnect) {
        if (!this.funcs.hasProperty(devicesToConnect, i)) {
          continue
        }
        this.log.warn(
          '[%s] %s %ss.',
          devicesToConnect[i],
          this.lang.awaiting,
          this.config.discoveryInterval
        )
      }
    }, 3000)
  }

  async getDeviceInfo (ip, portToTryFirst) {
    // Try to find the correct port of a device by ip
    // Credit to @Zacknetic for this function
    const tryPort = async (port, ipAddress) => {
      try {
        // Send a request to the device URL to get the XML information
        const res = await axios.get('http://' + ipAddress + ':' + port + '/setup.xml', {
          timeout: 5000
        })

        // Parse the XML response from the device
        const json = await xml2js.parseStringPromise(res.data, { explicitArray: false })
        const device = json.root.device

        // Add extra properties to the device variable
        device.host = ipAddress
        device.port = port
        const intAddr = this.getLocalInterfaceAddress(ipAddress)
        device.cbURL = 'http://' + intAddr + ':' + listenerServer.address().port

        // Return the XML2JS data
        return device
      } catch (err) {
        // Suppress any errors as we don't want to show them
        return false
      }
    }

    // Loop through the ports that Wemo devices generally use
    let portsToTry = this.consts.portsToScan
    if (portToTryFirst) {
      portsToTry = portsToTry.filter(el => el !== portToTryFirst)
      portsToTry.unshift(portToTryFirst)
    }

    for (const port of portsToTry) {
      const portAttempt = await tryPort(port, ip)
      if (portAttempt) {
        // We found the correct port
        return portAttempt
      }
    }

    // None of the ports worked
    return false
  }

  async initialiseDevice (device) {
    try {
      // If it's a new device or a previously errored device then initialise it (again)
      if (deviceClients[device.UDN] && !deviceClients[device.UDN].error) {
        return
      }
      let accessory
      let instance

      // Generate the uuid for this device from the device UDN
      const uuid = this.api.hap.uuid.generate(device.UDN)

      // Remove the device from the pending connection list
      delete devicesToConnect[uuid]

      // Don't continue if the device is on the ignore list
      if (this.config.ignoredDevices.includes(device.serialNumber)) {
        return
      }

      // Set up the client for the device (formerly wemo-client library)
      deviceClients[device.UDN] = new (require('./connection/upnp'))(this, device)

      // Get the correct device type instance
      switch (device.deviceType) {
        // Wemo Link + Bulbs
        case 'urn:Belkin:device:bridge:1': {
          try {
            // A function used later for parsing the device information
            const parseDeviceInfo = data => {
              const device = {}
              if (data.GroupID) {
                // Treat device group as if it were a single device
                device.friendlyName = data.GroupName[0]
                device.deviceId = data.GroupID[0]
                const values = data.GroupCapabilityValues[0].split(',')
                device.capabilities = {}
                data.GroupCapabilityIDs[0].split(',').forEach((val, index) => {
                  device.capabilities[val] = values[index]
                })
              } else {
                // Single device
                device.friendlyName = data.FriendlyName[0]
                device.deviceId = data.DeviceID[0]
                const values = data.CurrentState[0].split(',')
                device.capabilities = {}
                data.CapabilityIDs[0].split(',').forEach((val, index) => {
                  device.capabilities[val] = values[index]
                })
              }
              return device
            }

            // Request a list of subdevices from the Wemo Link
            const data = await deviceClients[device.UDN].sendRequest(
              'urn:Belkin:service:bridge:1',
              'GetEndDevices',
              { DevUDN: device.UDN, ReqListType: 'PAIRED_LIST' }
            )

            // Parse the XML response from the Wemo Link
            const result = await xml2js.parseStringPromise(data.DeviceLists)

            // Create an array of subdevices we can use
            const subdevices = []
            const deviceInfos = result.DeviceLists.DeviceList[0].DeviceInfos[0].DeviceInfo
            if (deviceInfos) {
              Array.prototype.push.apply(subdevices, deviceInfos.map(parseDeviceInfo))
            }
            if (result.DeviceLists.DeviceList[0].GroupInfos) {
              const groupInfos = result.DeviceLists.DeviceList[0].GroupInfos[0].GroupInfo
              Array.prototype.push.apply(subdevices, groupInfos.map(parseDeviceInfo))
            }

            // Loop through the subdevices initialising each one
            subdevices.forEach(subdevice => {
              try {
                // Generate the uuid for this subdevice from the subdevice id
                const uuidSub = this.api.hap.uuid.generate(subdevice.deviceId)

                // Remove the device from the pending connection list
                delete devicesToConnect[uuidSub]

                // Don't continue if the device is on the ignore list
                if (this.config.ignoredDevices.includes(subdevice.deviceId)) {
                  return
                }

                // Get the cached accessory or add to Homebridge if doesn't exist
                accessory = devicesInHB.get(uuidSub) || this.addAccessory(subdevice)

                // Final check the accessory now exists in Homebridge
                if (!accessory) {
                  throw new Error(this.lang.accNotFound)
                }

                // Add the device client to accessory
                accessory.client = deviceClients[device.UDN]
                const Link = require('./device/link')

                // Create the device type instance
                accessory.control = new Link(this, accessory, device, subdevice)

                // Save context information for the plugin to use
                accessory.context.serialNumber = subdevice.deviceId
                accessory.context.ipAddress = device.host
                accessory.context.port = device.port
                accessory.context.macAddress = device.macAddress.replace(/..\B/g, '$&:')
                accessory.context.firmware = device.firmwareVersion
                accessory.context.icon =
                  device.iconList && device.iconList.icon && device.iconList.icon.url
                    ? device.iconList.icon.url
                    : false

                // Log the successfully initialised device
                this.log(
                  '[%s] %s %s %s %s:%s.',
                  accessory.displayName,
                  this.lang.initSer,
                  subdevice.deviceId,
                  this.lang.initMac,
                  accessory.context.ipAddress,
                  accessory.context.port
                )

                // Update any changes to the accessory to the platform
                accessory.context.controllable = true
                this.api.updatePlatformAccessories(plugin.name, plugin.alias, [accessory])
                devicesInHB.set(uuidSub, accessory)
              } catch (e1) {
                // Catch any errors during the process
                const eText = this.funcs.parseError(e1)
                this.log.warn('[%s] %s %s.', subdevice.friendlyName, this.lang.devNotInit, eText)
              }
            })
          } catch (e) {
            // Catch any errors requesting subdevices
            const eText = this.funcs.parseError(e)
            this.log.warn('[%s] %s %s.', device.friendlyName, this.lang.sdErr, eText)
          }
          return
        }
        case 'urn:Belkin:device:insight:1': {
          // Wemo Insight
          instance = 'insight'
          break
        }
        case 'urn:Belkin:device:dimmer:1': {
          // Wemo Dimmer
          instance = 'dimmer'
          break
        }
        case 'urn:Belkin:device:lightswitch:1': {
          // Wemo Light Switch
          instance = 'switch'
          break
        }
        case 'urn:Belkin:device:Maker:1': {
          // Wemo Maker
          instance =
            this.wemoMakers[device.serialNumber] &&
            this.wemoMakers[device.serialNumber].showAsGarage
              ? 'maker-garage'
              : 'maker-switch'
          break
        }
        case 'urn:Belkin:device:sensor:1':
        case 'urn:Belkin:device:NetCamSensor:1': {
          // Wemo Motion
          instance = 'motion'
          break
        }
        case 'urn:Belkin:device:controllee:1':
        case 'urn:Belkin:device:outdoor:1': {
          // Wemo Switch
          instance =
            this.wemoOutlets[device.serialNumber] &&
            this.wemoOutlets[device.serialNumber].showAsSwitch
              ? 'switch'
              : this.wemoOutlets[device.serialNumber] &&
                this.wemoOutlets[device.serialNumber].showAsType
              ? this.wemoOutlets[device.serialNumber].showAsType
              : 'outlet'
          if (instance === 'purifier') {
            instance = 'simulation/purifier'
          }
          break
        }
        case 'urn:Belkin:device:HeaterA:1':
        case 'urn:Belkin:device:HeaterB:1': {
          // Wemo Heater
          instance = 'heater'
          break
        }
        case 'urn:Belkin:device:Humidifier:1': {
          // Wemo Humidifier
          instance = 'humidifier'
          break
        }
        case 'urn:Belkin:device:AirPurifier:1': {
          // Wemo Air Purifier
          instance = 'purifier'
          break
        }
        case 'urn:Belkin:device:crockpot:1': {
          // Wemo Crockpot
          instance = 'crockpot'
          break
        }
        default: {
          // Unsupported
          this.log.warn(
            '[%s] [%s] %s.',
            device.friendlyName,
            device.deviceType,
            this.lang.unsupported
          )
          return
        }
      }

      // Get the cached accessory or add to Homebridge if doesn't exist
      accessory = devicesInHB.get(uuid) || this.addAccessory(device, true)

      // Final check the accessory now exists in Homebridge
      if (!accessory) {
        throw new Error(this.lang.accNotFound)
      }

      // Add the device client to accessory
      accessory.client = deviceClients[device.UDN]

      // Create the device type instance
      accessory.control = new (require('./device/' + instance))(this, accessory, device)

      // Save context information for the plugin to use
      accessory.context.serialNumber = device.serialNumber
      accessory.context.ipAddress = device.host
      accessory.context.port = device.port
      accessory.context.firmware = device.firmwareVersion
      accessory.context.macAddress = device.macAddress
        ? device.macAddress.replace(/..\B/g, '$&:')
        : false
      accessory.context.icon =
        device.iconList && device.iconList.icon && device.iconList.icon.url
          ? device.iconList.icon.url
          : false
      accessory.context.controllable = true

      // Log the successfully initialised device
      this.log(
        '[%s] %s %s %s %s:%s',
        accessory.displayName,
        this.lang.initSer,
        device.serialNumber,
        this.lang.initMac,
        accessory.context.ipAddress,
        accessory.context.port
      )

      // Update any changes to the accessory to the platform
      this.api.updatePlatformAccessories(plugin.name, plugin.alias, [accessory])
      devicesInHB.set(uuid, accessory)

      // Listen for any errors on the device client
      deviceClients[device.UDN].on('error', err => {
        if (!err) {
          return
        }
        // Log the error immediately
        this.log.warn(
          '[%s] %s %ss [%s].',
          accessory.displayName,
          this.lang.reportedErr,
          this.config.discoveryInterval,
          err.message
        )

        // Some helpful logging for common device problems
        if (err.message) {
          if (err.message.includes('EHOSTUNREACH')) {
            this.log.warn('[%s] %s.', accessory.displayName, this.lang.errHostUnreach)
          } else if (err.message.includes('ECONNREFUSED')) {
            this.log.warn('[%s] %s.', accessory.displayName, this.lang.errConnRefused)
          }
        }

        // Add the device back to the pending list and throw away the bad client instance
        devicesToConnect[accessory.UUID] = accessory.displayName
        deviceClients[device.UDN] = undefined

        // Update the context now the device is uncontrollable again
        accessory.context.controllable = false
        this.api.updatePlatformAccessories(plugin.name, plugin.alias, [accessory])
        devicesInHB.set(uuid, accessory)
      })
    } catch (err) {
      // Catch any errors during the process
      const eText = this.funcs.parseError(err)
      this.log.warn('[%s] %s %s.', device.friendlyName, this.lang.devNotInit, eText)
    }
  }

  addAccessory (device, isPri) {
    try {
      // Add an accessory to Homebridge
      const newUUID = this.api.hap.uuid.generate(isPri ? device.UDN : device.deviceId)
      const accessory = new this.api.platformAccessory(device.friendlyName, newUUID)
      accessory
        .getService(this.api.hap.Service.AccessoryInformation)
        .setCharacteristic(this.api.hap.Characteristic.Manufacturer, this.lang.brand)
        .setCharacteristic(
          this.api.hap.Characteristic.Model,
          isPri ? device.modelName : this.lang.modelLED
        )
        .setCharacteristic(
          this.api.hap.Characteristic.SerialNumber,
          isPri ? device.serialNumber : device.deviceId
        )
        .setCharacteristic(this.api.hap.Characteristic.Identify, true)
      this.api.registerPlatformAccessories(plugin.name, plugin.alias, [accessory])
      this.log('[%s] %s.', device.friendlyName, this.lang.devAdd)
      this.configureAccessory(accessory)
      return accessory
    } catch (err) {
      // Catch any errors during add
      const eText = this.funcs.parseError(err)
      this.log.warn('[%s] %s %s.', device.friendlyName, this.lang.devNotAdd, eText)
      return false
    }
  }

  configureAccessory (accessory) {
    // Function is called to retrieve each accessory from the cache on startup
    try {
      if (!this.log) {
        return
      }
      accessory.on('identify', (paired, callback) => {
        callback()
        this.log('[%s] %s.', accessory.displayName, this.lang.identify)
      })
      devicesInHB.set(accessory.UUID, accessory)
    } catch (err) {
      // Catch any errors during retrieve
      const eText = this.funcs.parseError(err)
      this.log.warn('[%s] %s %s.', accessory.displayName, this.lang.devNotConf, eText)
    }
  }

  removeAccessory (accessory) {
    try {
      // Remove an accessory from Homebridge
      this.api.unregisterPlatformAccessories(plugin.name, plugin.alias, [accessory])
      devicesInHB.delete(accessory.UUID)
      this.log('[%s] %s.', accessory.displayName, this.lang.devRemove)
    } catch (err) {
      // Catch any errors during remove
      const eText = this.funcs.parseError(err)
      const name = accessory.displayName
      this.log.warn('[%s] %s %s.', name, this.lang.devNotRemove, eText)
    }
  }

  getLocalInterfaceAddress (targetNetwork) {
    // Get a list of available network interfaces
    let interfaces = os.networkInterfaces()

    // Check if the user has specified a network interface to listen on
    if (this.config.wemoClient.listen_interface) {
      // Specific interface in config, so check it exists in list
      if (interfaces[this.config.wemoClient.listen_interface]) {
        // Filter the interfaces object down to the specific interface
        interfaces = [interfaces[this.config.wemoClient.listen_interface]]
      } else {
        // Specified interface doesn't exist
        throw new Error(
          this.lang.noInterface + ' [' + this.config.wemoClient.listen_interface + ']'
        )
      }
    }

    // Get an appropriate IP address for the system
    const addresses = []
    for (const k in interfaces) {
      if (!this.funcs.hasProperty(interfaces, k)) {
        continue
      }
      for (const k2 in interfaces[k]) {
        if (!this.funcs.hasProperty(interfaces[k], k2)) {
          continue
        }
        const address = interfaces[k][k2]
        if (address.family === 'IPv4' && !address.internal) {
          if (
            targetNetwork &&
            ip.subnet(address.address, address.netmask).contains(targetNetwork)
          ) {
            // Try to find IP address on the same IP network as the device's location
            addresses.unshift(address.address)
          } else {
            addresses.push(address.address)
          }
        }
      }
    }

    // Return the IP address
    return addresses.shift()
  }
}

module.exports = hb => hb.registerPlatform(plugin.alias, WemoPlatform)
