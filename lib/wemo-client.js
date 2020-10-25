var util = require('util')
var http = require('http')
var xml2js = require('xml2js')
var entities = require('entities')
var EventEmitter = require('events').EventEmitter
var xmlbuilder = require('xmlbuilder')

function mapCapabilities (capabilityIds, capabilityValues) {
  var ids = capabilityIds.split(',')
  var values = capabilityValues.split(',')
  var result = {}
  ids.forEach(function (val, index) {
    result[val] = values[index]
  })
  return result
}

var WemoClient = module.exports = function (config) {
  EventEmitter.call(this)
  this.host = config.host
  this.port = config.port
  this.deviceType = config.deviceType
  this.UDN = config.UDN
  this.subscriptions = {}
  this.callbackURL = config.callbackURL
  this.device = config
  this.error = undefined

  // Create map of services
  config.serviceList.service.forEach(function (service) {
    this[service.serviceType] = {
      serviceId: service.serviceId,
      controlURL: service.controlURL,
      eventSubURL: service.eventSubURL
    }
  }, this.services = {})

  // Transparently subscribe to serviceType events
  // TODO: Unsubscribe from ServiceType when all listeners have been removed.
  this.on('newListener', this._onListenerAdded)
}

util.inherits(WemoClient, EventEmitter)

WemoClient.EventServices = {
  insightParams: 'urn:Belkin:service:insight:1',
  statusChange: 'urn:Belkin:service:bridge:1',
  attributeList: 'urn:Belkin:service:basicevent:1',
  binaryState: 'urn:Belkin:service:basicevent:1'
}

WemoClient.request = function (options, data, cb) {
  if (!cb && typeof data === 'function') {
    cb = data
    data = null
  }

  var req = http.request(options, function (res) {
    var body = ''
    res.setEncoding('utf8')
    res.on('data', function (chunk) {
      body += chunk
    })
    res.on('end', function () {
      if (res.statusCode === 200) {
        xml2js.parseString(body, { explicitArray: false }, cb)
      } else {
        cb(new Error('HTTP ' + res.statusCode + ': ' + body))
      }
    })
    res.on('error', function (err) {
      // debug('Error on http.request.res:', err)
      cb(err)
    })
  })
  req.on('error', function (err) {
    // debug('Error on http.request.req:', err)
    cb(err)
  })
  if (data) {
    req.write(data)
  }
  req.end()
}

WemoClient.prototype.soapAction = function (serviceType, action, body, cb) {
  this._verifyServiceSupport(serviceType)

  cb = cb || function () {}

  var xml = xmlbuilder.create('s:Envelope', {
    version: '1.0',
    encoding: 'utf-8',
    allowEmpty: true
  })
    .att('xmlns:s', 'http://schemas.xmlsoap.org/soap/envelope/')
    .att('s:encodingStyle', 'http://schemas.xmlsoap.org/soap/encoding/')
    .ele('s:Body')
    .ele('u:' + action)
    .att('xmlns:u', serviceType)

  var payload = (body ? xml.ele(body) : xml).end()

  var options = {
    host: this.host,
    port: this.port,
    path: this.services[serviceType].controlURL,
    method: 'POST',
    headers: {
      SOAPACTION: '"' + serviceType + '#' + action + '"',
      'Content-Type': 'text/xml; charset="utf-8"'
    }
  }

  WemoClient.request(options, payload, function (err, response) {
    if (err) {
      this.error = err.code
      this.emit('error', err)
      return cb(err)
    }
    // debug('%s Response: ', action, response)
    cb(null, response && response['s:Envelope']['s:Body']['u:' + action + 'Response'])
  }.bind(this))
}

WemoClient.prototype.getEndDevices = function (cb) {
  var parseDeviceInfo = function (data) {
    var device = {}

    if (data.GroupID) {
      // treat device group as it was a single device
      device.friendlyName = data.GroupName[0]
      device.deviceId = data.GroupID[0]
      device.capabilities = mapCapabilities(
        data.GroupCapabilityIDs[0],
        data.GroupCapabilityValues[0]
      )
    } else {
      // single device
      device.friendlyName = data.FriendlyName[0]
      device.deviceId = data.DeviceID[0]
      device.capabilities = mapCapabilities(
        data.CapabilityIDs[0],
        data.CurrentState[0]
      )
    }

    // set device type
    if (Object.prototype.hasOwnProperty.call(device.capabilities, '10008')) {
      device.deviceType = 'dimmableLight'
    }
    if (Object.prototype.hasOwnProperty.call(device.capabilities, '10300')) {
      device.deviceType = 'colorLight'
    }

    return device
  }

  var parseResponse = function (err, data) {
    if (err) return cb(err)
    // debug('endDevices raw data', data)
    var endDevices = []
    xml2js.parseString(data.DeviceLists.replace('\\ufeff', ''), function (err, result) {
      if (err) return cb(err)
      var deviceInfos = result.DeviceLists.DeviceList[0].DeviceInfos[0].DeviceInfo
      if (deviceInfos) {
        Array.prototype.push.apply(endDevices, deviceInfos.map(parseDeviceInfo))
      }
      if (result.DeviceLists.DeviceList[0].GroupInfos) {
        var groupInfos = result.DeviceLists.DeviceList[0].GroupInfos[0].GroupInfo
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

WemoClient.prototype.setDeviceStatus = function (deviceId, capability, value, cb) {
  var deviceStatusList = xmlbuilder.create('DeviceStatus', {
    version: '1.0',
    encoding: 'utf-8'
  }).ele({
    IsGroupAction: (deviceId.length === 10) ? 'YES' : 'NO',
    DeviceID: deviceId,
    CapabilityID: capability,
    CapabilityValue: value
  }).end()

  this.soapAction('urn:Belkin:service:bridge:1', 'SetDeviceStatus', {
    DeviceStatusList: {
      '#text': deviceStatusList
    }
  }, cb)
}

WemoClient.prototype.getDeviceStatus = function (deviceId, cb) {
  var parseResponse = function (err, data) {
    if (err) return cb(err)
    xml2js.parseString(data.DeviceStatusList, { explicitArray: false }, function (err, result) {
      if (err) return cb(err)
      var deviceStatus = result.DeviceStatusList.DeviceStatus
      var capabilities = mapCapabilities(deviceStatus.CapabilityID, deviceStatus.CapabilityValue)
      cb(null, capabilities)
    })
  }

  this.soapAction('urn:Belkin:service:bridge:1', 'GetDeviceStatus', {
    DeviceIDs: deviceId
  }, parseResponse)
}

WemoClient.prototype.setLightColor = function (deviceId, red, green, blue, cb) {
  var color = WemoClient.rgb2xy(red, green, blue)
  this.setDeviceStatus(deviceId, 10300, color.join(':') + ':0', cb)
}

WemoClient.prototype.setBinaryState = function (value, cb) {
  this.soapAction('urn:Belkin:service:basicevent:1', 'SetBinaryState', {
    BinaryState: value
  }, cb)
}

WemoClient.prototype.getBinaryState = function (cb) {
  this.soapAction('urn:Belkin:service:basicevent:1', 'GetBinaryState', null, function (err, data) {
    if (err) return cb(err)
    cb(null, data.BinaryState)
  })
}

WemoClient.prototype.setBrightness = function (brightness, cb) {
  this.soapAction('urn:Belkin:service:basicevent:1', 'SetBinaryState', {
    BinaryState: brightness <= 0 ? 0 : 1,
    brightness: brightness
  }, cb)
}

WemoClient.prototype.getBrightness = function (cb) {
  this.soapAction('urn:Belkin:service:basicevent:1', 'GetBinaryState', null, function (err, data) {
    if (err) return cb(err)
    cb(null, parseInt(data.brightness))
  })
}

WemoClient.prototype.setAttributes = function (attributes, cb) {
  var builder = new xml2js.Builder({ rootName: 'attribute', headless: true, renderOpts: { pretty: false } })

  var xmlAttributes = Object.keys(attributes).map(function (attributeKey) {
    return builder.buildObject({ name: attributeKey, value: attributes[attributeKey] })
  }).join('')

  this.soapAction('urn:Belkin:service:deviceevent:1', 'SetAttributes', {
    attributeList: {
      '#text': xmlAttributes
    }
  }, cb)
}

WemoClient.prototype.getAttributes = function (cb) {
  this.soapAction('urn:Belkin:service:deviceevent:1', 'GetAttributes', null, function (err, data) {
    if (err) return cb(err)
    var xml = '<attributeList>' + entities.decodeXML(data.attributeList) + '</attributeList>'
    xml2js.parseString(xml, { explicitArray: false }, function (err, result) {
      if (err) return cb(err)
      var attributes = {}
      for (var key in result.attributeList.attribute) {
        var attribute = result.attributeList.attribute[key]
        attributes[attribute.name] = attribute.value
      }
      cb(null, attributes)
    })
  })
}

WemoClient.prototype.getInsightParams = function (cb) {
  this.soapAction('urn:Belkin:service:insight:1', 'GetInsightParams', null, function (err, data) {
    if (err) return cb(err)

    var params = this._parseInsightParams(data.InsightParams)
    cb(null, params.binaryState, params.instantPower, params.insightParams)
  }.bind(this))
}

WemoClient.prototype._parseInsightParams = function (paramsStr) {
  var params = paramsStr.split('|')

  return {
    binaryState: params[0],
    instantPower: params[7],
    insightParams: {
      ONSince: params[1],
      OnFor: params[2],
      TodayONTime: params[3],
      TodayConsumed: params[8] // power consumer today (mW per minute)
    }
  }
}

WemoClient.prototype._onListenerAdded = function (eventName) {
  var serviceType = WemoClient.EventServices[eventName]
  if (serviceType && this.services[serviceType]) {
    this._subscribe(serviceType)
  }
}

WemoClient.prototype._subscribe = function (serviceType) {
  this._verifyServiceSupport(serviceType)

  if (!this.callbackURL) {
    throw new Error('Can not subscribe without callbackURL')
  }
  if (this.subscriptions[serviceType] && this.subscriptions[serviceType] === 'PENDING') {
    // debug('subscription still pending')
    return
  }

  var options = {
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

  var req = http.request(options, function (res) {
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

WemoClient.prototype._verifyServiceSupport = function (serviceType) {
  if (!this.services[serviceType]) {
    throw new Error('Service ' + serviceType + ' not supported by ' + this.UDN)
  }
}

WemoClient.prototype.handleCallback = function (body) {
  var self = this
  var handler = {
    BinaryState: function (data) {
      self.emit('binaryState', data.substring(0, 1))
    },
    Brightness: function (data) {
      self.emit('brightness', parseInt(data))
    },
    StatusChange: function (data) {
      xml2js.parseString(data, { explicitArray: false }, function (err, xml) {
        if (!err) {
          self.emit('statusChange',
            xml.StateEvent.DeviceID._,
            xml.StateEvent.CapabilityId,
            xml.StateEvent.Value
          )
        }
      })
    },
    InsightParams: function (data) {
      var params = this._parseInsightParams(data)
      self.emit('insightParams', params.binaryState, params.instantPower, params.insightParams)
    }.bind(this),
    attributeList: function (data) {
      var xml = '<attributeList>' + entities.decodeXML(data) + '</attributeList>'
      xml2js.parseString(xml, { explicitArray: true }, function (err, result) {
        if (!err) {
          // In order to keep the existing event signature this
          // triggers an event for every attribute changed.
          result.attributeList.attribute.forEach(function (attribute) {
            self.emit('attributeList',
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
    for (var prop in xml['e:propertyset']['e:property']) {
      if (Object.prototype.hasOwnProperty.call(handler, prop)) {
        handler[prop](xml['e:propertyset']['e:property'][prop])
      } else {
        // debug('Unhandled Event: %s', prop)
      }
    }
  })
}

WemoClient.rgb2xy = function (r, g, b) {
  // Based on: https://github.com/aleroddepaz/pyhue/blob/master/src/pyhue.py
  var X = (0.545053 * r) + (0.357580 * g) + (0.180423 * b)
  var Y = (0.212671 * r) + (0.715160 * g) + (0.072169 * b)
  var Z = (0.019334 * r) + (0.119193 * g) + (0.950227 * b)

  var x = X / (X + Y + Z)
  var y = Y / (X + Y + Z)

  return [
    Math.round(x * 65535),
    Math.round(y * 65535)
  ]
}
