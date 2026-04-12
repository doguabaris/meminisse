/**
 * @file formatters.js
 * @description CLI output formatting helpers.
 *
 * @license MIT
 */
'use strict';

const { countBy } = require('./utils');

/**
 * Formats recall results with a strict character budget.
 *
 * @param {{ record: object, score: number }[]} items - Scored recall results.
 * @param {string} query - Original query.
 * @param {{ maxChars: number, mode: string }} options - Output options.
 * @returns {string} Human-readable recall output.
 */
function formatRecall(items, query, options) {
  const lines = [`Relevant memories for: ${query}`];
  let used = lines[0].length + 1;

  for (const item of items) {
    const rendered = renderRecallItem(item, options.mode);
    for (const line of rendered) {
      const remaining = options.maxChars - used;
      if (remaining <= 0) {
        lines.push('... truncated by --max-chars');
        return lines.join('\n');
      }

      if (line.length + 1 > remaining) {
        lines.push(`${line.slice(0, Math.max(0, remaining - 18))}... truncated`);
        return lines.join('\n');
      }

      lines.push(line);
      used += line.length + 1;
    }
  }

  return lines.join('\n');
}

/**
 * Renders one recall result according to the selected mode.
 *
 * @param {{ record: object, score: number }} item - Recall result.
 * @param {string} mode - Recall output mode.
 * @returns {string[]} Rendered lines.
 */
function renderRecallItem(item, mode) {
  const record = item.record;
  const tags = record.tags && record.tags.length ? ` #${record.tags.slice(0, 5).join(' #')}` : '';
  const paths =
    record.paths && record.paths.length ? ` paths=${record.paths.slice(0, 3).join(',')}` : '';

  if (mode === 'ids') {
    return [`- ${record.id} score=${item.score} ${record.kind}: ${record.summary}`];
  }

  const lines = [
    `- [${record.kind}/${record.memory_type}/${record.confidence}] ${record.summary}${tags}${paths}`,
  ];

  if (mode === 'full' && record.body && record.body !== record.summary) {
    lines.push(`  ${record.body}`);
  }

  return lines;
}

/**
 * Formats records for deterministic session injection.
 *
 * @param {{ scope: string, record: object }[]} items - Records to inject.
 * @param {{ maxChars: number }} options - Output options.
 * @returns {string} Injection text.
 */
function formatInjection(items, options) {
  const lines = ['Meminisse injected memory'];
  let used = lines[0].length + 1;

  for (const item of items) {
    const record = item.record;
    const line = `- [${item.scope}/${record.kind}] ${record.summary}`;
    const remaining = options.maxChars - used;
    if (remaining <= 0) {
      lines.push('... truncated by --max-chars');
      break;
    }

    if (line.length + 1 > remaining) {
      lines.push(`${line.slice(0, Math.max(0, remaining - 18))}... truncated`);
      break;
    }

    lines.push(line);
    used += line.length + 1;
  }

  return lines.join('\n');
}

/**
 * Formats list results for terminal output.
 *
 * @param {{ scope: string, record: object }[]} items - Scoped records.
 * @param {{ scope: string, status: string, kind?: string, limit: number }} options - List options.
 * @returns {string} Human-readable listing.
 */
function formatList(items, options) {
  const kind = options.kind ? ` kind=${options.kind}` : '';
  const lines = [
    `Memories (scope=${options.scope} status=${options.status}${kind} limit=${options.limit})`,
  ];

  for (const item of items) {
    const record = item.record;
    const updated = (record.updated_at || record.created_at || '').slice(0, 10) || 'unknown-date';
    const tags =
      record.tags && record.tags.length ? ` #${record.tags.slice(0, 4).join(' #')}` : '';
    lines.push(
      `- ${record.id} [${item.scope}/${record.kind}/${record.status}/${record.confidence}] ${updated} ${record.summary}${tags}`,
    );
  }

  return lines.join('\n');
}

/**
 * Formats a verbose status block.
 *
 * @param {string} name - Scope name.
 * @param {string} root - Memory root path.
 * @param {object[]} records - Records in scope.
 * @returns {string} Verbose status text.
 */
function formatVerboseStatus(name, root, records) {
  const statusCounts = countBy(records, (record) => record.status || 'unknown');
  const kindCounts = countBy(records, (record) => record.kind || 'unknown');
  const schemaCounts = countBy(records, (record) => String(record.schema_version || 0));
  const lines = [`${name}:`, `  path: ${root}`, `  total: ${records.length}`];

  for (const status of ['active', 'superseded', 'deleted']) {
    lines.push(`  ${status}: ${statusCounts.get(status) || 0}`);
  }

  lines.push('  kinds:');
  for (const [kind, count] of [...kindCounts.entries()].sort()) {
    lines.push(`    ${kind}: ${count}`);
  }

  lines.push('  schema_versions:');
  for (const [schemaVersion, count] of [...schemaCounts.entries()].sort()) {
    lines.push(`    ${schemaVersion}: ${count}`);
  }

  return lines.join('\n');
}

/**
 * Formats doctor checks for terminal output.
 *
 * @param {{ status: string, name: string, detail: string }[]} checks - Doctor checks.
 * @returns {string} Human-readable doctor report.
 */
function formatDoctor(checks) {
  const lines = ['Meminisse doctor', ''];
  for (const check of checks) {
    lines.push(`${check.status.toUpperCase()} ${check.name}: ${check.detail}`);
  }

  return lines.join('\n');
}

/**
 * Formats review findings for terminal output.
 *
 * @param {{ scope: string, stale: object[], duplicates: object[], broken_paths: object[], summary: object }} report - Review report.
 * @returns {string} Human-readable review report.
 */
function formatReview(report) {
  const lines = [
    'Meminisse review',
    '',
    `Scope: ${report.scope}`,
    `Active records: ${report.summary.active_records}`,
    '',
  ];

  appendReviewSection(lines, 'Stale memories', report.stale, (item) => {
    return `${item.id} [${item.scope}/${item.kind}] mentions ${item.versions.join(', ')}: ${item.summary}`;
  });
  appendReviewSection(lines, 'Duplicate candidates', report.duplicates, (item) => {
    return `${item.records.map((record) => record.id).join(', ')}: ${item.suggestion}`;
  });
  appendReviewSection(lines, 'Broken path references', report.broken_paths, (item) => {
    return `${item.id} [${item.scope}/${item.kind}] ${item.path}: ${item.suggestion}`;
  });

  if (
    report.summary.stale === 0 &&
    report.summary.duplicates === 0 &&
    report.summary.broken_paths === 0
  ) {
    lines.push('No review issues found.');
  }

  return lines.join('\n');
}

/**
 * Appends a non-empty review section.
 *
 * @param {string[]} lines - Output lines to mutate.
 * @param {string} title - Section title.
 * @param {object[]} items - Findings.
 * @param {(item: object) => string} render - Finding renderer.
 * @returns {void}
 */
function appendReviewSection(lines, title, items, render) {
  if (items.length === 0) {
    return;
  }

  lines.push(`${title}:`);
  for (const item of items) {
    lines.push(`* ${render(item)}`);
  }
  lines.push('');
}

/**
 * Formats encryption status or enable results.
 *
 * @param {string} action - Action label.
 * @param {object[]} stats - Per-scope encryption stats.
 * @returns {string} Human-readable encryption report.
 */
function formatEncryptionStats(action, stats) {
  const lines = [`Meminisse encryption ${action}`];
  for (const item of stats) {
    lines.push(
      `- ${item.scope}: ${item.enabled ? 'enabled' : 'disabled'}${item.key_env ? ` key_env=${item.key_env}` : ''}${item.encrypted_records !== undefined ? ` records=${item.encrypted_records}` : ''}`,
    );
  }
  return lines.join('\n');
}

module.exports = {
  formatDoctor,
  formatEncryptionStats,
  formatInjection,
  formatList,
  formatRecall,
  formatReview,
  formatVerboseStatus,
};
