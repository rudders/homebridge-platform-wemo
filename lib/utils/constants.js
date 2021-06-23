/* jshint -W014, -W033, esversion: 9 */
/* eslint-disable new-cap */
'use strict'

module.exports = {
  defaultConfig: {
    name: 'Wemo',
    mode: 'auto',
    discoveryInterval: 30,
    disableDeviceLogging: false,
    debug: false,
    debugFakegato: false,
    disablePlugin: false,
    makerTypes: [],
    wemoInsights: [],
    wemoLights: [],
    wemoMotions: [],
    wemoOthers: [],
    wemoOutlets: [],
    manualDevices: [],
    ignoredDevices: [],
    removeByName: '',
    wemoClient: {
      listen_interface: '',
      port: 0,
      discover_opts: {
        interfaces: '',
        explicitSocketBind: true
      }
    },
    platform: 'BelkinWeMo'
  },

  defaultValues: {
    discoveryInterval: 30,
    makerTimer: 20,
    noMotionTimer: 60,
    port: 0,
    wattDiff: 1,
    timeDiff: 1,
    brightnessStep: 1,
    adaptiveLightingShift: 0,
    transitionTime: 0,
    pollingInterval: 30,
    showAsType: 'outlet',
    overrideLogging: 'default'
  },

  minValues: {
    discoveryInterval: 15,
    makerTimer: 1,
    noMotionTimer: 0,
    port: 0,
    wattDiff: 1,
    timeDiff: 1,
    brightnessStep: 1,
    adaptiveLightingShift: 0,
    transitionTime: 0,
    pollingInterval: 15
  },

  allowed: {
    wemoInsights: [
      'serialNumber',
      'label',
      'showTodayTC',
      'wattDiff',
      'timeDiff',
      'overrideDisabledLogging'
    ],
    wemoLights: [
      'serialNumber',
      'label',
      'adaptiveLightingShift',
      'brightnessStep',
      'pollingInterval',
      'transitionTime',
      'overrideDisabledLogging'
    ],
    wemoMakers: ['serialNumber', 'label', 'makerType', 'makerTimer', 'overrideDisabledLogging'],
    wemoMotions: ['serialNumber', 'label', 'noMotionTimer', 'overrideDisabledLogging'],
    wemoOthers: ['serialNumber', 'label', 'overrideDisabledLogging'],
    wemoOutlets: ['serialNumber', 'label', 'showAsType', 'overrideDisabledLogging'],
    showAsType: ['outlet', 'switch', 'purifier'],
    overrideLogging: ['default', 'standard', 'debug', 'disable']
  },

  portsToScan: [49152, 49153, 49154, 49155]
}
