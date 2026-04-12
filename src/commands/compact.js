/**
 * @file compact.js
 * @description Consolidates memory and optionally prunes inactive records.
 *
 * @license MIT
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { parseOptions } = require('../core/options');
const {
  ensureDir,
  ensureProjectIgnoreFiles,
  ensureProjectProfile,
  forEachConcreteScope,
  projectIdentity,
} = require('../system/paths');
const { countTags, pruneInactiveRecords, readRecords, refreshIndex } = require('../memory/storage');
const { titleCase } = require('../core/utils');
const { normalizeScope } = require('../core/validators');

/**
 * Runs memory consolidation for one or all scopes.
 *
 * @param {string[]} args - CLI arguments.
 * @returns {void}
 */
function compactCommand(args) {
  const { opts } = parseOptions(args);
  const scope = normalizeScope(opts.scope || 'project');
  const prune = Boolean(opts.prune);
  const stats = forEachConcreteScope(scope, (name, root) => compactOneScope(name, root, prune));

  console.log(
    scope === 'all' ? 'Consolidated project and global memories.' : `Consolidated ${scope} memories.`,
  );
  printPruneStats(stats);
}

/**
 * Writes the consolidated summary and optional prune archive for one scope.
 *
 * @param {'project' | 'global'} scope - Concrete memory scope.
 * @param {string} root - Memory root directory.
 * @param {boolean} prune - Whether to archive inactive records.
 * @returns {{ scope: string, pruned: number, archive_dir?: string }} Compaction stats.
 */
function compactOneScope(scope, root, prune) {
  ensureDir(root);
  if (scope === 'project') {
    ensureProjectProfile();
    ensureProjectIgnoreFiles();
  }

  const pruneStats = prune ? pruneInactiveRecords(root, scope) : { scope, pruned: 0 };
  const records = readRecords(root).filter((record) => record.status === 'active');
  const byKind = groupBy(records, (record) => record.kind);
  const lines = [
    '# Meminisse Consolidated Memory',
    '',
    `Updated: ${new Date().toISOString()}`,
    `Scope: ${scope}`,
    `Project: ${projectIdentity()}`,
    '',
  ];

  for (const kind of ['decision', 'fact', 'procedure', 'preference', 'event', 'session', 'note']) {
    const items = (byKind.get(kind) || []).sort(compareDateDesc).slice(0, 20);
    if (items.length === 0) {
      continue;
    }

    lines.push(`## ${titleCase(kind)}s`);
    for (const record of items) {
      const tags =
        record.tags && record.tags.length ? ` (${record.tags.slice(0, 4).join(', ')})` : '';
      lines.push(`- ${record.summary}${tags}`);
    }
    lines.push('');
  }

  const tagCounts = countTags(records);
  if (tagCounts.length > 0) {
    lines.push('## Retrieval Cues');
    lines.push(
      tagCounts
        .slice(0, 30)
        .map(([tag, count]) => `${tag}:${count}`)
        .join(', '),
    );
    lines.push('');
  }

  fs.writeFileSync(path.join(root, 'consolidated.md'), `${lines.join('\n')}\n`, 'utf8');
  refreshIndex(root);
  return pruneStats;
}

/**
 * Prints non-empty prune results.
 *
 * @param {{ scope: string, pruned: number, archive_dir?: string }[]} stats - Prune stats.
 * @returns {void}
 */
function printPruneStats(stats) {
  for (const item of stats) {
    if (item.pruned > 0) {
      console.log(`Pruned ${item.pruned} inactive ${item.scope} records to ${item.archive_dir}.`);
    }
  }
}

/**
 * Groups items by a derived key.
 *
 * @template T
 * @param {T[]} items - Items to group.
 * @param {(item: T) => string} getter - Key getter.
 * @returns {Map<string, T[]>} Grouped items.
 */
function groupBy(items, getter) {
  const groups = new Map();
  for (const item of items) {
    const key = getter(item);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  return groups;
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

module.exports = compactCommand;
