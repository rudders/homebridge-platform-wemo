/* jshint node: true */
// Wemo Platform Plugin for HomeBridge (https://github.com/nfarina/homebridge)
//
// Remember to add platform to config.json. Example:
// "platforms": [
//      {
//          "platform": "BelkinWeMo",
//          "name": "Belkin WeMo",
//          "expected_accessories": "", stop looking for wemo accessories after this many found (excluding Wemo Link(s))
//          "timeout": "" //defaults to 10 seconds that we look for accessories.
//          "no_motion_timer": 60 // optional: [WeMo Motion only] a timer (in seconds) which is started no motion is detected, defaults to 60
//      }
// ],

"use strict";

var Accessory, Characteristic, PowerConsumption, Service, uuid;
var Wemo = require('wemo-client');  
var wemo = new Wemo();

var noMotionTimer;

module.exports = function (homebridge) {
    Service = homebridge.hap.Service;
    Characteristic = homebridge.hap.Characteristic;
    Accessory = homebridge.hap.Accessory;
    uuid = homebridge.hap.uuid;

    PowerConsumption = function() {
        Characteristic.call(this, 'Power Consumption', 'AE48F447-E065-4B31-8050-8FB06DB9E087')

        this.setProps({
            format: Characteristic.Formats.FLOAT,
            unit: 'W',
            perms: [Characteristic.Perms.READ, Characteristic.Perms.NOTIFY]
        });

        this.value = this.getDefaultValue();
    };
    require('util').inherits(PowerConsumption, Characteristic);

    homebridge.registerPlatform("homebridge-platform-wemo", "BelkinWeMo", WemoPlatform);
};

function WemoPlatform(log, config) {
    this.log = log;
    this.log("Wemo Platform Plugin Loaded ");
    this.expectedAccessories = config.expected_accessories || 0 ; // default to false if not specficied
    this.timeout = config.timeout || 10; // default to 10 seconds if not specified

    noMotionTimer = config.no_motion_timer || 60;
}

WemoPlatform.prototype = {
    accessories: function (callback) {
        this.log("Fetching the Wemo Accessories, expecting %s and will wait %s seconds to find them.",
            this.expectedAccessories ? this.expectedAccessories : "an unknown number" , this.timeout);
        var foundAccessories = [];
        var self = this;
        wemo.discover(function (device) {
            self.log("Found: %s, type: %s", device.friendlyName, device.deviceType.split(":")[3]);
            if (device.deviceType === Wemo.DEVICE_TYPE.Bridge) { // a wemolink bridge - find bulbs
                var client = this.client(device);
                client.getEndDevices(function (err, enddevices) {
                    // this calls us back with an array of enddevices (bulbs)
                    for (var i = 0, tot = enddevices.length; i < tot; i++) {
                        self.log("Found endDevice: %s, id: %s", enddevices[i].friendlyName, enddevices[i].deviceId);
                        var accessory = new WemoAccessory(self.log, device, enddevices[i]);
                        foundAccessories.push(accessory);
                        self.log("Discovered %s accessories of %s ",
                                    foundAccessories.length,
                                    self.expectedAccessories ? self.expectedAccessories : "an unspecified number of accessories")
                        if (foundAccessories.length == self.expectedAccessories){
                            if (timer) {clearTimeout(timer);}
                            callback(foundAccessories);
                        }
                    }
                });
            } else if (device.deviceType !== Wemo.DEVICE_TYPE.Maker) {
                var accessory = new WemoAccessory(self.log, device, null);
                foundAccessories.push(accessory);
                self.log("Discovered %s accessories of %s ",
                            foundAccessories.length,
                            self.expectedAccessories ? self.expectedAccessories : "an unspecified number of accessories");
                if (foundAccessories.length == self.expectedAccessories)
                    {
                    self.log("Woohoo!!! all %s accessories found.", self.expectedAccessories );
                    if (timer) {clearTimeout(timer);} // if setTimeout got called already cancel it.
                    callback(foundAccessories);
                    }
                }
        });

        // we'll wait here for the accessories to be found unless the specified number of 
        // accessories has already been found in which case the timeout is cancelled!!

        var timer = setTimeout(function () {
            if(self.expectedAccessories) {
                self.log("We have timed out and only discovered %s of the specified %s devices - try restarting homebridge or increasing timeout in config.json",
                    foundAccessories.length, self.expectedAccessories);
            }
            callback(foundAccessories);
        }, self.timeout * 1000);
    },
};

function WemoAccessory(log, device, enddevice) {
    var self = this;

    this.device = device;
    this.log = log;
    this._client = wemo.client(device);

    if(device.deviceType === Wemo.DEVICE_TYPE.Bridge) {
        this.id = device.deviceId;
        this.name = enddevice.friendlyName;
        this.enddevice = enddevice;
        this.brightness = null;
        this._capabilities = enddevice.capabilities;

        // we can't depend on the capabilities returned from Belkin so we'll go ask expliciitly.
        this.getStatus(function (err) {
            self.onState = (self._capabilities['10006'].substr(0,1) === '1') ? true : false ;
            self.log("%s (bulb) reported as %s", self.name, self.onState > 0 ? "on" : "off");
            self.brightness = Math.round(self._capabilities['10008'].split(':').shift() / 255 * 100 );
            self.log("%s (bulb) reported as at %s\% brightness", self.name, self.brightness);
            });

        // register eventhandler
        this._client.on('statusChange', function(deviceId, capabilityId, value) {
            self._statusChange(deviceId, capabilityId, value);
        });
    } else {
        this.id = device.macAddress;
        this.name = device.friendlyName;

        // set onState for convenience
        this.onState = device.binaryState > 0 ? true : false ;
        this.log("%s is %s", this.name, this.onState);

        // register eventhandler
        var timer = null;

        this._client.on('binaryState', function(state){
            self.log('%s binaryState: %s', this.name, state > 0 ? "on" : "off");
            self.onState = state > 0 ? true : false ;

            if (self.service) {
                if (self.onState != self._onState) {
                    if (self.device.deviceType == Wemo.DEVICE_TYPE.Motion || self.device.deviceType == "urn:Belkin:device:NetCamSensor:1") {
                        self.updateMotionDetected();
                    }
                    else {
                        self.service.getCharacteristic(Characteristic.On).setValue(self.onState);

                        if(self.onState == false && self.device.deviceType === Wemo.DEVICE_TYPE.Insight) {
                            self.inUse = false;
                            self.updateInUse();

                            self.powerUsage = 0;
                            self.updatePowerUsage();
                        }
                    }

                    self._onState = self.onState;
                }
            }
        }.bind(this));

        if(device.deviceType === Wemo.DEVICE_TYPE.Insight) {
            this._client.on('insightParams', function(state, power){
                //self.log('%s inUse: %s', this.name, state);
                self.inUse = state == 1 ? true : false ;
                self.powerUsage = Math.round(power / 100) / 10;

                if (self.service) {
                    self.updateInUse();
                    self.updatePowerUsage();

                }
            }.bind(this));
        }
    }
}

WemoAccessory.prototype._statusChange = function(deviceId, capabilityId, value) {
    /*
         We recieve this notification if the wemo's are changed by Homekit (i.e us) or 
         some other trigger (i.e. any of the pethora of wemo apps).
         We want to update homekit with these changes, 
         to do that we need to use setValue which triggers another call back to here which
         we need to ignore - much of this function deals with the idiosyncrasies around this issue.
    */
    if (this.enddevice.deviceId != deviceId){
        // we get called for every bulb on the link so lets get out of here if the call is for a differnt bulb
        this.log('statusChange Ignored (device): ', this.enddevice.deviceId, deviceId, capabilityId, value);
        return;
        }
    
    if (this._capabilities[capabilityId] === value) {
        // nothing's changed - lets get out of here to stop an endless loop as 
        // this callback was probably triggered by us updating HomeKit
        this.log('statusChange Ignored (capability): ', deviceId, capabilityId, value);
        return;
        }

    this.log('statusChange processing: ', deviceId, capabilityId, value);

    // update our internal array with newly passed value.
    this._capabilities[capabilityId] = value;
    
    switch(capabilityId) {
        case '10008': // this is a brightness change
            // update our convenience variable ASAP to minimise race condition possibiities
            this.brightness = Math.round(this._capabilities['10008'].split(':').shift() / 255 * 100 );
 
            // changing wemo bulb brightness always turns them on so lets reflect this locally and in homekit.
            // do we really need this or do we get both status change messages from wemo?
            if (!this.onState){ // if off
                this.onState = true; // change convenience variable to on and call homekit which will trigger another ignored statusChange
                this.log('Update homekit onState: %s is %s', this.name, this.onState);
                this._capabilities['10006'] = '1'; 
                this.service.getCharacteristic(Characteristic.On).setValue(this.onState);
                }
            
            // call setValue to update HomeKit and iOS (this generates another statusChange that will get ignored)
            this.log('Update homekit brightness: %s is %s', this.name, this.brightness);
            this.service.getCharacteristic(Characteristic.Brightness).setValue(this.brightness);


            break;
            
        case '10006': // on/off/etc
            // reflect change of onState from potentially and external change (from Wemo App for instance)
            this.onState = (this._capabilities['10006'].substr(0,1) === '1') ? true : false;
            // similarly we need to update iOS with this change - which will trigger another state shange which we'll ignore    
            this.log('Update homekit onState: %s is %s', this.name, this.onState);
            this.service.getCharacteristic(Characteristic.On).setValue(this.onState);
            break;
            
        default:
            console.log("This capability (%s) not implemented", capabilityId);
    }
}

WemoAccessory.prototype.getServices = function () {
    var services = [];
    // set up the accessory information - not sure how mandatory any of this is.
    var service = new Service.AccessoryInformation();
    service.setCharacteristic(Characteristic.Name, this.name).setCharacteristic(Characteristic.Manufacturer, "WeMo");

    if (this.device.deviceType === Wemo.DEVICE_TYPE.Bridge) {
        // todo - complete this information - if it was available.... which unfortunately it isn't
/*
        service
            .setCharacteristic(Characteristic.Model, this.enddevice.modelName)
            .setCharacteristic(Characteristic.SerialNumber, this.enddevice.serialNumber)
            .setCharacteristic(Characteristic.FirmwareRevision, this.enddevice.firmwareVersion)
            .setCharacteristic(Characteristic.HardwareRevision, this.enddevice.modelNumber);
*/
    }
    else {
        service
            .setCharacteristic(Characteristic.Model, this.device.modelName)
            .setCharacteristic(Characteristic.SerialNumber, this.device.serialNumber)
            .setCharacteristic(Characteristic.FirmwareRevision, this.device.firmwareVersion)
            .setCharacteristic(Characteristic.HardwareRevision, this.device.modelNumber);
    }

    services.push(service);

    switch(this.device.deviceType) {
        case Wemo.DEVICE_TYPE.Bridge:
            this.service = new Service.Lightbulb(this.name);

            this.service.getCharacteristic(Characteristic.On).on('set', this.setOnStatus.bind(this)).on('get', this.getOnStatus.bind(this));
            this.service.getCharacteristic(Characteristic.Brightness).on('set', this.setBrightness.bind(this)).on('get', this.getBrightness.bind(this));

            services.push(this.service);
            break;
        case Wemo.DEVICE_TYPE.Insight:
            this.service = new Service.Switch(this.name);

            this.service.getCharacteristic(Characteristic.On).on('set', this.setOn.bind(this)).on('get', this.getOn.bind(this));
            this.service.addCharacteristic(Characteristic.OutletInUse).on('get', this.getInUse.bind(this));
            this.service.addCharacteristic(PowerConsumption).on('get', this.getPowerUsage.bind(this));

            services.push(this.service);
            break;
        case Wemo.DEVICE_TYPE.Switch:
        case "urn:Belkin:device:lightswitch:1":
            this.service = new Service.Switch(this.name);

            this.service.getCharacteristic(Characteristic.On).on('set', this.setOn.bind(this)).on('get', this.getOn.bind(this));

            services.push(this.service);
            break;
        case Wemo.DEVICE_TYPE.Motion:
        case "urn:Belkin:device:NetCamSensor:1":
            this.service = new Service.MotionSensor(this.name);

            this.service.getCharacteristic(Characteristic.MotionDetected).on('get', this.getOn.bind(this));

            services.push(this.service);
            break;
        default:
            console.log("Not implemented");
    }
    //  this.log("Services for %s: ", this.name, services);
    return services;
};

WemoAccessory.prototype.setOn = function (value, cb) {

    if (this.onState != value) {  //remove redundent calls to setBinaryState when requested state is already achieved
        this.log("setOn: %s to %s", this.name, value > 0 ? "on" : "off");
        this._client.setBinaryState(value ? 1 : 0);
        this.onState = value;
        }
    if (cb) cb(null);
}

WemoAccessory.prototype.getOn = function (cb) {
    this.log("getOn: %s is %s ", this.name, this.onState > 0 ? "on" : "off");
    if (cb) cb(null, this.onState);
}

WemoAccessory.prototype.getInUse = function (cb) {
    //this.log("getInUse: %s is %s ", this.name, this.inUse);
    if (cb) cb(null, this.inUse);
}

WemoAccessory.prototype.getPowerUsage = function (cb) {
    //this.log("getPowerUsage: %s is %s ", this.name, this.powerUsage);
    if (cb) cb(null, this.powerUsage);
}

WemoAccessory.prototype.getStatus = function (cb) {
    // this function is called on initialisation of a Bulbs because we can't rely on Belkin's
    // capabilities structure on initialisation so we'll explicity retrieve it here.
    var self = this;
    this._client.getDeviceStatus(this.enddevice.deviceId, function (err, capabilities) {
        if(err) {
            if(cb) {cb("unknown error getting device status (getStatus)", capabilities)}
            }
        else {
            if (!capabilities['10006'].length) { // we've get no data in the capabilities array, so it's off
                self.log("%s appears to be off, i.e. at the power!",self.name);
                }
            else {
//                 self.log("getStatus: %s is ", self.name, capabilities);
                self._capabilities = capabilities;
                }
            if (cb) { cb(null) }
            }
        });
}

WemoAccessory.prototype.setOnStatus = function (value, cb) {
//  var client = wemo.client(this.device);
    this.onState = value;
    this.log("setOnStatus: %s to %s", this.name, value > 0 ? "on" : "off");
    this._client.setDeviceStatus(this.enddevice.deviceId, 10006, (value ? 1 : 0));
    if (cb) cb(null);
}

WemoAccessory.prototype.getOnStatus = function (cb) {
    this.log("getOnStatus: %s is %s", this.name, this.onState > 0 ? "on" : "off")
    if(cb) cb(null, this.onState);
}

WemoAccessory.prototype.setBrightness = function (value, cb) {
//  var client = wemo.client(this.device);
    this._client.setDeviceStatus(this.enddevice.deviceId, 10008, value*255/100 );
    this.log("setBrightness: %s to %s\%", this.name, value);
    if (cb) cb(null);
}

WemoAccessory.prototype.getBrightness = function (cb) {
    this.log("getBrightness: %s is %s\%", this.name, this.brightness)
    if(cb) cb(null, this.brightness);
}

WemoAccessory.prototype.updateInUse = function () {
    if (this.inUse != this._inUse) {
        this.service.getCharacteristic(Characteristic.OutletInUse).setValue(this.inUse);
        this._inUse = this.inUse;
    }
}

WemoAccessory.prototype.updateMotionDetected = function() {
    var self = this;

    if (this.onState == true || this._onState == undefined) {
        if (this.motionTimer) {
            this.log("%s - no motion timer stopped", this.name);
            clearTimeout(this.motionTimer);
            this.motionTimer = null;
        }

        this.log("%s - notify binaryState change: %s", this.name, +this.onState);
        this.service.getCharacteristic(Characteristic.MotionDetected).setValue(this.onState);
    }
    else {
        this.log("%s - no motion timer started [%d secs]", self.name, noMotionTimer);
        clearTimeout(this.motionTimer);
        this.motionTimer = setTimeout(function () {
            self.log("%s - no motion timer completed; notify binaryState change: 0", self.name);
            self.service.getCharacteristic(Characteristic.MotionDetected).setValue(false);
            self._onState = false;
            self.motionTimer = null;
        }, noMotionTimer * 1000);
    }
}

WemoAccessory.prototype.updatePowerUsage = function () {
    if (this.powerUsage != this._powerUsage) {
        this.service.getCharacteristic(PowerConsumption).setValue(this.powerUsage);
        this._powerUsage = this.powerUsage;
    }
}

