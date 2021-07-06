/* jshint -W014, -W033, esversion: 9 */
/* eslint-disable new-cap */
'use strict'

module.exports = class deviceMotion {
  constructor (platform, accessory, device) {
    // Set up variables from the platform
    this.eveChar = platform.eveChar
    this.funcs = platform.funcs
    this.hapChar = platform.api.hap.Characteristic
    this.hapServ = platform.api.hap.Service
    this.lang = platform.lang
    this.log = platform.log

    // Set up variables from the accessory
    this.accessory = accessory
    this.client = accessory.client
    this.name = accessory.displayName

    // Set up custom variables for this device type
    const deviceConf = platform.wemoMotions[device.serialNumber]
    this.noMotionTimer =
      deviceConf && deviceConf.noMotionTimer
        ? deviceConf.noMotionTimer
        : platform.consts.defaultValues.noMotionTimer

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

    // Add the motion sensor service if it doesn't already exist
    this.service =
      this.accessory.getService(this.hapServ.MotionSensor) ||
      this.accessory.addService(this.hapServ.MotionSensor)

    // Pass the accessory to fakegato to setup the Eve info service
    this.accessory.historyService = new platform.eveService('motion', this.accessory, {
      log: platform.config.debugFakegato ? this.log : () => {}
    })

    // Output the customised options to the log
    const opts = JSON.stringify({
      logging: this.enableDebugLogging ? 'debug' : this.enableLogging ? 'standard' : 'disable',
      noMotionTimer: this.noMotionTimer
    })
    this.log('[%s] %s %s.', this.name, this.lang.devInitOpts, opts)

    // A listener for when the device sends an update to the plugin
    this.client.on('BinaryState', attribute => this.receiveDeviceUpdate(attribute))
  }

  receiveDeviceUpdate (attribute) {
    // Log the receiving update if debug is enabled
    if (this.enableDebugLogging) {
      this.log('[%s] %s [%s: %s].', this.name, this.lang.recUpd, attribute.name, attribute.value)
    }

    // Send a HomeKit needed true/false argument
    // attribute.value is 1 if and only if motion is detected
    this.externalUpdate(attribute.value === 1)
  }

  externalUpdate (value) {
    try {
      // Obtain the previous state of the motion sensor
      const prevState = this.service.getCharacteristic(this.hapChar.MotionDetected).value

      // Don't continue in the following cases:
      // (1) the previous state is the same as before and the motion timer isn't running
      // (2) the new value is 'no motion detected' but the motion timer is still running
      if ((value === prevState && !this.motionTimer) || (!value && this.motionTimer)) {
        return
      }

      // Next logic depends on two cases
      if (value || this.noMotionTimer === 0) {
        // CASE: new motion detected or the user motion timer is set to 0 seconds
        // If a motion timer is already present then stop it
        if (this.motionTimer) {
          if (!this.disableDeviceLogging) {
            this.log('[%s] %s.', this.name, this.lang.timerStopped)
          }
          clearTimeout(this.motionTimer)
          this.motionTimer = false
        }

        // Update the HomeKit characteristics
        this.service.updateCharacteristic(this.hapChar.MotionDetected, value)

        // Add the entry to Eve
        this.accessory.historyService.addEntry({ status: value ? 1 : 0 })

        // If motion detected then update the LastActivation Eve characteristic
        if (value) {
          this.service.updateCharacteristic(
            this.eveChar.LastActivation,
            Math.round(new Date().valueOf() / 1000) - this.accessory.historyService.getInitialTime()
          )
        }

        // Log the change if appropriate
        if (!this.disableDeviceLogging) {
          this.log(
            '[%s] %s [%s].',
            this.name,
            this.lang.motionSensor,
            value ? this.lang.motionYes : this.lang.motionNo
          )
        }
      } else {
        // CASE: motion not detected and the user motion timer is more than 0 seconds
        if (!this.disableDeviceLogging) {
          this.log('[%s] %s [%ss].', this.name, this.lang.timerStarted, this.noMotionTimer)
        }

        // Clear any existing timers
        clearTimeout(this.motionTimer)

        // Create a new 'no motion timer'
        this.motionTimer = setTimeout(() => {
          // Update the HomeKit characteristic to false
          this.service.updateCharacteristic(this.hapChar.MotionDetected, false)

          // Add a no motion detected value to Eve
          this.accessory.historyService.addEntry({ status: 0 })

          // Log the change if appropriate
          if (!this.disableDeviceLogging) {
            this.log(
              '[%s] %s [%s] [%s].',
              this.name,
              this.lang.motionSensor,
              this.lang.motionNo,
              this.lang.timerComplete
            )
          }

          // Set the motion timer in use to false
          this.motionTimer = false
        }, this.noMotionTimer * 1000)
      }
    } catch (err) {
      // Catch any errors
      const eText = this.funcs.parseError(err)
      this.log.warn('[%s] %s %s.', this.name, this.lang.cantUpd, eText)
    }
  }
}
