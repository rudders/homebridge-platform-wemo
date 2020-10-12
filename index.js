'use strict'
let Accessory, Characteristic, Consumption, Service, TotalConsumption, UUIDGen
const WemoClient = require('wemo-client')
let wemoClient = new WemoClient()
module.exports = function (homebridge) {
  Accessory = homebridge.platformAccessory
  Characteristic = homebridge.hap.Characteristic
  Service = homebridge.hap.Service
  UUIDGen = homebridge.hap.uuid

  Consumption = function () {
    Characteristic.call(
      this,
      'Consumption',
      'E863F10D-079E-48FF-8F27-9C2605A29F52'
    )
    this.setProps({
      format: Characteristic.Formats.UINT16,
      unit: 'W',
      perms: [Characteristic.Perms.READ, Characteristic.Perms.NOTIFY]
    })
    this.value = this.getDefaultValue()
  }
  TotalConsumption = function () {
    Characteristic.call(
      this,
      'Total Consumption',
      'E863F10C-079E-48FF-8F27-9C2605A29F52'
    )
    this.setProps({
      format: Characteristic.Formats.UINT32,
      unit: 'Wh', // change from kWh to Wh to have value significance for low mW draw
      perms: [Characteristic.Perms.READ, Characteristic.Perms.NOTIFY]
    })
    this.value = this.getDefaultValue()
  }
  require('util').inherits(Consumption, Characteristic)
  require('util').inherits(TotalConsumption, Characteristic)
  Consumption.UUID = 'E863F10D-079E-48FF-8F27-9C2605A29F52'
  TotalConsumption.UUID = 'E863F10C-079E-48FF-8F27-9C2605A29F52'
  homebridge.registerPlatform('homebridge-platform-wemo', 'BelkinWeMo', WemoPlatform, true)
}

function WemoPlatform (log, config, api) {
  if (!log || !api || !config) return
  this.config = config
  this.api = api
  this.log = log
  wemoClient = new WemoClient(this.config.wemoClient || {})
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

  const self = this

  const addDiscoveredDevice = function (err, device) {
    if (!device) return

    let uuid = UUIDGen.generate(device.UDN)
    let accessory

    if (device.deviceType === WemoClient.DEVICE_TYPE.Bridge) {
      const client = this.client(device, self.log)

      client.getEndDevices(function (err, enddevices) {
        for (let i = 0, tot = enddevices.length; i < tot; i++) {
          uuid = UUIDGen.generate(enddevices[i].deviceId)
          accessory = self.accessories[uuid]

          if (self.ignoredDevices.indexOf(device.serialNumber) !== -1) {
            if (accessory !== undefined) {
              self.removeAccessory(accessory)
            }
            return
          }

          if (accessory === undefined) {
            self.addLinkAccessory(device, enddevices[i])
          } else if (accessory instanceof WemoLinkAccessory) {
            this.setupDevice(device, enddevices[i])
            this.observeDevice()
          } else {
            self.accessories[uuid] = new WemoLinkAccessory(self.log, accessory, device, enddevices[i])
          }
        }
      })
    } else {
      accessory = self.accessories[uuid]
      if (self.ignoredDevices.indexOf(device.serialNumber) !== -1) {
        if (accessory !== undefined) {
          self.removeAccessory(accessory)
        }
        return
      }

      if (accessory === undefined) {
        self.addAccessory(device)
      } else if (accessory instanceof WemoAccessory) {
        self.log('Online and can update device: %s [%s]', accessory.displayName, device.macAddress)
        accessory.setupDevice(device)
        accessory.observeDevice(device)
      } else {
        self.log('Online: %s [%s]', accessory.displayName, device.macAddress)
        self.accessories[uuid] = new WemoAccessory(self.config, self.log, accessory, device)
      }
    }
  }

  this.api
    .on('didFinishLaunching', () => {
      this.manualDevices.forEach(device => wemoClient.load(device, addDiscoveredDevice))
      if (this.config.discovery) wemoClient.discover(addDiscoveredDevice)
    })
  if (this.config.discovery) {
    setInterval(() => wemoClient.discover(addDiscoveredDevice), (this.config.discoveryInterval || 30) * 1000)
  }
}

WemoPlatform.prototype.addAccessory = function (device) {
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
      this.log('Not Supported: %s [%s]', device.friendlyName, device.deviceType)
  }

  if (serviceType === undefined) return

  this.log('Found: %s [%s]', device.friendlyName, device.macAddress)

  const accessory = new Accessory(device.friendlyName, UUIDGen.generate(device.UDN))
  const service = accessory.addService(serviceType, device.friendlyName)

  switch (device.deviceType) {
    case WemoClient.DEVICE_TYPE.Insight:
      service.addCharacteristic(Consumption)
      service.addCharacteristic(TotalConsumption)
      break
    case WemoClient.DEVICE_TYPE.Dimmer:
      service.addCharacteristic(Characteristic.Brightness)
      break
  }

  this.accessories[accessory.UUID] = new WemoAccessory(this.config, this.log, accessory, device)
  this.api.registerPlatformAccessories('homebridge-platform-wemo', 'BelkinWeMo', [accessory])
}

WemoPlatform.prototype.addLinkAccessory = function (link, device) {
  this.log('Found: %s [%s]', device.friendlyName, device.deviceId)

  const accessory = new Accessory(device.friendlyName, UUIDGen.generate(device.deviceId))
  const service = accessory.addService(Service.Lightbulb, device.friendlyName)
  service.addCharacteristic(Characteristic.Brightness)

  if (device.capabilities[WemoLinkAccessory.OPTIONS.Temperature] !== undefined) {
    service.addCharacteristic(Characteristic.ColorTemperature)
  }

  this.accessories[accessory.UUID] = new WemoLinkAccessory(this.log, accessory, link, device)
  this.api.registerPlatformAccessories('homebridge-platform-wemo', 'BelkinWeMo', [accessory])
}

WemoPlatform.prototype.configureAccessory = function (accessory) {
  this.accessories[accessory.UUID] = accessory
}

WemoPlatform.prototype.configurationRequestHandler = function (context, request, callback) {
  var self = this
  var respDict = {}

  if (request && request.type === 'Terminate') {
    context.onScreen = null
  }

  const sortAccessories = function () {
    context.sortedAccessories = Object.keys(self.accessories)
      .map(function (k) {
        return this[k] instanceof Accessory ? this[k] : this[k].accessory
      }, self.accessories)
      .sort(function (a, b) {
        if (a.displayName < b.displayName) return -1
        if (a.displayName > b.displayName) return 1
        return 0
      })

    return Object.keys(context.sortedAccessories).map(function (k) {
      return this[k].displayName
    }, context.sortedAccessories)
  }

  let items
  switch (context.onScreen) {
    case 'DoRemove':
      if (request.response.selections) {
        for (const i in request.response.selections.sort()) {
          this.removeAccessory(context.sortedAccessories[request.response.selections[i]])
        }
        respDict = {
          type: 'Interface',
          interface: 'instruction',
          title: 'Finished',
          detail: 'Accessory removal was successful.'
        }

        context.onScreen = null
        callback(respDict)
      } else {
        context.onScreen = null
        callback(respDict, 'platform', true, this.config)
      }
      break
    case 'DoModify':
      context.accessory = context.sortedAccessories[request.response.selections[0]]
      context.onScreenSelection = []
      context.canChangeService = []

      items = []

      if (context.accessory.context.deviceType === WemoClient.DEVICE_TYPE.Maker) {
        items.push('Change Service')
        context.onScreenSelection.push({
          action: 'change',
          item: 'service',
          screen: 'ChangeService'
        })
      }

      respDict = {
        type: 'Interface',
        interface: 'list',
        title: 'Select action for ' + context.accessory.displayName,
        allowMultipleSelection: false,
        items: items
      }

      context.onScreen = 'ModifyAccessory'

      callback(respDict)
      break
    case 'ModifyAccessory': {
      if (!request.response.selections) {
        context.onScreen = null
        callback(respDict, 'platform', true, this.config)
      }

      const selection = context.onScreenSelection[request.response.selections[0]]

      context.onScreen = selection.screen

      items = []

      if (
        context.accessory.context.deviceType === WemoClient.DEVICE_TYPE.Maker &&
        context.accessory.context.switchMode === 1
      ) {
        const services = [Service.GarageDoorOpener, Service.Switch]

        for (const index in services) {
          const service = services[index]

          if (service.UUID === context.accessory.context.serviceType) {
            continue
          }

          context.canChangeService.push(service)
          let name
          switch (service) {
            case Service.GarageDoorOpener:
              name = 'Garage Door Opener'
              break
            case Service.Switch:
              name = 'Switch'
              break
            default:
              name = 'Unknown'
              break
          }
          items.push(name)
        }
      }

      respDict = {
        type: 'Interface',
        interface: 'list',
        title: 'Select ' + selection.item + ' to ' + selection.action,
        allowMultipleSelection: false,
        items: items
      }

      callback(respDict)
      break
    }
    case 'ChangeService': {
      if (!request.response.selections) {
        context.onScreen = null
        callback(respDict, 'platform', true, this.config)
      }

      const item = context['can' + context.onScreen][request.response.selections[0]]

      respDict = {
        type: 'Interface',
        interface: 'instruction',
        title: 'Finished',
        detail: 'Accessory service change failed.'
      }

      try {
        const accessory = self.accessories[context.accessory.UUID]
        accessory.accessory.context.serviceType = item.UUID
        accessory.updateMakerMode()

        respDict.detail = 'Accessory service change was successful.'
      } catch (e) {}

      context.onScreen = null
      callback(respDict)
      break
    }
    case 'Menu':
      switch (request.response.selections[0]) {
        case 0:
          context.onScreen = 'Modify'
          break
        case 1:
          context.onScreen = 'Remove'
          break
        case 2:
          context.onScreen = 'Configuration'
          break
      }

      if (context.onScreen !== 'Configuration') {
        respDict = {
          type: 'Interface',
          interface: 'list',
          title: 'Select accessory to ' + context.onScreen.toLowerCase(),
          allowMultipleSelection: context.onScreen === 'Remove',
          items: sortAccessories()
        }

        context.onScreen = 'Do' + context.onScreen
        callback(respDict)
        break
      }

      respDict = {
        type: 'Interface',
        interface: 'list',
        title: 'Select Option',
        allowMultipleSelection: false,
        items: ['Ignored Devices']
      }

      callback(respDict)
      break
    case 'Configuration':
      respDict = {
        type: 'Interface',
        interface: 'list',
        title: 'Modify Ignored Devices',
        allowMultipleSelection: false,
        items: this.ignoredDevices.length > 0 ? ['Add Accessory', 'Remove Accessory'] : ['Add Accessory']
      }

      context.onScreen = 'IgnoreList'

      callback(respDict)
      break
    case 'IgnoreList':
      context.onScreen =
        request && request.response && request.response.selections[0] === 1
          ? 'IgnoreListRemove'
          : 'IgnoreListAdd'

      if (context.onScreen === 'IgnoreListAdd') {
        respDict = {
          type: 'Interface',
          interface: 'list',
          title: 'Select accessory to add to Ignored Devices',
          allowMultipleSelection: true,
          items: sortAccessories()
        }
      } else {
        context.selection = JSON.parse(JSON.stringify(this.ignoredDevices))

        respDict = {
          type: 'Interface',
          interface: 'list',
          title: 'Select accessory to remove from Ignored Devices',
          allowMultipleSelection: true,
          items: context.selection
        }
      }

      callback(respDict)
      break
    case 'IgnoreListAdd':
      if (request.response.selections) {
        for (const i in request.response.selections.sort()) {
          var accessory =
            context.sortedAccessories[request.response.selections[i]]

          if (
            accessory.context &&
            accessory.context.id &&
            this.ignoredDevices.indexOf(accessory.context.id) === -1
          ) {
            this.ignoredDevices.push(accessory.context.id)
          }

          this.removeAccessory(accessory)
        }

        this.config.ignoredDevices = this.ignoredDevices

        respDict = {
          type: 'Interface',
          interface: 'instruction',
          title: 'Finished',
          detail: 'Ignore List update was successful.'
        }
      }

      context.onScreen = null
      callback(respDict, 'platform', true, this.config)
      break

    case 'IgnoreListRemove':
      if (request.response.selections) {
        for (var i in request.response.selections) {
          var id = context.selection[request.response.selections[i]]

          if (this.ignoredDevices.indexOf(id) !== -1) {
            this.ignoredDevices.splice(this.ignoredDevices.indexOf(id), 1)
          }
        }
      }

      this.config.ignoredDevices = this.ignoredDevices

      if (this.config.ignoredDevices.length === 0) {
        delete this.config.ignoredDevices
      }

      context.onScreen = null
      callback(respDict, 'platform', true, this.config)
      break
    default:
      if (request && (request.response || request.type === 'Terminate')) {
        context.onScreen = null
        callback(respDict, 'platform', true, this.config)
      } else {
        respDict = {
          type: 'Interface',
          interface: 'list',
          title: 'Select option',
          allowMultipleSelection: false,
          items: ['Modify Accessory', 'Remove Accessory', 'Configuration']
        }

        context.onScreen = 'Menu'
        callback(respDict)
      }
  }
}

WemoPlatform.prototype.removeAccessory = function (accessory) {
  this.log('Remove Accessory: %s', accessory.displayName)

  if (this.accessories[accessory.UUID]) {
    delete this.accessories[accessory.UUID]
  }

  this.api.unregisterPlatformAccessories('homebridge-platform-wemo', 'BelkinWeMo', [accessory])
}

function WemoAccessory (config, log, accessory, device) {
  var self = this

  this.accessory = accessory
  this.config = config
  this.device = device
  this.log = log

  this.accessory.context.deviceType = device.deviceType

  this.setupDevice(device)

  this.accessory
    .getService(Service.AccessoryInformation)
    .setCharacteristic(Characteristic.Manufacturer, 'Belkin Wemo')
    .setCharacteristic(Characteristic.Model, device.modelName)
    .setCharacteristic(Characteristic.SerialNumber, device.serialNumber)
    .setCharacteristic(Characteristic.FirmwareRevision, device.firmwareVersion)

  this.accessory.on('identify', function (paired, callback) {
    self.log('%s - identify', self.accessory.displayName)
    callback()
  })

  this.observeDevice(device)
  this.addEventHandlers()
}

WemoAccessory.prototype.addEventHandler = function (serviceName, characteristic) {
  serviceName = serviceName || Service.Switch

  var service = this.accessory.getService(serviceName)

  if (service === undefined && serviceName === Service.Switch) {
    serviceName = Service.Outlet
    service = this.accessory.getService(serviceName)
  }

  if (service === undefined) return

  if (service.testCharacteristic(characteristic) === false) return

  switch (characteristic) {
    case Characteristic.On:
      service
        .getCharacteristic(characteristic)
        .on('set', this.setSwitchState.bind(this))
      break
    case Characteristic.TargetDoorState:
      service
        .getCharacteristic(characteristic)
        .on('set', this.setTargetDoorState.bind(this))
      break
    case Characteristic.Brightness:
      service
        .getCharacteristic(characteristic)
        .on('set', this.setBrightness.bind(this))
      break
  }
}

WemoAccessory.prototype.addEventHandlers = function () {
  this.addEventHandler(Service.Switch, Characteristic.On)
  this.addEventHandler(Service.Lightbulb, Characteristic.On)
  this.addEventHandler(Service.Lightbulb, Characteristic.Brightness)
  this.addEventHandler(Service.GarageDoorOpener, Characteristic.TargetDoorState)
}

WemoAccessory.prototype.getAttributes = function (callback) {
  callback = callback || function () {}

  this.client.getAttributes(
    function (err, attributes) {
      if (err) {
        this.log(err)
        callback()
        return
      }

      this.device.attributes = attributes
      this.accessory.context.switchMode = attributes.SwitchMode
      this.updateMakerMode()

      if (attributes.SensorPresent === 1) {
        if (this.accessory.getService(Service.Switch) !== undefined) {
          if (this.accessory.getService(Service.ContactSensor) === undefined) {
            this.log('%s - Add Service: %s', this.accessory.displayName, 'Service.ContactSensor')
            this.accessory.addService(Service.ContactSensor, this.accessory.displayName)
          }
        } else if (this.accessory.getService(Service.GarageDoorOpener) !== undefined) {
          this.sensorPresent = true
        }
        this.updateSensorState(attributes.Sensor)
      } else {
        const contactSensor = this.accessory.getService(Service.ContactSensor)
        if (contactSensor !== undefined) {
          this.log('%s - Remove Service: %s', this.accessory.displayName, 'Service.ContactSensor')
          this.accessory.removeService(contactSensor)
        }
        delete this.sensorPresent
      }
      if (this.accessory.getService(Service.Switch) !== undefined) {
        this.updateSwitchState(attributes.Switch)
      }
      callback()
    }.bind(this)
  )
}

WemoAccessory.prototype.getSwitchState = function (callback) {
  if (this.device.deviceType === WemoClient.DEVICE_TYPE.Maker) {
    this.getAttributes(
      function () {
        callback(
          null,
          this.accessory.getService(Service.Switch).getCharacteristic(Characteristic.On).value
        )
      }.bind(this)
    )
  } else {
    this.client.getBinaryState(
      function (err, state) {
        if (err) {
          const service = this.accessory.getService(Service.Switch) || this.accessory.getService(Service.Outlet)
          callback(null, service.getCharacteristic(Characteristic.On).value)
          return
        }
        callback(null, this.updateSwitchState(state))
      }.bind(this)
    )
  }
}

WemoAccessory.prototype.observeDevice = function (device) {
  if (device.deviceType === WemoClient.DEVICE_TYPE.Maker) {
    this.getAttributes()
    this.client.on(
      'attributeList',
      function (name, value, prevalue, timestamp) {
        switch (name) {
          case 'Switch':
            if (this.accessory.getService(Service.Switch) !== undefined) {
              this.updateSwitchState(value)
            } else if (this.accessory.getService(Service.GarageDoorOpener) !== undefined) {
              if (value === 1) {
                if (this.homekitTriggered === true) {
                  // Triggered through HomeKit
                  delete this.homekitTriggered
                } else {
                  // Triggered using the button on the Wemo Maker
                  const targetDoorState = this.accessory.getService(Service.GarageDoorOpener).getCharacteristic(Characteristic.TargetDoorState)
                  const state = targetDoorState.value ? Characteristic.TargetDoorState.OPEN : Characteristic.TargetDoorState.CLOSED
                  this.log(
                    '%s - Set Target Door State: %s (triggered by Maker)',
                    this.accessory.displayName,
                    state ? 'Closed' : 'Open'
                  )
                  targetDoorState.updateValue(state)
                  this.setDoorMoving(state)
                }
              }
            }
            break
          case 'Sensor':
            this.updateSensorState(value, true)
            break
        }
      }.bind(this)
    )
  } else {
    this.client.on(
      'binaryState',
      function (state) {
        if (this.device.deviceType === WemoClient.DEVICE_TYPE.Motion || this.device.deviceType === 'urn:Belkin:device:NetCamSensor:1') {
          this.updateMotionDetected(state)
        } else {
          this.updateSwitchState(state)
        }
      }.bind(this)
    )
  }

  if (device.deviceType === WemoClient.DEVICE_TYPE.Insight) {
    this.client.on('insightParams', this.updateInsightParams.bind(this))
  }

  if (device.deviceType === WemoClient.DEVICE_TYPE.Dimmer) {
    this.client.on('brightness', this.updateBrightness.bind(this))
  }
}

WemoAccessory.prototype.removeMakerServices = function (service) {
  const services = [Service.GarageDoorOpener, Service.Switch]
  for (const index in services) {
    if (services[index] === service) {
      continue
    }
    if (this.accessory.getService(services[index]) !== undefined) {
      this.accessory.removeService(this.accessory.getService(services[index]))
    }
  }
}

WemoAccessory.prototype.setDoorMoving = function (targetDoorState, homekitTriggered) {
  const service = this.accessory.getService(Service.GarageDoorOpener)

  if (this.movingTimer) {
    clearTimeout(this.movingTimer)
    delete this.movingTimer
  }

  if (this.isMoving === true) {
    delete this.isMoving
    this.updateCurrentDoorState(Characteristic.CurrentDoorState.STOPPED)

    // Toggle TargetDoorState after receiving a stop
    setTimeout(
      function (obj, state) {
        obj.updateValue(state)
      },
      500,
      service.getCharacteristic(Characteristic.TargetDoorState),
      targetDoorState === Characteristic.TargetDoorState.OPEN
        ? Characteristic.TargetDoorState.CLOSED
        : Characteristic.TargetDoorState.OPEN
    )
    return
  }

  this.isMoving = true

  if (homekitTriggered === true) {
    const currentDoorState = service.getCharacteristic(Characteristic.CurrentDoorState)

    if (targetDoorState === Characteristic.TargetDoorState.CLOSED) {
      if (currentDoorState.value !== Characteristic.CurrentDoorState.CLOSED) {
        this.updateCurrentDoorState(Characteristic.CurrentDoorState.CLOSING)
      }
    } else if (targetDoorState === Characteristic.TargetDoorState.OPEN) {
      if (
        currentDoorState.value === Characteristic.CurrentDoorState.STOPPED ||
        (this.sensorPresent !== true && currentDoorState.value !== Characteristic.CurrentDoorState.OPEN)
      ) {
        this.updateCurrentDoorState(Characteristic.CurrentDoorState.OPENING)
      }
    }
  }

  this.movingTimer = setTimeout(
    function (self) {
      delete self.movingTimer
      delete self.isMoving
      var targetDoorState = self.accessory.getService(Service.GarageDoorOpener).getCharacteristic(Characteristic.TargetDoorState)
      if (!self.sensorPresent) {
        self.updateCurrentDoorState(
          targetDoorState.value
            ? Characteristic.CurrentDoorState.CLOSED
            : Characteristic.CurrentDoorState.OPEN
        )
        return
      }
      self.getAttributes()
    },
    this.config.doorOpenTimer * 1000,
    this
  )
}

WemoAccessory.prototype.setSwitchState = function (state, callback) {
  const value = state | 0
  const service =
    this.accessory.getService(Service.Switch) ||
    this.accessory.getService(Service.Outlet) ||
    this.accessory.getService(Service.Lightbulb)
  const switchState = service.getCharacteristic(Characteristic.On)
  callback = callback || function () {}

  if (switchState.value !== value) {
    // remove redundant calls to setBinaryState when requested state is already achieved
    this.client.setBinaryState(
      value,
      function (err) {
        if (!err) {
          this.log('%s - Set state: %s', this.accessory.displayName, value ? 'On' : 'Off')
          callback(null)
          // for dimmer, poll brightness for ON events (supports night mode)
          if (value && this.device.deviceType === WemoClient.DEVICE_TYPE.Dimmer) {
            this.client.getBrightness(
              function (err, brightness) {
                if (err) {
                  this.log('%s - Error ON brightness', this.accessory.displayName)
                  return
                }
                this.updateBrightness(brightness)
              }.bind(this)
            )
          }
        } else {
          this.log('%s - Set state FAILED: %s. Error: %s', this.accessory.displayName, value ? 'on' : 'off', err.code)
          callback(new Error(err))
        }
      }.bind(this)
    )
  } else {
    callback(null)
  }
}

WemoAccessory.prototype.setBrightness = function (value, callback) {
  callback = callback || function () {}

  if (this.brightness === value) {
    callback(null)
    return
  }

  this._brightness = value

  // defer the actual update to smooth out changes from sliders
  setTimeout(
    function (caller, value) {
      // check that we actually have a change to make and that something
      // hasn't tried to update the brightness again in the last 0.1 seconds
      if (caller.brightness !== value && caller._brightness === value) {
        caller.client.setBrightness(
          value,
          function (err) {
            if (err) {
              this.log('%s - Set brightness FAILED: %s. Error: %s', this.accessory.displayName, value, err.code)
            } else {
              caller.log('%s - Set brightness: %s%', caller.accessory.displayName, value)
              caller.brightness = value
            }
          }.bind(caller)
        )
      }
    },
    100,
    this,
    value
  )
  callback(null)
}

WemoAccessory.prototype.setTargetDoorState = function (state, callback) {
  const value = state | 0
  callback = callback || function () {}
  this.homekitTriggered = true
  const currentDoorState = this.accessory.getService(Service.GarageDoorOpener).getCharacteristic(Characteristic.CurrentDoorState)

  if (!this.isMoving) {
    if (value === Characteristic.TargetDoorState.CLOSED && currentDoorState.value === Characteristic.CurrentDoorState.CLOSED) {
      this.log('Door already closed')
      callback(null)
      return
    } else if (value === Characteristic.TargetDoorState.OPEN && currentDoorState.value === Characteristic.CurrentDoorState.OPEN) {
      this.log('Door already open')
      callback(null)
      return
    }
  } else {
    if (value === Characteristic.TargetDoorState.CLOSED && currentDoorState.value === Characteristic.CurrentDoorState.CLOSING) {
      this.log('Door already closing')
      callback(null)
      return
    } else if (value === Characteristic.TargetDoorState.OPEN && currentDoorState.value === Characteristic.CurrentDoorState.OPENING) {
      this.log('Door already opening')
      callback(null)
      return
    }
  }

  this.client.setBinaryState(
    1,
    function (err) {
      if (!err) {
        this.log('%s - Set Target Door State: %s (triggered by HomeKit)', this.accessory.displayName, value ? 'Closed' : 'Open')
        this.setDoorMoving(value, true)
        callback(null)
      } else {
        this.log('%s - Set state FAILED: %s. Error: %s', this.accessory.displayName, value ? 'on' : 'off', err.code)
        callback(new Error(err))
      }
    }.bind(this)
  )
}

WemoAccessory.prototype.setupDevice = function (device) {
  this.device = device
  this.client = wemoClient.client(device)

  this.client.on(
    'error',
    function (err) {
      this.log('%s reported error %s', this.accessory.displayName, err.code)
    }.bind(this)
  )
}

WemoAccessory.prototype.updateBrightness = function (newBrightness) {
  const currentBrightness = this.accessory.getService(Service.Lightbulb).getCharacteristic(Characteristic.Brightness)
  if (currentBrightness.value !== newBrightness) {
    this.log('%s - Updated brightness: %s%', this.accessory.displayName, newBrightness)
    currentBrightness.updateValue(newBrightness)
    this.brightness = newBrightness
  }
  return newBrightness
}

WemoAccessory.prototype.updateConsumption = function (raw) {
  const value = Math.round(raw / 1000)
  const service = this.accessory.getService(Service.Switch) || this.accessory.getService(Service.Outlet)
  const consumption = service.getCharacteristic(Consumption)
  if (consumption.value !== value) {
    this.log('%s - Consumption: %sw', this.accessory.displayName, value)
    consumption.setValue(value)
  }
  return value
}

WemoAccessory.prototype.updateCurrentDoorState = function (value, actualFeedback) {
  let state

  switch (value) {
    case Characteristic.CurrentDoorState.OPEN:
      state = 'Open'
      break
    case Characteristic.CurrentDoorState.CLOSED:
      state = 'Closed'
      break
    case Characteristic.CurrentDoorState.OPENING:
      state = 'Opening'
      break
    case Characteristic.CurrentDoorState.CLOSING:
      state = 'Closing'
      break
    case Characteristic.CurrentDoorState.STOPPED:
      state = 'Stopped'
      break
  }

  this.log('%s - Get Current Door State: %s', this.accessory.displayName, state)

  this.accessory
    .getService(Service.GarageDoorOpener)
    .getCharacteristic(Characteristic.CurrentDoorState)
    .updateValue(value)
}

WemoAccessory.prototype.updateInsightParams = function (state, power, data) {
  this.updateSwitchState(state)
  this.updateOutletInUse(state)
  this.updateConsumption(power)
  this.updateTotalConsumption(data.TodayConsumed, data.TodayONTime) // TodayConsumed in mW minutes, TodayONTime in seconds
}

WemoAccessory.prototype.updateMotionDetected = function (state) {
  state = state | 0

  const value = !!state
  const motionDetected = this.accessory
    .getService(Service.MotionSensor)
    .getCharacteristic(Characteristic.MotionDetected)

  if (
    (value === motionDetected.value && this.motionTimer === undefined) ||
    (value === false && this.motionTimer)
  ) {
    return
  }

  if (value === true || this.config.noMotionTimer === 0) {
    if (this.motionTimer) {
      this.log('%s - no motion timer stopped', this.accessory.displayName)
      clearTimeout(this.motionTimer)
      delete this.motionTimer
    }

    this.log('%s - Motion Sensor: %s', this.accessory.displayName, value ? 'Detected' : 'Clear')
    motionDetected.setValue(value)
  } else {
    this.log(
      '%s - no motion timer started [%d secs]',
      this.accessory.displayName,
      this.config.noMotionTimer
    )
    clearTimeout(this.motionTimer)
    this.motionTimer = setTimeout(
      function (self) {
        self.log('%s - Motion Sensor: Clear; no motion timer completed', self.accessory.displayName)
        self.accessory
          .getService(Service.MotionSensor)
          .getCharacteristic(Characteristic.MotionDetected)
          .setValue(false)
        delete self.motionTimer
      },
      this.config.noMotionTimer * 1000,
      this
    )
  }
}

WemoAccessory.prototype.updateMakerMode = function () {
  if (this.accessory.context.switchMode === 1) {
    // SwitchMode - Momentary
    if (this.accessory.context.serviceType === undefined) {
      this.accessory.context.serviceType = Service.GarageDoorOpener.UUID
    }

    switch (this.accessory.context.serviceType) {
      case Service.GarageDoorOpener.UUID:
        if (this.accessory.getService(Service.GarageDoorOpener) === undefined) {
          this.accessory.addService(Service.GarageDoorOpener, this.accessory.displayName)
          this.addEventHandler(Service.GarageDoorOpener, Characteristic.TargetDoorState)
        }
        this.removeMakerServices(Service.GarageDoorOpener)
        break
      case Service.Switch.UUID:
        if (this.accessory.getService(Service.Switch) === undefined) {
          this.accessory.addService(Service.Switch, this.accessory.displayName)
          this.addEventHandler(Service.Switch, Characteristic.On)
        }
        this.removeMakerServices(Service.Switch)
        break
    }
  } else if (this.accessory.context.switchMode === 0) {
    // SwitchMode - Toggle
    if (this.accessory.getService(Service.Switch) === undefined) {
      this.accessory.addService(Service.Switch, this.accessory.displayName)
      this.addEventHandler(Service.Switch, Characteristic.On)
    }
    this.removeMakerServices(Service.Switch)
  }
}

WemoAccessory.prototype.updateOutletInUse = function (state) {
  state = state | 0

  const value = state === 1
  const service = this.accessory.getService(Service.Switch) || this.accessory.getService(Service.Outlet)
  const outletInUse = service.getCharacteristic(Characteristic.OutletInUse)

  if (outletInUse.value !== value) {
    this.log('%s - Outlet In Use: %s', this.accessory.displayName, value ? 'Yes' : 'No')
    outletInUse.setValue(value)
  }
  return value
}

WemoAccessory.prototype.updateSensorState = function (state, wasTriggered) {
  state = state | 0

  const value = !state

  if (this.accessory.getService(Service.ContactSensor) !== undefined) {
    const sensorState = this.accessory.getService(Service.ContactSensor).getCharacteristic(Characteristic.ContactSensorState)

    if (sensorState.value !== value) {
      this.log('%s - Sensor: %s', this.accessory.displayName, value ? 'Detected' : 'Not detected')
      sensorState.updateValue(
        value
          ? Characteristic.ContactSensorState.CONTACT_DETECTED
          : Characteristic.ContactSensorState.CONTACT_NOT_DETECTED
      )
    }
  } else if (this.accessory.getService(Service.GarageDoorOpener) !== undefined) {
    const targetDoorState = this.accessory.getService(Service.GarageDoorOpener).getCharacteristic(Characteristic.TargetDoorState)

    if (targetDoorState.value === Characteristic.TargetDoorState.OPEN) {
      if (value === Characteristic.CurrentDoorState.OPEN) {
        // Garage door's target state is OPEN and the garage door's current state is OPEN
        if (!this.isMoving) {
          this.updateCurrentDoorState(Characteristic.CurrentDoorState.OPEN, true)
        } else {
          this.updateCurrentDoorState(Characteristic.CurrentDoorState.OPENING, true)
        }
      } else if (value === Characteristic.CurrentDoorState.CLOSED) {
        // Garage door's target state is OPEN, but the garage door's current state is CLOSED,
        // it must have been triggered externally by a remote control
        this.log('%s - Set Target Door State: Closed (triggered by External)', this.accessory.displayName)
        delete this.isMoving
        targetDoorState.updateValue(Characteristic.TargetDoorState.CLOSED)
        this.updateCurrentDoorState(Characteristic.CurrentDoorState.CLOSED, true)
      }
    } else if (targetDoorState.value === Characteristic.TargetDoorState.CLOSED) {
      // Garage door's target state is CLOSED and the garage door's current state is CLOSED
      if (value === Characteristic.CurrentDoorState.CLOSED) {
        delete this.isMoving

        if (this.movingTimer) {
          clearTimeout(this.movingTimer)
          delete this.movingTimer
        }

        this.updateCurrentDoorState(Characteristic.CurrentDoorState.CLOSED, true)
      } else if (value === Characteristic.CurrentDoorState.OPEN) {
        // Garage door's target state is CLOSED, but the garage door's current state is OPEN,
        // it must have been triggered externally by a remote control
        this.log('%s - Set Target Door State: Open (triggered by External)', this.accessory.displayName)
        targetDoorState.updateValue(Characteristic.TargetDoorState.OPEN)

        if (wasTriggered) {
          this.setDoorMoving(Characteristic.TargetDoorState.OPEN)
        }
      }
    }
  }
  return value
}

WemoAccessory.prototype.updateSwitchState = function (state) {
  state = state | 0

  const value = !!state
  const service =
    this.accessory.getService(Service.Switch) ||
    this.accessory.getService(Service.Outlet) ||
    this.accessory.getService(Service.Lightbulb)
  const switchState = service.getCharacteristic(Characteristic.On)

  if (switchState.value !== value) {
    this.log('%s - Get state: %s', this.accessory.displayName, value ? 'On' : 'Off')
    switchState.updateValue(value)

    // for dimmer, poll brightness for ON events (supports night mode)
    if (value && this.device.deviceType === WemoClient.DEVICE_TYPE.Dimmer) {
      this.client.getBrightness(
        function (err, brightness) {
          if (err) {
            this.log('%s - Error ON brightness', this.accessory.displayName)
            return
          }
          this.updateBrightness(brightness)
        }.bind(this)
      )
    }

    if (!value && this.device.deviceType === WemoClient.DEVICE_TYPE.Insight) {
      this.updateOutletInUse(0)
      this.updateConsumption(0)
    }
  }
  return value
}

WemoAccessory.prototype.updateTotalConsumption = function (raw, raw2) {
  // raw=data.TodayConsumed, raw 2=data.TodayONTime
  const value = Math.round(raw / (1000 * 60)) // convert to Wh, raw is total mW minutes
  const kWh = value / 1000 // convert to kWh
  const onHours = Math.round(raw2 / 36) / 100 // convert to hours, raw2 in seconds
  const service = this.accessory.getService(Service.Switch) || this.accessory.getService(Service.Outlet)
  const totalConsumption = service.getCharacteristic(TotalConsumption)
  if (totalConsumption.value !== value) {
    this.log('%s - Total On Time: %s hours', this.accessory.displayName, onHours)
    this.log('%s - Total Consumption: %skWh', this.accessory.displayName, kWh)
    totalConsumption.updateValue(value)
  }
  return value
}

function WemoLinkAccessory (log, accessory, link, device) {
  this.accessory = accessory
  this.link = link
  this.device = device
  this.log = log

  this.setupDevice(link, device)

  this.accessory
    .getService(Service.AccessoryInformation)
    .setCharacteristic(Characteristic.Manufacturer, 'Belkin Wemo')
    .setCharacteristic(Characteristic.Model, 'Dimmable Bulb')
    .setCharacteristic(Characteristic.SerialNumber, device.deviceId)

  this.accessory.on(
    'identify',
    function (paired, callback) {
      this.log('%s - Identify', this.accessory.displayName)

      const switchState = this.accessory.getService(Service.Lightbulb).getCharacteristic(Characteristic.On)
      let count = 0

      if (switchState.value) {
        setOff()
      } else {
        setOn()
      }

      function setOn () {
        switchState.setValue(true)
        count++

        if (count === 6) {
          callback()
          return
        }

        setTimeout(function () {
          setOff()
        }, 500)
      }

      function setOff () {
        switchState.setValue(false)
        count++

        if (count === 6) {
          callback()
          return
        }

        setTimeout(function () {
          setOn()
        }, 750)
      }
    }.bind(this)
  )

  this.addEventHandlers()
  this.observeDevice()
}

WemoLinkAccessory.OPTIONS = {
  Brightness: '10008',
  Color: '10300',
  Switch: '10006',
  Temperature: '30301'
}

WemoLinkAccessory.prototype.addEventHandler = function (characteristic) {
  const service = this.accessory.getService(Service.Lightbulb)

  if (!service.testCharacteristic(characteristic)) {
    return
  }

  const object = service.getCharacteristic(characteristic)

  switch (characteristic) {
    case Characteristic.On:
      object.on('set', this.setSwitchState.bind(this))
      break
    case Characteristic.Brightness:
      object.on('set', this.setBrightness.bind(this))
      break
    case Characteristic.ColorTemperature:
      object.on('set', this.setColorTemperature.bind(this))
      break
  }
}

WemoLinkAccessory.prototype.addEventHandlers = function () {
  this.addEventHandler(Characteristic.On)
  this.addEventHandler(Characteristic.Brightness)
  this.addEventHandler(Characteristic.ColorTemperature)
}

WemoLinkAccessory.prototype.getSwitchState = function (callback) {
  callback = callback || function () {}

  this.client.getDeviceStatus(
    this.device.deviceId,
    function (err, capabilities) {
      if (err) {
        callback(null)
        return
      }
      if (capabilities[WemoLinkAccessory.OPTIONS.Switch] === undefined || !capabilities[WemoLinkAccessory.OPTIONS.Switch].length) {
        // we've get no data in the capabilities array, so it's off
        this.log('Offline: %s [%s]', this.accessory.displayName, this.device.deviceId)
        callback(null)
        return
      }

      this.log('Online: %s [%s]', this.accessory.displayName, this.device.deviceId)

      const value = this.updateSwitchState(capabilities[WemoLinkAccessory.OPTIONS.Switch])
      this.updateBrightness(capabilities[WemoLinkAccessory.OPTIONS.Brightness])
      this.updateColorTemperature(capabilities[WemoLinkAccessory.OPTIONS.Temperature])
      callback(null, value)
    }.bind(this)
  )
}

WemoLinkAccessory.prototype.miredKelvin = function (value) {
  return Math.round(100000 / (5 * value)) * 50
}

WemoLinkAccessory.prototype.observeDevice = function () {
  this.getSwitchState()

  // register eventhandler
  this.client.on(
    'statusChange',
    function (deviceId, capabilityId, value) {
      if (this.device.deviceId !== deviceId) {
        return
      }

      this.statusChange(deviceId, capabilityId, value)
    }.bind(this)
  )
}

WemoLinkAccessory.prototype.setBrightness = function (value, callback) {
  callback = callback || function () {}

  if (this.brightness === value) {
    callback(null)
    return
  }

  this._brightness = value

  // defer the actual update to smooth out changes from sliders
  setTimeout(
    function (caller, value) {
      // check that we actually have a change to make and that something
      // hasn't tried to update the brightness again in the last 0.1 seconds
      if (caller.brightness !== value && caller._brightness === value) {
        caller.client.setDeviceStatus(
          caller.device.deviceId,
          WemoLinkAccessory.OPTIONS.Brightness,
          (value * 255) / 100,
          function (err, response) {
            caller.log('%s - Set brightness: %s%', caller.accessory.displayName, value)
            caller.brightness = value
          }
        )
      }
    },
    100,
    this,
    value
  )
  callback(null)
}

WemoLinkAccessory.prototype.setColorTemperature = function (value, callback) {
  callback = callback || function () {}
  if (this.temperature === value) {
    callback(null)
    return
  }

  if (value < 154) {
    value = 154
  } else if (value > 370) {
    value = 370
  }

  this._temperature = value

  // defer the actual update to smooth out changes from sliders
  setTimeout(
    function (caller, value) {
      // check that we actually have a change to make and that something
      // hasn't tried to update the temperature again in the last 0.1 seconds
      if (caller.temperature !== value && caller._temperature === value) {
        caller.client.setDeviceStatus(
          caller.device.deviceId,
          WemoLinkAccessory.OPTIONS.Temperature,
          value + ':0',
          function (err, response) {
            caller.log('%s - Set color temperature: %s (%sK)', caller.accessory.displayName, value, caller.miredKelvin(value))
            caller.temperature = value
          }
        )
      }
    },
    100,
    this,
    value
  )
  callback(null)
}

WemoLinkAccessory.prototype.setSwitchState = function (state, callback) {
  const value = state | 0
  const switchState = this.accessory.getService(Service.Lightbulb).getCharacteristic(Characteristic.On)
  callback = callback || function () {}

  if (switchState.value === value) {
    callback(null)
    return
  }

  this.log('%s - Set state: %s', this.accessory.displayName, value ? 'On' : 'Off')
  this.client.setDeviceStatus(
    this.device.deviceId,
    WemoLinkAccessory.OPTIONS.Switch,
    value,
    function (err, response) {
      this.device.capabilities[WemoLinkAccessory.OPTIONS.Switch] = value
      callback(null)
    }.bind(this)
  )
}

WemoLinkAccessory.prototype.setupDevice = function (link, device) {
  this.link = link
  this.device = device
  this.client = wemoClient.client(link, this.log)

  this.client.on(
    'error',
    function (err) {
      this.log('%s reported error %s', this.accessory.displayName, err.code)
    }.bind(this)
  )
}

WemoLinkAccessory.prototype.statusChange = function (deviceId, capabilityId, value) {
  if (this.device.capabilities[capabilityId] === value) {
    return
  }

  this.device.capabilities[capabilityId] = value

  switch (capabilityId) {
    case WemoLinkAccessory.OPTIONS.Brightness:
      this.updateBrightness(value)
      break
    case WemoLinkAccessory.OPTIONS.Switch:
      this.updateSwitchState(value)
      break
    case WemoLinkAccessory.OPTIONS.Temperature:
      this.updateColorTemperature(value)
      break
    default:
      this.log('This capability (%s) not implemented', capabilityId)
  }
}

WemoLinkAccessory.prototype.updateBrightness = function (capability) {
  const value = Math.round((capability.split(':').shift() * 100) / 255)
  const brightness = this.accessory.getService(Service.Lightbulb).getCharacteristic(Characteristic.Brightness)
  if (brightness.value !== value) {
    this.log('%s - Get brightness: %s%', this.accessory.displayName, value)
    brightness.updateValue(value)
    this.brightness = value
  }
  return value
}

WemoLinkAccessory.prototype.updateColorTemperature = function (capability) {
  const service = this.accessory.getService(Service.Lightbulb)

  if (!service.testCharacteristic(Characteristic.ColorTemperature) || capability === undefined) {
    return
  }
  const value = Math.round(capability.split(':').shift())
  const temperature = service.getCharacteristic(Characteristic.ColorTemperature)
  if (temperature.value !== value) {
    this.log('%s - Get color temperature: %s (%sK)', this.accessory.displayName, value, this.miredKelvin(value))
    temperature.updateValue(value)
  }
  return value
}

WemoLinkAccessory.prototype.updateSwitchState = function (state) {
  state = state | 0

  const value = !!state
  const switchState = this.accessory.getService(Service.Lightbulb).getCharacteristic(Characteristic.On)

  if (switchState.value !== value) {
    this.log('%s - Get state: %s', this.accessory.displayName, value ? 'On' : 'Off')
    switchState.updateValue(value)
  }
  return value
}
