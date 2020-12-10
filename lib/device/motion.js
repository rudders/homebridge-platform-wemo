/* jshint -W014, -W033, esversion: 9 */
/* eslint-disable new-cap */
'use strict'
const util = require('util')
module.exports = class deviceMotion {
  constructor (platform, accessory, device) {
    this.log = platform.log
    this.helpers = platform.helpers
    this.debug = platform.debug
    this.disableDeviceLogging = platform.config.disableDeviceLogging || false
    this.noMotionTimer = platform.noMotionTimer
    this.Service = platform.api.hap.Service
    this.Characteristic = platform.api.hap.Characteristic
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
    this.service = accessory.getService(this.Service.MotionSensor) || accessory.addService(this.Service.MotionSensor)
    accessory.log = this.log
    accessory.eveLogger = new platform.eveService('motion', accessory, {
      storage: 'fs',
      path: platform.eveLogPath
    })
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
        this.accessory.eveLogger.addEntry({
          time: Math.round(new Date().valueOf() / 1000),
          status: value ? 1 : 0
        })
        if (value) {
          this.service.updateCharacteristic(
            this.eveLastActivation,
            Math.round(new Date().valueOf() / 1000) - this.accessory.eveLogger.getInitialTime()
          )
        }
        if (!this.disableDeviceLogging) {
          this.log('[%s] motion sensor [%s].', this.accessory.displayName, value ? 'detected motion' : 'clear')
        }
      } else {
        if (!this.disableDeviceLogging) this.log('[%s] noMotionTimer started [%d secs]', this.accessory.displayName, this.noMotionTimer)
        clearTimeout(this.motionTimer)
        this.motionTimer = setTimeout(() => {
          this.service.updateCharacteristic(this.Characteristic.MotionDetected, false)
          this.accessory.eveLogger.addEntry({
            time: Math.round(new Date().valueOf() / 1000),
            status: 0
          })
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
