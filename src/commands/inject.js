/**
 * @file inject.js
 * @description Prints critical memory for deterministic session hooks.
 *
 * @license MIT
 */
'use strict';

const { DEFAULT_RECALL_LIMIT, DEFAULT_RECALL_MAX_CHARS } = require('../constants');
const { formatInjection } = require('../core/formatters');
const { parseOptions } = require('../core/options');
const { readRecordsWithScope } = require('../memory/storage');
const { splitList, toPositiveInt } = require('../core/utils');
const { normalizeKind, normalizeScope } = require('../core/validators');

/**
 * Prints high-priority records for deterministic session injection.
 *
 * @param {string[]} args - CLI arguments.
 * @returns {void}
 */
function injectCommand(args) {
  const { opts } = parseOptions(args);
  const scope = normalizeScope(opts.scope || 'all');
  const maxChars = toPositiveInt(opts['max-chars'], DEFAULT_RECALL_MAX_CHARS);
  const limit = toPositiveInt(opts.limit, DEFAULT_RECALL_LIMIT);
  const kinds = splitList(opts.kinds || 'preference,procedure,decision').map(normalizeKind);
  const kindSet = new Set(kinds);
  const priority = new Map(kinds.map((kind, index) => [kind, index]));
  const records = readRecordsWithScope(scope)
    .filter((item) => item.record.status === 'active')
    .filter((item) => kindSet.has(item.record.kind))
    .sort((a, b) => {
      const priorityDiff = priority.get(a.record.kind) - priority.get(b.record.kind);
      return priorityDiff || compareDateDesc(a.record, b.record);
    })
    .slice(0, limit);

  if (opts.json) {
    console.log(JSON.stringify(records.map((item) => ({ scope: item.scope, ...item.record })), null, 2));
    return;
  }

  if (records.length === 0) {
    console.log('No injectable memories found.');
    return;
  }

  console.log(formatInjection(records, { maxChars }));
}

/**
 * Sorts records by most recent update or creation date.
 *
 * @param {object} a - First record.
 * @param {object} b - Second record.
 * @returns {number} Sort comparator result.
 */
function compareDateDesc(a, b) {
  return (
    Date.parse(b.updated_at || b.created_at || 0) - Date.parse(a.updated_at || a.created_at || 0)
  );
}

module.exports = injectCommand;
