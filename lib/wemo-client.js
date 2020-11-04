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
      if (serviceType && this.services[serviceType]) this._subscribe(serviceType)
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

  getEndDevices (cb) {
    const parseDeviceInfo = function (data) {
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
    const parseResponse = function (err, data) {
      if (err) return cb(err)
      // debug('endDevices raw data', data)
      const endDevices = []
      xml2js.parseString(data.DeviceLists.replace('\\ufeff', ''), function (err, result) {
        if (err) return cb(err)
        const deviceInfos = result.DeviceLists.DeviceList[0].DeviceInfos[0].DeviceInfo
        if (deviceInfos) {
          Array.prototype.push.apply(endDevices, deviceInfos.map(parseDeviceInfo))
        }
        if (result.DeviceLists.DeviceList[0].GroupInfos) {
          const groupInfos = result.DeviceLists.DeviceList[0].GroupInfos[0].GroupInfo
          Array.prototype.push.apply(endDevices, groupInfos.map(parseDeviceInfo))
        }
        cb(null, endDevices)
      })
    }
    this.soapAction('urn:Belkin:service:bridge:1', 'GetEndDevices', {
      DevUDN: this.UDN,
      ReqListType: 'PAIRED_LIST'
    }, parseResponse)
  }

  setDeviceStatus (deviceId, capability, value, cb) {
    const deviceStatusList = xmlbuilder.create('DeviceStatus', {
      version: '1.0',
      encoding: 'utf-8'
    }).ele({
      IsGroupAction: (deviceId.length === 10) ? 'YES' : 'NO',
      DeviceID: deviceId,
      CapabilityID: capability,
      CapabilityValue: value
    }).end()
    this.soapAction('urn:Belkin:service:bridge:1', 'SetDeviceStatus', { DeviceStatusList: { '#text': deviceStatusList } }, cb)
  }

  getDeviceStatus (deviceId, cb) {
    const self = this
    const parseResponse = function (err, data) {
      if (err) return cb(err)
      xml2js.parseString(data.DeviceStatusList, { explicitArray: false }, function (err, result) {
        if (err) return cb(err)
        const deviceStatus = result.DeviceStatusList.DeviceStatus
        const capabilities = self.mapCapabilities(deviceStatus.CapabilityID, deviceStatus.CapabilityValue)
        cb(null, capabilities)
      })
    }

    this.soapAction('urn:Belkin:service:bridge:1', 'GetDeviceStatus', { DeviceIDs: deviceId }, parseResponse)
  }

  setLightColor (deviceId, red, green, blue, cb) {
    const color = this.rgb2xy(red, green, blue)
    this.setDeviceStatus(deviceId, 10300, color.join(':') + ':0', cb)
  }

  setBinaryState (value, cb) {
    this.soapAction('urn:Belkin:service:basicevent:1', 'SetBinaryState', { BinaryState: value }, cb)
  }

  getBinaryState (cb) {
    this.soapAction('urn:Belkin:service:basicevent:1', 'GetBinaryState', null, function (err, data) {
      if (err) return cb(err)
      cb(null, data.BinaryState)
    })
  }

  setAttributes (attributes, cb) {
    const builder = new xml2js.Builder({ rootName: 'attribute', headless: true, renderOpts: { pretty: false } })
    const xmlAttributes = Object.keys(attributes).map(function (attributeKey) {
      return builder.buildObject({ name: attributeKey, value: attributes[attributeKey] })
    }).join('')
    this.soapAction('urn:Belkin:service:deviceevent:1', 'SetAttributes', { attributeList: { '#text': xmlAttributes } }, cb)
  }

  getAttributes (cb) {
    this.soapAction('urn:Belkin:service:deviceevent:1', 'GetAttributes', null, function (err, data) {
      if (err) return cb(err)
      const xml = '<attributeList>' + entities.decodeXML(data.attributeList) + '</attributeList>'
      xml2js.parseString(xml, { explicitArray: false }, function (err, result) {
        if (err) return cb(err)
        const attributes = {}
        for (const key in result.attributeList.attribute) {
          if (helpers.hasProperty(result.attributeList.attribute, key)) {
            const attribute = result.attributeList.attribute[key]
            attributes[attribute.name] = attribute.value
          }
        }
        cb(null, attributes)
      })
    })
  }

  _subscribe (serviceType) {
    if (!this.services[serviceType]) {
      throw new Error('Service ' + serviceType + ' not supported by ' + this.UDN)
    }
    if (!this.callbackURL) {
      throw new Error('Can not subscribe without callbackURL')
    }
    if (this.subscriptions[serviceType] && this.subscriptions[serviceType] === 'PENDING') {
    // debug('subscription still pending')
      return
    }
    const options = {
      host: this.host,
      port: this.port,
      path: this.services[serviceType].eventSubURL,
      method: 'SUBSCRIBE',
      headers: {
        TIMEOUT: 'Second-300'
      }
    }
    if (!this.subscriptions[serviceType]) {
    // Initial subscription
      this.subscriptions[serviceType] = 'PENDING'
      // debug('Initial subscription - Device: %s, Service: %s', this.UDN, serviceType)
      options.headers.CALLBACK = '<' + this.callbackURL + '/' + this.UDN + '>'
      options.headers.NT = 'upnp:event'
    } else {
    // Subscription renewal
    // debug('Renewing subscription - Device: %s, Service: %s', this.UDN, serviceType)
      options.headers.SID = this.subscriptions[serviceType]
    }

    const req = http.request(options, function (res) {
      if (res.statusCode === 200) {
      // Renew after 150 seconds
        this.subscriptions[serviceType] = res.headers.sid
        setTimeout(this._subscribe.bind(this), 150 * 1000, serviceType)
      } else {
      // Try to recover from failed subscription after 2 seconds
      // debug('Subscription request failed with HTTP %s', res.statusCode)
        this.subscriptions[serviceType] = null
        setTimeout(this._subscribe.bind(this), 2000, serviceType)
      }
    }.bind(this))

    req.on('error', function (err) {
    // debug('Subscription error: %s - Device: %s, Service: %s', err.code, this.UDN, serviceType)
      this.subscriptions[serviceType] = null
      this.error = err.code
      this.emit('error', err)
    }.bind(this))

    req.end()
  }

  handleCallback (body) {
    const handler = {
      BinaryState: data => this.emit('binaryState', data.substring(0, 1)),
      Brightness: data => this.emit('brightness', parseInt(data)),
      StatusChange: data => {
        xml2js.parseString(data, { explicitArray: false }, function (err, xml) {
          if (!err) {
            this.emit('statusChange',
              xml.StateEvent.DeviceID._,
              xml.StateEvent.CapabilityId,
              xml.StateEvent.Value
            )
          }
        })
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
        const xml = '<attributeList>' + entities.decodeXML(data) + '</attributeList>'
        xml2js.parseString(xml, { explicitArray: true }, function (err, result) {
          if (!err) {
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
          }
        })
      }
    }

    xml2js.parseString(body, { explicitArray: false }, function (err, xml) {
      if (err) throw err
      for (const prop in xml['e:propertyset']['e:property']) {
        if (helpers.hasProperty(handler, prop)) {
          handler[prop](xml['e:propertyset']['e:property'][prop])
        } else {
        // debug('Unhandled Event: %s', prop)
        }
      }
    })
  }

  rgb2xy (r, g, b) {
  // *** Based on: https://github.com/aleroddepaz/pyhue/blob/master/src/pyhue.py *** \\
    const X = (0.545053 * r) + (0.357580 * g) + (0.180423 * b)
    const Y = (0.212671 * r) + (0.715160 * g) + (0.072169 * b)
    const Z = (0.019334 * r) + (0.119193 * g) + (0.950227 * b)
    const x = X / (X + Y + Z)
    const y = Y / (X + Y + Z)
    return [Math.round(x * 65535), Math.round(y * 65535)]
  }

  mapCapabilities (capabilityIds, capabilityValues) {
    const ids = capabilityIds.split(',')
    const values = capabilityValues.split(',')
    const result = {}
    ids.forEach((val, index) => (result[val] = values[index]))
    return result
  }
}
