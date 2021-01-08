/* jshint -W014, -W033, esversion: 9 */
/* eslint-disable new-cap */
'use strict'
const xml2js = require('xml2js')
module.exports = class deviceMakerGarage {
  constructor (platform, accessory, device) {
    this.log = platform.log
    this.debug = platform.debug
    this.helpers = platform.helpers
    this.disableDeviceLogging = platform.config.disableDeviceLogging
    this.doorOpenTimer = parseInt(platform.makerTypes[device.serialNumber].timer)
    this.doorOpenTimer = isNaN(this.doorOpenTimer)
      ? platform.doorOpenTimer
      : this.doorOpenTimer < 0
        ? platform.doorOpenTimer
        : this.doorOpenTimer
    this.Service = platform.api.hap.Service
    this.Characteristic = platform.api.hap.Characteristic
    this.client = accessory.client
    this.accessory = accessory

    // *** If the accessory has a switch service, then remove it *** \\
    if (this.accessory.getService(this.Service.Switch)) {
      this.accessory.removeService(this.accessory.getService(this.Service.Switch))
    }

    // *** If the accessory has a contact sensor service, then remove it *** \\
    if (this.accessory.getService(this.Service.ContactSensor)) {
      this.accessory.removeService(this.accessory.getService(this.Service.ContactSensor))
    }

    // *** Add the garage door service if it doesn't already exist *** \\
    this.service = this.accessory.getService(this.Service.GarageDoorOpener) || this.accessory.addService(this.Service.GarageDoorOpener)

    // *** Add the set handler to the garage door target state characteristic *** \\
    this.service
      .getCharacteristic(this.Characteristic.TargetDoorState)
      .removeAllListeners('set')
      .on('set', this.internalDoorUpdate.bind(this))

    // *** A listener for when the device sends an update to the plugin *** \\
    this.client.on('attributeList', attribute => this.receiveDeviceUpdate(attribute))

    // *** Request a device update immediately *** \\
    this.requestDeviceUpdate()
  }

  receiveDeviceUpdate (attribute) {
    if (this.debug) {
      this.log('[%s] received update [%s: %s]', this.accessory.displayName, attribute.name, attribute.value)
    }
    switch (attribute.name) {
      case 'Switch':
        this.externalDoorUpdate(attribute.value)
        break
      case 'Sensor': {
        /***
          state is passed as 0 for closed / TargetDoorState value = 0=open, 1=closed
          0->1 and 1->0 reverse values to match HomeKit needs
        ***/
        const hkValue = 1 - attribute.value
        this.externalSensorUpdate(hkValue, true)
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
      const data = await this.client.sendRequest('urn:Belkin:service:deviceevent:1', 'GetAttributes')
      const xml = '<attributeList>' + this.helpers.decodeXML(data.attributeList) + '</attributeList>'
      const result = await xml2js.parseStringPromise(xml, { explicitArray: false })
      const attributes = {}
      for (const key in result.attributeList.attribute) {
        if (this.helpers.hasProperty(result.attributeList.attribute, key)) {
          const attribute = result.attributeList.attribute[key]
          attributes[attribute.name] = attribute.value
        }
      }
      if (attributes.SwitchMode && parseInt(attributes.SwitchMode) === 0) {
        this.log.warn('[%s] must be set to momentary mode to work as a garage door.', this.accessory.displayName)
        return
      }
      if (attributes.SensorPresent && parseInt(attributes.SensorPresent) === 1) {
        this.sensorPresent = true
        if (attributes.Sensor) {
          const hkValue = 1 - parseInt(attributes.Sensor)
          this.externalSensorUpdate(hkValue, false)
        }
      } else {
        this.sensorPresent = false
      }
    } catch (err) {
      const errToShow = this.debug ? '\n' + err : err.message
      this.log.warn('[%s] requestDeviceUpdate error: %s.', this.accessory.displayName, errToShow)
    }
  }

  async internalDoorUpdate (value, callback) {
    let prevTarget
    let prevCurrent
    try {
      prevTarget = this.service.getCharacteristic(this.Characteristic.TargetDoorState).value
      prevCurrent = this.service.getCharacteristic(this.Characteristic.CurrentDoorState).value
      callback()
      this.homekitTriggered = true
      if (!this.isMoving) {
        if (value === this.helpers.garageStates.Closed && prevCurrent === this.helpers.garageStates.Closed) {
          if (!this.disableDeviceLogging) {
            this.log('[%s] is already closed.', this.accessory.displayName)
          }
          return
        } else if (value === this.helpers.garageStates.Open && prevCurrent === this.helpers.garageStates.Open) {
          if (!this.disableDeviceLogging) {
            this.log('[%s] is already open.', this.accessory.displayName)
          }
          return
        }
      } else {
        if (value === this.helpers.garageStates.Closed && prevCurrent === this.helpers.garageStates.Closing) {
          if (!this.disableDeviceLogging) {
            this.log('[%s] is already closing.', this.accessory.displayName)
          }
          return
        } else if (value === this.helpers.garageStates.Open && prevCurrent === this.helpers.garageStates.Opening) {
          if (!this.disableDeviceLogging) {
            this.log('[%s] is already opening.', this.accessory.displayName)
          }
          return
        }
      }
      await this.sendDeviceUpdate({
        BinaryState: 1
      })
      if (!this.disableDeviceLogging) {
        this.log('[%s] setting to [%s].', this.accessory.displayName, value ? 'close' : 'open')
      }
      this.setDoorMoving(value, true)
    } catch (err) {
      const errToShow = this.debug ? '\n' + err : err.message
      this.log.warn('[%s] setting target state [%s] error: %s.', this.accessory.displayName, value ? 'closed' : 'open', errToShow)
      this.log.warn('[%s] reverting HomeKit status due to error.', this.accessory.displayName)
      await this.helpers.sleep(1000)
      this.service.updateCharacteristic(this.Characteristic.CurrentDoorState, prevCurrent)
      this.service.updateCharacteristic(this.Characteristic.TargetDoorState, prevTarget)
    }
  }

  externalDoorUpdate (value) {
    try {
      if (value === 0) return
      if (this.homekitTriggered) {
        this.homekitTriggered = false
        return
      }
      const targetDoorState = this.service.getCharacteristic(this.Characteristic.TargetDoorState).value
      const state = 1 - targetDoorState
      if (!this.disableDeviceLogging) {
        this.log('[%s] triggered externally, updating target position [%s].', this.accessory.displayName, state ? 'closed' : 'open')
      }
      this.service.updateCharacteristic(this.Characteristic.TargetDoorState, state)
      this.setDoorMoving(state)
    } catch (err) {
      const errToShow = this.debug ? '\n' + err : err.message
      this.log.warn('[%s] updating target position [%s] error: %s.', this.accessory.displayName, value, errToShow)
    }
  }

  externalSensorUpdate (value, wasTriggered) {
    const targetDoorState = this.service.getCharacteristic(this.Characteristic.TargetDoorState).value
    if (targetDoorState === 0) {
      if (value === 0) {
        // Garage door's target state is OPEN and the garage door's current state is OPEN
        if (this.isMoving) {
          this.service.updateCharacteristic(this.Characteristic.CurrentDoorState, this.helpers.garageStates.Opening)
          if (!this.disableDeviceLogging) {
            this.log('[%s] updating current state [opening].', this.accessory.displayName)
          }
        } else {
          this.service.updateCharacteristic(this.Characteristic.CurrentDoorState, this.helpers.garageStates.Open)
          if (!this.disableDeviceLogging) {
            this.log('[%s] updating current state [open].', this.accessory.displayName)
          }
        }
      } else {
        // Garage door's target state is OPEN, but the garage door's current state is CLOSED,
        // it must have been triggered externally by a remote control
        this.isMoving = false
        this.service.updateCharacteristic(this.Characteristic.TargetDoorState, this.helpers.garageStates.Closed)
        this.service.updateCharacteristic(this.Characteristic.CurrentDoorState, this.helpers.garageStates.Closed)
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
        this.service.updateCharacteristic(this.Characteristic.CurrentDoorState, this.helpers.garageStates.Closed)
        if (!this.disableDeviceLogging) {
          this.log('[%s] updating current state [closed].', this.accessory.displayName)
        }
      } else {
        // Garage door's target state is CLOSED, but the garage door's current state is OPEN,
        // it must have been triggered externally by a remote control
        this.service.updateCharacteristic(this.Characteristic.TargetDoorState, this.helpers.garageStates.Open)
        if (!this.disableDeviceLogging) {
          this.log('[%s] updating target state [open] (triggered externally).', this.accessory.displayName)
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
      this.service.updateCharacteristic(this.Characteristic.CurrentDoorState, 4)
      if (!this.disableDeviceLogging) {
        this.log('[%s] updating current state [stopped].', this.accessory.displayName)
      }
      // *** Toggle TargetDoorState after receiving a stop *** \\
      await this.helpers.sleep(500)
      this.service.updateCharacteristic(
        this.Characteristic.TargetDoorState,
        targetDoorState === this.helpers.garageStates.Open ? this.helpers.garageStates.Closed : this.helpers.garageStates.Open
      )
      return
    }
    this.isMoving = true
    if (homekitTriggered) {
      const currentDoorState = this.service.getCharacteristic(this.Characteristic.CurrentDoorState).value
      if (targetDoorState === this.helpers.garageStates.Closed) {
        if (currentDoorState !== this.helpers.garageStates.Closed) {
          this.service.updateCharacteristic(this.Characteristic.CurrentDoorState, this.helpers.garageStates.Closing)
          if (!this.disableDeviceLogging) {
            this.log('[%s] updating current state [closing].', this.accessory.displayName)
          }
        }
      } else if (targetDoorState === this.helpers.garageStates.Open) {
        if (
          currentDoorState === this.helpers.garageStates.Stopped ||
          (currentDoorState !== this.helpers.garageStates.Open && !this.sensorPresent)
        ) {
          this.service.updateCharacteristic(this.Characteristic.CurrentDoorState, this.helpers.garageStates.Opening)
          if (!this.disableDeviceLogging) {
            this.log('[%s] updating current state [opening].', this.accessory.displayName)
          }
        }
      }
    }
    this.movingTimer = setTimeout(
      () => {
        this.movingTimer = false
        this.isMoving = false
        const targetDoorState = this.service.getCharacteristic(this.Characteristic.TargetDoorState).value
        if (!this.sensorPresent) {
          this.service.updateCharacteristic(
            this.Characteristic.CurrentDoorState,
            targetDoorState ? this.helpers.garageStates.Closed : this.helpers.garageStates.Open
          )
          if (!this.disableDeviceLogging) {
            this.log('[%s] updating current state [%s].', this.accessory.displayName, targetDoorState ? 'closed' : 'open')
          }
          return
        }
        this.requestDeviceUpdate()
      },
      this.doorOpenTimer * 1000
    )
  }
}
