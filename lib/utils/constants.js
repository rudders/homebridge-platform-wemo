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
    brightnessStep: 1,
    adaptiveLightingShift: 0
  },

  minValues: {
    discoveryInterval: 15,
    makerTimer: 1,
    noMotionTimer: 0,
    port: 0,
    wattDiff: 1,
    brightnessStep: 1,
    adaptiveLightingShift: 0
  },

  messages: {
    accNotFound: 'accessory not found',
    awaiting: 'awaiting (re)connection and will retry in',
    brand: 'Belkin Wemo',
    cantCtl: 'could not control device and reverting status as',
    cantUpd: 'could not update device as',
    cfgDef: 'is not a valid number so using default of',
    cfgIgn: 'is not configured correctly so ignoring',
    cfgIgnItem: 'has an invalid entry which will be ignored',
    cfgItem: 'Config entry',
    cfgLow: 'is set too low so increasing to',
    cfgRmv: 'is unused and can be removed',
    cfgQts: 'should not have quotes around its entry',
    complete: '✓ Setup complete',
    connError: 'connection error',
    devAdd: 'has been added to Homebridge',
    devRemove: 'has been removed from Homebridge',
    devNotAdd: 'could not be added to Homebridge as',
    devNotConf: 'could not be configured as',
    devNotInit: 'could not be initialised as',
    devNotRemove: 'could not be removed from Homebridge as',
    disabled: 'To change this, set disablePlugin to false',
    disabling: 'Disabling plugin',
    identify: 'identify button pressed',
    incFail: 'failed to process incoming message as',
    incKnown: 'incoming notification',
    incUnknown: 'incoming notification from unknown accessory',
    initSer: 'initialised with s/n',
    initMac: 'and mac address',
    initialised: 'initialised. Setting up device discovery',
    listenerClosed: 'Listener server gracefully closed',
    listenerError: 'Listener server error',
    listenerPort: 'Listener server port',
    modelLED: 'LED Bulb (Via Link)',
    noInterface: 'Unable to find interface',
    noPort: 'could not find correct port for device',
    notConfigured: 'Plugin has not been configured',
    proEr: 'could not be processed as',
    rduErr: 'requestDeviceUpdate() error',
    recUpd: 'received update',
    repError: 'reported error',
    reportedErr: 'reported error and will retry connection within',
    ssdpFail: 'SSDP search failed as',
    ssdpStopped: 'SSDP client gracefully stopped',
    sdErr: 'could not request subdevices as',
    subError: 'subscription error, retrying in 2 seconds',
    subInit: 'initial subscription for service',
    subPending: 'subscription still pending',
    subscribeError: 'could not subscribe as',
    unsupported: 'is unsupported but feel free to create a GitHub issue'
  },

  welcomeMessages: [
    "Don't forget to ☆ this plugin on GitHub if you're finding it useful!",
    'Have a feature request? Visit http://bit.ly/hb-wemo-issues to ask!',
    'Interested in sponsoring this plugin? https://github.com/sponsors/bwp91',
    "Join the plugin's Discord community! https://discord.gg/cMGhNtZ3tW",
    'Thanks for using this plugin, I hope you find it helpful!',
    'This plugin has been made with ♥ by bwp91 from the UK!'
  ],

  portsToScan: [49152, 49153, 49154, 49155]
}
