/* jshint -W014, -W033, esversion: 9 */
/* eslint-disable new-cap */
'use strict'

module.exports = class connectionUPNP extends require('events').EventEmitter {
  constructor (platform, device) {
    super()

    // Setup global vars from the platform
    this.debug = platform.config.debug
    this.funcs = platform.funcs
    this.log = platform.log
    this.messages = platform.messages

    // Setup the libraries we need
    this.axios = platform.axios
    this.HTTP = platform.HTTP
    this.xmlbuilder = platform.xmlbuilder
    this.xml2js = platform.xml2js

    // Setup other variables we need
    this.device = device
    this.name = device.friendlyName
    this.subs = {}
    this.services = {}

    // Create a map of device services
    device.serviceList.service.forEach(service => {
      this.services[service.serviceType] = {
        serviceId: service.serviceId,
        controlURL: service.controlURL,
        eventSubURL: service.eventSubURL
      }
    })

    // Transparently subscribe to serviceType events
    this.removeAllListeners('newListener')
    this.on('newListener', (event, listener) => {
      let serviceType
      switch (event) {
        case 'attributeList':
        case 'binaryState':
          serviceType = 'urn:Belkin:service:basicevent:1'
          break
        case 'insightParams':
          serviceType = 'urn:Belkin:service:insight:1'
          break
        case 'statusChange':
          serviceType = 'urn:Belkin:service:bridge:1'
          break
      }

      // Check the device supports this service type
      if (this.services[serviceType]) {
        this.subscribe(serviceType)
      }
    })
  }

  subscribe (serviceType) {
    try {
      // Check to see an already sent request is still pending
      if (this.subs[serviceType] && this.subs[serviceType] === 'PENDING') {
        if (this.debug) {
          this.log('[%s] %s.', this.name, this.messages.subPending)
        }
        return
      }

      // Setup the options for the subscription request
      const options = {
        host: this.device.host,
        port: this.device.port,
        path: this.services[serviceType].eventSubURL,
        method: 'SUBSCRIBE',
        headers: { TIMEOUT: 'Second-300' }
      }

      // The remaining options depend on whether the subscription already exists
      if (this.subs[serviceType]) {
        // Subscription already exists so renew
        options.headers.SID = this.subs[serviceType]
      } else {
        // Subscription doesn't exist yet to setup for new subscription
        this.subs[serviceType] = 'PENDING'
        if (this.debug) {
          this.log('[%s] %s [%s].', this.name, this.messages.subInit, serviceType)
        }
        options.headers.CALLBACK = '<' + this.device.cbURL + '/' + this.device.UDN + '>'
        options.headers.NT = 'upnp:event'
      }

      // Execute the subscription request
      const req = this.HTTP.request(options, res => {
        if (res.statusCode === 200) {
          // Subscription request successful
          this.subs[serviceType] = res.headers.sid

          // Renew subscription after 150 seconds
          setTimeout(() => this.subscribe(serviceType), 150000)
        } else {
          // Subscription request failure
          if (this.debug) {
            const code = res.statusCode
            this.log.warn('[%s] %s [%s].', this.name, this.messages.subError, code)
          }
          this.subs[serviceType] = null

          // Try to recover from a failed subscription after 2 seconds
          setTimeout(() => this.subscribe(serviceType), 2000)
        }
      })

      // Listen for errors on the subscription
      req.removeAllListeners('error')
      req.on('error', err => {
        this.subs[serviceType] = null
        this.error = err.code
        this.emit('error', err)
      })
      req.end()
    } catch (err) {
      // Catch any errors during the process
      const eText = this.funcs.parseError(err)
      this.log.warn('[%s] %s %s.', this.name, this.messages.subscribeError, eText)
    }
  }

  async sendRequest (serviceType, action, body) {
    try {
      // Check if there are any existing errors reported for this device
      if (this.error) {
        throw new Error(
          '[' + this.name + '] ' + this.messages.repError + ': ' + this.error
        )
      }

      // Generate the XML to send to the device
      const xml = this.xmlbuilder.create('s:Envelope', {
        version: '1.0',
        encoding: 'utf-8',
        allowEmpty: true
      }).att('xmlns:s', 'http://schemas.xmlsoap.org/soap/envelope/')
        .att('s:encodingStyle', 'http://schemas.xmlsoap.org/soap/encoding/')
        .ele('s:Body')
        .ele('u:' + action)
        .att('xmlns:u', serviceType)

      // Send the request to the device
      const hostPort = 'http://' + this.device.host + ':' + this.device.port
      const res = await this.axios({
        url: hostPort + this.services[serviceType].controlURL,
        method: 'post',
        headers: {
          SOAPACTION: '"' + serviceType + '#' + action + '"',
          'Content-Type': 'text/xml; charset="utf-8"'
        },
        data: (body ? xml.ele(body) : xml).end(),
        timeout: 10000
      })

      // Parse the response from the device
      const xmlRes = res.data
      const response = await this.xml2js.parseStringPromise(xmlRes, {
        explicitArray: false
      })

      // Return the parsed response
      return response['s:Envelope']['s:Body']['u:' + action + 'Response']
    } catch (err) {
      this.error = err.code
      this.emit('error', err)
      throw err
    }
  }

  async receiveRequest (body) {
    try {
      // Convert the XML to JSON
      const json = await this.xml2js.parseStringPromise(body, { explicitArray: false })

      // Loop through the JSON for the necessary information
      for (const prop in json['e:propertyset']['e:property']) {
        if (!this.funcs.hasProperty(json['e:propertyset']['e:property'], prop)) {
          continue
        }
        const data = json['e:propertyset']['e:property'][prop]
        switch (prop) {
          case 'BinaryState':
            try {
              this.emit('binaryState', {
                name: 'binaryState',
                value: parseInt(data.substring(0, 1))
              })
            } catch (e) {
              const eText = this.funcs.parseError(e)
              this.log.warn('[%s] %s %s %s.', this.name, prop, this.messages.proEr, eText)
            }
            break
          case 'Brightness':
            try {
              this.emit('brightness', {
                name: 'brightness',
                value: parseInt(data)
              })
            } catch (e) {
              const eText = this.funcs.parseError(e)
              this.log.warn('[%s] %s %s %s.', this.name, prop, this.messages.proEr, eText)
            }
            break
          case 'InsightParams': {
            try {
              const params = data.split('|')
              this.emit('insightParams', {
                name: 'insightParams',
                value: {
                  state: parseInt(params[0]),
                  power: parseInt(params[7]),
                  todayWm: parseFloat(params[8]),
                  todayOnSeconds: parseFloat(params[3])
                }
              })
            } catch (e) {
              const eText = this.funcs.parseError(e)
              this.log.warn('[%s] %s %s %s.', this.name, prop, this.messages.proEr, eText)
            }
            break
          }
          case 'attributeList':
            try {
              const decoded = this.funcs.decodeXML(data)
              const xml = '<attributeList>' + decoded + '</attributeList>'
              const result = await this.xml2js.parseStringPromise(xml, {
                explicitArray: true
              })
              result.attributeList.attribute.forEach(attribute => {
                this.emit('attributeList', {
                  name: attribute.name[0],
                  value: parseInt(attribute.value[0])
                })
              })
            } catch (e) {
              const eText = this.funcs.parseError(e)
              this.log.warn('[%s] %s %s %s.', this.name, prop, this.messages.proEr, eText)
            }
            break
          case 'StatusChange':
            try {
              const xml = await this.xml2js.parseStringPromise(data, {
                explicitArray: false
              })
              this.emit('statusChange', xml.StateEvent.DeviceID._, {
                name: xml.StateEvent.CapabilityId,
                value: xml.StateEvent.Value
              })
            } catch (e) {
              const eText = this.funcs.parseError(e)
              this.log.warn('[%s] %s %s %s.', this.name, prop, this.messages.proEr, eText)
            }
            break
        }
      }
    } catch (err) {
      // Catch any errors during this process
      const eText = this.funcs.parseError(err)
      this.log.warn('[%s] %s %s.', this.name, this.messages.incFail, eText)
    }
  }
}
