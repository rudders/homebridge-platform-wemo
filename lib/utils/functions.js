/* jshint -W014, -W033, esversion: 9 */
/* eslint-disable new-cap */
'use strict'

module.exports = {
  hasProperty: (obj, prop) => {
    return Object.prototype.hasOwnProperty.call(obj, prop)
  },

  sleep: ms => {
    return new Promise(resolve => setTimeout(resolve, ms))
  },

  decodeXML: input => {
    return input
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#039;/g, "'")
      .replace(/&amp;/g, '&')
  },

  parseError: err => {
    let toReturn = err.message
    if (err.stack && err.stack.length > 0) {
      const stack = err.stack.split('\n')
      if (stack[1]) {
        toReturn += stack[1].replace('   ', '')
      }
    }
    return toReturn
  },

  parseSerialNumber: input => {
    return input
      .toString()
      .replace(/[\s'"]+/g, '')
      .toUpperCase()
  }
}
