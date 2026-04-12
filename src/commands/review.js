/**
 * @file review.js
 * @description Reports stale, duplicate, and broken path memory issues.
 *
 * @license MIT
 */
'use strict';

const fs = require('fs');
const { VERSION } = require('../constants');
const { formatReview } = require('../core/formatters');
const { parseOptions } = require('../core/options');
const { resolveMemoryPath, shouldCheckPath } = require('../system/paths');
const { readRecordsWithScope } = require('../memory/storage');
const { contentHash } = require('../core/utils');
const { normalizeScope } = require('../core/validators');

/**
 * Runs the memory review command.
 *
 * @param {string[]} args - CLI arguments.
 * @returns {void}
 */
function reviewCommand(args) {
  const { opts } = parseOptions(args);
  const scope = normalizeScope(opts.scope || 'all');
  const report = buildReviewReport(scope);

  if (opts.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log(formatReview(report));
}

/**
 * Builds the review report for active memories.
 *
 * @param {'project' | 'global' | 'all'} scope - Scope to inspect.
 * @returns {{ scope: string, stale: object[], duplicates: object[], broken_paths: object[], summary: object }} Review report.
 */
function buildReviewReport(scope) {
  const records = readRecordsWithScope(scope);
  const active = records.filter((item) => item.record.status === 'active');
  const stale = findStaleMemories(active);
  const duplicates = findDuplicateMemories(active);
  const brokenPaths = findBrokenPathReferences(active);

  return {
    scope,
    stale,
    duplicates,
    broken_paths: brokenPaths,
    summary: {
      active_records: active.length,
      stale: stale.length,
      duplicates: duplicates.length,
      broken_paths: brokenPaths.length,
    },
  };
}

/**
 * Finds memories that mention older package versions as current.
 *
 * @param {{ scope: string, record: object }[]} items - Active scoped records.
 * @returns {object[]} Stale memory findings.
 */
function findStaleMemories(items) {
  const findings = [];
  const versionPattern = /\b\d+\.\d+\.\d+\b/g;

  for (const item of items) {
    const text = `${item.record.summary || ''}\n${item.record.body || ''}`;
    const versions = uniqueArray(text.match(versionPattern) || []);
    const oldVersions = versions.filter((version) => version !== VERSION);
    const isCurrentClaim = /\b(current|aligned|version|snapshot|published|release)\b/i.test(text);
    if (oldVersions.length > 0 && isCurrentClaim) {
      findings.push({
        scope: item.scope,
        id: item.record.id,
        kind: item.record.kind,
        summary: item.record.summary,
        versions: oldVersions,
        suggestion: `Check whether this should be superseded with ${VERSION}.`,
      });
    }
  }

  return findings;
}

/**
 * Finds duplicate active memories by content hash.
 *
 * @param {{ scope: string, record: object }[]} items - Active scoped records.
 * @returns {object[]} Duplicate findings.
 */
function findDuplicateMemories(items) {
  const groups = new Map();
  for (const item of items) {
    const key = item.record.content_hash || contentHash(item.record.kind, item.record.body || '');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({
      scope: item.scope,
      id: item.record.id,
      kind: item.record.kind,
      summary: item.record.summary,
    });
  }

  return [...groups.values()]
    .filter((group) => group.length > 1)
    .map((records) => ({
      records,
      suggestion: 'Consider forgetting or superseding duplicate active records.',
    }));
}

/**
 * Finds active memories that point at missing local files.
 *
 * @param {{ scope: string, record: object }[]} items - Active scoped records.
 * @returns {object[]} Broken path findings.
 */
function findBrokenPathReferences(items) {
  const findings = [];

  for (const item of items) {
    for (const recordPath of item.record.paths || []) {
      if (!shouldCheckPath(recordPath)) {
        continue;
      }

      const resolved = resolveMemoryPath(recordPath);
      if (!fs.existsSync(resolved)) {
        findings.push({
          scope: item.scope,
          id: item.record.id,
          kind: item.record.kind,
          path: recordPath,
          summary: item.record.summary,
          suggestion: 'Update, restore, or forget this path reference.',
        });
      }
    }
  }

  return findings;
}

/**
 * Returns unique values while preserving order.
 *
 * @template T
 * @param {T[]} values - Source values.
 * @returns {T[]} Unique values.
 */
function uniqueArray(values) {
  return [...new Set(values)];
}

module.exports = reviewCommand;
