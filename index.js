/* jshint node: true */
// Wemo Platform Plugin for HomeBridge (https://github.com/nfarina/homebridge)
//
// Remember to add platform to config.json. Example:
// "platforms": [
//      {
//          "platform": "BelkinWeMo",
//          "name": "Belkin WeMo",
//          "noMotionTimer": 60,  // optional: [WeMo Motion only] a timer (in seconds) which is started no motion is detected, defaults to 60
//          "ignoredDevices": [], // optional: an array of Device serial numbers to ignore
//          "manualDevices": [],  // optional: an array of config urls for devices to be manually configured eg. "manualDevices": ["http://192.168.1.20:49153/setup.xml"]
//          "discovery": true,    // optional: turn off device discovery if not required
//          "wemoClient": {}      // optional: initialisation parameters to be passed to wemo-client
//      }
// ],

"use strict";

const DEFAULT_DOOR_OPEN_TIME = 20,
      DEFAULT_NO_MOTION_TIME = 60;

var Wemo  = require('wemo-client'),
    debug = require('debug')('homebridge-platform-wemo');

var Accessory, Characteristic, Consumption, Service, TotalConsumption, UUIDGen;
var wemo = new Wemo();

var doorOpenTimer, noMotionTimer;

module.exports = function (homebridge) {
    Accessory = homebridge.platformAccessory;
    Characteristic = homebridge.hap.Characteristic;
    Service = homebridge.hap.Service;
    UUIDGen = homebridge.hap.uuid;

    Consumption = function() {
        Characteristic.call(this, 'Consumption', 'E863F10D-079E-48FF-8F27-9C2605A29F52');

        this.setProps({
            format: Characteristic.Formats.UINT16,
            unit: 'W',
            perms: [Characteristic.Perms.READ, Characteristic.Perms.NOTIFY]
        });

        this.value = this.getDefaultValue();
    };
    require('util').inherits(Consumption, Characteristic);

    Consumption.UUID = 'E863F10D-079E-48FF-8F27-9C2605A29F52';

    TotalConsumption = function() {
        Characteristic.call(this, 'Total Consumption', 'E863F10C-079E-48FF-8F27-9C2605A29F52');

        this.setProps({
            format: Characteristic.Formats.UINT32,
            unit: 'kWh',
            perms: [Characteristic.Perms.READ, Characteristic.Perms.NOTIFY]
        });

        this.value = this.getDefaultValue();
    };
    require('util').inherits(TotalConsumption, Characteristic);

    TotalConsumption.UUID = 'E863F10C-079E-48FF-8F27-9C2605A29F52';

    homebridge.registerPlatform("homebridge-platform-wemo", "BelkinWeMo", WemoPlatform, true);
};

function WemoPlatform(log, config, api) {
    if (!config) {
        log.warn("Ignoring WeMo Platform setup because it is not configured");
        this.disabled = true;
        return;
    }

    this.config = config;

    wemo = new Wemo(this.config.wemoClient || {});

    if (this.config.ignoredDevices && this.config.ignoredDevices.constructor !== Array) {
        delete this.config.ignoredDevices;
    }

    if (this.config.manualDevices && this.config.manualDevices.constructor !== Array) {
        delete this.config.manualDevices;
    }

    this.discovery = this.config.discovery || true;
    this.ignoredDevices = this.config.ignoredDevices || [];
    this.manualDevices = this.config.manualDevices || [];

    var self = this;

    this.api = api;
    this.accessories = {};
    this.log = log;

    doorOpenTimer = this.config.doorOpenTimer || DEFAULT_DOOR_OPEN_TIME;
    noMotionTimer = this.config.noMotionTimer || this.config.no_motion_timer || DEFAULT_NO_MOTION_TIME;

    var addDiscoveredDevice = function(err, device) {
        var uuid = UUIDGen.generate(device.UDN);
        var accessory;

        if (device.deviceType === Wemo.DEVICE_TYPE.Bridge) {
            var client = this.client(device , self.log);

            client.getEndDevices(function (err, enddevices) {
                for (var i = 0, tot = enddevices.length; i < tot; i++) {
                    uuid = UUIDGen.generate(enddevices[i].deviceId);
                    accessory = self.accessories[uuid];

                    if (self.ignoredDevices.indexOf(device.serialNumber) !== -1) {
                        if (accessory !== undefined) {
                            self.removeAccessory(accessory);
                        }

                        return;
                    }

                    if (accessory === undefined) {
                        self.addLinkAccessory(device, enddevices[i]);
                    }
                    else {
                        self.accessories[uuid] = new WemoLinkAccessory(self.log, accessory, device, enddevices[i]);
                    }
                }
            });
        }
        else {
            accessory = self.accessories[uuid];

            if (self.ignoredDevices.indexOf(device.serialNumber) !== -1) {
                if (accessory !== undefined) {
                    self.removeAccessory(accessory);
                }

                return;
            }

            if (accessory === undefined) {
                self.addAccessory(device);
            }
            else if (accessory instanceof WemoAccessory) {
                self.log("Online and can update device: %s [%s]", accessory.displayName, device.macAddress);
                accessory.setupDevice(device);
                accessory.observeDevice(device);
            }
            else {
                self.log("Online: %s [%s]", accessory.displayName, device.macAddress);
               self.accessories[uuid] = new WemoAccessory(self.log, accessory, device);
            }
        }
    }

    this.api.on('didFinishLaunching', function() {
        for (var i in this.manualDevices) {
            wemo.load(this.manualDevices[i], addDiscoveredDevice);
        }

        if (this.discovery == true) {
            wemo.discover(addDiscoveredDevice);
        }
    }.bind(this));

    if (this.discovery == true) {
        setInterval(
            function(){
                wemo.discover(addDiscoveredDevice);
            },
            30000
        );
    }
}

WemoPlatform.prototype.addAccessory = function(device) {
    var serviceType;

    switch(device.deviceType) {
        case Wemo.DEVICE_TYPE.Insight:
        case Wemo.DEVICE_TYPE.Switch:
            serviceType = Service.Outlet;
            break;
        case Wemo.DEVICE_TYPE.LightSwitch:
            serviceType = Service.Switch;
            break;
        case Wemo.DEVICE_TYPE.Motion:
        case "urn:Belkin:device:NetCamSensor:1":
            serviceType = Service.MotionSensor;
            break;
        case Wemo.DEVICE_TYPE.Maker:
            serviceType = Service.Switch;
            break;
        default:
            this.log("Not Supported: %s [%s]", device.friendlyName, device.deviceType);
    }

    if (serviceType === undefined) {
        return;
    }

    this.log("Found: %s [%s]", device.friendlyName, device.macAddress);

    var accessory = new Accessory(device.friendlyName, UUIDGen.generate(device.UDN));
    var service = accessory.addService(serviceType, device.friendlyName);

    switch(device.deviceType) {
        case Wemo.DEVICE_TYPE.Insight:
            //service.addCharacteristic(Characteristic.OutletInUse);
            service.addCharacteristic(Consumption);
            service.addCharacteristic(TotalConsumption);
            break;
    }

    this.accessories[accessory.UUID] = new WemoAccessory(this.log, accessory, device);
    this.api.registerPlatformAccessories("homebridge-platform-wemo", "BelkinWeMo", [accessory]);
}

WemoPlatform.prototype.addLinkAccessory = function(link, device) {
    this.log("Found: %s [%s]", device.friendlyName, device.deviceId);

    var accessory = new Accessory(device.friendlyName, UUIDGen.generate(device.deviceId));
    accessory.addService(Service.Lightbulb, device.friendlyName).addCharacteristic(Characteristic.Brightness);

    this.accessories[accessory.UUID] = new WemoLinkAccessory(this.log, accessory, link, device);
    this.api.registerPlatformAccessories("homebridge-platform-wemo", "BelkinWeMo", [accessory]);
}

WemoPlatform.prototype.configureAccessory = function(accessory) {
    accessory.updateReachability(false);
    this.accessories[accessory.UUID] = accessory;
}

WemoPlatform.prototype.configurationRequestHandler = function(context, request, callback) {
    var self = this;
    var respDict = {};

    if (request && request.type === "Terminate") {
        context.onScreen = null;
    }

    var sortAccessories = function() {
        context.sortedAccessories = Object.keys(self.accessories).map(
            function(k){return this[k] instanceof Accessory ? this[k] : this[k].accessory},
            self.accessories
        ).sort(function(a,b) {if (a.displayName < b.displayName) return -1; if (a.displayName > b.displayName) return 1; return 0});

        return Object.keys(context.sortedAccessories).map(function(k) {return this[k].displayName}, context.sortedAccessories);
    }

    switch(context.onScreen) {
        case "DoRemove":
            if (request.response.selections) {
                for (var i in request.response.selections.sort()) {
                    this.removeAccessory(context.sortedAccessories[request.response.selections[i]]);
                }

                respDict = {
                    "type": "Interface",
                    "interface": "instruction",
                    "title": "Finished",
                    "detail": "Accessory removal was successful."
                }

                context.onScreen = null;
                callback(respDict);
            }
            else {
                context.onScreen = null;
                callback(respDict, "platform", true, this.config);
            }
            break;
        case "Menu":
            context.onScreen = "Remove";
        case "Remove":
            respDict = {
                "type": "Interface",
                "interface": "list",
                "title": "Select accessory to " + context.onScreen.toLowerCase(),
                "allowMultipleSelection": context.onScreen == "Remove",
                "items": sortAccessories()
            }

            context.onScreen = "Do" + context.onScreen;
            callback(respDict);
            break;
        default:
            if (request && (request.response || request.type === "Terminate")) {
                context.onScreen = null;
                callback(respDict, "platform", true, this.config);
            }
            else {
                respDict = {
                    "type": "Interface",
                    "interface": "list",
                    "title": "Select option",
                    "allowMultipleSelection": false,
                    "items": ["Remove Accessory"]
                }

                context.onScreen = "Menu";
                callback(respDict);
            }
    }
}

WemoPlatform.prototype.removeAccessory = function(accessory) {
    this.log("Remove Accessory: %s", accessory.displayName);

    if (this.accessories[accessory.UUID]) {
        delete this.accessories[accessory.UUID];
    }

    this.api.unregisterPlatformAccessories("homebridge-platform-wemo", "BelkinWeMo", [accessory]);
}

function WemoAccessory(log, accessory, device) {
    var self = this;

    this.accessory = accessory;
    this.device = device;
    this.log = log;

    this.setupDevice(device);

    this.accessory.getService(Service.AccessoryInformation)
        .setCharacteristic(Characteristic.Manufacturer, "Belkin WeMo")
        .setCharacteristic(Characteristic.Model, device.modelName)
        .setCharacteristic(Characteristic.SerialNumber, device.serialNumber)
        .setCharacteristic(Characteristic.FirmwareRevision, device.firmwareVersion);

    this.accessory.on('identify', function(paired, callback) {
        self.log("%s - identify", self.accessory.displayName);
        callback();
    });

    this.observeDevice(device);
    this.addEventHandlers();
}


WemoAccessory.prototype.addEventHandler = function(serviceName, characteristic) {
    serviceName = serviceName || Service.Switch;

    var service = this.accessory.getService(serviceName);

    if (service === undefined) {
        serviceName = Service.Outlet;
        service = this.accessory.getService(serviceName);
    }

    if (service === undefined) {
        return;
    }

    if (service.testCharacteristic(characteristic) === false) {
        return;
    }

    switch(characteristic) {
        case Characteristic.On:
            service
                .getCharacteristic(characteristic)
                .on('set', this.setSwitchState.bind(this));
            break;
        case Characteristic.TargetDoorState:
            service
                .getCharacteristic(characteristic)
                .on('set', this.setTargetDoorState.bind(this));
    }
}

WemoAccessory.prototype.addEventHandlers = function() {
    this.addEventHandler(Service.Switch, Characteristic.On);
    this.addEventHandler(Service.GarageDoorOpener, Characteristic.TargetDoorState);
}

WemoAccessory.prototype.getAttributes = function(callback) {
    callback = callback || function() {};

    this.client.getAttributes(function(err, attributes) {
        if (err) {
            this.log(err);
            callback();
            return;
        }

        this.device.attributes = attributes;

        // SwitchMode - Momentary
        if (attributes.SwitchMode == 1) {
            if (this.accessory.getService(Service.GarageDoorOpener) === undefined) {
                this.accessory.addService(Service.GarageDoorOpener, this.accessory.displayName);
                this.addEventHandler(Service.GarageDoorOpener, Characteristic.TargetDoorState);
            }

            if (this.accessory.getService(Service.Switch) !== undefined) {
                this.accessory.removeService(this.accessory.getService(Service.Switch));
            }

            if (this.accessory.getService(Service.ContactSensor) !== undefined) {
                this.accessory.removeService(this.accessory.getService(Service.ContactSensor));
            }
        }
        // SwitchMode - Toggle
        else if (attributes.SwitchMode == 0) {
            if (this.accessory.getService(Service.Switch) === undefined) {
                this.accessory.addService(Service.Switch, this.accessory.displayName);
                this.addEventHandler(Service.Switch, Characteristic.On);
            }

            if (this.accessory.getService(Service.GarageDoorOpener) !== undefined) {
                this.accessory.removeService(this.accessory.getService(Service.GarageDoorOpener));
            }
        }

        if (attributes.SensorPresent == 1) {
            if (this.accessory.getService(Service.Switch) !== undefined) {
                 if (this.accessory.getService(Service.ContactSensor) === undefined) {
                     this.log("%s - Add Service: %s", this.accessory.displayName, "Service.ContactSensor");
                     this.accessory.addService(Service.ContactSensor, this.accessory.displayName);
                 }
            }
            else if (this.accessory.getService(Service.GarageDoorOpener) !== undefined) {
                this.sensorPresent = true;
            }

            this.updateSensorState(attributes.Sensor);
        }
        else {
            var contactSensor = this.accessory.getService(Service.ContactSensor);

            if (contactSensor !== undefined) {
                this.log("%s - Remove Service: %s", this.accessory.displayName, "Service.ContactSensor");
                this.accessory.removeService(contactSensor);
            }

            delete this.sensorPresent;
        }

        if (this.accessory.getService(Service.Switch) !== undefined) {
            this.updateSwitchState(attributes.Switch);
        }

        callback();
    }.bind(this));
}

WemoAccessory.prototype.getSwitchState = function(callback) {
    if (this.device.deviceType === Wemo.DEVICE_TYPE.Maker) {
        this.getAttributes(function() {
            callback(null, this.accessory.getService(Service.Switch).getCharacteristic(Characteristic.On).value);
        }.bind(this));
    }
    else {
        this.client.getBinaryState(function(err, state) {
            if (err) {
                var service = this.accessory.getService(Service.Switch) || this.accessory.getService(Service.Outlet);
                callback(null, service.getCharacteristic(Characteristic.On).value);
                return;
            }

            callback(null, this.updateSwitchState(state));
        }.bind(this));
    }
}

WemoAccessory.prototype.observeDevice = function(device) {
    if (device.deviceType === Wemo.DEVICE_TYPE.Maker) {
        this.getAttributes();

        this.client.on('attributeList', function(name, value, prevalue, timestamp) {
            switch(name) {
                case 'Switch':
                    if (this.accessory.getService(Service.Switch) !== undefined) {
                        this.updateSwitchState(value);
                    }
                    else if (this.accessory.getService(Service.GarageDoorOpener) !== undefined) {
                        if (value == 1) {
                            // Triggered through HomeKit
                            if (this.homekitTriggered === true) {
                                delete this.homekitTriggered;
                            }
                            // Triggered using the button on the WeMo Maker
                            else {
                                var targetDoorState = this.accessory.getService(Service.GarageDoorOpener).getCharacteristic(Characteristic.TargetDoorState);
                                var state = targetDoorState.value ? Characteristic.TargetDoorState.OPEN : Characteristic.TargetDoorState.CLOSED;
                                this.log("%s - Set Target Door State: %s (triggered by Maker)", this.accessory.displayName, (state ? "Closed" : "Open"));
                                targetDoorState.updateValue(state);
                                this.setDoorMoving(state);
                            }
                        }
                    }
                    break;
                case 'Sensor':
                    this.updateSensorState(value, true);
                    break;
            }
        }.bind(this));
    }
    else {
        this.client.on('binaryState', function(state) {
            if (this.device.deviceType === Wemo.DEVICE_TYPE.Motion || this.device.deviceType === "urn:Belkin:device:NetCamSensor:1") {
                this.updateMotionDetected(state);
            }
            else {
                this.updateSwitchState(state);
            }
        }.bind(this));
    }

    if (device.deviceType === Wemo.DEVICE_TYPE.Insight) {
        this.client.on('insightParams', this.updateInsightParams.bind(this));
    }
}

WemoAccessory.prototype.setDoorMoving = function(targetDoorState, homekitTriggered) {
    var service = this.accessory.getService(Service.GarageDoorOpener);

    if (this.movingTimer) {
        clearTimeout(this.movingTimer);
        delete this.movingTimer;
    }

    if (this.isMoving === true) {
        delete this.isMoving;
        this.updateCurrentDoorState(Characteristic.CurrentDoorState.STOPPED);

        // Toggle TargetDoorState after receiving a stop
        setTimeout(
            function(obj, state) {
                obj.updateValue(state);
            },
            500,
            service.getCharacteristic(Characteristic.TargetDoorState),
            targetDoorState == Characteristic.TargetDoorState.OPEN ? Characteristic.TargetDoorState.CLOSED : Characteristic.TargetDoorState.OPEN
        );
        return;
    }

    this.isMoving = true;

    if (homekitTriggered === true) {
        var currentDoorState = service.getCharacteristic(Characteristic.CurrentDoorState);

        if (targetDoorState == Characteristic.TargetDoorState.CLOSED) {
            if (currentDoorState.value != Characteristic.CurrentDoorState.CLOSED) {
                this.updateCurrentDoorState(Characteristic.CurrentDoorState.CLOSING);
            }
        }
        else if (targetDoorState == Characteristic.TargetDoorState.OPEN) {
            if ((this.sensorPresent !== true && currentDoorState.value != Characteristic.CurrentDoorState.OPEN) || currentDoorState.value == Characteristic.CurrentDoorState.STOPPED) {
                this.updateCurrentDoorState(Characteristic.CurrentDoorState.OPENING);
            }
        }
    }

    this.movingTimer = setTimeout(function(self) {
        delete self.movingTimer;
        delete self.isMoving;

        var targetDoorState = self.accessory.getService(Service.GarageDoorOpener).getCharacteristic(Characteristic.TargetDoorState);

        if (self.sensorPresent !== true) {
            self.updateCurrentDoorState(targetDoorState.value ? Characteristic.CurrentDoorState.CLOSED : Characteristic.CurrentDoorState.OPEN);
            return;
        }

        self.getAttributes();
    }, doorOpenTimer * 1000, this);
}

WemoAccessory.prototype.setSwitchState = function(state, callback) {
    var value = state | 0;
    var service = this.accessory.getService(Service.Switch) || this.accessory.getService(Service.Outlet);
    var switchState = service.getCharacteristic(Characteristic.On);
    callback = callback || function() {};

    if (switchState.value != value) {  //remove redundent calls to setBinaryState when requested state is already achieved
        this.client.setBinaryState(value, function (err) {
            if(!err) {
                this.log("%s - Set state: %s", this.accessory.displayName, (value ? "On" : "Off"));
                callback(null);
            }
            else {
                this.log("%s - Set state FAILED: %s. Error: %s", this.accessory.displayName, (value ? "on" : "off"), err.code);
                callback(new Error(err));
            }
        }.bind(this));
    }
    else {
        callback(null);
    }
}

WemoAccessory.prototype.setTargetDoorState = function(state, callback) {
    var value = state | 0;
    callback = callback || function() {};

    this.homekitTriggered = true;

    var currentDoorState = this.accessory.getService(Service.GarageDoorOpener).getCharacteristic(Characteristic.CurrentDoorState);

    if (this.isMoving !== true) {
        if (value == Characteristic.TargetDoorState.CLOSED && currentDoorState.value == Characteristic.CurrentDoorState.CLOSED) {
            this.log("Door already closed");
            callback(null);
            return;
        }
        else if (value == Characteristic.TargetDoorState.OPEN && currentDoorState.value == Characteristic.CurrentDoorState.OPEN) {
            this.log("Door already open");
            callback(null);
            return;
        }
    }

    this.client.setBinaryState(1, function (err) {
        if(!err) {
            this.log("%s - Set Target Door State: %s (triggered by HomeKit)",
                this.accessory.displayName,
                (value ? "Closed" : "Open")
            );

            this.setDoorMoving(value, true);

            callback(null);
        }
        else {
            this.log("%s - Set state FAILED: %s. Error: %s", this.accessory.displayName, (value ? "on" : "off"), err.code);
            callback(new Error(err));
        }
    }.bind(this));
}

WemoAccessory.prototype.setupDevice = function(device) {
    this.device = device;
    this.client = wemo.client(device);

    this.client.on('error', function(err) {
      this.log('%s reported error %s', this.accessory.displayName, err.code);
    }.bind(this));

    this.updateReachability(true);
}

WemoAccessory.prototype.updateConsumption = function(raw) {
    var value = Math.round(raw / 1000);
    var service = this.accessory.getService(Service.Switch) || this.accessory.getService(Service.Outlet);
    var consumption = service.getCharacteristic(Consumption);

    if (consumption.value !== value) {
        this.log("%s - Consumption: %sw", this.accessory.displayName, value);
        consumption.setValue(value);
    }

    return value;
}

WemoAccessory.prototype.updateInsightParams = function(state, power, data) {
    this.updateSwitchState(state);
    this.updateOutletInUse(state);
    this.updateConsumption(power);
    this.updateTotalConsumption(data.TodayConsumed);
}

WemoAccessory.prototype.updateOutletInUse = function(state) {
    state = state | 0;

    var value = !!state;
    var service = this.accessory.getService(Service.Switch) || this.accessory.getService(Service.Outlet);
    var outletInUse = service.getCharacteristic(Characteristic.OutletInUse);

    if (outletInUse.value !== value) {
        this.log("%s - Outlet In Use: %s", this.accessory.displayName, (value ? "Yes" : "No"));
        outletInUse.setValue(value);
    }

    return value;
}

WemoAccessory.prototype.updateMotionDetected = function(state) {
    state = state | 0;

    var value = !!state;
    var motionDetected = this.accessory.getService(Service.MotionSensor).getCharacteristic(Characteristic.MotionDetected);

    if ((value === motionDetected.value && this.motionTimer === undefined) || (value === false && this.motionTimer)) {
        return;
    }

    if (value === true || noMotionTimer == 0) {
        if (this.motionTimer) {
            this.log("%s - no motion timer stopped", this.accessory.displayName);
            clearTimeout(this.motionTimer);
            delete this.motionTimer;
        }

        this.log("%s - Motion Sensor: %s", this.accessory.displayName, (value ? "Detected" : "Clear"));
        motionDetected.setValue(value);
    }
    else {
        this.log("%s - no motion timer started [%d secs]", this.accessory.displayName, noMotionTimer);
        clearTimeout(this.motionTimer);
        this.motionTimer = setTimeout(function(self) {
            self.log("%s - Motion Sensor: Clear; no motion timer completed", self.accessory.displayName);
            self.accessory.getService(Service.MotionSensor).getCharacteristic(Characteristic.MotionDetected).setValue(false);
            delete self.motionTimer;
        }, noMotionTimer * 1000, this);
    }
}

WemoAccessory.prototype.updateReachability = function(reachable) {
    this.accessory.updateReachability(reachable);
}

WemoAccessory.prototype.updateCurrentDoorState = function(value, actualFeedback) {
    var state;

    switch(value) {
        case Characteristic.CurrentDoorState.OPEN:
            state = "Open";
            break;
        case Characteristic.CurrentDoorState.CLOSED:
            state = "Closed";
            break;
        case Characteristic.CurrentDoorState.OPENING:
            state = "Opening";
            break;
        case Characteristic.CurrentDoorState.CLOSING:
            state = "Closing";
            break;
        case Characteristic.CurrentDoorState.STOPPED:
            state = "Stopped";
            break;
    }

    this.log("%s - Get Current Door State: %s",
        this.accessory.displayName,
        state
    );

    this.accessory
        .getService(Service.GarageDoorOpener)
        .getCharacteristic(Characteristic.CurrentDoorState)
        .updateValue(value);
}

WemoAccessory.prototype.updateSensorState = function(state, wasTriggered) {
    state = state | 0;

    var value = !state;

    if (this.accessory.getService(Service.ContactSensor) !== undefined) {
        var sensorState = this.accessory.getService(Service.ContactSensor).getCharacteristic(Characteristic.ContactSensorState);

        if (sensorState.value !== value) {
            this.log("%s - Sensor: %s", this.accessory.displayName, (value ? "Detected" : "Not detected"));
            sensorState.updateValue(value ?  Characteristic.ContactSensorState.CONTACT_DETECTED: Characteristic.ContactSensorState.CONTACT_NOT_DETECTED);
        }
    }
    else if (this.accessory.getService(Service.GarageDoorOpener) !== undefined) {
        var targetDoorState = this.accessory.getService(Service.GarageDoorOpener).getCharacteristic(Characteristic.TargetDoorState);

        if (targetDoorState.value == Characteristic.TargetDoorState.OPEN) {
            // Garage door's target state is OPEN and the garage door's current state is OPEN
            if (value == Characteristic.CurrentDoorState.OPEN) {
                if (this.isMoving !== true) {
                    this.updateCurrentDoorState(Characteristic.CurrentDoorState.OPEN, true);
                }
                else {
                    this.updateCurrentDoorState(Characteristic.CurrentDoorState.OPENING, true);
                }
            }
            // Garage door's target state is OPEN, but the garage door's current state is CLOSED,
            // it must have been triggered externally by a remote control
            else if (value == Characteristic.CurrentDoorState.CLOSED) {
                this.log("%s - Set Target Door State: Closed (triggered by External)", this.accessory.displayName);
                delete this.isMoving;
                targetDoorState.updateValue(Characteristic.TargetDoorState.CLOSED);
                this.updateCurrentDoorState(Characteristic.CurrentDoorState.CLOSED, true);
            }
        }
        else if (targetDoorState.value == Characteristic.TargetDoorState.CLOSED) {
            // Garage door's target state is CLOSED and the garage door's current state is CLOSED
            if (value == Characteristic.CurrentDoorState.CLOSED) {
                delete this.isMoving;

                if (this.movingTimer) {
                    clearTimeout(this.movingTimer);
                    delete this.movingTimer;
                }

                this.updateCurrentDoorState(Characteristic.CurrentDoorState.CLOSED, true);
            }
            // Garage door's target state is CLOSED, but the garage door's current state is OPEN,
            // it must have been triggered externally by a remote control
            else if (value == Characteristic.CurrentDoorState.OPEN) {
                this.log("%s - Set Target Door State: Open (triggered by External)", this.accessory.displayName);
                targetDoorState.updateValue(Characteristic.TargetDoorState.OPEN);

                if (wasTriggered === true) {
                    this.setDoorMoving(Characteristic.TargetDoorState.OPEN);
                }
            }
        }
    }

    return value;
}

WemoAccessory.prototype.updateSwitchState = function(state) {
    state = state | 0;

    var value = !!state;
    var service = this.accessory.getService(Service.Switch) || this.accessory.getService(Service.Outlet);
    var switchState = service.getCharacteristic(Characteristic.On);

    if (switchState.value !== value) {
        this.log("%s - Get state: %s", this.accessory.displayName, (value ? "On" : "Off"));
        switchState.updateValue(value);

        if(value === false && this.device.deviceType === Wemo.DEVICE_TYPE.Insight) {
            this.updateOutletInUse(0);
            this.updateConsumption(0);
        }
    }

    return value;
}

WemoAccessory.prototype.updateTotalConsumption = function(raw) {
    var value = Math.round(raw / 10000 * 6) / 100;
    var service = this.accessory.getService(Service.Switch) || this.accessory.getService(Service.Outlet);
    var totalConsumption = service.getCharacteristic(TotalConsumption);

    if (totalConsumption.value !== value) {
        this.log("%s - Total Consumption: %skwh", this.accessory.displayName, value);
        totalConsumption.updateValue(value);
    }

    return value;
}

function WemoLinkAccessory(log, accessory, link, device) {
    var self = this;

    this.accessory = accessory;
    this.link = link;
    this.device = device;
    this.log = log;
    this.client = wemo.client(link, log);

    this.client.on('error', function(err) {
        this.log('%s reported error %s', this.accessory.displayName, err.code);
    }.bind(this));

    this.updateReachability(false);

    this.accessory.getService(Service.AccessoryInformation)
        .setCharacteristic(Characteristic.Manufacturer, "Belkin WeMo")
        .setCharacteristic(Characteristic.Model, "Dimmable Bulb")
        .setCharacteristic(Characteristic.SerialNumber, device.deviceId);

    this.accessory.on('identify', function(paired, callback) {
        this.log("%s - Identify", this.accessory.displayName);

        var switchState = this.accessory.getService(Service.Lightbulb).getCharacteristic(Characteristic.On);
        var count = 0;

        if (switchState.value == true) {
            setOff();
        }
        else {
            setOn();
        }

        function setOn() {
            switchState.setValue(true);
            count++;

            if (count == 6) {
                callback();
                return;
            }

            setTimeout(function() {
                setOff();
            }, 500);
        }

        function setOff() {
            switchState.setValue(false);
            count++;

            if (count == 6) {
                callback();
                return;
            }

            setTimeout(function() {
                setOn();
            }, 750);
        }
    }.bind(this));

    this.addEventHandlers();
    this.getSwitchState();

    // register eventhandler
    this.client.on('statusChange', function(deviceId, capabilityId, value) {
        if (this.device.deviceId !== deviceId){
            return;
        }

        this.statusChange(deviceId, capabilityId, value);
    }.bind(this));
}

WemoLinkAccessory.OPTIONS = {
    Brightness: '10008',
    Switch:     '10006'
}

WemoLinkAccessory.prototype.addEventHandler = function(characteristic) {
    var service = this.accessory.getService(Service.Lightbulb)

    if (service.testCharacteristic(characteristic) === false) {
        return;
    }

    switch(characteristic) {
        case Characteristic.On:
            service
                .getCharacteristic(Characteristic.On)
                .on('set', this.setSwitchState.bind(this));
            break;
        case Characteristic.Brightness:
            service
                .getCharacteristic(Characteristic.Brightness)
                .on('set', this.setBrightness.bind(this));
            break;
    }
}

WemoLinkAccessory.prototype.addEventHandlers = function () {
    this.addEventHandler(Characteristic.On);
    this.addEventHandler(Characteristic.Brightness);
}

WemoLinkAccessory.prototype.getSwitchState = function(callback) {
    callback = callback || function() {};

    this.client.getDeviceStatus(this.device.deviceId, function(err, capabilities) {
        if(err) {
            callback(null);
            return;
        }

        if (capabilities[WemoLinkAccessory.OPTIONS.Switch] === undefined || !capabilities[WemoLinkAccessory.OPTIONS.Switch].length) { // we've get no data in the capabilities array, so it's off
            this.log("Offline: %s [%s]", this.accessory.displayName, this.device.deviceId);
            this.updateReachability(false);
            callback(null);
            return;
        }

        this.log("Online: %s [%s]", this.accessory.displayName, this.device.deviceId);

        var value = this.updateSwitchState(capabilities[WemoLinkAccessory.OPTIONS.Switch]);
        this.updateBrightness(capabilities[WemoLinkAccessory.OPTIONS.Brightness]);
        this.updateReachability(true);
        callback(null, value);
    }.bind(this));
}

WemoLinkAccessory.prototype.setBrightness = function(value, callback) {
    callback = callback || function() {};

    if (this.brightness == value) {
        callback(null);
        return;
    }

    this._brightness = value;

    //defer the actual update to smooth out changes from sliders
    setTimeout(function(caller, value) {
        //check that we actually have a change to make and that something
        //hasn't tried to update the brightness again in the last 0.1 seconds
        if (caller.brightness !== value && caller._brightness == value) {
            caller.client.setDeviceStatus(caller.device.deviceId, 10008, value * 255 / 100, function(err, response) {
                caller.log("%s - Set brightness: %s%", caller.accessory.displayName, value);
                caller.brightness = value;
            }.bind(caller));
        }
    }, 100, this, value);

    callback(null);
}

WemoLinkAccessory.prototype.setSwitchState = function(state, callback) {
    var value = state | 0;
    var switchState = this.accessory.getService(Service.Lightbulb).getCharacteristic(Characteristic.On);
    callback = callback || function() {};

    if(switchState.value == value) {
        callback(null);
        return;
    }

    this.log("%s - Set state: %s", this.accessory.displayName, (value ? "On" : "Off"));
    this.client.setDeviceStatus(this.device.deviceId, WemoLinkAccessory.OPTIONS.Switch, value, function(err, response) {
        this.device.capabilities[WemoLinkAccessory.OPTIONS.Switch] = value;
        callback(null);
    }.bind(this));
}

WemoLinkAccessory.prototype.statusChange = function(deviceId, capabilityId, value) {
    if (this.accessory.reachable === false) {
        this.updateReachability(true);
    }

    if (this.device.capabilities[capabilityId] == value) {
        return;
    }

    this.device.capabilities[capabilityId] = value;

    switch(capabilityId) {
        case WemoLinkAccessory.OPTIONS.Brightness:
            this.updateBrightness(value);
            break;
        case WemoLinkAccessory.OPTIONS.Switch:
            this.updateSwitchState(value);
            break;
        default:
            this.log("This capability (%s) not implemented", capabilityId);
    }
}

WemoLinkAccessory.prototype.updateBrightness = function(capability) {
    var value = Math.round(capability.split(':').shift() * 100 / 255 );
    var brightness = this.accessory.getService(Service.Lightbulb).getCharacteristic(Characteristic.Brightness);

    if (brightness.value != value) {
        this.log("%s - Get brightness: %s%", this.accessory.displayName, value);
        brightness.updateValue(value);
        this.brightness = value;
    }

    return value;
}

WemoLinkAccessory.prototype.updateReachability = function(reachable) {
    this.accessory.updateReachability(reachable);
}

WemoLinkAccessory.prototype.updateSwitchState = function(state) {
    state = state | 0;

    var value = !!state;
    var switchState = this.accessory.getService(Service.Lightbulb).getCharacteristic(Characteristic.On);

    if (switchState.value != value) {
        this.log("%s - Get state: %s", this.accessory.displayName, (value ? "On" : "Off"));
        switchState.updateValue(value);
    }

    return value;
}
