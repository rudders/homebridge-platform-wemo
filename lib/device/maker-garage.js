/* jshint -W014, -W033, esversion: 9 */
/* eslint-disable new-cap */
'use strict'
const helpers = require('./../helpers')
module.exports = class deviceMakerGarage {
  constructor (platform, accessory, device) {
    this.log = platform.log
    this.config = platform.config
    this.debug = this.config.debug || false
    this.superDebug = this.config.superDebug || false
    this.doorOpenTimer = platform.doorOpenTimer
    this.device = device
    this.client = accessory.client
    this.Service = platform.api.hap.Service
    this.Characteristic = platform.api.hap.Characteristic
    if (accessory.getService(this.Service.Switch)) {
      accessory.removeService(accessory.getService(this.Service.Switch))
    }
    const service = accessory.getService(this.Service.GarageDoorOpener) || accessory.addService(this.Service.GarageDoorOpener)
    service
      .getCharacteristic(this.Characteristic.TargetDoorState)
      .on('set', (value, callback) => this.internalDoorUpdate(value, callback))
    this.getAttributes()
    accessory.client.on('error', err => this.log.warn('[%s] reported error - %s.', accessory.displayName, err.code))
    accessory.client.on('attributeList', (name, value, prevalue, timestamp) => {
      this.externalDoorUpdate(name, value)
      if (this.superDebug) {
        this.log.error('---- superDebug output ----')
        this.log.error('---- on.attributeList ----')
        this.log.warn('\n name: %s\n value: %s\n prevalue: %s\n timestamp: %s', name, value, prevalue, timestamp)
        this.log.error('---- end superDebug output ----')
      }
    })
    this.accessory = accessory
  }

  internalDoorUpdate (state, callback) {
    const value = state | 0
    this.homekitTriggered = true
    const service = this.accessory.getService(this.Service.GarageDoorOpener)
    const currentDoorState = service.getCharacteristic(this.Characteristic.CurrentDoorState)
    if (!this.isMoving) {
      if (
        value === this.Characteristic.TargetDoorState.CLOSED &&
        currentDoorState.value === this.Characteristic.CurrentDoorState.CLOSED
      ) {
        if (this.debug) this.log('[%s] is already closed.', this.accessory.displayName)
        callback()
        return
      } else if (
        value === this.Characteristic.TargetDoorState.OPEN &&
        currentDoorState.value === this.Characteristic.CurrentDoorState.OPEN
      ) {
        if (this.debug) this.log('[%s] is already open.', this.accessory.displayName)
        callback()
        return
      }
    } else {
      if (
        value === this.Characteristic.TargetDoorState.CLOSED &&
        currentDoorState.value === this.Characteristic.CurrentDoorState.CLOSING
      ) {
        if (this.debug) this.log('[%s] is already closing.', this.accessory.displayName)
        callback()
        return
      } else if (
        value === this.Characteristic.TargetDoorState.OPEN &&
        currentDoorState.value === this.Characteristic.CurrentDoorState.OPENING
      ) {
        if (this.debug) this.log('[%s] is already opening.', this.accessory.displayName)
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
          this.setDoorMoving(value, true)
          if (this.debug) {
            this.log('[%s] setting target state to [%s] (triggered by HomeKit).', this.accessory.displayName, value ? 'closed' : 'open')
          }
          callback()
        }
      }
    )
  }

  externalDoorUpdate (name, value) {
    switch (name) {
      case 'Switch': {
        if (value === 0) return // closed
        if (this.homekitTriggered) {
          delete this.homekitTriggered
          return
        }
        const service = this.accessory.getService(this.Service.GarageDoorOpener)
        const targetDoorState = service.getCharacteristic(this.Characteristic.TargetDoorState).value
        const state = targetDoorState ? 0 : 1
        if (this.debug) this.log('[%s] updating TargetDoorState [%s]', this.accessory.displayName, state ? 'Closed' : 'Open')
        service.updateCharacteristic(this.Characteristic.TargetDoorState, state)
        this.setDoorMoving(state)
        break
      }
      case 'Sensor':
        this.externalSensorUpdate(value, true)
        break
    }
  }

  getAttributes () {
    this.client.getAttributes(
      (err, attributes) => {
        if (err) {
          this.log.warn('[%s] wemoClient.getAttributes error - %s.', this.accessory.displayName, err)
          return
        }
        if (this.superDebug) {
          this.log.warn('---- superDebug output ----')
          this.log.warn('---- maker getAttributes() ----')
          this.log.warn(attributes)
          this.log.warn('---- end superDebug output ----')
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
      if (this.debug) this.log('[%s] updated current state [stopped].', this.accessory.displayName)

      // Toggle TargetDoorState after receiving a stop
      await helpers.sleep(500)
      service.updateCharacteristic(
        this.Characteristic.TargetDoorState,
        targetDoorState === helpers.garageStates.Open
          ? helpers.garageStates.Closed
          : helpers.garageStates.Open
      )
      return
    }
    this.isMoving = true
    if (homekitTriggered) {
      const currentDoorState = service.getCharacteristic(this.Characteristic.CurrentDoorState).value
      if (targetDoorState === helpers.garageStates.Closed) {
        if (currentDoorState !== helpers.garageStates.Closed) {
          service.updateCharacteristic(this.Characteristic.CurrentDoorState, helpers.garageStates.Closing)
          if (this.debug) this.log('[%s] updated current state [closing].', this.accessory.displayName)
        }
      } else if (targetDoorState === helpers.garageStates.Open) {
        if (
          currentDoorState === helpers.garageStates.Stopped ||
              (!this.sensorPresent && currentDoorState !== helpers.garageStates.Open)
        ) {
          service.updateCharacteristic(this.Characteristic.CurrentDoorState, helpers.garageStates.Opening)
          if (this.debug) this.log('[%s] updated current state [opening].', this.accessory.displayName)
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
          if (this.debug) this.log('[%s] updated current state [%s].', this.accessory.displayName, targetDoorState ? 'closed' : 'open')
          return
        }
        this.getAttributes()
      },
      this.doorOpenTimer * 1000
    )
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
          if (this.debug) this.log('[%s] updated current state [opening].', this.accessory.displayName)
        } else {
          service.updateCharacteristic(this.Characteristic.CurrentDoorState, helpers.garageStates.Open)
          if (this.debug) this.log('[%s] updated current state [open].', this.accessory.displayName)
        }
      } else {
        // Garage door's target state is OPEN, but the garage door's current state is CLOSED,
        // it must have been triggered externally by a remote control
        delete this.isMoving
        service.updateCharacteristic(this.Characteristic.TargetDoorState, helpers.garageStates.Closed)
        service.updateCharacteristic(this.Characteristic.CurrentDoorState, helpers.garageStates.Closed)
        if (this.debug) this.log('[%s] updated current state [closed]] (triggered externally).', this.accessory.displayName)
      }
    } else if (targetDoorState === 1) {
      // Garage door's target state is CLOSED and the garage door's current state is CLOSED
      if (value === 1) {
        delete this.isMoving
        if (this.movingTimer) {
          clearTimeout(this.movingTimer)
          delete this.movingTimer
        }
        service.updateCharacteristic(this.Characteristic.CurrentDoorState, helpers.garageStates.Closed)
        if (this.debug) this.log('[%s] updated current state [closed].', this.accessory.displayName)
      } else if (value === 0) {
        // Garage door's target state is CLOSED, but the garage door's current state is OPEN,
        // it must have been triggered externally by a remote control
        service.updateCharacteristic(this.Characteristic.TargetDoorState, helpers.garageStates.Open)
        if (this.debug) this.log('[%s] setting target state [open] (triggered externally).', this.accessory.displayName)
        if (wasTriggered) this.setDoorMoving(0)
      }
    }
  }
}
