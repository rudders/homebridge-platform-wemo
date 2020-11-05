/* jshint -W014, -W033, esversion: 9 */
/* eslint-disable new-cap */
'use strict'
const entities = require('entities')
const helpers = require('./../helpers')
const xml2js = require('xml2js')
module.exports = class deviceMakerGarage {
  constructor (platform, accessory, device) {
    this.log = platform.log
    this.debug = platform.debug
    this.disableDeviceLogging = platform.config.disableDeviceLogging || false
    this.debugMakerOnEvent = platform.config.debugMakerOnEvent || false
    this.debugMakerGetEvent = platform.config.debugMakerGetEvent || false
    this.doorOpenTimer = platform.doorOpenTimer
    this.Service = platform.api.hap.Service
    this.Characteristic = platform.api.hap.Characteristic
    if (accessory.getService(this.Service.Switch)) {
      accessory.removeService(accessory.getService(this.Service.Switch))
    }
    if (accessory.getService(this.Service.ContactSensor)) {
      accessory.removeService(accessory.getService(this.Service.ContactSensor))
    }
    const service = accessory.getService(this.Service.GarageDoorOpener) || accessory.addService(this.Service.GarageDoorOpener)
    service
      .getCharacteristic(this.Characteristic.TargetDoorState)
      .on('set', (value, callback) => this.internalDoorUpdate(value, callback))
    this.accessory = accessory
    this.device = device
    this.client = accessory.client
    this.getAttributes()
    this.client.on('error', err => this.log.warn('[%s] reported error:\n%s.', accessory.displayName, err))
    this.client.on('attributeList', (name, value, prevalue, timestamp) => {
      this.externalDoorUpdate(name, parseInt(value))
      if (this.debugMakerOnEvent) {
        this.log.error('---- debugMakerOnEvent output ----')
        this.log.warn('\n name: %s\n value: %s\n prevalue: %s\n timestamp: %s', name, value, prevalue, timestamp)
        this.log.error('---- end debugMakerOnEvent output ----')
      }
    })
  }

  async getAttributes () {
    try {
      const data = await this.soapAction('urn:Belkin:service:deviceevent:1', 'GetAttributes', null)
      const xml = '<attributeList>' + entities.decodeXML(data.attributeList) + '</attributeList>'
      const result = await xml2js.parseStringPromise(xml, { explicitArray: false })
      const attributes = {}
      for (const key in result.attributeList.attribute) {
        if (helpers.hasProperty(result.attributeList.attribute, key)) {
          const attribute = result.attributeList.attribute[key]
          attributes[attribute.name] = attribute.value
        }
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
      if (parseInt(attributes.SensorPresent) === 1) {
        this.sensorPresent = true
        this.externalSensorUpdate(parseInt(attributes.Sensor))
      } else {
        this.sensorPresent = false
      }
    } catch (err) {
      this.log.warn('[%s] wemoClient.getAttributes error - %s.', this.accessory.displayName, err)
    }
  }

  async internalDoorUpdate (value, callback) {
    const service = this.accessory.getService(this.Service.GarageDoorOpener)
    const prevTarget = service.getCharacteristic(this.Characteristic.TargetDoorState).value
    const prevCurrent = service.getCharacteristic(this.Characteristic.CurrentDoorState).value
    try {
      callback()
      this.homekitTriggered = true
      if (!this.isMoving) {
        if (value === helpers.garageStates.Closed && prevCurrent === helpers.garageStates.Closed) {
          if (!this.disableDeviceLogging) this.log('[%s] is already closed.', this.accessory.displayName)
          return
        } else if (value === helpers.garageStates.Open && prevCurrent === helpers.garageStates.Open) {
          if (!this.disableDeviceLogging) this.log('[%s] is already open.', this.accessory.displayName)
          return
        }
      } else {
        if (value === helpers.garageStates.Closed && prevCurrent === helpers.garageStates.Closing) {
          if (!this.disableDeviceLogging) this.log('[%s] is already closing.', this.accessory.displayName)
          return
        } else if (value === helpers.garageStates.Open && prevCurrent === helpers.garageStates.Opening) {
          if (!this.disableDeviceLogging) this.log('[%s] is already opening.', this.accessory.displayName)
          return
        }
      }
      await this.soapAction('urn:Belkin:service:basicevent:1', 'SetBinaryState', { BinaryState: 1 })
      if (!this.disableDeviceLogging) this.log('[%s] setting to [%s].', this.accessory.displayName, value ? 'close' : 'open')
      this.setDoorMoving(value, true)
    } catch (err) {
      this.log.warn('[%s] setting target state [%s] error - %s.', this.accessory.displayName, value ? 'closed' : 'open', err)
      this.log.warn('[%s] Reverting HomeKit status due to error.', this.accessory.displayName)
      await helpers.sleep(1000)
      service.updateCharacteristic(this.Characteristic.CurrentDoorState, prevCurrent)
      service.updateCharacteristic(this.Characteristic.TargetDoorState, prevTarget)
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
            this.homekitTriggered = false
            return
          }
          const service = this.accessory.getService(this.Service.GarageDoorOpener)
          const targetDoorState = service.getCharacteristic(this.Characteristic.TargetDoorState).value
          const state = 1 - targetDoorState
          if (!this.disableDeviceLogging) {
            this.log('[%s] triggered externally, updating target position [%s].', this.accessory.displayName, state ? 'closed' : 'open')
          }
          service.updateCharacteristic(this.Characteristic.TargetDoorState, state)
          this.setDoorMoving(state)
          break
        }
      }
    } catch (err) {
      this.log.warn('[%s] updating [%s] with value [%s] error - %s', this.accessory.displayName, name, value, err)
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
          if (!this.disableDeviceLogging) this.log('[%s] updating current state [opening].', this.accessory.displayName)
        } else {
          service.updateCharacteristic(this.Characteristic.CurrentDoorState, helpers.garageStates.Open)
          if (!this.disableDeviceLogging) this.log('[%s] updating current state [open].', this.accessory.displayName)
        }
      } else {
        // Garage door's target state is OPEN, but the garage door's current state is CLOSED,
        // it must have been triggered externally by a remote control
        this.isMoving = false
        service.updateCharacteristic(this.Characteristic.TargetDoorState, helpers.garageStates.Closed)
        service.updateCharacteristic(this.Characteristic.CurrentDoorState, helpers.garageStates.Closed)
        if (!this.disableDeviceLogging) {
          this.log('[%s] updating current state [closed] (triggered externally).', this.accessory.displayName)
        }
      }
    } else {
      // Garage door's target state is CLOSED and the garage door's current state is CLOSED
      if (value === 1) {
        this.isMoving = false
        if (this.movingTimer) {
          clearTimeout(this.movingTimer)
          this.movingTimer = false
        }
        service.updateCharacteristic(this.Characteristic.CurrentDoorState, helpers.garageStates.Closed)
        if (!this.disableDeviceLogging) this.log('[%s] updating current state [closed].', this.accessory.displayName)
      } else {
        // Garage door's target state is CLOSED, but the garage door's current state is OPEN,
        // it must have been triggered externally by a remote control
        service.updateCharacteristic(this.Characteristic.TargetDoorState, helpers.garageStates.Open)
        if (!this.disableDeviceLogging) this.log('[%s] updating target state [open] (triggered externally).', this.accessory.displayName)
        if (wasTriggered) this.setDoorMoving(0)
      }
    }
  }

  async setDoorMoving (targetDoorState, homekitTriggered) {
    const service = this.accessory.getService(this.Service.GarageDoorOpener)
    if (this.movingTimer) {
      clearTimeout(this.movingTimer)
      this.movingTimer = false
    }
    if (this.isMoving) {
      this.isMoving = false
      service.updateCharacteristic(this.Characteristic.CurrentDoorState, 4)
      if (!this.disableDeviceLogging) this.log('[%s] updating current state [stopped].', this.accessory.displayName)
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
          if (!this.disableDeviceLogging) this.log('[%s] updating current state [closing].', this.accessory.displayName)
        }
      } else if (targetDoorState === helpers.garageStates.Open) {
        if (
          currentDoorState === helpers.garageStates.Stopped ||
          (currentDoorState !== helpers.garageStates.Open && !this.sensorPresent)
        ) {
          service.updateCharacteristic(this.Characteristic.CurrentDoorState, helpers.garageStates.Opening)
          if (!this.disableDeviceLogging) this.log('[%s] updating current state [opening].', this.accessory.displayName)
        }
      }
    }
    this.movingTimer = setTimeout(
      () => {
        this.movingTimer = false
        this.isMoving = false
        const targetDoorState = service.getCharacteristic(this.Characteristic.TargetDoorState).value
        if (!this.sensorPresent) {
          service.updateCharacteristic(
            this.Characteristic.CurrentDoorState,
            targetDoorState ? helpers.garageStates.Closed : helpers.garageStates.Open
          )
          if (!this.disableDeviceLogging) {
            this.log('[%s] updating current state [%s].', this.accessory.displayName, targetDoorState ? 'closed' : 'open')
          }
          return
        }
        this.getAttributes()
      },
      this.doorOpenTimer * 1000
    )
  }
}
