/* jshint -W014, -W033, esversion: 9 */
/* eslint-disable new-cap */
'use strict'
module.exports = class deviceMotion {
  constructor (platform, accessory, device) {
    this.log = platform.log
    this.helpers = platform.helpers
    this.debug = platform.debug
    this.disableDeviceLogging = platform.config.disableDeviceLogging || false
    this.noMotionTimer = platform.noMotionTimer
    this.Service = platform.api.hap.Service
    this.Characteristic = platform.api.hap.Characteristic
    this.service = accessory.getService(this.Service.MotionSensor) || accessory.addService(this.Service.MotionSensor)
    this.accessory = accessory
    this.client = accessory.client
    this.client.on('binaryState', value => this.externalMotionUpdate(parseInt(value)))
  }

  externalMotionUpdate (value) {
    try {
      value = value === 1
      const md = this.service.getCharacteristic(this.Characteristic.MotionDetected).value
      if ((value === md && !this.motionTimer) || (!value && this.motionTimer)) return
      if (value || this.noMotionTimer === 0) {
        if (this.motionTimer) {
          if (!this.disableDeviceLogging) this.log('[%s] noMotionTimer stopped.', this.accessory.displayName)
          clearTimeout(this.motionTimer)
          this.motionTimer = false
        }
        this.service.updateCharacteristic(this.Characteristic.MotionDetected, value)
        if (!this.disableDeviceLogging) {
          this.log('[%s] motion sensor [%s].', this.accessory.displayName, value ? 'detected motion' : 'clear')
        }
      } else {
        if (!this.disableDeviceLogging) this.log('[%s] noMotionTimer started [%d secs]', this.accessory.displayName, this.noMotionTimer)
        clearTimeout(this.motionTimer)
        this.motionTimer = setTimeout(() => {
          this.service.updateCharacteristic(this.Characteristic.MotionDetected, false)
          if (!this.disableDeviceLogging) this.log('[%s] motion sensor [clear] - noMotion timer completed.', this.accessory.displayName)
          this.motionTimer = false
        }, this.noMotionTimer * 1000)
      }
    } catch (err) {
      this.log.warn(
        '[%s] motion sensor update [%s] error: %s.',
        this.accessory.displayName,
        value,
        this.debug ? '\n' + err : err.message
      )
    }
  }
}
