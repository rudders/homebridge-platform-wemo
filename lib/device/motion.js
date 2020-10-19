/* jshint -W014, -W033, esversion: 9 */
/* eslint-disable new-cap */
'use strict'
module.exports = class deviceMotion {
  constructor (platform, accessory, device) {
    this.log = platform.log
    this.config = platform.config
    this.debug = this.config.debug || false
    this.client = accessory.client
    this.Service = platform.api.hap.Service
    this.Characteristic = platform.api.hap.Characteristic
    if (!accessory.getService(this.Service.MotionSensor)) accessory.addService(this.Service.MotionSensor)
    this.client.on('binaryState', state => this.updateMotionDetected(state))
    this.accessory = accessory
  }

  updateMotionDetected (state) {
    state = state | 0
    const value = state === 1
    const mdChar = this.accessory.getService(this.Service.MotionSensor).getCharacteristic(this.Characteristic.MotionDetected)
    if ((value === mdChar.value && !this.motionTimer) || (!value && this.motionTimer)) return
    if (value || this.platform.noMotionTimer === 0) {
      if (this.motionTimer) {
        if (this.debug) this.log('[%s] noMotion timer stopped.', this.accessory.displayName)
        clearTimeout(this.motionTimer)
        delete this.motionTimer
      }
      if (this.debug) this.log('[%s] motion sensor [%s].', this.accessory.displayName, value ? 'detected motion' : 'clear')
      this.accessory.getService(this.Service.MotionSensor).updateCharacteristic(this.Characteristic.MotionDetected, value)
    } else {
      if (this.debug) this.log('[%s] noMotion timer started [%d secs]', this.accessory.displayName, this.platform.noMotionTimer)
      clearTimeout(this.motionTimer)
      this.motionTimer = setTimeout(
        () => {
          this.accessory.getService(this.Service.MotionSensor).updateCharacteristic(this.Characteristic.MotionDetected, false)
          delete this.motionTimer
          if (this.debug) this.log('[%s] motion sensor [clear] - noMotion timer completed.', this.accessory.displayName)
        },
        this.platform.noMotionTimer * 1000
      )
    }
  }
}
