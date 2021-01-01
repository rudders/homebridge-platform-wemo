/* jshint -W014, -W033, esversion: 9 */
/* eslint-disable new-cap */
'use strict'
const xml2js = require('xml2js')
module.exports = class devicePurifier {
  constructor (platform, accessory, device) {
    this.log = platform.log
    this.helpers = platform.helpers
    this.debug = platform.debug
    this.disableDeviceLogging = platform.config.disableDeviceLogging || false
    this.Service = platform.api.hap.Service
    this.Characteristic = platform.api.hap.Characteristic

    // BETA
    if (accessory.getService(this.Service.AirPurifier)) {
      accessory.removeService(accessory.getService(this.Service.AirPurifier))
    }
    //

    this.service = accessory.getService(this.Service.AirPurifier) || accessory.addService(this.Service.AirPurifier)
    this.service
      .getCharacteristic(this.Characteristic.Active)
      .removeAllListeners('set')
      // .on('set', this.internalActiveUpdate.bind(this))
    this.service
      .getCharacteristic(this.Characteristic.TargetAirPurifierState)
      .removeAllListeners('set')

    this.service
      .getCharacteristic(this.Characteristic.CurrentAirPurifierState)
      .removeAllListeners('set')

    this.device = device
    this.accessory = accessory
    this.client = accessory.client

    this.getAttributes()
    // USED FOR MIMIC TESTING ON A OUTLET
    // this.service.updateCharacteristic(this.Characteristic.CurrentHumidifierDehumidifierState, 1)
    // this.service.updateCharacteristic(this.Characteristic.CurrentRelativeHumidity, 30)

    /* Characteristic.CurrentH..D..State
      0 ”Inactive”
      1 ”Idle”
      2 ”Humidifying”
      3 ”Dehumidifying”
    */

    this.client.on('attributeList', (name, value, prevalue, timestamp) => {
      if (this.debug) this.log('[%s] has changed attribute [%s] to [%s].', this.accessory.displayName, name, value)
      /*
      switch (name) {
        case 'FanMode':
          this.externalModeUpdate(parseInt(value))
          break
        case 'Ionizer':
          this.externalCurrentHumidityUpdate(parseInt(value))
          break
        case 'AirQuality':
          this.externalTargetHumidityUpdate(parseInt(value))
          break
      }
      */
    })
  }

  async getAttributes () {
    try {
      const data = await this.client.sendRequest('urn:Belkin:service:deviceevent:1', 'GetAttributes')
      const xml = '<attributeList>' + this.helpers.decodeXML(data.attributeList) + '</attributeList>'
      const result = await xml2js.parseStringPromise(xml, { explicitArray: false })
      const attributes = {}
      for (const key in result.attributeList.attribute) {
        if (this.helpers.hasProperty(result.attributeList.attribute, key)) {
          const attribute = result.attributeList.attribute[key]
          attributes[attribute.name] = attribute.value
          this.log('[%s] initial attribute [%s] is [%s].', this.accessory.displayName, attribute.name, attribute.value)
        }
      }
      /*
      this.externalModeUpdate(parseInt(attributes.FanMode))
      this.externalCurrentHumidityUpdate(parseInt(attributes.CurrentHumidity))
      this.externalTargetHumidityUpdate(parseInt(attributes.DesiredHumidity))
      */
    } catch (err) {
      this.log.warn('[%s] getAttributes error: %s.', this.accessory.displayName, this.debug ? '\n' + err : err.message)
    }
  }

  async setAttributes (attributes) {
    const builder = new xml2js.Builder({ rootName: 'attribute', headless: true, renderOpts: { pretty: false } })
    const xmlAttributes = Object.keys(attributes)
      .map(attributeKey => builder.buildObject({ name: attributeKey, value: attributes[attributeKey] }))
      .join('')
    await this.client.sendRequest('urn:Belkin:service:deviceevent:1', 'SetAttributes', { attributeList: { '#text': xmlAttributes } })
  }
}
