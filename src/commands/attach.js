/**
 * @file attach.js
 * @description Copies supporting files into project-local attachment storage.
 *
 * @license MIT
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { MEMORY_SCHEMA_VERSION, TEXT_ATTACHMENT_EXTENSIONS } = require('../constants');
const { parseOptions } = require('../core/options');
const { extractEntities, extractTags } = require('../memory/recall');
const { detectAttachmentSecret } = require('../security/secrets');
const { defaultMemoryTypeForKind } = require('./remember');
const {
  contentHash,
  dayStamp,
  makeId,
  normalizeText,
  uniqueArray,
} = require('../core/utils');
const {
  createAttachmentFolder,
  ensureProjectIgnoreFiles,
  ensureProjectProfile,
  expandHome,
  fileForKind,
  projectIdentity,
  projectMemoryPath,
  relativeToCwd,
  titleFromFilename,
} = require('../system/paths');
const { refreshIndex, writeRecord } = require('../memory/storage');
const { normalizeAttachmentKind, normalizeKind } = require('../core/validators');

/**
 * Copies a supporting file into attachment storage and remembers it.
 *
 * @param {string[]} args - CLI arguments.
 * @returns {void}
 */
function attachCommand(args) {
  const { opts, rest } = parseOptions(args);
  const sourceInput = normalizeText(rest[0]);
  if (!sourceInput) {
    throw new Error('Usage: meminisse attach <file> [--kind reference|evidence|brief|asset|note] [--title text] [--tags a,b] [--move]');
  }

  const sourcePath = expandHome(sourceInput);
  if (!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isFile()) {
    throw new Error(`Attachment source must be an existing file: ${sourceInput}`);
  }

  const secret = detectAttachmentSecret(sourcePath, TEXT_ATTACHMENT_EXTENSIONS);
  if (secret && !opts['allow-secret']) {
    throw new Error(
      `Possible ${secret} detected in attachment. Refusing to store it. Remove the secret or pass --allow-secret if this is intentionally non-sensitive.`,
    );
  }

  const attachmentKind = normalizeAttachmentKind(opts.kind || 'reference');
  const memoryKind = opts['memory-kind'] ? normalizeKind(opts['memory-kind']) : 'fact';
  const tags = splitList(opts.tags);
  const title = normalizeText(opts.title || titleFromFilename(sourcePath));
  const createdAt = new Date().toISOString();
  const folder = createAttachmentFolder(title, createdAt);
  const extension = path.extname(sourcePath);
  const storedPath = path.join(folder, `original${extension || ''}`);
  const notePath = path.join(folder, 'note.md');
  const metadataPath = path.join(folder, 'metadata.json');

  ensureProjectProfile();
  ensureProjectIgnoreFiles();
  fs.copyFileSync(sourcePath, storedPath);

  const metadata = {
    schema_version: MEMORY_SCHEMA_VERSION,
    title,
    kind: attachmentKind,
    tags,
    source_path: sourceInput,
    stored_path: relativeToCwd(storedPath),
    note_path: relativeToCwd(notePath),
    metadata_path: relativeToCwd(metadataPath),
    created_at: createdAt,
  };
  fs.writeFileSync(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');
  fs.writeFileSync(notePath, renderAttachmentNote(metadata, sourcePath), 'utf8');

  if (opts.move) {
    fs.rmSync(sourcePath);
  }

  const record = rememberAttachment(metadata, memoryKind);
  console.log(`Attached ${record.id} (${attachmentKind}).`);
  console.log(`Note: ${metadata.note_path}`);
  console.log(`Stored copy: ${metadata.stored_path}`);
}

/**
 * Writes a memory record for an attachment.
 *
 * @param {object} metadata - Attachment metadata.
 * @param {string} memoryKind - Memory kind to store.
 * @returns {object} Written memory record.
 */
function rememberAttachment(metadata, memoryKind) {
  const root = projectMemoryPath();
  const now = new Date().toISOString();
  const body = [
    `Attached ${metadata.title} as ${metadata.kind}.`,
    `Note: ${metadata.note_path}`,
    `Stored copy: ${metadata.stored_path}`,
  ].join(' ');
  const record = {
    schema_version: MEMORY_SCHEMA_VERSION,
    id: makeId('mem', `project:${memoryKind}:${body}:${now}`),
    kind: memoryKind,
    memory_type: defaultMemoryTypeForKind(memoryKind),
    event_id: makeId('evt', `${process.cwd()}:attachment:${dayStamp(now)}`),
    boundary: 'soft',
    summary: `Attached ${metadata.title} as ${metadata.kind}.`,
    body,
    tags: uniqueArray(metadata.tags.concat(['attachment', metadata.kind], extractTags(body))),
    entities: extractEntities(body),
    paths: uniqueArray([metadata.note_path, metadata.stored_path, metadata.metadata_path]),
    source: 'meminisse attach',
    confidence: 'high',
    status: 'active',
    supersedes: [],
    content_hash: contentHash(memoryKind, body),
    project: projectIdentity(),
    created_at: now,
    updated_at: now,
  };

  writeRecord(root, fileForKind(memoryKind), record);
  refreshIndex(root);
  return record;
}

/**
 * Renders the Markdown note stored beside an attachment.
 *
 * @param {object} metadata - Attachment metadata.
 * @param {string} sourcePath - Original source path.
 * @returns {string} Markdown note.
 */
function renderAttachmentNote(metadata, sourcePath) {
  const lines = [
    `# ${metadata.title}`,
    '',
    `Kind: ${metadata.kind}`,
    `Tags: ${metadata.tags.length ? metadata.tags.join(', ') : 'none'}`,
    `Imported: ${metadata.created_at}`,
    `Source: ${metadata.source_path}`,
    `Stored copy: ${metadata.stored_path}`,
    '',
    '## Notes',
    '',
    'Attached for future Meminisse recall.',
  ];
  const excerpt = readAttachmentExcerpt(sourcePath);
  if (excerpt) {
    lines.push('', '## Excerpt', '', '```text', excerpt, '```');
  }

  return `${lines.join('\n')}\n`;
}

/**
 * Reads a bounded text excerpt from text-like attachments.
 *
 * @param {string} sourcePath - Original source path.
 * @returns {string} Excerpt text or empty string.
 */
function readAttachmentExcerpt(sourcePath) {
  if (!TEXT_ATTACHMENT_EXTENSIONS.has(path.extname(sourcePath).toLowerCase())) {
    return '';
  }

  const content = fs.readFileSync(sourcePath, 'utf8').replace(/\0/g, '');
  return content.length > 2000 ? `${content.slice(0, 2000)}\n...` : content;
}

/**
 * Splits a comma-delimited option value.
 *
 * @param {string | boolean | undefined} value - Raw option value.
 * @returns {string[]} Parsed list.
 */
function splitList(value) {
  if (!value || value === true) return [];
  return String(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

module.exports = attachCommand;
