/**
 * @file remember.js
 * @description Stores durable memory records.
 *
 * @license MIT
 */
'use strict';

const { MEMORY_SCHEMA_VERSION } = require('../constants');
const { parseOptions } = require('../core/options');
const { detectSecret } = require('../security/secrets');
const { extractEntities, extractPaths, extractTags } = require('../memory/recall');
const {
  contentHash,
  dayStamp,
  makeId,
  normalizeText,
  splitList,
  summarize,
} = require('../core/utils');
const {
  ensureProjectIgnoreFiles,
  ensureProjectProfile,
  fileForKind,
  projectIdentity,
  scopePath,
} = require('../system/paths');
const {
  findDuplicate,
  markSuperseded,
  refreshIndex,
  writeRecord,
} = require('../memory/storage');
const {
  normalizeBoundary,
  normalizeConfidence,
  normalizeKind,
  normalizeMemoryType,
  normalizeScope,
  normalizeStatus,
} = require('../core/validators');

/**
 * Appends a durable memory record to the selected scope.
 *
 * @param {string[]} args - CLI arguments.
 * @returns {void}
 */
function rememberCommand(args) {
  const { opts, rest } = parseOptions(args);
  const body = normalizeText(rest.join(' '));
  if (!body) {
    throw new Error('Usage: meminisse remember [--kind decision] [--scope project] <text>');
  }

  const secret = detectSecret(body);
  if (secret && !opts['allow-secret']) {
    throw new Error(
      `Possible ${secret} detected. Refusing to store it. Remove the secret or pass --allow-secret if this is intentionally non-sensitive.`,
    );
  }

  const kind = normalizeKind(opts.kind || 'note');
  const scope = normalizeScope(opts.scope || defaultScopeForKind(kind));
  const root = scopePath(scope);
  if (scope === 'project') {
    ensureProjectProfile();
    ensureProjectIgnoreFiles();
  }

  const hash = contentHash(kind, body);
  const duplicate = findDuplicate(root, kind, hash, body);
  if (duplicate && !opts.force) {
    console.log(
      `Duplicate memory exists: ${duplicate.id} (${scope}/${kind}). Use --force to store again.`,
    );
    return;
  }

  const now = new Date().toISOString();
  const record = {
    schema_version: MEMORY_SCHEMA_VERSION,
    id: makeId('mem', `${scope}:${kind}:${body}:${now}`),
    kind,
    memory_type: normalizeMemoryType(opts.type || defaultMemoryTypeForKind(kind)),
    event_id: normalizeText(opts.event || makeId('evt', `${process.cwd()}:${dayStamp(now)}`)),
    boundary: normalizeBoundary(opts.boundary || defaultBoundaryForKind(kind)),
    summary: normalizeText(opts.summary || summarize(body)),
    body,
    tags: splitList(opts.tags).concat(extractTags(body)).filter(isUniqueValue),
    entities: splitList(opts.entities).concat(extractEntities(body)).filter(isUniqueValue),
    paths: splitList(opts.paths).concat(extractPaths(body)).filter(isUniqueValue),
    source: normalizeText(opts.source || 'user'),
    confidence: normalizeConfidence(opts.confidence || 'high'),
    status: normalizeStatus(opts.status || 'active'),
    supersedes: splitList(opts.supersedes),
    content_hash: hash,
    project: projectIdentity(),
    created_at: now,
    updated_at: now,
  };

  if (record.supersedes.length > 0) {
    markSuperseded(root, record.supersedes, record.id, now);
  }

  writeRecord(root, fileForKind(kind), record);
  refreshIndex(root);
  console.log(`Remembered ${record.id} (${scope}/${kind}).`);
}

/**
 * Chooses the default storage scope for a memory kind.
 *
 * @param {string} kind - Memory kind.
 * @returns {'project' | 'global'} Default scope.
 */
function defaultScopeForKind(kind) {
  return kind === 'preference' ? 'global' : 'project';
}

/**
 * Chooses the default memory type for a memory kind.
 *
 * @param {string} kind - Memory kind.
 * @returns {'episodic' | 'semantic' | 'procedural' | 'preference'} Default memory type.
 */
function defaultMemoryTypeForKind(kind) {
  if (kind === 'procedure') return 'procedural';
  if (kind === 'preference') return 'preference';
  if (kind === 'event' || kind === 'session') return 'episodic';
  return 'semantic';
}

/**
 * Chooses the default boundary marker for a memory kind.
 *
 * @param {string} kind - Memory kind.
 * @returns {'soft' | 'hard'} Default boundary marker.
 */
function defaultBoundaryForKind(kind) {
  return kind === 'event' || kind === 'session' || kind === 'decision' ? 'hard' : 'soft';
}

/**
 * Array filter callback for keeping the first occurrence of each value.
 *
 * @template T
 * @param {T} value - Current value.
 * @param {number} index - Current index.
 * @param {T[]} array - Source array.
 * @returns {boolean} Whether this is the first occurrence.
 */
function isUniqueValue(value, index, array) {
  return array.indexOf(value) === index;
}

module.exports = rememberCommand;
module.exports.defaultMemoryTypeForKind = defaultMemoryTypeForKind;
