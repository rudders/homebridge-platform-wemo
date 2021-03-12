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
    pollingInterval: 30
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
    pollingInterval: 15
  },

  welcomeMessages: [
    "Don't forget to ☆ this plugin on GitHub if you're finding it useful!",
    'Have a feature request? Visit http://bit.ly/hb-wemo-issues to ask!',
    'Interested in sponsoring this plugin? https://github.com/sponsors/bwp91',
    "Join the plugin's Discord community! https://discord.gg/cMGhNtZ3tW",
    'Thanks for using this plugin, I hope you find it helpful!',
    'This plugin has been made with ♥ by bwp91 from the UK!'
  ],

  allowed: {
    wemoInsights: [
      'serialNumber', 'label', 'showTodayTC', 'wattDiff', 'timeDiff',
      'overrideDisabledLogging'
    ],
    wemoLights: [
      'serialNumber', 'label', 'adaptiveLightingShift', 'brightnessStep',
      'pollingInterval', 'overrideDisabledLogging'
    ],
    wemoMakers: [
      'serialNumber', 'label', 'makerType', 'makerTimer', 'overrideDisabledLogging'
    ],
    wemoMotions: ['serialNumber', 'label', 'noMotionTimer', 'overrideDisabledLogging'],
    wemoOthers: ['serialNumber', 'label', 'overrideDisabledLogging'],
    wemoOutlets: ['serialNumber', 'label', 'showAsSwitch', 'overrideDisabledLogging']
  },

  portsToScan: [49152, 49153, 49154, 49155]
}
