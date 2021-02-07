/* jshint -W014, -W033, esversion: 9 */
/* eslint-disable new-cap */
'use strict'

// Retrieve necessary fields from the package.json file
const PLUGIN = require('./../package.json')

// Create the platform class
class WemoPlatform {
  constructor (log, config, api) {
    // Don't load the plugin if these aren't accessible for any reason
    if (!log || !api) {
      return
    }

    // Retrieve the necessary constants and functions before starting
    this.consts = require('./utils/constants')
    this.messages = this.consts.messages
    this.funcs = require('./utils/functions')

    // Begin plugin initialisation
    try {
      // Check the user has configured the plugin
      if (!config) {
        throw new Error(this.messages.notConfigured)
      }

      // Initialise these variables before anything else
      this.log = log
      this.api = api
      this.wemoInsights = {}
      this.wemoMakers = {}
      this.wemoMotions = {}
      this.wemoOutlets = {}

      // Apply the user's configuration
      this.config = this.consts.defaultConfig
      this.applyUserConfig(config)

      // Create further variables needed by the plugin
      this.devicesInHB = new Map()

      // Setup the Homebridge events
      this.api.on('didFinishLaunching', this.pluginSetup.bind(this))
      this.api.on('shutdown', this.pluginShutdown.bind(this))
    } catch (err) {
      // Catch any errors during initialisation
      const eText = err.message === this.messages.notConfigured
        ? err.message
        : this.funcs.parseError(err)
      log.warn('***** %s [v%s]. *****', this.messages.disabling, PLUGIN.version)
      log.warn('***** %s. *****', eText)
    }
  }

  applyUserConfig (config) {
    // These shorthand functions save line space during config parsing
    const logDefault = (k, def) => {
      this.log.warn('%s [%s] %s %s.', this.messages.cfgItem, k, this.messages.cfgDef, def)
    }
    const logIgnore = k => {
      this.log.warn('%s [%s] %s.', this.messages.cfgItem, k, this.messages.cfgIgn)
    }
    const logIncrease = (k, min) => {
      this.log.warn('%s [%s] %s %s.', this.messages.cfgItem, k, this.messages.cfgLow, min)
    }
    const logQuotes = k => {
      this.log.warn('%s [%s] %s.', this.messages.cfgItem, k, this.messages.cfgQts)
    }
    const logRemove = k => {
      this.log.warn('%s [%s] %s.', this.messages.cfgItem, k, this.messages.cfgRmv)
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
                  serialNumber.toString().toUpperCase().replace(/[\s'"]+/g, '')
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
        case 'makerTypes':
          if (Array.isArray(val) && val.length > 0) {
            val.forEach(x => {
              if (!x.serialNumber) {
                logIgnore(key)
                return
              }
              const sn = this.funcs.parseSerialNumber(x.serialNumber)
              this.wemoMakers[sn] = {}
              for (const [k, v] of Object.entries(x)) {
                switch (k) {
                  case 'makerType':
                    this.wemoMakers[sn].showAsGarage = x[k].toString() === 'garageDoor'
                    break
                  case 'serialNumber':
                    break
                  case 'makerTimer': {
                    if (typeof v === 'string') {
                      logQuotes(key + '.' + k)
                    }
                    const intVal = parseInt(v)
                    if (isNaN(intVal)) {
                      logDefault(key + '.' + k, this.consts.defaultValues[k])
                      this.wemoMakers[sn][k] = this.consts.defaultValues[k]
                    } else if (intVal < this.consts.minValues[k]) {
                      logIncrease(key + '.' + k, this.consts.minValues[k])
                      this.wemoMakers[sn][k] = this.consts.minValues[k]
                    } else {
                      this.wemoMakers[sn][k] = intVal
                    }
                    break
                  }
                  default:
                    logRemove(key + '.' + k)
                    break
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
                  manualDevice.toString().toLowerCase().replace(/[\s'"]+/g, '')
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
                case 'discover_opts':
                  if (typeof v1 === 'object' && Object.keys(v1).length > 0) {
                    for (const [k2, v2] of Object.entries(v1)) {
                      switch (k2) {
                        case 'interfaces':
                          if (typeof v2 !== 'string' || v2 === '') {
                            logIgnore(key + '.' + k1 + '.' + k2)
                          }
                          this.config[key][k1][k2] = v2.toString()
                          break
                        case 'explicitSocketBind':
                          if (typeof v2 === 'string') {
                            logQuotes(key + '.' + k1 + '.' + k2)
                          }
                          this.config[key][k1][k2] = v2 === 'false' ? false : !!v2
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
                default:
                  logRemove(key + '.' + k1)
                  break
              }
            }
          } else {
            logIgnore(key)
          }
          break
        case 'wemoInsights':
          if (Array.isArray(val) && val.length > 0) {
            val.forEach(x => {
              if (!x.serialNumber) {
                logIgnore(key)
                return
              }
              const sn = this.funcs.parseSerialNumber(x.serialNumber)
              this.wemoInsights[sn] = {}
              for (const [k, v] of Object.entries(x)) {
                switch (k) {
                  case 'serialNumber':
                    break
                  case 'showTodayTC':
                    if (typeof v === 'string') {
                      logQuotes(k)
                    }
                    this.wemoInsights[sn][k] = v === 'false' ? false : !!v
                    break
                  case 'wattDiff': {
                    if (typeof v === 'string') {
                      logQuotes(key + '.' + k)
                    }
                    const intVal = parseInt(v)
                    if (isNaN(intVal)) {
                      logDefault(key + '.' + k, this.consts.defaultValues[k])
                      this.wemoInsights[sn][k] = this.consts.defaultValues[k]
                    } else if (intVal < this.consts.minValues[k]) {
                      logIncrease(key + '.' + k, this.consts.minValues[k])
                      this.wemoInsights[sn][k] = this.consts.minValues[k]
                    } else {
                      this.wemoInsights[sn][k] = intVal
                    }
                    break
                  }
                  default:
                    logRemove(key + '.' + k)
                    break
                }
              }
            })
          } else {
            logIgnore(key)
          }
          break
        case 'wemoMotions':
          if (Array.isArray(val) && val.length > 0) {
            val.forEach(x => {
              if (!x.serialNumber) {
                logIgnore(key)
                return
              }
              const sn = this.funcs.parseSerialNumber(x.serialNumber)
              this.wemoMotions[sn] = {}
              for (const [k, v] of Object.entries(x)) {
                switch (k) {
                  case 'noMotionTimer': {
                    if (typeof v === 'string') {
                      logQuotes(key + '.' + k)
                    }
                    const intVal = parseInt(v)
                    if (isNaN(intVal)) {
                      logDefault(key + '.' + k, this.consts.defaultValues[k])
                      this.wemoMotions[sn][k] = this.consts.defaultValues[k]
                    } else if (intVal < this.consts.minValues[k]) {
                      logIncrease(key + '.' + k, this.consts.minValues[k])
                      this.wemoMotions[sn][k] = this.consts.minValues[k]
                    } else {
                      this.wemoMotions[sn][k] = intVal
                    }
                    break
                  }
                  case 'serialNumber':
                    break
                  default:
                    logRemove(key + '.' + k)
                    break
                }
              }
            })
          } else {
            logIgnore(key)
          }
          break
        case 'wemoOutlets':
          if (Array.isArray(val) && val.length > 0) {
            val.forEach(x => {
              if (!x.serialNumber) {
                logIgnore(key)
                return
              }
              const sn = this.funcs.parseSerialNumber(x.serialNumber)
              this.wemoOutlets[sn] = {}
              for (const [k, v] of Object.entries(x)) {
                switch (k) {
                  case 'serialNumber':
                    break
                  case 'showAsSwitch':
                    if (typeof v === 'string') {
                      logQuotes(k)
                    }
                    this.wemoOutlets[sn][k] = v === 'false' ? false : !!v
                    break
                }
              }
            })
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
    // Plugin has finished initialising to now onto setup
    try {
      // If the user has disabled the plugin then remove all accessories
      if (this.config.disablePlugin) {
        this.devicesInHB.forEach(accessory => {
          this.removeAccessory(accessory)
        })
        throw new Error(this.messages.disabled)
      }

      // Log that the plugin initialisation has been successful
      this.log('[v%s] %s.', PLUGIN.version, this.messages.initialised)

      // Set up further global variables
      this.discoveryRun = 0
      this.devicesToConnect = {}
      this.deviceClients = {}
      this.eveLogPath = this.api.user.storagePath() + '/persist/'

      // Require any libraries that the plugin uses
      this.axios = require('axios')
      this.eveService = require('./fakegato/fakegato-history')(this.api)
      this.HTTP = require('http')
      this.IP = require('ip')
      this.OS = require('os')
      const { default: PQueue } = require('p-queue')
      this.queue = new PQueue({ concurrency: 5 })
      this.SSDPClient = require('node-ssdp').Client
      this.URL = require('url').URL
      this.xml2js = require('xml2js')
      this.xmlbuilder = require('xmlbuilder')

      // Configure each accessory restored from the cache
      this.devicesInHB.forEach(accessory => {
        // If it's in the ignore list or the removeByName option then remove
        if (
          this.config.ignoredDevices.includes(accessory.context.serialNumber) ||
          this.config.removeByName === accessory.displayName
        ) {
          this.removeAccessory(accessory)
          return
        }

        // Add the device to the pending connection list
        this.devicesToConnect[accessory.UUID] = accessory.displayName

        // Update the context that the accessory can't be controlled until discovered
        accessory.context.controllable = false

        // Update the changes to the accessory to the platform
        this.api.updatePlatformAccessories(PLUGIN.name, PLUGIN.alias, [accessory])
        this.devicesInHB.set(accessory.UUID, accessory)
      })

      // Set up the listener server for device notifications
      this.listenerServer = this.HTTP.createServer((req, res) => {
        let body = ''
        const udn = req.url.substring(1)
        if (req.method === 'NOTIFY' && this.deviceClients[udn]) {
          // A notification from a known device
          req.on('data', chunk => {
            body += chunk.toString()
          })
          req.on('end', () => {
            if (this.config.debug) {
              this.log('[%s] %s:\n%s', udn, this.messages.incKnown, body)
            }

            // Send the notification to be dealt with in the device's client
            this.deviceClients[udn].receiveRequest(body)
            res.writeHead(200)
            res.end()
          })
        } else {
          // A notification from an unknown device
          if (this.config.debug) {
            this.log('[%s] %s.', udn, this.messages.incUnknown)
          }
          res.writeHead(404)
          res.end()
        }
      })

      // Start listening on the above created server
      if (this.config.wemoClient.listen_interface) {
        // User has defined a specific network interface to listen on
        this.listenerServer.listen(
          this.config.wemoClient.port,
          this.getLocalInterfaceAddress(),
          err => {
            if (err) {
              this.log.warn('%s: %s.', this.messages.listenerError, err)
            }
          }
        )
      } else {
        // User has not defined a specific network interface to listen on
        this.listenerServer.listen(
          this.config.wemoClient.port,
          err => {
            if (err) {
              this.log.warn('%s: %s', this.messages.listenerError, err)
            }
          }
        )
      }

      // Log the port of the listener server in debug mode
      if (this.config.debug) {
        const port = this.listenerServer.address().port
        this.log('%s [%s].', this.messages.listenerPort, port)
      }

      // Set up the SSDP client if the user has not specified manual devices only
      if (this.config.mode === 'auto') {
        this.ssdpClient = new this.SSDPClient(this.config.wemoClient.discover_opts)
      }

      // Log that the plugin setup has been successful with a welcome message
      const randIndex = Math.floor(Math.random() * this.consts.welcomeMessages.length)
      this.log('%s. %s', this.messages.complete, this.consts.welcomeMessages[randIndex])

      // Perform the first discovery run and setup the interval for subsequent runs
      this.discoverDevices()
      this.refreshInterval = setInterval(
        () => this.discoverDevices(),
        this.config.discoveryInterval * 1000
      )
    } catch (err) {
      // Catch any errors during setup
      const eText = this.funcs.parseError(err)
      this.log.warn('***** %s [v%s]. *****', this.messages.disabling, PLUGIN.version)
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
      if (this.listenerServer) {
        this.listenerServer.close(() => {
          if (this.config.debug) {
            this.log('%s.', this.messages.listenerClosed)
          }
        })
      }

      // Stop the SSDP client if it's running
      if (this.ssdpClient) {
        this.ssdpClient.stop()
        if (this.config.debug) {
          this.log('%s.', this.messages.ssdpStopped)
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
      this.ssdpClient.removeAllListeners('response')

      // Setup the listener for a detected device
      this.ssdpClient.on('response', (msg, statusCode, rinfo) => {
        // Don't continue if it's not a Wemo device (service type)
        if (msg.ST !== 'urn:Belkin:service:basicevent:1') {
          return
        }

        // Don't continue if this IP has been set up as a manual device
        const urlParts = new this.URL(msg.LOCATION)
        const ip = urlParts.hostname
        const isIpInManual = this.config.manualDevices.some(el => el.indexOf(ip) >= 0)
        if (isIpInManual) {
          return
        }

        // Check to see if this found device is already initialised
        const usnParts = msg.USN.split('::')

        // Obtain the device UDN from the USN
        const udnToCheck = usnParts[0]

        // Don't continue if this device already has a valid client
        if (this.deviceClients[udnToCheck] && !this.deviceClients[udnToCheck].error) {
          return
        }

        // Device doesn't have a valid client so sent it to the queue to load
        this.queue.add(async () => await this.loadDevice(msg.LOCATION))
      })

      // Perform the scan
      this.ssdpClient.search('urn:Belkin:service:basicevent:1')
    }

    // *************************** \\
    // Manually Configured Devices \\
    // *************************** \\
    this.config.manualDevices.forEach(async device => {
      try {
        // Check to see if the entry is a full address or an IP
        if (device.includes(':')) {
          // It's a full address so sent straight to the queue to load
          this.queue.add(async () => await this.loadDevice(device))
        } else {
          // It's an IP so perform a port scan
          const port = await this.findDevicePort(device)

          // Don't continue if we haven't found the correct port
          if (!port) {
            throw new Error('[' + device + '] ' + this.messages.noPort)
          }

          // Successfully found the correct port so send it to the queue to load
          const url = 'http://' + device + ':' + port + '/setup.xml'
          this.queue.add(async () => await this.loadDevice(url))
        }
      } catch (err) {
        // Show warnings on runs 1, 2, 5, 8, 11, ... just to limit logging to an extent
        if (this.discoveryRun === 1 || this.discoveryRun % 3 === 2) {
          const eText = this.funcs.parseError(err)
          this.log.warn('[%s] %s: %s.', device, this.messages.connError, eText)
        }
      }
    })

    // ************************ \\
    // Erroneous Device Logging \\
    // ************************ \\
    if (this.discoveryRun % 3 !== 2) {
      return
    }

    // Loop through the devices that are pending (re)connection and log
    for (const i in this.devicesToConnect) {
      if (!this.funcs.hasProperty(this.devicesToConnect, i)) {
        continue
      }
      this.log.warn(
        '[%s] %s %ss.',
        this.devicesToConnect[i],
        this.messages.awaiting,
        this.config.discoveryInterval
      )
    }
  }

  async loadDevice (setupUrl) {
    // Here we are passed a device URL to setup
    try {
      // Parse the URL for the parts
      const location = new this.URL(setupUrl)

      // Send a request to the device URL to get the XML information
      const res = await this.axios.get(setupUrl)

      // Parse the XML response from the device
      const json = await this.xml2js.parseStringPromise(
        res.data,
        { explicitArray: false }
      )
      const device = json.root.device

      // Add extra properties to the device variable
      device.host = location.hostname
      device.port = location.port
      const intAddr = this.getLocalInterfaceAddress(location.hostname)
      device.cbURL = 'http://' + intAddr + ':' + this.listenerServer.address().port

      // If it's a new device or a previously errored device then initialise it (again)
      if (!this.deviceClients[device.UDN] || this.deviceClients[device.UDN].error) {
        this.initialiseDevice(device)
      }
    } catch (err) {
      // Catch any errors during this setup
      const eText = this.funcs.parseError(err)
      this.log.warn('[%s] %s: %s.', setupUrl, this.messages.connError, eText)
    }
  }

  async initialiseDevice (device) {
    try {
      let accessory
      let instance

      // Generate the uuid for this device from the device UDN
      const uuid = this.api.hap.uuid.generate(device.UDN)

      // Remove the device from the pending connection list
      delete this.devicesToConnect[uuid]

      // Don't continue if the device is on the ignore list
      if (this.config.ignoredDevices.includes(device.serialNumber)) {
        return
      }

      // Set up the client for the device (formerly wemo-client library)
      this.deviceClients[device.UDN] = new (require('./connection/upnp'))(this, device)

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
            const data = await this.deviceClients[device.UDN].sendRequest(
              'urn:Belkin:service:bridge:1',
              'GetEndDevices',
              { DevUDN: device.UDN, ReqListType: 'PAIRED_LIST' }
            )

            // Parse the XML response from the Wemo Link
            const result = await this.xml2js.parseStringPromise(data.DeviceLists)

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
                delete this.devicesToConnect[uuidSub]

                // Don't continue if the device is on the ignore list
                if (this.config.ignoredDevices.includes(subdevice.deviceId)) {
                  return
                }

                // Get the cached accessory or add to Homebridge if doesn't exist
                accessory = this.devicesInHB.has(uuidSub)
                  ? this.devicesInHB.get(uuidSub)
                  : this.addAccessory(subdevice, false)

                // Final check the accessory now exists in Homebridge
                if (!accessory) {
                  throw new Error(this.messages.accNotFound)
                }

                // Add the device client to accessory
                accessory.client = this.deviceClients[device.UDN]
                const Link = require('./device/link')

                // Create the device type instance
                accessory.control = new Link(this, accessory, device, subdevice)

                // Save context information for the plugin to use
                accessory.context.serialNumber = subdevice.deviceId
                accessory.context.ipAddress = device.host
                accessory.context.port = device.port
                accessory.context.macAddress = device.macAddress.replace(/..\B/g, '$&:')
                accessory.context.icon = device.iconList &&
                  device.iconList.icon &&
                  device.iconList.icon.url
                  ? device.iconList.icon.url
                  : false

                // Log the successfully initialised device
                this.log(
                  '[%s] %s %s %s %s.',
                  accessory.displayName,
                  this.messages.initSer,
                  subdevice.deviceId,
                  this.messages.initMac,
                  accessory.context.macAddress
                )

                // Update any changes to the accessory to the platform
                accessory.context.controllable = true
                this.api.updatePlatformAccessories(PLUGIN.name, PLUGIN.alias, [accessory])
                this.devicesInHB.set(uuidSub, accessory)
              } catch (e1) {
                // Catch any errors during the process
                const eText = this.funcs.parseError(e1)
                this.log.warn(
                  '[%s] %s %s.',
                  subdevice.friendlyName,
                  this.messages.devNotInit,
                  eText
                )
              }
            })
          } catch (e) {
            // Catch any errors requesting subdevices
            const eText = this.funcs.parseError(e)
            this.log.warn('[%s] %s %s.', device.friendlyName, this.messages.sdErr, eText)
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
          instance = this.wemoMakers[device.serialNumber] &&
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
          instance = this.wemoOutlets[device.serialNumber] &&
            this.wemoOutlets[device.serialNumber].showAsSwitch
            ? 'switch'
            : 'outlet'
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
            this.messages.unsupported
          )
          return
        }
      }

      // Get the cached accessory or add to Homebridge if doesn't exist
      accessory = this.devicesInHB.has(uuid)
        ? this.devicesInHB.get(uuid)
        : this.addAccessory(device, true)

      // Final check the accessory now exists in Homebridge
      if (!accessory) {
        throw new Error(this.messages.accNotFound)
      }

      // Add the device client to accessory
      accessory.client = this.deviceClients[device.UDN]

      // Create the device type instance
      accessory.control = new (require('./device/' + instance))(this, accessory, device)

      // Save context information for the plugin to use
      accessory.context.serialNumber = device.serialNumber
      accessory.context.ipAddress = device.host
      accessory.context.port = device.port
      accessory.context.macAddress = device.macAddress
        ? device.macAddress.replace(/..\B/g, '$&:')
        : false
      accessory.context.icon = device.iconList &&
        device.iconList.icon &&
        device.iconList.icon.url
        ? device.iconList.icon.url
        : false
      accessory.context.controllable = true

      // Log the successfully initialised device
      this.log(
        '[%s] %s %s %s %s.',
        accessory.displayName,
        this.messages.initSer,
        device.serialNumber,
        this.messages.initMac,
        accessory.context.macAddress
      )

      // Update any changes to the accessory to the platform
      this.api.updatePlatformAccessories(PLUGIN.name, PLUGIN.alias, [accessory])
      this.devicesInHB.set(uuid, accessory)

      // Listen for any errors on the device client
      this.deviceClients[device.UDN].on('error', err => {
        if (!err) {
          return
        }
        // Log the error immediately
        const eText = this.config.debug
          ? ':\n' + err
          : ' [' + err.code + ': ' + err.message + '].'
        this.log.warn(
          '[%s] %s %ss%s',
          accessory.displayName,
          this.messages.reportedErr,
          this.discoveryInterval,
          eText
        )

        // Add the device back to the pending list and throw away the bad client instance
        this.devicesToConnect[accessory.UUID] = accessory.displayName
        this.deviceClients[device.UDN] = undefined

        // Update the context now the device is uncontrollable again
        accessory.context.controllable = false
        this.api.updatePlatformAccessories(PLUGIN.name, PLUGIN.alias, [accessory])
        this.devicesInHB.set(uuid, accessory)
      })
    } catch (err) {
      // Catch any errors during the process
      const eText = this.funcs.parseError(err)
      this.log.warn('[%s] %s %s.', device.friendlyName, this.messages.devNotInit, eText)
    }
  }

  addAccessory (device, isPri) {
    try {
      // Add an accessory to Homebridge
      const newUUID = this.api.hap.uuid.generate(isPri ? device.UDN : device.deviceId)
      const accessory = new this.api.platformAccessory(device.friendlyName, newUUID)
      accessory.getService(this.api.hap.Service.AccessoryInformation)
        .setCharacteristic(
          this.api.hap.Characteristic.Manufacturer,
          this.messages.brand
        )
        .setCharacteristic(
          this.api.hap.Characteristic.Model,
          isPri ? device.modelName : this.messages.modelLED
        )
        .setCharacteristic(
          this.api.hap.Characteristic.SerialNumber,
          isPri ? device.serialNumber : device.deviceId
        )
        .setCharacteristic(
          this.api.hap.Characteristic.FirmwareRevision,
          isPri ? device.firmwareVersion : null
        )
        .setCharacteristic(this.api.hap.Characteristic.Identify, true)
      accessory.on('identify', (paired, callback) => {
        callback()
        this.log('[%s] %s.', accessory.displayName, this.messages.identify)
      })
      accessory.context.serialNumber = isPri ? device.serialNumber : device.deviceId
      this.api.registerPlatformAccessories(PLUGIN.name, PLUGIN.alias, [accessory])
      this.log('[%s] %s.', device.friendlyName, this.messages.devAdd)
      return accessory
    } catch (err) {
      // Catch any errors during add
      const eText = this.funcs.parseError(err)
      this.log.warn('[%s] %s %s.', device.friendlyName, this.messages.devNotAdd, eText)
      return false
    }
  }

  configureAccessory (accessory) {
    // Function is called to retrieve each accessory from the cache on startup
    try {
      if (!this.log) {
        return
      }

      this.devicesInHB.set(accessory.UUID, accessory)
    } catch (err) {
      // Catch any errors during retrieve
      const eText = this.funcs.parseError(err)
      this.log.warn('[%s] %s %s.', accessory.displayName, this.messages.devNotConf, eText)
    }
  }

  removeAccessory (accessory) {
    try {
      // Remove an accessory from Homebridge
      this.api.unregisterPlatformAccessories(PLUGIN.name, PLUGIN.alias, [accessory])
      this.devicesInHB.delete(accessory.UUID)
      this.log('[%s] %s.', accessory.displayName, this.messages.devRemove)
    } catch (err) {
      // Catch any errors during remove
      const eText = this.funcs.parseError(err)
      const name = accessory.displayName
      this.log.warn('[%s] %s %s.', name, this.messages.devNotRemove, eText)
    }
  }

  async findDevicePort (ip) {
    // Try to find the correct port of a device by ip
    // Credit to @Zacknetic for this function
    const tryPort = async (wemoPort, ipAddress) => {
      try {
        await this.axios.get(
          'http://' + ipAddress + ':' + wemoPort + '/setup.xml',
          { timeout: 500 }
        )
        return wemoPort
      } catch (err) {
        // Suppress any errors as we don't want to show them
        return false
      }
    }

    // Loop through the ports that Wemo devices generally use
    for (const port of this.consts.portsToScan) {
      const portAttempt = await tryPort(port, ip)
      if (portAttempt) {
        // We found the correct port
        return portAttempt
      }
    }

    // None of the ports worked
    return false
  }

  getLocalInterfaceAddress (targetNetwork) {
    // Get a list of available network interfaces
    let interfaces = this.OS.networkInterfaces()

    // Check if the user has specified a network interface to listen on
    if (this.config.wemoClient.listen_interface) {
      // Specific interface in config, so check it exists in list
      if (interfaces[this.config.wemoClient.listen_interface]) {
        // Filter the interfaces object down to the specific interface
        interfaces = [interfaces[this.config.wemoClient.listen_interface]]
      } else {
        // Specified interface doesn't exist
        throw new Error(
          this.messages.noInterface + ' [' + this.config.wemoClient.listen_interface + ']'
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
            this.IP.subnet(address.address, address.netmask).contains(targetNetwork)
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

module.exports = hb => hb.registerPlatform(PLUGIN.alias, WemoPlatform)
