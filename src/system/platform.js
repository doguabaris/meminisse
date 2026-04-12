/**
 * @file platform.js
 * @description Cross-platform path helpers for Meminisse.
 *
 * @license MIT
 */
'use strict';

const os = require('os');
const path = require('path');

/**
 * Resolves a path under the current user's home directory.
 *
 * @param {...string} parts - Path segments under the home directory.
 * @returns {string} Absolute home-relative path.
 */
function homePath(...parts) {
  return path.join(os.homedir(), ...parts);
}

/**
 * Returns a stable platform label for diagnostics.
 *
 * @returns {string} Platform label.
 */
function platformLabel() {
  return `${process.platform}/${process.arch}`;
}

module.exports = {
  homePath,
  platformLabel,
};
