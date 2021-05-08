/* jshint -W014, -W033, esversion: 9 */
/* eslint-disable new-cap */
'use strict'

module.exports = class deviceMotion {
  constructor (platform, accessory, device) {
    // Set up variables from the platform
    this.debug = platform.config.debug
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
    this.noMotionTimer = deviceConf && deviceConf.noMotionTimer
      ? deviceConf.noMotionTimer
      : platform.consts.defaultValues.noMotionTimer
    this.disableDeviceLogging = deviceConf && deviceConf.overrideDisabledLogging
      ? false
      : platform.config.disableDeviceLogging

    // Add the motion sensor service if it doesn't already exist
    this.service = this.accessory.getService(this.hapServ.MotionSensor) ||
      this.accessory.addService(this.hapServ.MotionSensor)

    // Pass the accessory to fakegato to setup the Eve info service
    this.accessory.historyService = new platform.eveService('motion', this.accessory, {
      log: platform.config.debugFakegato ? this.log : () => {}
    })

    // Output the customised options to the log if in debug mode
    if (this.debug) {
      const opts = JSON.stringify({
        disableDeviceLogging: this.disableDeviceLogging,
        noMotionTimer: this.noMotionTimer
      })
      this.log('[%s] %s %s.', this.name, this.lang.devInitOpts, opts)
    }

    // A listener for when the device sends an update to the plugin
    this.client.on('BinaryState', attribute => this.receiveDeviceUpdate(attribute))
  }

  receiveDeviceUpdate (attribute) {
    // Log the receiving update if debug is enabled
    if (this.debug) {
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
            this.log('[%s] timer stopped.', this.name)
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
          const initialTime = this.accessory.historyService.getInitialTime()
          this.service.updateCharacteristic(
            this.eveChar.LastActivation,
            Math.round(new Date().valueOf() / 1000) - initialTime
          )
        }

        // Log the change if appropriate
        if (!this.disableDeviceLogging) {
          this.log('[%s] motion sensor [%s].', this.name, value ? 'detected motion' : 'clear')
        }
      } else {
        // CASE: motion not detected and the user motion timer is more than 0 seconds
        if (!this.disableDeviceLogging) {
          this.log('[%s] timer started [%d secs].', this.name, this.noMotionTimer)
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
            this.log('[%s] motion sensor [clear] - timer completed.', this.name)
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
