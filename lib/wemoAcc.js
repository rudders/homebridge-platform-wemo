/* jshint -W014, -W033, esversion: 8 */
'use strict'
let Characteristic, EveService, Service
const cns = require('./constants')
const hbLib = require('homebridge-lib')
const utils = require('./utils')
module.exports = class wemoAcc {
  constructor (platform, accessory, device) {
    Service = platform.api.hap.Service
    Characteristic = platform.api.hap.Characteristic
    EveService = new hbLib.EveHomeKitTypes(platform.api)
    this.log = platform.log
    this.config = platform.config
    this.wemoClient = platform.wemoClient
    this.debug = this.config.debug || false
    this.accessory = accessory
    this.device = device
    this.accessory
      .getService(Service.AccessoryInformation)
      .setCharacteristic(Characteristic.Manufacturer, 'Belkin Wemo')
      .setCharacteristic(Characteristic.Model, device.modelName)
      .setCharacteristic(Characteristic.SerialNumber, device.serialNumber)
      .setCharacteristic(Characteristic.FirmwareRevision, device.firmwareVersion)
    this.accessory.context.deviceType = device.deviceType
    this.accessory.on('identify', (paired, callback) => {
      this.log('[%s] - identify.', this.accessory.displayName)
      callback()
    })
    this.setupDevice(device)
    this.observeDevice(device)
    this.addEventHandlers()
  }

  addEventHandler (serviceName, characteristic) {
    serviceName = serviceName || Service.Switch
    let service = this.accessory.getService(serviceName)
    if (service === undefined && serviceName === Service.Switch) {
      service = this.accessory.getService(Service.Outlet)
    }
    if (service === undefined) return
    if (service.testCharacteristic(characteristic) === false) return
    switch (characteristic) {
      case Characteristic.On:
        service
          .getCharacteristic(characteristic)
          .on('set', (value, callback) => this.setSwitchState(value, callback))
        break
      case Characteristic.TargetDoorState:
        service
          .getCharacteristic(characteristic)
          .on('set', (value, callback) => this.setTargetDoorState(value, callback))
        break
      case Characteristic.Brightness:
        service
          .getCharacteristic(characteristic)
          .on('set', (value, callback) => this.setBrightness(value, callback))
        break
    }
  }

  addEventHandlers () {
    this.addEventHandler(Service.Switch, Characteristic.On)
    this.addEventHandler(Service.Lightbulb, Characteristic.On)
    this.addEventHandler(Service.Lightbulb, Characteristic.Brightness)
    this.addEventHandler(Service.GarageDoorOpener, Characteristic.TargetDoorState)
  }

  getAttributes () {
    try {
      this.client.getAttributes(
        (err, attributes) => {
          if (err) {
            this.log.warn('[%s] wemoClient.getAttributes error - %s.', this.accessory.displayName, err)
            return
          }
          this.device.attributes = attributes
          this.accessory.context.switchMode = attributes.SwitchMode
          if (this.accessory.context.switchMode === 1) {
          // *** SWITCHMODE - MOMENTARY *** \\
            if (this.accessory.context.serviceType === undefined) {
              this.accessory.context.serviceType = Service.GarageDoorOpener.UUID
            }
            switch (this.accessory.context.serviceType) {
              case Service.GarageDoorOpener.UUID:
                if (this.accessory.getService(Service.GarageDoorOpener) === undefined) {
                  this.accessory.addService(Service.GarageDoorOpener)
                  this.addEventHandler(Service.GarageDoorOpener, Characteristic.TargetDoorState)
                }
                if (this.accessory.getService(Service.Switch) !== undefined) {
                  this.accessory.removeService(this.accessory.getService(Service.Switch))
                }
                break
              case Service.Switch.UUID:
                if (this.accessory.getService(Service.Switch) === undefined) {
                  this.accessory.addService(Service.Switch)
                  this.addEventHandler(Service.Switch, Characteristic.On)
                }
                if (this.accessory.getService(Service.GarageDoorOpener) !== undefined) {
                  this.accessory.removeService(this.accessory.getService(Service.GarageDoorOpener))
                }
                break
            }
          } else if (this.accessory.context.switchMode === 0) {
          // *** SWITCHMODE - TOGGLE *** \\
            if (this.accessory.getService(Service.Switch) === undefined) {
              this.accessory.addService(Service.Switch)
              this.addEventHandler(Service.Switch, Characteristic.On)
            }
            if (this.accessory.getService(Service.GarageDoorOpener) !== undefined) {
              this.accessory.removeService(this.accessory.getService(Service.GarageDoorOpener))
            }
          }
          if (attributes.SensorPresent === 1) {
            if (this.accessory.getService(Service.Switch) !== undefined) {
              if (this.accessory.getService(Service.ContactSensor) === undefined) {
                if (this.debug) {
                  this.log('[%s] adding service [%s]', this.accessory.displayName, 'Service.ContactSensor')
                }
                this.accessory.addService(Service.ContactSensor)
              }
            } else if (this.accessory.getService(Service.GarageDoorOpener) !== undefined) {
              this.sensorPresent = true
            }
            this.updateSensorState(attributes.Sensor)
          } else {
            const contactSensor = this.accessory.getService(Service.ContactSensor)
            if (contactSensor !== undefined) {
              if (this.debug) {
                this.log('[%s] removing service [%s]', this.accessory.displayName, 'Service.ContactSensor')
              }
              this.accessory.removeService(contactSensor)
            }
            delete this.sensorPresent
          }
          if (this.accessory.getService(Service.Switch) !== undefined) {
            this.updateSwitchState(attributes.Switch)
          }
        }
      )
    } catch (err) {
      this.log.warn('wemoClient.getAttributes() error - %s', this.debug ? err : err.message)
    }
  }

  observeDevice (device) {
    if (device.deviceType === cns.deviceTypes.Maker) {
      this.getAttributes()
      this.client.on(
        'attributeList',
        (name, value, prevalue, timestamp) => {
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
                    if (this.debug) {
                      this.log(
                        '[%s] setting TargetDoorState [%s] (triggered by Maker)',
                        this.accessory.displayName,
                        state ? 'Closed' : 'Open'
                      )
                    }
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
        }
      )
    } else {
      this.client.on(
        'binaryState',
        state => {
          if (this.device.deviceType === cns.deviceTypes.Motion || this.device.deviceType === cns.deviceTypes.NetCamSensor) {
            this.updateMotionDetected(state)
          } else {
            this.updateSwitchState(state)
          }
        }
      )
    }
    if (device.deviceType === cns.deviceTypes.Insight) {
      this.client.on('insightParams', (state, power, data) => this.updateInsightParams)
    }
    if (device.deviceType === cns.deviceTypes.Dimmer) {
      this.client.on('brightness', newBrightness => this.updateBrightness)
    }
  }

  setDoorMoving (targetDoorState, homekitTriggered) {
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
        (obj, state) => {
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
      () => {
        delete this.movingTimer
        delete this.isMoving
        const targetDoorState = this.accessory.getService(Service.GarageDoorOpener).getCharacteristic(Characteristic.TargetDoorState)
        if (!this.sensorPresent) {
          this.updateCurrentDoorState(
            targetDoorState.value
              ? Characteristic.CurrentDoorState.CLOSED
              : Characteristic.CurrentDoorState.OPEN
          )
          return
        }
        this.getAttributes()
      },
      this.config.doorOpenTimer * 1000,
      this
    )
  }

  setSwitchState (state, callback) {
    const value = state | 0
    const service =
      this.accessory.getService(Service.Switch) ||
      this.accessory.getService(Service.Outlet) ||
      this.accessory.getService(Service.Lightbulb)
    const switchState = service.getCharacteristic(Characteristic.On)
    if (switchState.value === value) {
      callback()
      return
    }
    this.client.setBinaryState(
      value,
      err => {
        if (err) {
          this.log.warn('[%s] setting state [%s] error - %s', this.accessory.displayName, value ? 'on' : 'off', err.code)
          callback(new Error(err))
        } else {
          if (this.debug) {
            this.log('[%s] setting state to [%s].', this.accessory.displayName, value ? 'on' : 'off')
          }
          // for dimmer, poll brightness for ON events (supports night mode)
          if (value && this.device.deviceType === cns.deviceTypes.Dimmer) {
            this.client.getBrightness(
              (err, brightness) => {
                if (err) {
                  this.log.warn('[%s] error getting brightness - %s.', this.accessory.displayName, err)
                  return
                }
                this.updateBrightness(brightness)
              }
            )
          }
        }
      }
    )
    callback()
  }

  async setBrightness (value, callback) {
    callback = callback || function () {}
    if (this.brightness === value) {
      callback()
      return
    }
    this._brightness = value
    /*****
      defer the actual update to smooth out changes from sliders
      check that we actually have a change to make and that something
      hasn't tried to update the brightness again in the last 0.1 seconds
    *****/
    await utils.sleep(100)
    if (this.brightness !== value && this._brightness === value) {
      this.client.setBrightness(
        value,
        err => {
          if (err) {
            this.log.warn('[%s] setting brightness [%s%] error - %s.', this.accessory.displayName, value, err.code)
            callback(new Error(err))
            return
          }
          if (this.debug) {
            this.log('[%s] setting to brightness [%s%].', this.accessory.displayName, value)
          }
          this.brightness = value
        }
      )
    }
    callback()
  }

  setTargetDoorState (state, callback) {
    const value = state | 0
    callback = callback || function () {}
    this.homekitTriggered = true
    const currentDoorState = this.accessory.getService(Service.GarageDoorOpener).getCharacteristic(Characteristic.CurrentDoorState)

    if (!this.isMoving) {
      if (value === Characteristic.TargetDoorState.CLOSED && currentDoorState.value === Characteristic.CurrentDoorState.CLOSED) {
        if (this.debug) {
          this.log('[%s] is already closed.', this.accessory.displayName)
        }
        callback()
        return
      } else if (value === Characteristic.TargetDoorState.OPEN && currentDoorState.value === Characteristic.CurrentDoorState.OPEN) {
        if (this.debug) {
          this.log('[%s] is already open.', this.accessory.displayName)
        }
        callback()
        return
      }
    } else {
      if (value === Characteristic.TargetDoorState.CLOSED && currentDoorState.value === Characteristic.CurrentDoorState.CLOSING) {
        if (this.debug) {
          this.log('[%s] is already closing.', this.accessory.displayName)
        }
        callback()
        return
      } else if (value === Characteristic.TargetDoorState.OPEN && currentDoorState.value === Characteristic.CurrentDoorState.OPENING) {
        if (this.debug) {
          this.log('[%s] is already opening.', this.accessory.displayName)
        }
        callback()
        return
      }
    }

    this.client.setBinaryState(
      1,
      err => {
        if (err) {
          this.log.warn('[%s] setting target state [%s] error - %s.', this.accessory.displayName, value ? 'closed' : 'open', err.code)
          callback(new Error(err))
        } else {
          if (this.debug) {
            this.log('[%s] setting target state to [%s] (triggered by HomeKit).', this.accessory.displayName, value ? 'closed' : 'open')
          }
          this.setDoorMoving(value, true)
          callback()
        }
      }
    )
  }

  setupDevice (device) {
    this.device = device
    this.client = this.wemoClient.client(device)
    this.client.on('error', err => this.log.warn('[%s] reported error - %s.', this.accessory.displayName, err.code))
  }

  updateBrightness (newBrightness) {
    const currentBrightness = this.accessory.getService(Service.Lightbulb).getCharacteristic(Characteristic.Brightness)
    if (currentBrightness.value !== newBrightness) {
      if (this.debug) {
        this.log('[%s] updating brightness to [%s%].', this.accessory.displayName, newBrightness)
      }
      currentBrightness.updateValue(newBrightness)
      this.brightness = newBrightness
    }
    return newBrightness
  }

  updateConsumption (raw) {
    const value = Math.round(raw / 1000)
    const service = this.accessory.getService(Service.Switch) || this.accessory.getService(Service.Outlet)
    const consumption = service.getCharacteristic(EveService.Characteristics.CurrentConsumption)
    if (consumption.value !== value) {
      if (this.debug) {
        this.log('[%s] updating power consumption to [%sw].', this.accessory.displayName, value)
      }
      consumption.setValue(value)
    }
    return value
  }

  updateCurrentDoorState (value, actualFeedback) {
    let state
    switch (value) {
      case Characteristic.CurrentDoorState.OPEN:
        state = 'open'
        break
      case Characteristic.CurrentDoorState.CLOSED:
        state = 'closed'
        break
      case Characteristic.CurrentDoorState.OPENING:
        state = 'opening'
        break
      case Characteristic.CurrentDoorState.CLOSING:
        state = 'closing'
        break
      case Characteristic.CurrentDoorState.STOPPED:
        state = 'stopped'
        break
    }
    if (this.debug) {
      this.log('[%s] updated current state [%s].', this.accessory.displayName, state)
    }
    this.accessory
      .getService(Service.GarageDoorOpener)
      .getCharacteristic(Characteristic.CurrentDoorState)
      .updateValue(value)
  }

  updateInsightParams (state, power, data) {
    this.updateSwitchState(state)
    this.updateOutletInUse(state)
    this.updateConsumption(power)
    this.updateTotalConsumption(data.TodayConsumed, data.TodayONTime)
    // TodayConsumed in mW minutes, TodayONTime in seconds
  }

  updateMotionDetected (state) {
    state = state | 0
    const value = !!state
    const motionDetected = this.accessory
      .getService(Service.MotionSensor)
      .getCharacteristic(Characteristic.MotionDetected)
    if ((value === motionDetected.value && this.motionTimer === undefined) || (value === false && this.motionTimer)) {
      return
    }
    if (value || this.config.noMotionTimer === 0) {
      if (this.motionTimer) {
        if (this.debug) {
          this.log('[%s] noMotion timer stopped.', this.accessory.displayName)
        }
        clearTimeout(this.motionTimer)
        delete this.motionTimer
      }
      if (this.debug) {
        this.log('[%s] motion sensor [%s].', this.accessory.displayName, value ? 'detected motion' : 'clear')
      }
      motionDetected.setValue(value)
    } else {
      if (this.debug) {
        this.log('[%s] noMotion timer started [%d secs]', this.accessory.displayName, this.config.noMotionTimer)
      }
      clearTimeout(this.motionTimer)
      this.motionTimer = setTimeout(
        () => {
          if (this.debug) {
            this.log('[%s] motion sensor [clear] - noMotion timer completed.', this.accessory.displayName)
          }
          this.accessory
            .getService(Service.MotionSensor)
            .getCharacteristic(Characteristic.MotionDetected)
            .setValue(false)
          delete this.motionTimer
        },
        this.config.noMotionTimer * 1000
      )
    }
  }

  updateOutletInUse (state) {
    state = state | 0
    const value = state === 1
    const service = this.accessory.getService(Service.Switch) || this.accessory.getService(Service.Outlet)
    const outletInUse = service.getCharacteristic(Characteristic.OutletInUse)
    if (outletInUse.value !== value) {
      if (this.debug) {
        this.log('[%s] updated outlet in use [%s].', this.accessory.displayName, value ? 'Yes' : 'No')
      }
      outletInUse.setValue(value)
    }
    return value
  }

  updateSensorState (state, wasTriggered) {
    state = state | 0
    const value = !state
    if (this.accessory.getService(Service.ContactSensor) !== undefined) {
      const sensorState = this.accessory.getService(Service.ContactSensor).getCharacteristic(Characteristic.ContactSensorState)
      if (sensorState.value !== value) {
        if (this.debug) {
          this.log('[%s] sensor state [%s].', this.accessory.displayName, value ? 'detected' : 'not detected')
        }
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
          if (this.debug) {
            this.log('[%s] setting target state [closed] (triggered by External).', this.accessory.displayName)
          }
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
          if (this.debug) {
            this.log('[%s] setting target state [open] (triggered by External).', this.accessory.displayName)
          }
          targetDoorState.updateValue(Characteristic.TargetDoorState.OPEN)
          if (wasTriggered) {
            this.setDoorMoving(Characteristic.TargetDoorState.OPEN)
          }
        }
      }
    }
    return value
  }

  updateSwitchState (state) {
    state = state | 0
    const value = !!state
    const service =
    this.accessory.getService(Service.Switch) ||
    this.accessory.getService(Service.Outlet) ||
    this.accessory.getService(Service.Lightbulb)
    const switchState = service.getCharacteristic(Characteristic.On)
    if (switchState.value !== value) {
      if (this.debug) {
        this.log('[%s] getting state [%s].', this.accessory.displayName, value ? 'on' : 'off')
      }
      switchState.updateValue(value)
      // for dimmer, poll brightness for ON events (supports night mode)
      if (value && this.device.deviceType === cns.deviceTypes.Dimmer) {
        this.client.getBrightness(
          (err, brightness) => {
            if (err) {
              this.log('%s - Error getting brightness - %s.', this.accessory.displayName, err.code)
              return
            }
            this.updateBrightness(brightness)
          }
        )
      }
      if (!value && this.device.deviceType === cns.deviceTypes.Insight) {
        this.updateOutletInUse(0)
        this.updateConsumption(0)
      }
    }
    return value
  }

  updateTotalConsumption (raw, raw2) {
  // raw = data.TodayConsumed; raw2 = data.TodayONTime
    const value = Math.round(raw / (1000 * 60)) // convert to Wh, raw is total mW minutes
    const kWh = value / 1000 // convert to kWh
    const onHours = Math.round(raw2 / 36) / 100 // convert to hours, raw2 in seconds
    const service = this.accessory.getService(Service.Switch) || this.accessory.getService(Service.Outlet)
    const totalConsumption = service.getCharacteristic(EveService.Characteristics.TotalConsumption)
    if (totalConsumption.value !== value) {
      if (this.debug) {
        this.log('[%s] total on-time - %s hours.', this.accessory.displayName, onHours)
        this.log('[%s] total consumption - %s kWh.', this.accessory.displayName, kWh)
      }
      totalConsumption.updateValue(value)
    }
    return value
  }
}
