'use strict'
module.exports = function (homebridge) {
  const Wemo = require('./lib/wemo.js')(homebridge)
  homebridge.registerPlatform('homebridge-platform-wemo', 'BelkinWeMo', Wemo, true)
}
