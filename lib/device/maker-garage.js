/* jshint -W014, -W033, esversion: 9 */
/* eslint-disable new-cap */
'use strict'

const xml2js = require('xml2js')

module.exports = class deviceMakerGarage {
  constructor (platform, accessory, device) {
    this.log = platform.log
    this.debug = platform.debug
    this.funcs = platform.funcs
    this.disableDeviceLogging = platform.config.disableDeviceLogging
    this.doorOpenTimer = platform.wemoMakers[device.serialNumber] && platform.wemoMakers[device.serialNumber].timer
      ? parseInt(platform.wemoMakers[device.serialNumber].timer)
      : platform.doorOpenTimer
    this.doorOpenTimer = isNaN(this.doorOpenTimer) || this.doorOpenTimer < 0
      ? platform.doorOpenTimer
      : this.doorOpenTimer
    this.S = platform.api.hap.Service
    this.C = platform.api.hap.Characteristic
    this.client = accessory.client
    this.dName = accessory.displayName
    this.accessory = accessory

    // *** Some conversion objects *** \\
    this.garageStates = {
      Open: 0,
      Closed: 1,
      Opening: 2,
      Closing: 3,
      Stopped: 4
    }

    // *** If the accessory has a switch service, then remove it *** \\
    if (this.accessory.getService(this.S.Switch)) {
      this.accessory.removeService(this.accessory.getService(this.S.Switch))
    }

    // *** If the accessory has a contact sensor service, then remove it *** \\
    if (this.accessory.getService(this.S.ContactSensor)) {
      this.accessory.removeService(this.accessory.getService(this.S.ContactSensor))
    }

    // *** Add the garage door service if it doesn't already exist *** \\
    this.service = this.accessory.getService(this.S.GarageDoorOpener) || this.accessory.addService(this.S.GarageDoorOpener)

    // *** Add the set handler to the target door state characteristic *** \\
    this.service.getCharacteristic(this.C.TargetDoorState)
      .removeAllListeners('set')
      .on('set', this.internalDoorUpdate.bind(this))

    // *** A listener for when the device sends an update to the plugin *** \\
    this.client.on('attributeList', attribute => this.receiveDeviceUpdate(attribute))

    // *** Request a device update immediately *** \\
    this.requestDeviceUpdate()
  }

  receiveDeviceUpdate (attribute) {
    if (this.debug) {
      this.log('[%s] received update [%s: %s]', this.dName, attribute.name, attribute.value)
    }
    switch (attribute.name) {
      case 'Switch': {
        if (attribute.value !== 0) {
          this.externalDoorUpdate()
        }
        break
      }
      case 'Sensor': {
        this.externalSensorUpdate(attribute.value, true)
        break
      }
    }
  }

  async sendDeviceUpdate (value) {
    await this.client.sendRequest(
      'urn:Belkin:service:basicevent:1',
      'SetBinaryState',
      value
    )
  }

  async requestDeviceUpdate () {
    try {
      const data = await this.client.sendRequest(
        'urn:Belkin:service:deviceevent:1',
        'GetAttributes'
      )
      const xml = '<attributeList>' + this.funcs.decodeXML(data.attributeList) + '</attributeList>'
      const result = await xml2js.parseStringPromise(xml, { explicitArray: false })
      const attributes = {}
      for (const key in result.attributeList.attribute) {
        if (this.funcs.hasProperty(result.attributeList.attribute, key)) {
          const attribute = result.attributeList.attribute[key]
          attributes[attribute.name] = parseInt(attribute.value)
        }
      }
      if (attributes.SwitchMode === 0) {
        this.log.warn('[%s] must be set to momentary mode to work as a garage door.', this.dName)
        return
      }
      if (attributes.SensorPresent === 1) {
        this.sensorPresent = true
        this.externalSensorUpdate(attributes.Sensor)
      } else {
        this.sensorPresent = false
      }
    } catch (err) {
      const errToShow = this.debug ? '\n' + err : err.message
      this.log.warn('[%s] requestDeviceUpdate error: %s.', this.dName, errToShow)
    }
  }

  async internalDoorUpdate (value, callback) {
    let prevTarget
    let prevCurrent
    try {
      prevTarget = this.service.getCharacteristic(this.C.TargetDoorState).value
      prevCurrent = this.service.getCharacteristic(this.C.CurrentDoorState).value
      callback()
      this.homekitTriggered = true
      if (!this.isMoving) {
        if (value === this.garageStates.Closed && prevCurrent === this.garageStates.Closed) {
          if (!this.disableDeviceLogging) {
            this.log('[%s] is already closed.', this.dName)
          }
          return
        } else if (value === this.garageStates.Open && prevCurrent === this.garageStates.Open) {
          if (!this.disableDeviceLogging) {
            this.log('[%s] is already open.', this.dName)
          }
          return
        }
      } else {
        if (value === this.garageStates.Closed && prevCurrent === this.garageStates.Closing) {
          if (!this.disableDeviceLogging) {
            this.log('[%s] is already closing.', this.dName)
          }
          return
        } else if (value === this.garageStates.Open && prevCurrent === this.garageStates.Opening) {
          if (!this.disableDeviceLogging) {
            this.log('[%s] is already opening.', this.dName)
          }
          return
        }
      }
      await this.sendDeviceUpdate({
        BinaryState: 1
      })
      if (!this.disableDeviceLogging) {
        this.log('[%s] setting to [%s].', this.dName, value ? 'close' : 'open')
      }
      this.setDoorMoving(value, true)
    } catch (err) {
      try {
        const errToShow = this.debug ? '\n' + err : err.message
        this.log.warn('[%s] setting target state [%s] error: %s.', this.dName, value ? 'closed' : 'open', errToShow)
        this.log.warn('[%s] reverting HomeKit status due to error.', this.dName)
        await this.funcs.sleep(1000)
        this.service.updateCharacteristic(this.C.CurrentDoorState, prevCurrent)
        this.service.updateCharacteristic(this.C.TargetDoorState, prevTarget)
      } catch (e) {}
    }
  }

  externalDoorUpdate () {
    let state
    try {
      if (this.homekitTriggered) {
        this.homekitTriggered = false
        return
      }
      const targetDoorState = this.service.getCharacteristic(this.C.TargetDoorState).value
      state = 1 - targetDoorState
      if (!this.disableDeviceLogging) {
        this.log('[%s] triggered externally, updating target position [%s].', this.dName, state ? 'closed' : 'open')
      }
      this.service.updateCharacteristic(this.C.TargetDoorState, state)
      this.setDoorMoving(state)
    } catch (err) {
      const errToShow = this.debug ? '\n' + err : err.message
      this.log.warn('[%s] updating target position [%s] error: %s.', this.dName, state ? 'closed' : 'open', errToShow)
    }
  }

  externalSensorUpdate (state, wasTriggered) {
    // *** 0->1 and 1->0 reverse values to match HomeKit needs *** \\
    const value = 1 - state
    const targetDoorState = this.service.getCharacteristic(this.C.TargetDoorState).value
    if (targetDoorState === 0) {
      if (value === 0) {
        // *** Garage door target state is OPEN and the garage door current state is OPEN *** \\
        if (this.isMoving) {
          this.service.updateCharacteristic(this.C.CurrentDoorState, this.garageStates.Opening)
          if (!this.disableDeviceLogging) {
            this.log('[%s] updating current state [opening].', this.dName)
          }
        } else {
          this.service.updateCharacteristic(this.C.CurrentDoorState, this.garageStates.Open)
          if (!this.disableDeviceLogging) {
            this.log('[%s] updating current state [open].', this.dName)
          }
        }
      } else {
        // *** Garage door target state is OPEN but the garage door current state is CLOSED (must be triggered externally) *** \\
        this.isMoving = false
        this.service.updateCharacteristic(this.C.TargetDoorState, this.garageStates.Closed)
        this.service.updateCharacteristic(this.C.CurrentDoorState, this.garageStates.Closed)
        if (!this.disableDeviceLogging) {
          this.log('[%s] updating current state [closed] (triggered externally).', this.dName)
        }
      }
    } else {
      // *** Garage door target state is CLOSED and the garage door current state is CLOSED *** \\
      if (value === 1) {
        this.isMoving = false
        if (this.movingTimer) {
          clearTimeout(this.movingTimer)
          this.movingTimer = false
        }
        this.service.updateCharacteristic(this.C.CurrentDoorState, this.garageStates.Closed)
        if (!this.disableDeviceLogging) {
          this.log('[%s] updating current state [closed].', this.dName)
        }
      } else {
        // *** Garage door target state is CLOSED but the garage door current state is OPEN (must be triggered externally) *** \\
        this.service.updateCharacteristic(this.C.TargetDoorState, this.garageStates.Open)
        if (!this.disableDeviceLogging) {
          this.log('[%s] updating target state [open] (triggered externally).', this.dName)
        }
        if (wasTriggered) {
          this.setDoorMoving(0)
        }
      }
    }
  }

  async setDoorMoving (targetDoorState, homekitTriggered) {
    if (this.movingTimer) {
      clearTimeout(this.movingTimer)
      this.movingTimer = false
    }
    if (this.isMoving) {
      this.isMoving = false
      this.service.updateCharacteristic(this.C.CurrentDoorState, 4)
      if (!this.disableDeviceLogging) {
        this.log('[%s] updating current state [stopped].', this.dName)
      }
      // *** Toggle TargetDoorState after receiving a stop *** \\
      await this.funcs.sleep(500)
      this.service.updateCharacteristic(
        this.C.TargetDoorState,
        targetDoorState === this.garageStates.Open ? this.garageStates.Closed : this.garageStates.Open
      )
      return
    }
    this.isMoving = true
    if (homekitTriggered) {
      const currentDoorState = this.service.getCharacteristic(this.C.CurrentDoorState).value
      if (targetDoorState === this.garageStates.Closed) {
        if (currentDoorState !== this.garageStates.Closed) {
          this.service.updateCharacteristic(this.C.CurrentDoorState, this.garageStates.Closing)
          if (!this.disableDeviceLogging) {
            this.log('[%s] updating current state [closing].', this.dName)
          }
        }
      } else if (targetDoorState === this.garageStates.Open) {
        if (currentDoorState === this.garageStates.Stopped || (currentDoorState !== this.garageStates.Open && !this.sensorPresent)) {
          this.service.updateCharacteristic(this.C.CurrentDoorState, this.garageStates.Opening)
          if (!this.disableDeviceLogging) {
            this.log('[%s] updating current state [opening].', this.dName)
          }
        }
      }
    }
    this.movingTimer = setTimeout(
      () => {
        this.movingTimer = false
        this.isMoving = false
        const targetDoorState = this.service.getCharacteristic(this.C.TargetDoorState).value
        if (!this.sensorPresent) {
          this.service.updateCharacteristic(
            this.C.CurrentDoorState,
            targetDoorState ? this.garageStates.Closed : this.garageStates.Open
          )
          if (!this.disableDeviceLogging) {
            this.log('[%s] updating current state [%s].', this.dName, targetDoorState ? 'closed' : 'open')
          }
          return
        }
        this.requestDeviceUpdate()
      },
      this.doorOpenTimer * 1000
    )
  }
}
