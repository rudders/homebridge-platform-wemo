/* jshint -W014, -W033, esversion: 9 */
/* eslint-disable new-cap */
'use strict'
const wemoPlatform = require('./lib/wemo-platform.js')
module.exports = hb => hb.registerPlatform('homebridge-platform-wemo', 'BelkinWeMo', wemoPlatform)
