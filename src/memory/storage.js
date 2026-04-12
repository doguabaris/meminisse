/**
 * @file storage.js
 * @description JSONL record storage, lifecycle, indexing, pruning, and encryption.
 *
 * @license MIT
 */
'use strict';

const fs = require('fs');
const path = require('path');
const {
  DEFAULT_ENCRYPTION_KEY_ENV,
  MEMORY_SCHEMA_VERSION,
} = require('../constants');
const {
  createEncryptionConfig,
  parseStoredRecord: parseEncryptedOrPlainRecord,
  readEncryptionConfig,
  requireEncryptionKey,
  serializeStoredRecord,
  writeEncryptionConfig,
} = require('../security/encryption');
const {
  ensureDir,
  ensureProjectIgnoreFiles,
  ensureProjectProfile,
  fileForKind,
  forEachConcreteScope,
  projectIdentity,
  projectMemoryPath,
  scopePath,
  uniqueMemoryFiles,
} = require('../system/paths');
const {
  contentHash,
  countBy,
  groupBy,
  makeId,
  normalizeForHash,
  normalizeStringArray,
  normalizeText,
  toNonNegativeInt,
} = require('../core/utils');
const {
  normalizeStoredBoundary,
  normalizeStoredConfidence,
  normalizeStoredKind,
  normalizeStoredMemoryType,
  normalizeStoredStatus,
} = require('../core/validators');

/**
 * Reads memory records and annotates each record with its source scope.
 *
 * @param {'project' | 'global' | 'all'} scope - Memory scope to read.
 * @returns {{ scope: 'project' | 'global', record: object }[]} Scoped records.
 */
function readRecordsWithScope(scope) {
  if (scope === 'all') {
    return readRecordsWithScope('project').concat(readRecordsWithScope('global'));
  }

  return readRecords(scopePath(scope)).map((record) => ({ scope, record }));
}

/**
 * Reads all primary JSONL memory files from a memory root.
 *
 * @param {string} root - Memory root directory.
 * @returns {object[]} Parsed memory records.
 */
function readRecords(root) {
  const records = [];
  for (const filename of uniqueMemoryFiles()) {
    const filePath = path.join(root, filename);
    if (!fs.existsSync(filePath)) {
      continue;
    }

    for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }

      try {
        records.push(parseStoredRecord(root, trimmed));
      } catch (error) {
        if (trimmed.includes('"encrypted":true')) {
          throw error;
        }
        records.push(parseErrorRecord(filePath, trimmed));
      }
    }
  }

  return records;
}

/**
 * Parses one plaintext or encrypted JSONL line.
 *
 * @param {string} root - Memory root directory.
 * @param {string} line - JSONL line.
 * @returns {object} Normalized memory record.
 */
function parseStoredRecord(root, line) {
  return parseEncryptedOrPlainRecord(root, line, normalizeMemoryRecord);
}

/**
 * Creates a low-confidence placeholder for an unreadable JSONL row.
 *
 * @param {string} filePath - JSONL file path.
 * @param {string} line - Raw unreadable line.
 * @returns {object} Parse-error memory record.
 */
function parseErrorRecord(filePath, line) {
  return {
    schema_version: 0,
    id: makeId('bad', `${filePath}:${line}`),
    kind: 'note',
    memory_type: 'semantic',
    summary: `Unreadable memory line in ${filePath}`,
    body: line,
    tags: ['parse-error'],
    entities: [],
    paths: [filePath],
    source: 'meminisse',
    confidence: 'low',
    status: 'active',
    created_at: new Date(0).toISOString(),
    updated_at: new Date(0).toISOString(),
  };
}

/**
 * Normalizes older memory records into the current in-memory shape.
 *
 * @param {object} record - Parsed record.
 * @returns {object} Backward-compatible memory record.
 */
function normalizeMemoryRecord(record) {
  return {
    ...record,
    schema_version: toNonNegativeInt(record.schema_version),
    kind: normalizeStoredKind(record.kind),
    memory_type: normalizeStoredMemoryType(record.memory_type),
    event_id: normalizeText(record.event_id),
    boundary: normalizeStoredBoundary(record.boundary),
    summary: normalizeText(record.summary || record.body || 'Untitled memory'),
    body: normalizeText(record.body || record.summary),
    tags: normalizeStringArray(record.tags),
    entities: normalizeStringArray(record.entities),
    paths: normalizeStringArray(record.paths),
    source: normalizeText(record.source || 'unknown'),
    confidence: normalizeStoredConfidence(record.confidence),
    status: normalizeStoredStatus(record.status),
    supersedes: normalizeStringArray(record.supersedes),
    content_hash: normalizeText(record.content_hash),
    project: normalizeText(record.project || projectIdentity()),
    created_at: normalizeText(record.created_at || new Date(0).toISOString()),
    updated_at: normalizeText(record.updated_at || record.created_at || new Date(0).toISOString()),
  };
}

/**
 * Appends a memory record to the selected JSONL file.
 *
 * @param {string} root - Memory root directory.
 * @param {string} filename - JSONL filename.
 * @param {object} record - Record to write.
 * @returns {void}
 */
function writeRecord(root, filename, record) {
  ensureDir(root);
  const filePath = path.join(root, filename);
  fs.appendFileSync(filePath, `${serializeStoredRecord(root, record)}\n`, 'utf8');
}

/**
 * Finds an active duplicate record by content hash or normalized body.
 *
 * @param {string} root - Memory root directory.
 * @param {string} kind - Memory kind.
 * @param {string} hash - Content hash.
 * @param {string} body - Raw body text.
 * @returns {object | undefined} Duplicate record when found.
 */
function findDuplicate(root, kind, hash, body) {
  const normalized = normalizeForHash(body);
  return readRecords(root).find((record) => {
    if (record.status !== 'active' || record.kind !== kind) {
      return false;
    }

    return record.content_hash === hash || normalizeForHash(record.body || '') === normalized;
  });
}

/**
 * Marks active records as superseded by a replacement record.
 *
 * @param {string} root - Memory root directory.
 * @param {string[]} ids - Record IDs to supersede.
 * @param {string} supersededBy - Replacement record ID.
 * @param {string} now - ISO timestamp.
 * @returns {number} Number of changed records.
 */
function markSuperseded(root, ids, supersededBy, now) {
  return rewriteMatchingRecords(root, (record) => {
    if (ids.includes(record.id) && record.status === 'active') {
      return {
        record: {
          ...record,
          status: 'superseded',
          superseded_by: supersededBy,
          updated_at: now,
        },
        changed: true,
      };
    }

    return { record, changed: false };
  }).changed;
}

/**
 * Marks active records as deleted without removing audit history.
 *
 * @param {string} root - Memory root directory.
 * @param {string[]} ids - Record IDs to delete.
 * @param {string} now - ISO timestamp.
 * @param {string} reason - Optional deletion reason.
 * @returns {string[]} Deleted record IDs.
 */
function markDeleted(root, ids, now, reason) {
  const deleted = [];
  rewriteMatchingRecords(root, (record) => {
    if (ids.includes(record.id) && record.status === 'active') {
      deleted.push(record.id);
      return {
        record: {
          ...record,
          status: 'deleted',
          ...(reason ? { deleted_reason: reason } : {}),
          updated_at: now,
        },
        changed: true,
      };
    }

    return { record, changed: false };
  });
  return deleted;
}

/**
 * Updates recall telemetry for active records.
 *
 * @param {string} root - Memory root directory.
 * @param {string[]} ids - Record IDs that were recalled.
 * @param {string} now - ISO timestamp.
 * @returns {Map<string, object>} Updated records by ID.
 */
function markRecalled(root, ids, now) {
  const targets = new Set(ids);
  const updated = new Map();

  rewriteMatchingRecords(root, (record) => {
    if (targets.has(record.id) && record.status === 'active') {
      const nextRecord = {
        ...record,
        recall_count: toNonNegativeInt(record.recall_count) + 1,
        last_recalled_at: now,
      };
      updated.set(record.id, nextRecord);
      return { record: nextRecord, changed: true };
    }

    return { record, changed: false };
  });

  return updated;
}

/**
 * Rewrites primary JSONL files with a record update callback.
 *
 * @param {string} root - Memory root directory.
 * @param {(record: object) => { record: object, changed: boolean }} updater - Record updater.
 * @returns {{ changed: number }} Rewrite stats.
 */
function rewriteMatchingRecords(root, updater) {
  let changed = 0;
  for (const filename of uniqueMemoryFiles()) {
    const filePath = path.join(root, filename);
    if (!fs.existsSync(filePath)) {
      continue;
    }

    const nextLines = [];
    for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/).filter(Boolean)) {
      try {
        const record = parseStoredRecord(root, line);
        const result = updater(record);
        if (result.changed) {
          changed += 1;
        }
        nextLines.push(serializeStoredRecord(root, result.record));
      } catch {
        nextLines.push(line);
      }
    }

    fs.writeFileSync(filePath, nextLines.length ? `${nextLines.join('\n')}\n` : '', 'utf8');
  }

  return { changed };
}

/**
 * Persists recall telemetry for returned recall results.
 *
 * @param {{ scope: string, record: object }[]} items - Recall result records.
 * @returns {void}
 */
function updateRecallTelemetry(items) {
  const byScope = groupBy(items, (item) => item.scope);
  const now = new Date().toISOString();

  for (const [scope, scopedItems] of byScope.entries()) {
    const updated = markRecalled(scopePath(scope), scopedItems.map((item) => item.record.id), now);
    for (const item of scopedItems) {
      const record = updated.get(item.record.id);
      if (record) {
        item.record.recall_count = record.recall_count;
        item.record.last_recalled_at = record.last_recalled_at;
      }
    }
  }
}

/**
 * Rebuilds the lightweight index for a memory root.
 *
 * @param {string} root - Memory root directory.
 * @returns {void}
 */
function refreshIndex(root) {
  ensureDir(root);
  const records = readRecords(root);
  const index = {
    schema_version: MEMORY_SCHEMA_VERSION,
    updated_at: new Date().toISOString(),
    project: projectIdentity(),
    counts: {},
    schema_versions: {},
    tags: Object.fromEntries(countTags(records)),
    records: records.length,
    encrypted: Boolean(readEncryptionConfig(root)),
  };

  for (const record of records) {
    index.counts[record.kind] = (index.counts[record.kind] || 0) + 1;
    index.schema_versions[record.schema_version] =
      (index.schema_versions[record.schema_version] || 0) + 1;
  }

  fs.writeFileSync(path.join(root, 'index.json'), `${JSON.stringify(index, null, 2)}\n`, 'utf8');
}

/**
 * Counts tag usage across records.
 *
 * @param {object[]} records - Records to inspect.
 * @returns {[string, number][]} Sorted tag/count pairs.
 */
function countTags(records) {
  const counts = new Map();
  for (const record of records) {
    for (const tag of record.tags || []) {
      counts.set(tag, (counts.get(tag) || 0) + 1);
    }
  }

  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

/**
 * Enables encryption and rewrites primary JSONL rows as encrypted envelopes.
 *
 * @param {string} root - Memory root directory.
 * @param {'project' | 'global'} scope - Memory scope.
 * @param {string} keyEnv - Environment variable containing the encryption key.
 * @returns {{ scope: string, enabled: boolean, encrypted_records: number, key_env: string }} Enable stats.
 */
function enableEncryption(root, scope, keyEnv = DEFAULT_ENCRYPTION_KEY_ENV) {
  ensureDir(root);
  if (scope === 'project') {
    ensureProjectProfile();
    ensureProjectIgnoreFiles();
  }

  requireEncryptionKey(keyEnv);
  const existing = readEncryptionConfig(root);
  const config = existing && existing.enabled ? existing : createEncryptionConfig(keyEnv);
  config.key_env = keyEnv;
  config.enabled = true;
  config.updated_at = new Date().toISOString();
  writeEncryptionConfig(root, config);

  let encryptedRecords = 0;
  for (const filename of uniqueMemoryFiles()) {
    const filePath = path.join(root, filename);
    if (!fs.existsSync(filePath)) {
      continue;
    }

    const nextLines = [];
    for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/).filter(Boolean)) {
      const record = parseStoredRecord(root, line);
      nextLines.push(serializeStoredRecord(root, record));
      encryptedRecords += 1;
    }
    fs.writeFileSync(filePath, nextLines.length ? `${nextLines.join('\n')}\n` : '', 'utf8');
  }

  refreshIndex(root);
  return { scope, enabled: true, encrypted_records: encryptedRecords, key_env: keyEnv };
}

/**
 * Reports encryption status for one memory root.
 *
 * @param {string} root - Memory root directory.
 * @param {'project' | 'global'} scope - Memory scope.
 * @returns {{ scope: string, enabled: boolean, key_env?: string, root: string }} Status object.
 */
function encryptionStatus(root, scope) {
  const config = readEncryptionConfig(root);
  return {
    scope,
    enabled: Boolean(config && config.enabled),
    ...(config && config.key_env ? { key_env: config.key_env } : {}),
    root,
  };
}

/**
 * Enables encryption for one or all concrete scopes.
 *
 * @param {'project' | 'global' | 'all'} scope - Requested scope.
 * @param {string} keyEnv - Environment variable containing the encryption key.
 * @returns {object[]} Per-scope encryption stats.
 */
function enableEncryptionForScope(scope, keyEnv) {
  return forEachConcreteScope(scope, (name, root) => enableEncryption(root, name, keyEnv));
}

/**
 * Reports encryption status for one or all concrete scopes.
 *
 * @param {'project' | 'global' | 'all'} scope - Requested scope.
 * @returns {object[]} Per-scope encryption status.
 */
function encryptionStatusForScope(scope) {
  return forEachConcreteScope(scope, (name, root) => encryptionStatus(root, name));
}

/**
 * Archives deleted and superseded records out of primary JSONL files.
 *
 * @param {string} root - Memory root directory.
 * @param {'project' | 'global'} scope - Memory scope.
 * @returns {{ scope: string, pruned: number, archive_dir?: string }} Prune stats.
 */
function pruneInactiveRecords(root, scope) {
  const archiveDir = path.join(root, 'archive', new Date().toISOString().replace(/[:.]/g, '-'));
  let pruned = 0;

  for (const filename of uniqueMemoryFiles()) {
    const filePath = path.join(root, filename);
    if (!fs.existsSync(filePath)) {
      continue;
    }

    const keptLines = [];
    const archivedLines = [];
    for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/).filter(Boolean)) {
      try {
        const record = parseStoredRecord(root, line);
        if (record.status === 'deleted' || record.status === 'superseded') {
          archivedLines.push(serializeStoredRecord(root, record));
          pruned += 1;
          continue;
        }
      } catch {
        keptLines.push(line);
        continue;
      }

      keptLines.push(line);
    }

    if (archivedLines.length > 0) {
      ensureDir(archiveDir);
      fs.writeFileSync(path.join(archiveDir, filename), `${archivedLines.join('\n')}\n`, 'utf8');
      fs.writeFileSync(filePath, keptLines.length ? `${keptLines.join('\n')}\n` : '', 'utf8');
    }
  }

  return pruned > 0 ? { scope, pruned, archive_dir: archiveDir } : { scope, pruned };
}

/**
 * Reads active records from a scope.
 *
 * @param {'project' | 'global' | 'all'} scope - Memory scope.
 * @returns {{ scope: string, record: object }[]} Active scoped records.
 */
function activeRecords(scope) {
  return readRecordsWithScope(scope).filter((item) => item.record.status === 'active');
}

module.exports = {
  activeRecords,
  contentHash,
  countBy,
  countTags,
  enableEncryptionForScope,
  encryptionStatusForScope,
  fileForKind,
  findDuplicate,
  markDeleted,
  markSuperseded,
  projectMemoryPath,
  pruneInactiveRecords,
  readRecords,
  readRecordsWithScope,
  refreshIndex,
  scopePath,
  updateRecallTelemetry,
  writeRecord,
};
