/* jshint -W014, -W033, esversion: 9 */
/* eslint-disable new-cap */
'use strict'

module.exports = class deviceMakerGarage {
  constructor (platform, accessory, device) {
    // Set up variables from the platform
    this.debug = platform.config.debug
    this.disableDeviceLogging = platform.config.disableDeviceLogging
    this.funcs = platform.funcs
    this.hapServ = platform.api.hap.Service
    this.hapChar = platform.api.hap.Characteristic
    this.log = platform.log
    this.messages = platform.messages
    this.xml2js = platform.xml2js

    // Set up variables from the accessory
    this.accessory = accessory
    this.client = accessory.client
    this.name = accessory.displayName

    // Set up custom variables for this device type
    this.doorOpenTimer = platform.wemoMakers[device.serialNumber] &&
      platform.wemoMakers[device.serialNumber].makerTimer
      ? platform.wemoMakers[device.serialNumber].makerTimer
      : platform.consts.defaultValues.makerTimer

    // Some conversion objects
    this.gStates = {
      Open: 0,
      Closed: 1,
      Opening: 2,
      Closing: 3,
      Stopped: 4
    }

    // If the accessory has a switch service then remove it
    if (this.accessory.getService(this.hapServ.Switch)) {
      this.accessory.removeService(this.accessory.getService(this.hapServ.Switch))
    }

    // If the accessory has a contact sensor service then remove it
    if (this.accessory.getService(this.hapServ.ContactSensor)) {
      this.accessory.removeService(this.accessory.getService(this.hapServ.ContactSensor))
    }

    // Add the garage door service if it doesn't already exist
    this.service = this.accessory.getService(this.hapServ.GarageDoorOpener) || this.accessory.addService(this.hapServ.GarageDoorOpener)

    // Add the set handler to the target door state characteristic
    this.service.getCharacteristic(this.hapChar.TargetDoorState)
      .removeAllListeners('set')
      .on('set', this.internalDoorUpdate.bind(this))

    // A listener for when the device sends an update to the plugin
    this.client.on('attributeList', attribute => this.receiveDeviceUpdate(attribute))

    // Request a device update immediately
    this.requestDeviceUpdate()
  }

  receiveDeviceUpdate (attribute) {
    if (this.debug) {
      this.log(
        '[%s] %s [%s: %s].',
        this.name,
        this.messages.recUpd,
        attribute.name,
        attribute.value
      )
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
      const decoded = this.funcs.decodeXML(data.attributeList)
      const xml = '<attributeList>' + decoded + '</attributeList>'
      const result = await this.xml2js.parseStringPromise(xml, { explicitArray: false })
      const attributes = {}
      for (const key in result.attributeList.attribute) {
        if (this.funcs.hasProperty(result.attributeList.attribute, key)) {
          const attribute = result.attributeList.attribute[key]
          attributes[attribute.name] = parseInt(attribute.value)
        }
      }
      if (attributes.SwitchMode === 0) {
        this.log.warn(
          '[%s] must be set to momentary mode to work as a garage door.',
          this.name
        )
        return
      }
      if (attributes.SensorPresent === 1) {
        this.sensorPresent = true
        this.externalSensorUpdate(attributes.Sensor)
      } else {
        this.sensorPresent = false
      }
    } catch (err) {
      const eText = this.funcs.parseError(err)
      this.log.warn('[%s] %s: %s.', this.name, this.messages.rduErr, eText)
    }
  }

  async internalDoorUpdate (value, callback) {
    let prevTarget
    let prevCurrent
    try {
      prevTarget = this.service.getCharacteristic(this.hapChar.TargetDoorState).value
      prevCurrent = this.service.getCharacteristic(this.hapChar.CurrentDoorState).value
      callback()
      this.homekitTriggered = true
      if (!this.isMoving) {
        if (value === this.gStates.Closed && prevCurrent === this.gStates.Closed) {
          if (!this.disableDeviceLogging) {
            this.log('[%s] is already closed.', this.name)
          }
          return
        } else if (value === this.gStates.Open && prevCurrent === this.gStates.Open) {
          if (!this.disableDeviceLogging) {
            this.log('[%s] is already open.', this.name)
          }
          return
        }
      } else {
        if (value === this.gStates.Closed && prevCurrent === this.gStates.Closing) {
          if (!this.disableDeviceLogging) {
            this.log('[%s] is already closing.', this.name)
          }
          return
        } else if (value === this.gStates.Open && prevCurrent === this.gStates.Opening) {
          if (!this.disableDeviceLogging) {
            this.log('[%s] is already opening.', this.name)
          }
          return
        }
      }
      await this.sendDeviceUpdate({
        BinaryState: 1
      })
      if (!this.disableDeviceLogging) {
        this.log('[%s] setting to [%s].', this.name, value ? 'close' : 'open')
      }
      this.setDoorMoving(value, true)
    } catch (err) {
      try {
        const eText = this.funcs.parseError(err)
        this.log.warn('[%s] %s %s.', this.name, this.messages.cantUpd, eText)
        await this.funcs.sleep(1000)
        this.service.updateCharacteristic(this.hapChar.CurrentDoorState, prevCurrent)
        this.service.updateCharacteristic(this.hapChar.TargetDoorState, prevTarget)
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
      const target = this.service.getCharacteristic(this.hapChar.TargetDoorState).value
      state = 1 - target
      if (!this.disableDeviceLogging) {
        this.log(
          '[%s] triggered externally, updating target position [%s].',
          this.name,
          state ? 'closed' : 'open'
        )
      }
      this.service.updateCharacteristic(this.hapChar.TargetDoorState, state)
      this.setDoorMoving(state)
    } catch (err) {
      const eText = this.funcs.parseError(err)
      this.log.warn('[%s] %s %s.', this.name, this.messages.cantUpd, eText)
    }
  }

  externalSensorUpdate (state, wasTriggered) {
    // 0->1 and 1->0 reverse values to match HomeKit needs
    const value = 1 - state
    const target = this.service.getCharacteristic(this.hapChar.TargetDoorState).value
    if (target === 0) {
      if (value === 0) {
        // Garage door target state is OPEN and the garage door current state is OPEN
        if (this.isMoving) {
          this.service.updateCharacteristic(
            this.hapChar.CurrentDoorState,
            this.gStates.Opening
          )
          if (!this.disableDeviceLogging) {
            this.log('[%s] updating current state [opening].', this.name)
          }
        } else {
          this.service.updateCharacteristic(
            this.hapChar.CurrentDoorState,
            this.gStates.Open
          )
          if (!this.disableDeviceLogging) {
            this.log('[%s] updating current state [open].', this.name)
          }
        }
      } else {
        // Garage door target state is OPEN but the garage door current state is CLOSED
        // Must have been triggered externally
        this.isMoving = false
        this.service.updateCharacteristic(
          this.hapChar.TargetDoorState,
          this.gStates.Closed
        )
        this.service.updateCharacteristic(
          this.hapChar.CurrentDoorState,
          this.gStates.Closed
        )
        if (!this.disableDeviceLogging) {
          this.log(
            '[%s] updating current state [closed] (triggered externally).',
            this.name
          )
        }
      }
    } else {
      // Garage door target state is CLOSED and the garage door current state is CLOSED
      if (value === 1) {
        this.isMoving = false
        if (this.movingTimer) {
          clearTimeout(this.movingTimer)
          this.movingTimer = false
        }
        this.service.updateCharacteristic(
          this.hapChar.CurrentDoorState,
          this.gStates.Closed
        )
        if (!this.disableDeviceLogging) {
          this.log('[%s] updating current state [closed].', this.name)
        }
      } else {
        // Garage door target state is CLOSED but the garage door current state is OPEN
        // Must have been triggered externally
        this.service.updateCharacteristic(this.hapChar.TargetDoorState, this.gStates.Open)
        if (!this.disableDeviceLogging) {
          this.log('[%s] updating target state [open] (triggered externally).', this.name)
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
      this.service.updateCharacteristic(this.hapChar.CurrentDoorState, 4)
      if (!this.disableDeviceLogging) {
        this.log('[%s] updating current state [stopped].', this.name)
      }
      // Toggle TargetDoorState after receiving a stop
      await this.funcs.sleep(500)
      this.service.updateCharacteristic(
        this.hapChar.TargetDoorState,
        targetDoorState === this.gStates.Open ? this.gStates.Closed : this.gStates.Open
      )
      return
    }
    this.isMoving = true
    if (homekitTriggered) {
      const current = this.service.getCharacteristic(this.hapChar.CurrentDoorState).value
      if (targetDoorState === this.gStates.Closed) {
        if (current !== this.gStates.Closed) {
          this.service.updateCharacteristic(
            this.hapChar.CurrentDoorState,
            this.gStates.Closing
          )
          if (!this.disableDeviceLogging) {
            this.log('[%s] updating current state [closing].', this.name)
          }
        }
      } else if (targetDoorState === this.gStates.Open) {
        if (
          current === this.gStates.Stopped ||
          (current !== this.gStates.Open && !this.sensorPresent)
        ) {
          this.service.updateCharacteristic(
            this.hapChar.CurrentDoorState,
            this.gStates.Opening
          )
          if (!this.disableDeviceLogging) {
            this.log('[%s] updating current state [opening].', this.name)
          }
        }
      }
    }
    this.movingTimer = setTimeout(
      () => {
        this.movingTimer = false
        this.isMoving = false
        const target = this.service.getCharacteristic(this.hapChar.TargetDoorState).value
        if (!this.sensorPresent) {
          this.service.updateCharacteristic(
            this.hapChar.CurrentDoorState,
            target ? this.gStates.Closed : this.gStates.Open
          )
          if (!this.disableDeviceLogging) {
            this.log(
              '[%s] updating current state [%s].',
              this.name,
              target ? 'closed' : 'open'
            )
          }
          return
        }
        this.requestDeviceUpdate()
      },
      this.doorOpenTimer * 1000
    )
  }
}
