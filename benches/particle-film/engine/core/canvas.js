'use strict';
// The single import point for Skia (@napi-rs/canvas). Every engine module, and every bench built on this
// engine (micro-ad-series), goes through here, so only one copy of the native binding is ever loaded.
module.exports = require('@napi-rs/canvas');
