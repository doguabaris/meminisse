/**
 * @file constants.js
 * @description Shared constants for the Meminisse CLI.
 *
 * @license MIT
 */
'use strict';

const VERSION = '0.5.2';
const MEMORY_SCHEMA_VERSION = 1;
const DEFAULT_ENCRYPTION_KEY_ENV = 'MEMINISSE_ENCRYPTION_KEY';
const ENCRYPTION_CONFIG_FILE = 'encryption.json';
const PROJECT_DIR = '.meminisse';
const MEMORY_DIR = 'memory';
const ATTACHMENTS_DIR = 'attachments';
const PROJECT_IGNORE_ENTRY = `${PROJECT_DIR}/`;
const FILES = {
  event: 'events.jsonl',
  session: 'events.jsonl',
  fact: 'facts.jsonl',
  decision: 'decisions.jsonl',
  procedure: 'procedures.jsonl',
  preference: 'preferences.jsonl',
  note: 'facts.jsonl',
};
const MEMORY_TYPES = new Set(['episodic', 'semantic', 'procedural', 'preference']);
const KINDS = new Set(Object.keys(FILES));
const ATTACHMENT_KINDS = new Set(['reference', 'evidence', 'brief', 'asset', 'note']);
const RECALL_MODES = new Set(['summary', 'full', 'ids']);
const BOOLEAN_FLAGS = new Set([
  'allow-secret',
  'copy',
  'force',
  'json',
  'local',
  'move',
  'prune',
  'strict',
  'verbose',
]);
const DEFAULT_RECALL_LIMIT = 8;
const DEFAULT_LIST_LIMIT = 20;
const DEFAULT_RECALL_MAX_CHARS = 4000;
const TEXT_ATTACHMENT_EXTENSIONS = new Set([
  '.css',
  '.csv',
  '.html',
  '.js',
  '.json',
  '.jsx',
  '.log',
  '.md',
  '.mdx',
  '.mjs',
  '.ts',
  '.tsx',
  '.txt',
  '.xml',
  '.yaml',
  '.yml',
]);

module.exports = {
  ATTACHMENT_KINDS,
  ATTACHMENTS_DIR,
  BOOLEAN_FLAGS,
  DEFAULT_ENCRYPTION_KEY_ENV,
  DEFAULT_LIST_LIMIT,
  DEFAULT_RECALL_LIMIT,
  DEFAULT_RECALL_MAX_CHARS,
  ENCRYPTION_CONFIG_FILE,
  FILES,
  KINDS,
  MEMORY_DIR,
  MEMORY_SCHEMA_VERSION,
  MEMORY_TYPES,
  PROJECT_DIR,
  PROJECT_IGNORE_ENTRY,
  RECALL_MODES,
  TEXT_ATTACHMENT_EXTENSIONS,
  VERSION,
};
