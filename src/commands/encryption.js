/**
 * @file encryption.js
 * @description Enables and reports at-rest memory encryption.
 *
 * @license MIT
 */
'use strict';

const { DEFAULT_ENCRYPTION_KEY_ENV } = require('../constants');
const { formatEncryptionStats } = require('../core/formatters');
const { parseOptions } = require('../core/options');
const { enableEncryptionForScope, encryptionStatusForScope } = require('../memory/storage');
const { normalizeText } = require('../core/utils');
const { normalizeScope } = require('../core/validators');

/**
 * Enables or reports memory encryption.
 *
 * @param {string[]} args - CLI arguments.
 * @returns {void}
 */
function encryptionCommand(args) {
  const action = normalizeText(args[0] || 'status').toLowerCase();
  const { opts } = parseOptions(args.slice(1));
  const scope = normalizeScope(opts.scope || 'all');
  const keyEnv = normalizeText(opts['key-env'] || DEFAULT_ENCRYPTION_KEY_ENV);

  if (action === 'enable') {
    console.log(formatEncryptionStats('enabled', enableEncryptionForScope(scope, keyEnv)));
    return;
  }

  if (action === 'status') {
    console.log(formatEncryptionStats('status', encryptionStatusForScope(scope)));
    return;
  }

  throw new Error('Usage: meminisse encryption enable|status [--scope project|global|all] [--key-env NAME]');
}

module.exports = encryptionCommand;
