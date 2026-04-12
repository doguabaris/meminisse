/**
 * @file status.js
 * @description Prints memory status.
 *
 * @license MIT
 */
'use strict';

const { formatVerboseStatus } = require('../core/formatters');
const { parseOptions } = require('../core/options');
const { forEachConcreteScope } = require('../system/paths');
const { readRecords } = require('../memory/storage');
const { normalizeScope } = require('../core/validators');

/**
 * Prints active and total memory counts.
 *
 * @param {string[]} args - CLI arguments.
 * @returns {void}
 */
function statusCommand(args) {
  const { opts } = parseOptions(args);
  const scope = normalizeScope(opts.scope || 'all');
  const verbose = Boolean(opts.verbose);

  forEachConcreteScope(scope, (name, root) => {
    const records = readRecords(root);
    const active = records.filter((record) => record.status === 'active').length;
    if (verbose) {
      console.log(formatVerboseStatus(name, root, records));
    } else {
      console.log(`${name}: ${active}/${records.length} active memories at ${root}`);
    }
  });
}

module.exports = statusCommand;
