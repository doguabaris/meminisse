/**
 * @file recall.js
 * @description Recalls relevant memories.
 *
 * @license MIT
 */
'use strict';

const { DEFAULT_RECALL_LIMIT, DEFAULT_RECALL_MAX_CHARS } = require('../constants');
const { formatRecall } = require('../core/formatters');
const { parseOptions } = require('../core/options');
const { buildRecallCorpus, formatScore, scoreRecord } = require('../memory/recall');
const { readRecordsWithScope, updateRecallTelemetry } = require('../memory/storage');
const { normalizeText, toPositiveInt } = require('../core/utils');
const { normalizeRecallMode, normalizeScope } = require('../core/validators');

/**
 * Searches active memories for a query.
 *
 * @param {string[]} args - CLI arguments.
 * @returns {void}
 */
function recallCommand(args) {
  const { opts, rest } = parseOptions(args);
  const query = normalizeText(rest.join(' '));
  if (!query) {
    throw new Error('Usage: meminisse recall [--scope all] [--limit 8] <query>');
  }

  const scope = normalizeScope(opts.scope || 'all');
  const limit = toPositiveInt(opts.limit, DEFAULT_RECALL_LIMIT);
  const threshold = toPositiveInt(opts.threshold, 1);
  const mode = normalizeRecallMode(opts.mode || 'summary');
  const maxChars = toPositiveInt(opts['max-chars'], DEFAULT_RECALL_MAX_CHARS);
  const activeRecords = readRecordsWithScope(scope).filter((item) => item.record.status === 'active');
  const corpus = buildRecallCorpus(activeRecords.map((item) => item.record));
  const records = activeRecords
    .map((item) => ({ ...item, score: scoreRecord(item.record, query, corpus) }))
    .filter((item) => item.score >= threshold)
    .sort((a, b) => b.score - a.score || compareDateDesc(a.record, b.record))
    .slice(0, limit);

  updateRecallTelemetry(records);

  if (opts.json) {
    console.log(
      JSON.stringify(
        records.map((item) => ({
          scope: item.scope,
          score: formatScore(item.score),
          ...item.record,
        })),
        null,
        2,
      ),
    );
    return;
  }

  if (records.length === 0) {
    console.log('No relevant memories found.');
    return;
  }

  console.log(formatRecall(records, query, { maxChars, mode }));
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

module.exports = recallCommand;
