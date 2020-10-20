/* jshint -W014, -W033, esversion: 9 */
/* eslint-disable new-cap */
'use strict'
const helpers = require('./../helpers')
module.exports = class deviceMakerGarage {
  constructor (platform, accessory, device) {
    this.log = platform.log
    this.config = platform.config
    this.debug = this.config.debug || false
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
      .on('set', (value, callback) => this.setTargetDoorState(value, callback))
    accessory.client.getAttributes(
      (err, attributes) => {
        if (err) {
          this.log.warn('[%s] wemoClient.getAttributes error - %s.', accessory.displayName, err)
          return
        }
        this.device.attributes = attributes
        if (attributes.SwitchMode === 0) {
          this.log.warn('Maker must be set to momentary mode to work as a garage door. Else use as a switch')
          return
        }
        const contactSensor = this.accessory.getService(this.Service.ContactSensor)
        if (attributes.SensorPresent === 1) {
          this.sensorPresent = true
          this.updateSensorState(attributes.Sensor)
        } else {
          if (contactSensor) {
            this.accessory.removeService(contactSensor)
          }
          delete this.sensorPresent
        }
      }
    )
    accessory.client.on('error', err => this.log.warn('[%s] reported error - %s.', accessory.displayName, err.code))
    accessory.client.on(
      'attributeList',
      (name, value, prevalue, timestamp) => {
        switch (name) {
          case 'Switch': {
            if (value !== 1) return
            if (this.homekitTriggered === true) {
              delete this.homekitTriggered
              return
            }
            const service = this.accessory.getService(this.Service.GarageDoorOpener)
            const targetDoorState = service.getCharacteristic(this.Characteristic.TargetDoorState).value
            const state = targetDoorState ? this.Characteristic.TargetDoorState.OPEN : this.Characteristic.TargetDoorState.CLOSED
            if (this.debug) this.log('[%s] updating TargetDoorState [%s]', this.accessory.displayName, state ? 'Closed' : 'Open')
            service.updateCharacteristic(this.Characteristic.TargetDoorState, state)
            this.setDoorMoving(state)
            break
          }
          case 'Sensor':
            this.updateSensorState(value, true)
            break
        }
      }
    )
    this.accessory = accessory
  }

  async setDoorMoving (targetDoorState, homekitTriggered) {
    const service = this.accessory.getService(this.Service.GarageDoorOpener)
    if (this.movingTimer) {
      clearTimeout(this.movingTimer)
      delete this.movingTimer
    }
    if (this.isMoving) {
      delete this.isMoving
      this.updateCurrentDoorState(this.Characteristic.CurrentDoorState.STOPPED)
      // Toggle TargetDoorState after receiving a stop
      await helpers.sleep(500)
      service.updateCharacteristic(
        this.Characteristic.TargetDoorState,
        targetDoorState === this.Characteristic.TargetDoorState.OPEN
          ? this.Characteristic.TargetDoorState.CLOSED
          : this.Characteristic.TargetDoorState.OPEN
      )
      return
    }
    this.isMoving = true
    if (homekitTriggered) {
      const currentDoorState = service.getCharacteristic(this.Characteristic.CurrentDoorState)
      if (targetDoorState === this.Characteristic.TargetDoorState.CLOSED) {
        if (currentDoorState.value !== this.Characteristic.CurrentDoorState.CLOSED) {
          this.updateCurrentDoorState(this.Characteristic.CurrentDoorState.CLOSING)
        }
      } else if (targetDoorState === this.Characteristic.TargetDoorState.OPEN) {
        if (
          currentDoorState.value === this.Characteristic.CurrentDoorState.STOPPED ||
          (this.sensorPresent !== true && currentDoorState.value !== this.Characteristic.CurrentDoorState.OPEN)
        ) {
          this.updateCurrentDoorState(this.Characteristic.CurrentDoorState.OPENING)
        }
      }
    }

    this.movingTimer = setTimeout(
      () => {
        delete this.movingTimer
        delete this.isMoving
        const targetDoorState = this.accessory.getService(this.Service.GarageDoorOpener)
          .getCharacteristic(this.Characteristic.TargetDoorState)
        if (!this.sensorPresent) {
          this.updateCurrentDoorState(
            targetDoorState.value
              ? this.Characteristic.CurrentDoorState.CLOSED
              : this.Characteristic.CurrentDoorState.OPEN
          )
          return
        }
        this.getAttributes()
      },
      this.doorOpenTimer * 1000
    )
  }

  setTargetDoorState (state, callback) {
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

  updateCurrentDoorState (value, actualFeedback) {
    let state
    switch (value) {
      case this.Characteristic.CurrentDoorState.OPEN:
        state = 'open'
        break
      case this.Characteristic.CurrentDoorState.CLOSED:
        state = 'closed'
        break
      case this.Characteristic.CurrentDoorState.OPENING:
        state = 'opening'
        break
      case this.Characteristic.CurrentDoorState.CLOSING:
        state = 'closing'
        break
      case this.Characteristic.CurrentDoorState.STOPPED:
        state = 'stopped'
        break
    }
    this.accessory.getService(this.Service.GarageDoorOpener).updateCharacteristic(this.Characteristic.CurrentDoorState, value)
    if (this.debug) this.log('[%s] updated current state [%s].', this.accessory.displayName, state)
  }

  updateSensorState (state, wasTriggered) {
    state = state | 0
    const value = state !== 1
    const service = this.accessory.getService(this.Service.GarageDoorOpener)
    const targetDoorState = service.getCharacteristic(this.Characteristic.TargetDoorState).value
    if (targetDoorState === this.Characteristic.TargetDoorState.OPEN) {
      if (value === this.Characteristic.CurrentDoorState.OPEN) {
        // Garage door's target state is OPEN and the garage door's current state is OPEN
        if (!this.isMoving) {
          this.updateCurrentDoorState(this.Characteristic.CurrentDoorState.OPEN, true)
        } else {
          this.updateCurrentDoorState(this.Characteristic.CurrentDoorState.OPENING, true)
        }
      } else if (value === this.Characteristic.CurrentDoorState.CLOSED) {
        // Garage door's target state is OPEN, but the garage door's current state is CLOSED,
        // it must have been triggered externally by a remote control
        delete this.isMoving
        service.updateCharacteristic(this.Characteristic.TargetDoorState, this.Characteristic.TargetDoorState.CLOSED)
        if (this.debug) this.log('[%s] setting target state [closed] (triggered by External).', this.accessory.displayName)
        this.updateCurrentDoorState(this.Characteristic.CurrentDoorState.CLOSED, true)
      }
    } else if (targetDoorState === this.Characteristic.TargetDoorState.CLOSED) {
      // Garage door's target state is CLOSED and the garage door's current state is CLOSED
      if (value === this.Characteristic.CurrentDoorState.CLOSED) {
        delete this.isMoving
        if (this.movingTimer) {
          clearTimeout(this.movingTimer)
          delete this.movingTimer
        }
        this.updateCurrentDoorState(this.Characteristic.CurrentDoorState.CLOSED, true)
      } else if (value === this.Characteristic.CurrentDoorState.OPEN) {
        // Garage door's target state is CLOSED, but the garage door's current state is OPEN,
        // it must have been triggered externally by a remote control
        service.getCharacteristic(this.Characteristic.TargetDoorState, this.Characteristic.TargetDoorState.OPEN)
        if (this.debug) this.log('[%s] setting target state [open] (triggered by External).', this.accessory.displayName)
        if (wasTriggered) this.setDoorMoving(this.Characteristic.TargetDoorState.OPEN)
      }
    }
  }
}
