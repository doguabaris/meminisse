/**
 * @file index.js
 * @description Command registry for the Meminisse CLI.
 *
 * @license MIT
 */
'use strict';

module.exports = {
  attach: require('./attach'),
  compact: require('./compact'),
  doctor: require('./doctor'),
  encryption: require('./encryption'),
  forget: require('./forget'),
  help: require('./help'),
  init: require('./init'),
  inject: require('./inject'),
  install: require('./install'),
  list: require('./list'),
  recall: require('./recall'),
  remember: require('./remember'),
  review: require('./review'),
  status: require('./status'),
};
