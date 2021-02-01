/* jshint -W014, -W033, esversion: 9 */
/* eslint-disable new-cap */
'use strict'

const axios = require('axios')
const eventEmitter = require('events').EventEmitter
const http = require('http')
const xmlbuilder = require('xmlbuilder')
const xml2js = require('xml2js')

module.exports = class connectionUPNP extends eventEmitter {
  constructor (platform, device) {
    super()
    this.log = platform.log
    this.funcs = platform.funcs
    this.debug = platform.debug
    this.device = device
    this.subscriptions = {}
    this.services = {}

    // *** Create map of services *** \\
    device.serviceList.service.forEach(service => {
      this.services[service.serviceType] = {
        serviceId: service.serviceId,
        controlURL: service.controlURL,
        eventSubURL: service.eventSubURL
      }
    })

    // *** Transparently subscribe to serviceType events *** \\
    // *** TODO: Unsubscribe from ServiceType when all listeners have been removed *** \\
    this.removeAllListeners('newListener')
    this.on('newListener', (event, listener) => {
      const EventServices = {
        insightParams: 'urn:Belkin:service:insight:1',
        statusChange: 'urn:Belkin:service:bridge:1',
        attributeList: 'urn:Belkin:service:basicevent:1',
        binaryState: 'urn:Belkin:service:basicevent:1'
      }
      const serviceType = EventServices[event]
      if (serviceType && this.services[serviceType]) {
        this.subscribe(serviceType)
      }
    })
  }

  subscribe (serviceType) {
    try {
      if (!this.services[serviceType]) {
        throw new Error('[' + this.device.friendlyName + '] service [' + serviceType + '] not supported.')
      }
      if (!this.device.callbackURL) {
        throw new Error('[' + this.device.friendlyName + '] cannot subscribe without callbackURL.')
      }
      if (this.subscriptions[serviceType] && this.subscriptions[serviceType] === 'PENDING') {
        this.log('[%s] subscription still pending.', this.device.friendlyName)
        return
      }
      const options = {
        host: this.device.host,
        port: this.device.port,
        path: this.services[serviceType].eventSubURL,
        method: 'SUBSCRIBE',
        headers: { TIMEOUT: 'Second-300' }
      }
      if (this.subscriptions[serviceType]) {
        // *** Renew subscription *** \\
        options.headers.SID = this.subscriptions[serviceType]
      } else {
        // *** Initial subscription *** \\
        this.subscriptions[serviceType] = 'PENDING'
        if (this.debug) {
          this.log('[%s] initial subscription for service [%s].', this.device.friendlyName, serviceType)
        }
        options.headers.CALLBACK = '<' + this.device.callbackURL + '/' + this.device.UDN + '>'
        options.headers.NT = 'upnp:event'
      }
      const req = http.request(options, res => {
        if (res.statusCode === 200) {
          this.subscriptions[serviceType] = res.headers.sid

          // *** Renew subscription after 150 seconds *** \\
          setTimeout(() => this.subscribe(serviceType), 150000)
        } else {
          if (this.debug) {
            this.log.warn(
              '[%s] connection error [%s], retrying in 2 seconds.',
              this.device.friendlyName,
              res.statusCode
            )
          }
          this.subscriptions[serviceType] = null

          // *** Try to recover from a failed subscription after 2 seconds *** \\
          setTimeout(() => this.subscribe(serviceType), 2000)
        }
      })
      req.removeAllListeners('error')
      req.on('error', err => {
        this.subscriptions[serviceType] = null
        this.error = err.code
        this.emit('error', err)
      })
      req.end()
    } catch (err) {
      this.log.warn(err)
    }
  }

  async sendRequest (serviceType, action, body) {
    try {
      if (!this.services[serviceType]) {
        throw new Error('[' + this.device.friendlyName + '] service [' + serviceType + '] not supported.')
      }
      if (this.error) {
        throw new Error('[' + this.device.friendlyName + '] reported error: ' + this.error)
      }
      const xml = xmlbuilder.create('s:Envelope', {
        version: '1.0',
        encoding: 'utf-8',
        allowEmpty: true
      }).att('xmlns:s', 'http://schemas.xmlsoap.org/soap/envelope/')
        .att('s:encodingStyle', 'http://schemas.xmlsoap.org/soap/encoding/')
        .ele('s:Body')
        .ele('u:' + action)
        .att('xmlns:u', serviceType)
      const res = await axios({
        url: 'http://' + this.device.host + ':' + this.device.port + this.services[serviceType].controlURL,
        method: 'post',
        headers: {
          SOAPACTION: '"' + serviceType + '#' + action + '"',
          'Content-Type': 'text/xml; charset="utf-8"'
        },
        data: (body ? xml.ele(body) : xml).end(),
        timeout: 10000
      })
      const xmlRes = res.data
      const response = await xml2js.parseStringPromise(xmlRes, { explicitArray: false })
      return response['s:Envelope']['s:Body']['u:' + action + 'Response']
    } catch (err) {
      this.error = err.code
      this.emit('error', err)
      throw err
    }
  }

  async receiveRequest (body) {
    try {
      const xml = await xml2js.parseStringPromise(body, { explicitArray: false })
      for (const prop in xml['e:propertyset']['e:property']) {
        if (this.funcs.hasProperty(xml['e:propertyset']['e:property'], prop)) {
          const data = xml['e:propertyset']['e:property'][prop]
          switch (prop) {
            case 'BinaryState':
              try {
                this.emit('binaryState', {
                  name: 'binaryState',
                  value: parseInt(data.substring(0, 1))
                })
              } catch (e) {
                const eToShow = this.debug
                  ? ':\n' + e
                  : ' ' + e.message + (e.lineNumber ? ' [line ' + e.lineNumber + '].' : '')
                this.log.warn('[%s] failed to process BinaryState as%s', this.device.friendlyName, eToShow)
              }
              break
            case 'Brightness':
              try {
                this.emit('brightness', {
                  name: 'brightness',
                  value: parseInt(data)
                })
              } catch (e) {
                const eToShow = this.debug
                  ? ':\n' + e
                  : ' ' + e.message + (e.lineNumber ? ' [line ' + e.lineNumber + '].' : '')
                this.log.warn('[%s] failed to process Brightness as%s', this.device.friendlyName, eToShow)
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
                    data: {
                      ONSince: params[1],
                      OnFor: params[2],
                      TodayONTime: params[3],
                      TodayConsumed: params[8]
                    }
                  }
                })
              } catch (e) {
                const eToShow = this.debug
                  ? ':\n' + e
                  : ' ' + e.message + (e.lineNumber ? ' [line ' + e.lineNumber + '].' : '')
                this.log.warn('[%s] failed to process insightParams as%s', this.device.friendlyName, eToShow)
              }
              break
            }
            case 'attributeList':
              try {
                const xml = '<attributeList>' + this.funcs.decodeXML(data) + '</attributeList>'
                const result = await xml2js.parseStringPromise(xml, { explicitArray: true })
                result.attributeList.attribute.forEach(attribute => {
                  this.emit('attributeList', {
                    name: attribute.name[0],
                    value: parseInt(attribute.value[0])
                  })
                })
              } catch (e) {
                const eToShow = this.debug
                  ? ':\n' + e
                  : ' ' + e.message + (e.lineNumber ? ' [line ' + e.lineNumber + '].' : '')
                this.log.warn('[%s] failed to process attributeList as%s', this.device.friendlyName, eToShow)
              }
              break
            case 'StatusChange':
              try {
                const xml = await xml2js.parseStringPromise(data, { explicitArray: false })
                this.emit('statusChange', xml.StateEvent.DeviceID._, {
                  name: xml.StateEvent.CapabilityId,
                  value: xml.StateEvent.Value
                })
              } catch (e) {
                const eToShow = this.debug
                  ? ':\n' + e
                  : ' ' + e.message + (e.lineNumber ? ' [line ' + e.lineNumber + '].' : '')
                this.log.warn('[%s] failed to process StatusChange as%s', this.device.friendlyName, eToShow)
              }
              break
          }
        }
      }
    } catch (err) {
      const errToShow = this.debug
        ? ':\n' + err
        : ' ' + err.message + (err.lineNumber ? ' [line ' + err.lineNumber + '].' : '')
      this.log.warn('[%s] failed to process incoming message as%s', this.device.friendlyName, errToShow)
    }
  }
}
