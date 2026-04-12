/**
 * @file forget.js
 * @description Soft-deletes active memory records.
 *
 * @license MIT
 */
'use strict';

const { parseOptions } = require('../core/options');
const { forEachConcreteScope } = require('../system/paths');
const { markDeleted, refreshIndex } = require('../memory/storage');
const { normalizeText, splitArgsList, splitList, uniqueArray } = require('../core/utils');
const { normalizeScope } = require('../core/validators');

/**
 * Marks active memories as deleted.
 *
 * @param {string[]} args - CLI arguments.
 * @returns {void}
 */
function forgetCommand(args) {
  const { opts, rest } = parseOptions(args);
  const scope = normalizeScope(opts.scope || 'all');
  const ids = splitList(opts.ids).concat(splitList(opts.id), splitArgsList(rest));
  if (ids.length === 0) {
    throw new Error('Usage: meminisse forget [--scope project|global|all] <memory-id> [memory-id...]');
  }

  const uniqueIds = uniqueArray(ids);
  const now = new Date().toISOString();
  const reason = normalizeText(opts.reason);
  const deleted = [];

  forEachConcreteScope(scope, (name, root) => {
    const changed = markDeleted(root, uniqueIds, now, reason);
    if (changed.length > 0) {
      refreshIndex(root);
      for (const id of changed) {
        deleted.push(`${id} (${name})`);
      }
    }
  });

  if (deleted.length === 0) {
    throw new Error(`No matching active memories found for: ${uniqueIds.join(', ')}`);
  }

  console.log(`Forgot ${deleted.length} ${deleted.length === 1 ? 'memory' : 'memories'}:`);
  for (const item of deleted) {
    console.log(`- ${item}`);
  }
}

module.exports = forgetCommand;
