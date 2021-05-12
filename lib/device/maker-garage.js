/* jshint -W014, -W033, esversion: 9 */
/* eslint-disable new-cap */
'use strict'

const xml2js = require('xml2js')

module.exports = class deviceMakerGarage {
  constructor (platform, accessory, device) {
    // Set up variables from the platform
    this.consts = platform.consts
    this.debug = platform.config.debug
    this.eveChar = platform.eveChar
    this.funcs = platform.funcs
    this.hapChar = platform.api.hap.Characteristic
    this.hapErr = platform.api.hap.HapStatusError
    this.hapServ = platform.api.hap.Service
    this.lang = platform.lang
    this.log = platform.log

    // Set up variables from the accessory
    this.accessory = accessory
    this.client = accessory.client
    this.name = accessory.displayName

    // Set up custom variables for this device type
    const deviceConf = platform.wemoMakers[device.serialNumber]
    this.doorOpenTimer =
      deviceConf && deviceConf.makerTimer
        ? deviceConf.makerTimer
        : platform.consts.defaultValues.makerTimer
    this.disableDeviceLogging =
      deviceConf && deviceConf.overrideDisabledLogging
        ? false
        : platform.config.disableDeviceLogging

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
    if (!(this.service = this.accessory.getService(this.hapServ.GarageDoorOpener))) {
      this.service = this.accessory.addService(this.hapServ.GarageDoorOpener)
      this.service.addCharacteristic(this.hapChar.ContactSensorState)
      this.service.addCharacteristic(this.eveChar.LastActivation)
      this.service.addCharacteristic(this.eveChar.ResetTotal)
      this.service.addCharacteristic(this.eveChar.OpenDuration)
      this.service.addCharacteristic(this.eveChar.ClosedDuration)
      this.service.addCharacteristic(this.eveChar.TimesOpened)
    }

    // Obtain the current times opened value
    this.timesOpened = this.service.getCharacteristic(this.eveChar.TimesOpened).value

    // Add the set handler to the garage door reset total characteristic
    this.service.getCharacteristic(this.eveChar.ResetTotal).onSet(value => {
      this.timesOpened = 0
      this.service.updateCharacteristic(this.eveChar.TimesOpened, 0)
    })

    // Add the set handler to the target door state characteristic
    this.service.getCharacteristic(this.hapChar.TargetDoorState).onSet(async value => {
      await this.internalStateUpdate(value)
    })

    // Pass the accessory to Fakegato to set up with Eve
    this.accessory.eveService = new platform.eveService('door', this.accessory, {
      log: platform.config.debugFakegato ? this.log : () => {}
    })

    // Output the customised options to the log if in debug mode
    if (this.debug) {
      const opts = JSON.stringify({
        disableDeviceLogging: this.disableDeviceLogging,
        makerTimer: this.doorOpenTimer
      })
      this.log('[%s] %s %s.', this.name, this.lang.devInitOpts, opts)
    }

    // A listener for when the device sends an update to the plugin
    this.client.on('AttributeList', attribute => this.receiveDeviceUpdate(attribute))

    // This is to remove the 'No Response' message that is there before the plugin finds this device
    this.service.updateCharacteristic(
      this.hapChar.TargetDoorState,
      this.service.getCharacteristic(this.hapChar.TargetDoorState).value
    )

    // Request a device update immediately
    this.requestDeviceUpdate()
  }

  receiveDeviceUpdate (attribute) {
    if (this.debug) {
      this.log('[%s] %s [%s: %s].', this.name, this.lang.recUpd, attribute.name, attribute.value)
    }
    switch (attribute.name) {
      case 'Switch': {
        if (attribute.value !== 0) {
          this.externalStateUpdate()
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
    if (this.debug) {
      this.log('[%s] %s %s.', this.name, this.lang.senUpd, JSON.stringify(value))
    }
    await this.client.sendRequest('urn:Belkin:service:basicevent:1', 'SetBinaryState', value)
  }

  async requestDeviceUpdate () {
    try {
      const data = await this.client.sendRequest(
        'urn:Belkin:service:deviceevent:1',
        'GetAttributes'
      )
      const decoded = this.funcs.decodeXML(data.attributeList)
      const xml = '<attributeList>' + decoded + '</attributeList>'
      const result = await xml2js.parseStringPromise(xml, { explicitArray: false })
      const attributes = {}
      for (const key in result.attributeList.attribute) {
        if (this.funcs.hasProperty(result.attributeList.attribute, key)) {
          const attribute = result.attributeList.attribute[key]
          attributes[attribute.name] = parseInt(attribute.value)
        }
      }
      if (attributes.SwitchMode === 0) {
        this.log.warn('[%s] must be set to momentary mode to work as a garage door.', this.name)
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
      this.log.warn('[%s] %s: %s.', this.name, this.lang.rduErr, eText)
    }
  }

  async internalStateUpdate (value) {
    const prevTarg = this.service.getCharacteristic(this.hapChar.TargetDoorState).value
    const prevCurr = this.service.getCharacteristic(this.hapChar.CurrentDoorState).value
    try {
      if (this.isMoving) {
        if (value === this.gStates.Closed && prevCurr === this.gStates.Closing) {
          if (!this.disableDeviceLogging) {
            this.log('[%s] is already closing so ignoring command.', this.name)
          }
          return
        } else if (value === this.gStates.Open && prevCurr === this.gStates.Opening) {
          if (!this.disableDeviceLogging) {
            this.log('[%s] is already opening so ignoring command.', this.name)
          }
          return
        }
      } else {
        if (value === this.gStates.Closed && prevCurr === this.gStates.Closed) {
          if (!this.disableDeviceLogging) {
            this.log('[%s] is already closed so ignoring command.', this.name)
          }
          return
        } else if (value === this.gStates.Open && prevCurr === this.gStates.Open) {
          if (!this.disableDeviceLogging) {
            this.log('[%s] is already open so ignoring command.', this.name)
          }
          return
        }
      }
      this.homekitTriggered = true
      await this.sendDeviceUpdate({
        BinaryState: 1
      })
      if (!this.disableDeviceLogging) {
        this.log('[%s] target state [%s].', this.name, value ? 'closed' : 'open')
      }
      this.setDoorMoving(value, true)
    } catch (err) {
      const eText = this.funcs.parseError(err)
      this.log.warn('[%s] %s %s.', this.name, this.lang.cantUpd, eText)

      // Throw a 'no response' error and set a timeout to revert this after 2 seconds
      setTimeout(() => {
        this.service.updateCharacteristic(this.hapChar.TargetDoorState, prevTarg)
      }, 2000)
      throw new this.hapErr(-70402)
    }
  }

  externalStateUpdate () {
    try {
      if (this.homekitTriggered) {
        this.homekitTriggered = false
        return
      }
      const target = this.service.getCharacteristic(this.hapChar.TargetDoorState).value
      const state = 1 - target
      if (!this.disableDeviceLogging) {
        this.log(
          '[%s] target state [%s] (triggered externally).',
          this.name,
          state === 1 ? 'closed' : 'open'
        )
      }
      this.service.updateCharacteristic(this.hapChar.TargetDoorState, state)
      if (state === 0) {
        // Door opened externally
        this.service.updateCharacteristic(this.hapChar.ContactSensorState, 1)
        this.accessory.eveService.addEntry({ status: 0 })
        const initialTime = this.accessory.eveService.getInitialTime()
        this.service.updateCharacteristic(
          this.eveChar.LastActivation,
          Math.round(new Date().valueOf() / 1000) - initialTime
        )
        this.timesOpened++
        this.service.updateCharacteristic(this.eveChar.TimesOpened, this.timesOpened)
      }
      this.setDoorMoving(state)
    } catch (err) {
      const eText = this.funcs.parseError(err)
      this.log.warn('[%s] %s %s.', this.name, this.lang.cantUpd, eText)
    }
  }

  externalSensorUpdate (state, wasTriggered) {
    try {
      // 0->1 and 1->0 reverse values to match HomeKit needs
      const value = 1 - state
      const target = this.service.getCharacteristic(this.hapChar.TargetDoorState).value
      if (target === 0) {
        // CASE target is to OPEN
        if (value === 0) {
          // Garage door HK target state is OPEN and the sensor has reported OPEN
          if (this.isMoving) {
            // Garage door is in the process of opening
            this.service.updateCharacteristic(this.hapChar.CurrentDoorState, this.gStates.Opening)
            this.service.updateCharacteristic(this.hapChar.ContactSensorState, 1)
            this.accessory.eveService.addEntry({ status: 0 })
            const initialTime = this.accessory.eveService.getInitialTime()
            this.service.updateCharacteristic(
              this.eveChar.LastActivation,
              Math.round(new Date().valueOf() / 1000) - initialTime
            )
            this.timesOpened++
            this.service.updateCharacteristic(this.eveChar.TimesOpened, this.timesOpened)
            if (!this.disableDeviceLogging) {
              this.log('[%s] current state [opening].', this.name)
            }
          } else {
            // Garage door is open and not moving
            this.service.updateCharacteristic(this.hapChar.CurrentDoorState, this.gStates.Open)
            if (!this.disableDeviceLogging) {
              this.log('[%s] current state [open].', this.name)
            }
          }
        } else {
          // Garage door HK target state is OPEN and the sensor has reported CLOSED
          // Must have been triggered externally
          this.isMoving = false
          this.service.updateCharacteristic(this.hapChar.TargetDoorState, this.gStates.Closed)
          this.service.updateCharacteristic(this.hapChar.CurrentDoorState, this.gStates.Closed)
          this.service.updateCharacteristic(this.hapChar.ContactSensorState, 0)
          this.accessory.eveService.addEntry({ status: 1 })
          if (!this.disableDeviceLogging) {
            this.log('[%s] current state [closed] (triggered externally).', this.name)
          }
        }
      } else {
        if (value === 1) {
          // Garage door HK target state is CLOSED and the sensor has reported CLOSED
          this.isMoving = false
          if (this.movingTimer) {
            clearTimeout(this.movingTimer)
            this.movingTimer = false
          }
          this.service.updateCharacteristic(this.hapChar.CurrentDoorState, this.gStates.Closed)
          this.service.updateCharacteristic(this.hapChar.ContactSensorState, 0)
          this.accessory.eveService.addEntry({ status: 1 })
          if (!this.disableDeviceLogging) {
            this.log('[%s] current state [closed].', this.name)
          }
        } else {
          // Garage door HK target state is CLOSED but the sensor has reported OPEN
          // Must have been triggered externally
          this.service.updateCharacteristic(this.hapChar.TargetDoorState, this.gStates.Open)
          this.service.updateCharacteristic(this.hapChar.ContactSensorState, 1)
          this.accessory.eveService.addEntry({ status: 0 })
          const initialTime = this.accessory.eveService.getInitialTime()
          this.service.updateCharacteristic(
            this.eveChar.LastActivation,
            Math.round(new Date().valueOf() / 1000) - initialTime
          )
          this.timesOpened++
          this.service.updateCharacteristic(this.eveChar.TimesOpened, this.timesOpened)
          if (!this.disableDeviceLogging) {
            this.log('[%s] target state [open] (triggered externally).', this.name)
          }
          if (wasTriggered) {
            this.setDoorMoving(0)
          }
        }
      }
    } catch (err) {
      const eText = this.funcs.parseError(err)
      this.log.warn('[%s] %s %s.', this.name, this.lang.cantUpd, eText)
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
        this.log('[%s] current state [stopped].', this.name)
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
      // CASE: triggered through HomeKit
      const curState = this.service.getCharacteristic(this.hapChar.CurrentDoorState).value
      if (targetDoorState === this.gStates.Closed) {
        // CASE: triggered through HomeKit and requested to CLOSE
        if (curState !== this.gStates.Closed) {
          this.service.updateCharacteristic(this.hapChar.CurrentDoorState, this.gStates.Closing)
          if (!this.disableDeviceLogging) {
            this.log('[%s] current state [closing].', this.name)
          }
        }
      } else {
        // CASE: triggered through HomeKit and requested to OPEN
        if (
          curState === this.gStates.Stopped ||
          (curState !== this.gStates.Open && !this.sensorPresent)
        ) {
          this.service.updateCharacteristic(this.hapChar.CurrentDoorState, this.gStates.Opening)
          this.service.updateCharacteristic(this.hapChar.ContactSensorState, 1)
          this.accessory.eveService.addEntry({ status: 0 })
          const initialTime = this.accessory.eveService.getInitialTime()
          this.service.updateCharacteristic(
            this.eveChar.LastActivation,
            Math.round(new Date().valueOf() / 1000) - initialTime
          )
          this.timesOpened++
          this.service.updateCharacteristic(this.eveChar.TimesOpened, this.timesOpened)
          if (!this.disableDeviceLogging) {
            this.log('[%s] current state [opening].', this.name)
          }
        }
      }
    }
    this.movingTimer = setTimeout(() => {
      this.movingTimer = false
      this.isMoving = false
      const target = this.service.getCharacteristic(this.hapChar.TargetDoorState).value
      if (!this.sensorPresent) {
        this.service.updateCharacteristic(
          this.hapChar.CurrentDoorState,
          target === 1 ? this.gStates.Closed : this.gStates.Open
        )
        if (!this.disableDeviceLogging) {
          this.log('[%s] current state [%s].', this.name, target === 1 ? 'closed' : 'open')
        }
        return
      }
      if (target === 1) {
        this.service.updateCharacteristic(this.hapChar.ContactSensorState, 0)
        this.accessory.eveService.addEntry({ status: 1 })
      }
      this.requestDeviceUpdate()
    }, this.doorOpenTimer * 1000)
  }
}
