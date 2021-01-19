/* jshint -W014, -W033, esversion: 9 */
/* eslint-disable new-cap */
'use strict'
const util = require('util')
module.exports = class deviceMotion {
  constructor (platform, accessory, device) {
    this.log = platform.log
    this.debug = platform.debug
    this.helpers = platform.helpers
    this.disableDeviceLogging = platform.config.disableDeviceLogging
    this.noMotionTimer = platform.noMotionTimer
    this.Service = platform.api.hap.Service
    this.Characteristic = platform.api.hap.Characteristic
    this.client = accessory.client
    this.accessory = accessory

    // *** Set up the Eve characteristics *** \\
    const self = this
    this.eveLastActivation = function () {
      self.Characteristic.call(this, 'Last Activation', 'E863F11A-079E-48FF-8F27-9C2605A29F52')
      this.setProps({
        format: self.Characteristic.Formats.UINT32,
        unit: self.Characteristic.Units.SECONDS,
        perms: [self.Characteristic.Perms.READ, self.Characteristic.Perms.NOTIFY]
      })
      this.value = this.getDefaultValue()
    }
    util.inherits(this.eveLastActivation, this.Characteristic)
    this.eveLastActivation.UUID = 'E863F11A-079E-48FF-8F27-9C2605A29F52'

    // *** Add the motion sensor service if it doesn't already exist *** \\
    this.service = this.accessory.getService(this.Service.MotionSensor) || this.accessory.addService(this.Service.MotionSensor)

    // *** Pass the accessory to fakegato to setup the Eve info service *** \\
    this.accessory.log = platform.config.debugFakegato ? this.log : () => {}
    this.accessory.historyService = new platform.eveService('motion', accessory, {
      storage: 'fs',
      path: platform.eveLogPath
    })

    // *** A listener for when the device sends an update to the plugin *** \\
    this.client.on('binaryState', attribute => this.receiveDeviceUpdate(attribute))
  }

  receiveDeviceUpdate (attribute) {
    if (this.debug) {
      this.log('[%s] received update [%s: %s]', this.accessory.displayName, attribute.name, attribute.value)
    }
    const hkValue = attribute.value === 1
    this.externalUpdate(hkValue)
  }

  externalUpdate (value) {
    try {
      const prevState = this.service.getCharacteristic(this.Characteristic.MotionDetected).value
      if ((value === prevState && !this.motionTimer) || (!value && this.motionTimer)) return
      if (value || this.noMotionTimer === 0) {
        if (this.motionTimer) {
          if (!this.disableDeviceLogging) {
            this.log('[%s] noMotionTimer stopped.', this.accessory.displayName)
          }
          clearTimeout(this.motionTimer)
          this.motionTimer = false
        }
        this.service.updateCharacteristic(this.Characteristic.MotionDetected, value)
        this.accessory.historyService.addEntry({ status: value ? 1 : 0 })
        if (value) {
          this.service.updateCharacteristic(
            this.eveLastActivation,
            Math.round(new Date().valueOf() / 1000) - this.accessory.historyService.getInitialTime()
          )
        }
        if (!this.disableDeviceLogging) {
          this.log('[%s] motion sensor [%s].', this.accessory.displayName, value ? 'detected motion' : 'clear')
        }
      } else {
        if (!this.disableDeviceLogging) {
          this.log('[%s] noMotionTimer started [%d secs].', this.accessory.displayName, this.noMotionTimer)
        }
        clearTimeout(this.motionTimer)
        this.motionTimer = setTimeout(() => {
          this.service.updateCharacteristic(this.Characteristic.MotionDetected, false)
          this.accessory.historyService.addEntry({ status: 0 })
          if (!this.disableDeviceLogging) {
            this.log('[%s] motion sensor [clear] - noMotion timer completed.', this.accessory.displayName)
          }
          this.motionTimer = false
        }, this.noMotionTimer * 1000)
      }
    } catch (err) {
      const errToShow = this.debug ? '\n' + err : err.message
      this.log.warn('[%s] motion sensor update [%s] error: %s.', this.accessory.displayName, value, errToShow)
    }
  }
}
