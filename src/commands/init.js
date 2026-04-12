/**
 * @file init.js
 * @description Initializes project and global memory storage.
 *
 * @license MIT
 */
'use strict';

const { parseOptions } = require('../core/options');
const { ensureDir, ensureProjectIgnoreFiles, ensureProjectProfile, globalMemoryPath } = require('../system/paths');
const { normalizeScope } = require('../core/validators');

/**
 * Initializes project and/or global memory storage.
 *
 * @param {string[]} args - CLI arguments.
 * @returns {void}
 */
function initCommand(args) {
  const { opts } = parseOptions(args);
  const scope = normalizeScope(opts.scope || 'all');

  if (scope === 'project' || scope === 'all') {
    ensureDir(require('../system/paths').projectMemoryPath());
    ensureProjectProfile();
    ensureProjectIgnoreFiles();
  }

  if (scope === 'global' || scope === 'all') {
    ensureDir(globalMemoryPath());
  }

  console.log(`Meminisse initialized (${scope}).`);
}

module.exports = initCommand;
