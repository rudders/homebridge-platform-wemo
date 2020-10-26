/* jshint -W014, -W033, esversion: 9 */
/* eslint-disable new-cap */
'use strict'
const helpers = require('./../helpers')
module.exports = class deviceMakerGarage {
  constructor (platform, accessory, device) {
    this.log = platform.log
    this.debug = platform.config.debug || false
    this.disableDeviceLogging = platform.config.disableDeviceLogging || false
    this.debugMakerOnEvent = platform.config.debugMakerOnEvent || false
    this.debugMakerGetEvent = platform.config.debugMakerGetEvent || false
    this.doorOpenTimer = platform.doorOpenTimer
    this.Service = platform.api.hap.Service
    this.Characteristic = platform.api.hap.Characteristic
    if (accessory.getService(this.Service.Switch)) {
      accessory.removeService(accessory.getService(this.Service.Switch))
    }
    const service = accessory.getService(this.Service.GarageDoorOpener) || accessory.addService(this.Service.GarageDoorOpener)
    service
      .getCharacteristic(this.Characteristic.TargetDoorState)
      .on('set', (value, callback) => this.internalDoorUpdate(value, callback))
    this.accessory = accessory
    this.device = device
    this.client = accessory.client
    this.getAttributes()
    this.client.on('error', err => this.log.warn('[%s] reported error - %s.', this.accessory.displayName, err.code))
    this.client.on('attributeList', (name, value, prevalue, timestamp) => {
      this.externalDoorUpdate(name, parseInt(value))
      if (this.debugMakerOnEvent) {
        this.log.error('---- debugMakerOnEvent output ----')
        this.log.warn('\n name: %s\n value: %s\n prevalue: %s\n timestamp: %s', name, value, prevalue, timestamp)
        this.log.error('---- end debugMakerOnEvent output ----')
      }
    })
  }

  internalDoorUpdate (value, callback) {
    try {
      this.homekitTriggered = true
      const service = this.accessory.getService(this.Service.GarageDoorOpener)
      const currentDoorState = service.getCharacteristic(this.Characteristic.CurrentDoorState).value
      if (!this.isMoving) {
        if (value === helpers.garageStates.Closed && currentDoorState === helpers.garageStates.Closed) {
          if (!this.disableDeviceLogging) this.log('[%s] is already closed.', this.accessory.displayName)
          callback()
          return
        } else if (value === helpers.garageStates.Open && currentDoorState === helpers.garageStates.Open) {
          if (!this.disableDeviceLogging) this.log('[%s] is already open.', this.accessory.displayName)
          callback()
          return
        }
      } else {
        if (value === helpers.garageStates.Closed && currentDoorState === helpers.garageStates.Closing) {
          if (!this.disableDeviceLogging) this.log('[%s] is already closing.', this.accessory.displayName)
          callback()
          return
        } else if (value === helpers.garageStates.Open && currentDoorState === helpers.garageStates.Opening) {
          if (!this.disableDeviceLogging) this.log('[%s] is already opening.', this.accessory.displayName)
          callback()
          return
        }
      }
      this.client.setBinaryState(1, err => {
        if (err) {
          this.log.warn('[%s] reported error - %s', this.accessory.displayName, this.debug ? err : err.message)
          callback(err)
          return
        }
        this.setDoorMoving(value, true)
        if (!this.disableDeviceLogging) {
          this.log('[%s] setting to [%s] (triggered by HK).', this.accessory.displayName, value ? 'close' : 'open')
        }
        callback()
      })
    } catch (err) {
      this.log.warn('[%s] setting target state [%s] error - %s.', this.accessory.displayName, value ? 'closed' : 'open', err.code)
      callback(err)
    }
  }

  externalDoorUpdate (name, value) {
    try {
      switch (name) {
        case 'Sensor':
          this.externalSensorUpdate(value, true)
          break
        case 'Switch': {
          if (value === 0) return
          if (this.homekitTriggered) {
            delete this.homekitTriggered
            return
          }
          const service = this.accessory.getService(this.Service.GarageDoorOpener)
          const targetDoorState = service.getCharacteristic(this.Characteristic.TargetDoorState).value
          const state = targetDoorState ? 0 : 1
          if (!this.disableDeviceLogging) {
            this.log('[%s] updating TargetDoorState [%s].', this.accessory.displayName, state ? 'Closed' : 'Open')
          }
          service.updateCharacteristic(this.Characteristic.TargetDoorState, state)
          this.setDoorMoving(state)
          break
        }
      }
    } catch (err) {
      this.log.warn('[%s] updating [%s] to [%s] error - %s', this.accessory.displayName, name, value, err)
    }
  }

  externalSensorUpdate (state, wasTriggered) {
    // *** state is passed as 0 for closed *** \\
    // *** TargetDoorState value = 0=open, 1=closed *** \\
    // *** CurrentDoorState {0:open, 1:closed, 2:opening, 3:closing, 4:stopped} *** \\
    const value = 1 - state // 0->1 and 1->0 reverse values to match HomeKit needs
    const service = this.accessory.getService(this.Service.GarageDoorOpener)
    const targetDoorState = service.getCharacteristic(this.Characteristic.TargetDoorState).value
    if (targetDoorState === 0) {
      if (value === 0) {
        // Garage door's target state is OPEN and the garage door's current state is OPEN
        if (this.isMoving) {
          service.updateCharacteristic(this.Characteristic.CurrentDoorState, helpers.garageStates.Opening)
          if (!this.disableDeviceLogging) this.log('[%s] updated current state [opening].', this.accessory.displayName)
        } else {
          service.updateCharacteristic(this.Characteristic.CurrentDoorState, helpers.garageStates.Open)
          if (!this.disableDeviceLogging) this.log('[%s] updated current state [open].', this.accessory.displayName)
        }
      } else {
        // Garage door's target state is OPEN, but the garage door's current state is CLOSED,
        // it must have been triggered externally by a remote control
        delete this.isMoving
        service.updateCharacteristic(this.Characteristic.TargetDoorState, helpers.garageStates.Closed)
        service.updateCharacteristic(this.Characteristic.CurrentDoorState, helpers.garageStates.Closed)
        if (!this.disableDeviceLogging) {
          this.log('[%s] updated current state [closed]] (triggered externally).', this.accessory.displayName)
        }
      }
    } else {
      // Garage door's target state is CLOSED and the garage door's current state is CLOSED
      if (value === 1) {
        delete this.isMoving
        if (this.movingTimer) {
          clearTimeout(this.movingTimer)
          delete this.movingTimer
        }
        service.updateCharacteristic(this.Characteristic.CurrentDoorState, helpers.garageStates.Closed)
        if (!this.disableDeviceLogging) this.log('[%s] updated current state [closed].', this.accessory.displayName)
      } else {
        // Garage door's target state is CLOSED, but the garage door's current state is OPEN,
        // it must have been triggered externally by a remote control
        service.updateCharacteristic(this.Characteristic.TargetDoorState, helpers.garageStates.Open)
        if (!this.disableDeviceLogging) this.log('[%s] setting target state [open] (triggered externally).', this.accessory.displayName)
        if (wasTriggered) this.setDoorMoving(0)
      }
    }
  }

  getAttributes () {
    this.client.getAttributes(
      (err, attributes) => {
        if (err) {
          this.log.warn('[%s] wemoClient.getAttributes error - %s.', this.accessory.displayName, err)
          return
        }
        if (this.debugMakerGetEvent) {
          this.log.error('---- debugMakerGetEvent output ----')
          this.log.warn(attributes)
          this.log.error('---- end debugMakerGetEvent output ----')
        }
        this.device.attributes = attributes
        if (parseInt(attributes.SwitchMode) === 0) {
          this.log.warn('Maker must be set to momentary mode to work as a garage door. Else use as a switch')
          return
        }
        const contactSensor = this.accessory.getService(this.Service.ContactSensor)
        if (parseInt(attributes.SensorPresent) === 1) {
          this.sensorPresent = true
          this.externalSensorUpdate(parseInt(attributes.Sensor))
        } else {
          if (contactSensor) {
            this.accessory.removeService(contactSensor)
          }
          delete this.sensorPresent
        }
      }
    )
  }

  async setDoorMoving (targetDoorState, homekitTriggered) {
    const service = this.accessory.getService(this.Service.GarageDoorOpener)
    if (this.movingTimer) {
      clearTimeout(this.movingTimer)
      delete this.movingTimer
    }
    if (this.isMoving) {
      delete this.isMoving
      service.updateCharacteristic(this.Characteristic.CurrentDoorState, 4)
      if (!this.disableDeviceLogging) this.log('[%s] updated current state [stopped].', this.accessory.displayName)
      // *** Toggle TargetDoorState after receiving a stop *** \\
      await helpers.sleep(500)
      service.updateCharacteristic(
        this.Characteristic.TargetDoorState,
        targetDoorState === helpers.garageStates.Open ? helpers.garageStates.Closed : helpers.garageStates.Open
      )
      return
    }
    this.isMoving = true
    if (homekitTriggered) {
      const currentDoorState = service.getCharacteristic(this.Characteristic.CurrentDoorState).value
      if (targetDoorState === helpers.garageStates.Closed) {
        if (currentDoorState !== helpers.garageStates.Closed) {
          service.updateCharacteristic(this.Characteristic.CurrentDoorState, helpers.garageStates.Closing)
          if (!this.disableDeviceLogging) this.log('[%s] updated current state [closing].', this.accessory.displayName)
        }
      } else if (targetDoorState === helpers.garageStates.Open) {
        if (
          currentDoorState === helpers.garageStates.Stopped ||
          (currentDoorState !== helpers.garageStates.Open && !this.sensorPresent)
        ) {
          service.updateCharacteristic(this.Characteristic.CurrentDoorState, helpers.garageStates.Opening)
          if (!this.disableDeviceLogging) this.log('[%s] updated current state [opening].', this.accessory.displayName)
        }
      }
    }
    this.movingTimer = setTimeout(
      () => {
        delete this.movingTimer
        delete this.isMoving
        const targetDoorState = service.getCharacteristic(this.Characteristic.TargetDoorState).value
        if (!this.sensorPresent) {
          service.updateCharacteristic(
            this.Characteristic.CurrentDoorState,
            targetDoorState ? helpers.garageStates.Closed : helpers.garageStates.Open
          )
          if (!this.disableDeviceLogging) {
            this.log('[%s] updated current state [%s].', this.accessory.displayName, targetDoorState ? 'closed' : 'open')
          }
          return
        }
        this.getAttributes()
      },
      this.doorOpenTimer * 1000
    )
  }
}
