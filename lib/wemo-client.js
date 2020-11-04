/* jshint -W014, -W033, esversion: 9 */
/* eslint-disable new-cap */
'use strict'
const axios = require('axios')
const entities = require('entities')
const eventEmitter = require('events').EventEmitter
const helpers = require('./helpers')
const http = require('http')
const xmlbuilder = require('xmlbuilder')
const xml2js = require('xml2js')

module.exports = class wemoClient extends eventEmitter {
  constructor (debug, log, device) {
    super()
    this.log = log
    this.debug = debug
    this.host = device.host
    this.port = device.port
    this.deviceType = device.deviceType
    this.UDN = device.UDN
    this.subscriptions = {}
    this.services = {}
    this.callbackURL = device.callbackURL
    this.device = device
    this.error = undefined
    // Create map of services
    device.serviceList.service.forEach(service => {
      this.services[service.serviceType] = {
        serviceId: service.serviceId,
        controlURL: service.controlURL,
        eventSubURL: service.eventSubURL
      }
    })
    // Transparently subscribe to serviceType events
    // TODO: Unsubscribe from ServiceType when all listeners have been removed.
    this.on('newListener', (event, listener) => {
      const EventServices = {
        insightParams: 'urn:Belkin:service:insight:1',
        statusChange: 'urn:Belkin:service:bridge:1',
        attributeList: 'urn:Belkin:service:basicevent:1',
        binaryState: 'urn:Belkin:service:basicevent:1'
      }
      const serviceType = EventServices[event]
      if (serviceType && this.services[serviceType]) this.subscribe(serviceType)
    })
  }

  async soapAction (serviceType, action, body) {
    try {
      if (!this.services[serviceType]) {
        throw new Error('Service ' + serviceType + ' not supported by ' + this.UDN)
      }
      const xml = xmlbuilder.create('s:Envelope', {
        version: '1.0',
        encoding: 'utf-8',
        allowEmpty: true
      })
        .att('xmlns:s', 'http://schemas.xmlsoap.org/soap/envelope/')
        .att('s:encodingStyle', 'http://schemas.xmlsoap.org/soap/encoding/')
        .ele('s:Body')
        .ele('u:' + action)
        .att('xmlns:u', serviceType)
      const res = await axios({
        url: 'http://' + this.host + ':' + this.port + this.services[serviceType].controlURL,
        method: 'post',
        headers: {
          SOAPACTION: '"' + serviceType + '#' + action + '"',
          'Content-Type': 'text/xml; charset="utf-8"'
        },
        data: (body ? xml.ele(body) : xml).end()
      })
      const xmlRes = res.data
      const response = await xml2js.parseStringPromise(xmlRes, { explicitArray: false })
      return response['s:Envelope']['s:Body']['u:' + action + 'Response']
    } catch (err) {
      this.error = err.code
      throw err
    }
  }

  async getEndDevices () {
    const parseDeviceInfo = data => {
      const device = {}
      if (data.GroupID) {
      // treat device group as it was a single device
        device.friendlyName = data.GroupName[0]
        device.deviceId = data.GroupID[0]
        device.capabilities = this.mapCapabilities(data.GroupCapabilityIDs[0], data.GroupCapabilityValues[0])
      } else {
      // single device
        device.friendlyName = data.FriendlyName[0]
        device.deviceId = data.DeviceID[0]
        device.capabilities = this.mapCapabilities(data.CapabilityIDs[0], data.CurrentState[0])
      }
      // set device type
      if (helpers.hasProperty(device.capabilities, '10008')) {
        device.deviceType = 'dimmableLight'
      }
      if (helpers.hasProperty(device.capabilities, '10300')) {
        device.deviceType = 'colorLight'
      }
      return device
    }
    const data = await this.soapAction('urn:Belkin:service:bridge:1', 'GetEndDevices', {
      DevUDN: this.UDN,
      ReqListType: 'PAIRED_LIST'
    })
    const endDevices = []
    const result = await xml2js.parseStringPromise(data.DeviceLists)
    const deviceInfos = result.DeviceLists.DeviceList[0].DeviceInfos[0].DeviceInfo
    if (deviceInfos) {
      Array.prototype.push.apply(endDevices, deviceInfos.map(parseDeviceInfo))
    }
    if (result.DeviceLists.DeviceList[0].GroupInfos) {
      const groupInfos = result.DeviceLists.DeviceList[0].GroupInfos[0].GroupInfo
      Array.prototype.push.apply(endDevices, groupInfos.map(parseDeviceInfo))
    }
    return endDevices
  }

  async handleCallback (body) {
    const handler = {
      BinaryState: data => this.emit('binaryState', data.substring(0, 1)),
      Brightness: data => this.emit('brightness', parseInt(data)),
      StatusChange: data => {
        try {
          const xml = await xml2js.parseStringPromise(data, { explicitArray: false }) 
          this.emit('statusChange',
            xml.StateEvent.DeviceID._,
            xml.StateEvent.CapabilityId,
            xml.StateEvent.Value
          )
        } catch (err) {}
      },
      InsightParams: data => {
        const params = data.split('|')
        const paramsToReturn = {
          binaryState: params[0],
          instantPower: params[7],
          insightParams: {
            ONSince: params[1],
            OnFor: params[2],
            TodayONTime: params[3],
            TodayConsumed: params[8]
          }
        }
        this.emit('insightParams', paramsToReturn.binaryState, paramsToReturn.instantPower, paramsToReturn.insightParams)
      },
      attributeList: data => {
        try {
          const xml = '<attributeList>' + entities.decodeXML(data) + '</attributeList>'
          const result = await xml2js.parseStringPromise(xml, { explicitArray: true })
          // In order to keep the existing event signature this
          // triggers an event for every attribute changed.
          result.attributeList.attribute.forEach(attribute => {
            this.emit('attributeList',
              attribute.name[0],
              attribute.value[0],
              attribute.prevalue[0],
              attribute.ts[0]
            )
          })
        } catch (err) {}
      }
    }
    const xml = await xml2js.parseStringPromise(body, { explicitArray: false })
    for (const prop in xml['e:propertyset']['e:property']) {
      if (helpers.hasProperty(handler, prop)) {
        handler[prop](xml['e:propertyset']['e:property'][prop])
      }
    }
  }

  mapCapabilities (capabilityIds, capabilityValues) {
    const ids = capabilityIds.split(',')
    const values = capabilityValues.split(',')
    const result = {}
    ids.forEach((val, index) => (result[val] = values[index]))
    return result
  }

  subscribe (serviceType) {
    try {
      if (!this.services[serviceType]) {
        throw new Error('Service ' + serviceType + ' not supported by ' + this.UDN)
      }
      if (!this.callbackURL) {
        throw new Error('Can not subscribe without callbackURL')
      }
      if (this.subscriptions[serviceType] && this.subscriptions[serviceType] === 'PENDING') {
        this.log.warn('Subscription still pending for %s.', this.UDN)
        return
      }
      const options = {
        host: this.host,
        port: this.port,
        path: this.services[serviceType].eventSubURL,
        method: 'SUBSCRIBE',
        headers: { TIMEOUT: 'Second-300' }
      }
      if (!this.subscriptions[serviceType]) {
        // Initial subscription
        this.subscriptions[serviceType] = 'PENDING'
        if (this.debug) this.log('Initial subscription - Device: %s, Service: %s', this.UDN, serviceType)
        options.headers.CALLBACK = '<' + this.callbackURL + '/' + this.UDN + '>'
        options.headers.NT = 'upnp:event'
      } else {
        // Subscription renewal
        if (this.debug) this.log('Renewing subscription - Device: %s, Service: %s', this.UDN, serviceType)
        options.headers.SID = this.subscriptions[serviceType]
      }

      const req = http.request(options, res => {
        if (res.statusCode === 200) {
          // Renew after 150 seconds
          this.subscriptions[serviceType] = res.headers.sid
          setTimeout(this.subscribe.bind(this), 150 * 1000, serviceType)
        } else {
          // Try to recover from failed subscription after 2 seconds
          if (this.debug) this.log.warn('Subscription request failed with HTTP %s', res.statusCode)
          this.subscriptions[serviceType] = null
          setTimeout(() => this.subscribe(serviceType), 2000)
        }
      })

      req.on('error', err => {
        if (this.debug) this.log.warn('Subscription error: %s - Device: %s, Service: %s', err.code, this.UDN, serviceType)
        this.subscriptions[serviceType] = null
        this.error = err.code
        this.emit('error', err)
      })
      req.end()
    } catch (err) {
      this.log.warn(err)
    }
  }
}
