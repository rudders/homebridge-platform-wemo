/* jshint node: true,esversion: 9, -W014, -W033 */
/* eslint-disable new-cap */
'use strict'

const xml2js = require('xml2js')

module.exports = class deviceMakerGarage {
  constructor (platform, accessory, device) {
    // Set up variables from the platform
    this.consts = platform.consts
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

    // Set the correct logging variables for this accessory
    this.enableLogging = !platform.config.disableDeviceLogging
    this.enableDebugLogging = platform.config.debug
    if (deviceConf && deviceConf.overrideLogging) {
      switch (deviceConf.overrideLogging) {
        case 'standard':
          this.enableLogging = true
          this.enableDebugLogging = false
          break
        case 'debug':
          this.enableLogging = true
          this.enableDebugLogging = true
          break
        case 'disable':
          this.enableLogging = false
          this.enableDebugLogging = false
          break
      }
    }

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
      this.service.addCharacteristic(this.eveChar.LastActivation)
      this.service.addCharacteristic(this.eveChar.ResetTotal)
      this.service.addCharacteristic(this.eveChar.TimesOpened)
    }

    // Remove unused characteristics
    if (this.service.testCharacteristic(this.hapChar.ContactSensorState)) {
      this.service.removeCharacteristic(
        this.service.getCharacteristic(this.hapChar.ContactSensorState)
      )
    }
    if (this.service.testCharacteristic(this.eveChar.OpenDuration)) {
      this.service.removeCharacteristic(this.service.getCharacteristic(this.eveChar.OpenDuration))
    }
    if (this.service.testCharacteristic(this.eveChar.ClosedDuration)) {
      this.service.removeCharacteristic(this.service.getCharacteristic(this.eveChar.ClosedDuration))
    }

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

    // Output the customised options to the log
    const opts = JSON.stringify({
      logging: this.enableDebugLogging ? 'debug' : this.enableLogging ? 'standard' : 'disable',
      makerTimer: this.doorOpenTimer
    })
    this.log('[%s] %s %s.', this.name, this.lang.devInitOpts, opts)

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
    // Log the receiving update if debug is enabled
    if (this.enableDebugLogging) {
      this.log('[%s] %s [%s: %s].', this.name, this.lang.recUpd, attribute.name, attribute.value)
    }

    // Check which attribute we are getting
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
    // Log the sending update if debug is enabled
    if (this.enableDebugLogging) {
      this.log('[%s] %s %s.', this.name, this.lang.senUpd, JSON.stringify(value))
    }

    // Send the update
    await this.client.sendRequest('urn:Belkin:service:basicevent:1', 'SetBinaryState', value)
  }

  async requestDeviceUpdate () {
    try {
      // Request the update
      const data = await this.client.sendRequest(
        'urn:Belkin:service:deviceevent:1',
        'GetAttributes'
      )

      // Parse the response
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

      // Only send the required attributes to the receiveDeviceUpdate function
      if (attributes.SwitchMode === 0) {
        this.log.warn('[%s] %s.', this.name, this.lang.makerNeedMMode)
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
      // Checks to see if the new required movement is already happening
      if (this.isMoving) {
        if (value === this.gStates.Closed && prevCurr === this.gStates.Closing) {
          if (this.enableLogging) {
            this.log('[%s] %s.', this.name, this.lang.makerClosing)
          }
          return
        } else if (value === this.gStates.Open && prevCurr === this.gStates.Opening) {
          if (this.enableLogging) {
            this.log('[%s] %s.', this.name, this.lang.makerOpening)
          }
          return
        }
      } else {
        if (value === this.gStates.Closed && prevCurr === this.gStates.Closed) {
          if (this.enableLogging) {
            this.log('[%s] %s.', this.name, this.lang.makerClosed)
          }
          return
        } else if (value === this.gStates.Open && prevCurr === this.gStates.Open) {
          if (this.enableLogging) {
            this.log('[%s] %s.', this.name, this.lang.makerOpen)
          }
          return
        }
      }

      // Required movement isn't already in progress so make the new movement happen
      this.homekitTriggered = true

      // Send the update
      await this.sendDeviceUpdate({
        BinaryState: 1
      })

      // Log the change if appropriate
      if (this.enableLogging) {
        this.log(
          '[%s] %s [%s].',
          this.name,
          this.lang.tarState,
          value ? this.lang.labelClosed : this.lang.labelOpen
        )
      }

      // Call the function to set the door moving
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
      // We want to ignore update notifications from when controlled through HomeKit
      if (this.homekitTriggered) {
        this.homekitTriggered = false
        return
      }

      // The change of state must have been triggered externally
      const target = this.service.getCharacteristic(this.hapChar.TargetDoorState).value
      const state = 1 - target
      if (this.enableLogging) {
        this.log(
          '[%s] %s [%s] [%s].',
          this.name,
          this.lang.tarState,
          state === 1 ? this.lang.labelClosed : this.lang.labelOpen,
          this.lang.makerTrigExt
        )
      }

      // Update the new target state HomeKit characteristic
      this.service.updateCharacteristic(this.hapChar.TargetDoorState, state)

      // If the door has been opened externally then update the Eve-only characteristics
      if (state === 0) {
        this.accessory.eveService.addEntry({ status: 0 })
        this.service.updateCharacteristic(
          this.eveChar.LastActivation,
          Math.round(new Date().valueOf() / 1000) - this.accessory.eveService.getInitialTime()
        )
        this.service.updateCharacteristic(
          this.eveChar.TimesOpened,
          this.service.getCharacteristic(this.eveChar.TimesOpened).value + 1
        )
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
            this.accessory.eveService.addEntry({ status: 0 })
            this.service.updateCharacteristic(
              this.eveChar.LastActivation,
              Math.round(new Date().valueOf() / 1000) - this.accessory.eveService.getInitialTime()
            )
            this.service.updateCharacteristic(
              this.eveChar.TimesOpened,
              this.service.getCharacteristic(this.eveChar.TimesOpened).value + 1
            )

            // Log the change if appropriate
            if (this.enableLogging) {
              this.log('[%s] %s [%s].', this.name, this.lang.curState, this.lang.labelOpening)
            }
          } else {
            // Garage door is open and not moving
            this.service.updateCharacteristic(this.hapChar.CurrentDoorState, this.gStates.Open)

            // Log the change if appropriate
            if (this.enableLogging) {
              this.log('[%s] %s [%s].', this.name, this.lang.curState, this.lang.labelOpen)
            }
          }
        } else {
          // Garage door HK target state is OPEN and the sensor has reported CLOSED
          // Must have been triggered externally
          this.isMoving = false
          this.service.updateCharacteristic(this.hapChar.TargetDoorState, this.gStates.Closed)
          this.service.updateCharacteristic(this.hapChar.CurrentDoorState, this.gStates.Closed)
          this.accessory.eveService.addEntry({ status: 1 })

          // Log the change if appropriate
          if (this.enableLogging) {
            this.log(
              '[%s] %s [%s] [%s].',
              this.name,
              this.lang.curState,
              this.lang.labelClosed,
              this.lang.makerTrigExt
            )
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

          // Update the HomeKit characteristics
          this.service.updateCharacteristic(this.hapChar.CurrentDoorState, this.gStates.Closed)
          this.accessory.eveService.addEntry({ status: 1 })

          // Log the change if appropriate
          if (this.enableLogging) {
            this.log('[%s] %s [%s].', this.name, this.lang.curState, this.lang.labelClosed)
          }
        } else {
          // Garage door HK target state is CLOSED but the sensor has reported OPEN
          // Must have been triggered externally
          this.service.updateCharacteristic(this.hapChar.TargetDoorState, this.gStates.Open)
          this.accessory.eveService.addEntry({ status: 0 })
          this.service.updateCharacteristic(
            this.eveChar.LastActivation,
            Math.round(new Date().valueOf() / 1000) - this.accessory.eveService.getInitialTime()
          )
          this.service.updateCharacteristic(
            this.eveChar.TimesOpened,
            this.service.getCharacteristic(this.eveChar.TimesOpened).value + 1
          )

          // Log the change if appropriate
          if (this.enableLogging) {
            this.log(
              '[%s] %s [%s] [%s].',
              this.name,
              this.lang.tarState,
              this.lang.labelOpen,
              this.lang.makerTrigExt
            )
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
    // If a moving timer already exists then stop it
    if (this.movingTimer) {
      clearTimeout(this.movingTimer)
      this.movingTimer = false
    }

    // The door must have stopped
    if (this.isMoving) {
      this.isMoving = false
      this.service.updateCharacteristic(this.hapChar.CurrentDoorState, 4)
      if (this.enableLogging) {
        this.log('[%s] %s [%s].', this.name, this.lang.curState, this.lang.labelStopped)
      }

      // Toggle TargetDoorState after receiving a stop
      await this.funcs.sleep(500)
      this.service.updateCharacteristic(
        this.hapChar.TargetDoorState,
        targetDoorState === this.gStates.Open ? this.gStates.Closed : this.gStates.Open
      )
      return
    }

    // Set the moving flag to true
    this.isMoving = true
    if (homekitTriggered) {
      // CASE: triggered through HomeKit
      const curState = this.service.getCharacteristic(this.hapChar.CurrentDoorState).value
      if (targetDoorState === this.gStates.Closed) {
        // CASE: triggered through HomeKit and requested to CLOSE
        if (curState !== this.gStates.Closed) {
          this.service.updateCharacteristic(this.hapChar.CurrentDoorState, this.gStates.Closing)

          // Log the change if appropriate
          if (this.enableLogging) {
            this.log('[%s] %s [%s].', this.name, this.lang.curState, this.lang.labelClosing)
          }
        }
      } else {
        // CASE: triggered through HomeKit and requested to OPEN
        if (
          curState === this.gStates.Stopped ||
          (curState !== this.gStates.Open && !this.sensorPresent)
        ) {
          this.service.updateCharacteristic(this.hapChar.CurrentDoorState, this.gStates.Opening)
          this.accessory.eveService.addEntry({ status: 0 })
          this.service.updateCharacteristic(
            this.eveChar.LastActivation,
            Math.round(new Date().valueOf() / 1000) - this.accessory.eveService.getInitialTime()
          )
          this.service.updateCharacteristic(
            this.eveChar.TimesOpened,
            this.service.getCharacteristic(this.eveChar.TimesOpened).value + 1
          )

          // Log the change if appropriate
          if (this.enableLogging) {
            this.log('[%s] %s [%s].', this.name, this.lang.curState, this.lang.labelOpening)
          }
        }
      }
    }

    // Setup the moving timer
    this.movingTimer = setTimeout(() => {
      this.movingTimer = false
      this.isMoving = false
      const target = this.service.getCharacteristic(this.hapChar.TargetDoorState).value
      if (!this.sensorPresent) {
        this.service.updateCharacteristic(
          this.hapChar.CurrentDoorState,
          target === 1 ? this.gStates.Closed : this.gStates.Open
        )

        // Log the change if appropriate
        if (this.enableLogging) {
          this.log(
            '[%s] %s [%s].',
            this.name,
            this.lang.curState,
            target === 1 ? this.lang.labelClosed : this.lang.labelOpen
          )
        }
        return
      }
      if (target === 1) {
        this.accessory.eveService.addEntry({ status: 1 })
      }

      // Request a device update at the end of the timer
      this.requestDeviceUpdate()
    }, this.doorOpenTimer * 1000)
  }
}
