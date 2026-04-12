/**
 * @file list.js
 * @description Lists memory records.
 *
 * @license MIT
 */
'use strict';

const { DEFAULT_LIST_LIMIT } = require('../constants');
const { formatList } = require('../core/formatters');
const { parseOptions } = require('../core/options');
const { readRecordsWithScope } = require('../memory/storage');
const { toPositiveInt } = require('../core/utils');
const { normalizeKind, normalizeScope, normalizeStatusFilter } = require('../core/validators');

/**
 * Lists memory records without requiring a recall query.
 *
 * @param {string[]} args - CLI arguments.
 * @returns {void}
 */
function listCommand(args) {
  const { opts } = parseOptions(args);
  const scope = normalizeScope(opts.scope || 'all');
  const status = normalizeStatusFilter(opts.status || 'active');
  const kind = opts.kind ? normalizeKind(opts.kind) : undefined;
  const limit = toPositiveInt(opts.limit, DEFAULT_LIST_LIMIT);
  const records = readRecordsWithScope(scope)
    .filter((item) => status === 'all' || item.record.status === status)
    .filter((item) => !kind || item.record.kind === kind)
    .sort((a, b) => compareDateDesc(a.record, b.record))
    .slice(0, limit);

  if (opts.json) {
    console.log(JSON.stringify(records.map((item) => ({ scope: item.scope, ...item.record })), null, 2));
    return;
  }

  if (records.length === 0) {
    console.log('No memories found.');
    return;
  }

  console.log(formatList(records, { kind, limit, scope, status }));
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

module.exports = listCommand;
