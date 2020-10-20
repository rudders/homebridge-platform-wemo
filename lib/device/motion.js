/* jshint -W014, -W033, esversion: 9 */
/* eslint-disable new-cap */
'use strict'
module.exports = class deviceMotion {
  constructor (platform, accessory, device) {
    this.log = platform.log
    this.config = platform.config
    this.debug = this.config.debug || false
    this.noMotionTimer = platform.noMotionTimer
    this.client = accessory.client
    this.Service = platform.api.hap.Service
    this.Characteristic = platform.api.hap.Characteristic
    if (!accessory.getService(this.Service.MotionSensor)) accessory.addService(this.Service.MotionSensor)
    accessory.client.on('error', err => this.log.warn('[%s] reported error - %s.', accessory.displayName, err.code))
    accessory.client.on('binaryState', state => this.updateMotionDetected(state))
    this.accessory = accessory
  }

  updateMotionDetected (state) {
    state = state | 0
    const value = state === 1
    const service = this.accessory.getService(this.Service.MotionSensor)
    const md = service.getCharacteristic(this.Characteristic.MotionDetected).value
    if ((value === md && !this.motionTimer) || (!value && this.motionTimer)) return
    if (value || this.noMotionTimer === 0) {
      if (this.motionTimer) {
        if (this.debug) this.log('[%s] noMotion timer stopped.', this.accessory.displayName)
        clearTimeout(this.motionTimer)
        delete this.motionTimer
      }
      if (this.debug) this.log('[%s] motion sensor [%s].', this.accessory.displayName, value ? 'detected motion' : 'clear')
      service.updateCharacteristic(this.Characteristic.MotionDetected, value)
    } else {
      if (this.debug) this.log('[%s] noMotion timer started [%d secs]', this.accessory.displayName, this.noMotionTimer)
      clearTimeout(this.motionTimer)
      this.motionTimer = setTimeout(
        () => {
          service.updateCharacteristic(this.Characteristic.MotionDetected, false)
          delete this.motionTimer
          if (this.debug) this.log('[%s] motion sensor [clear] - noMotion timer completed.', this.accessory.displayName)
        },
        this.noMotionTimer * 1000
      )
    }
  }
}
