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
const { assertNoSecrets, detectAttachmentSecret } = require('../security/secrets');
const { readEncryptionConfig, requireEncryptionKey } = require('../security/encryption');
const { atomicWriteFile, withMemoryLock } = require('../system/file-safety');
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
  relativeToProjectRoot,
  titleFromFilename,
} = require('../system/paths');
const { readRecords, refreshIndex, writeRecord } = require('../memory/storage');
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

  const allowSecret = opts['allow-secret'] === true || opts['allow-secret'] === 'true';
  assertAttachmentSafe(sourcePath, allowSecret);

  const attachmentKind = normalizeAttachmentKind(opts.kind || 'reference');
  const memoryKind = opts['memory-kind'] ? normalizeKind(opts['memory-kind']) : 'fact';
  const tags = splitList(opts.tags);
  const title = normalizeText(opts.title || titleFromFilename(sourcePath));
  assertNoSecrets([title, tags], allowSecret);
  assertNoSecrets(sourceInput, allowSecret, { pathValues: true });
  const root = projectMemoryPath();
  return withMemoryLock(root, () => {
    const encryption = readEncryptionConfig(root);
    if (encryption) requireEncryptionKey(encryption.key_env);
    // Authenticate existing encrypted records before changing attachment files.
    readRecords(root);
    ensureProjectProfile();
    ensureProjectIgnoreFiles();

    const snapshots = [fileForKind(memoryKind), 'index.json'].map((filename) => {
      const filePath = path.join(root, filename);
      return {
        filePath,
        content: fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : undefined,
      };
    });
    const createdAt = new Date().toISOString();
    const folder = createAttachmentFolder(title, createdAt);
    const extension = path.extname(sourcePath);
    const storedPath = path.join(folder, `original${extension || ''}`);
    const notePath = path.join(folder, 'note.md');
    const metadataPath = path.join(folder, 'metadata.json');
    const metadata = {
      schema_version: MEMORY_SCHEMA_VERSION,
      title,
      kind: attachmentKind,
      tags,
      source_path: sourceInput,
      stored_path: relativeToProjectRoot(storedPath),
      note_path: relativeToProjectRoot(notePath),
      metadata_path: relativeToProjectRoot(metadataPath),
      created_at: createdAt,
    };
    let record;
    let persistenceStarted = false;
    try {
      fs.copyFileSync(sourcePath, storedPath, fs.constants.COPYFILE_EXCL);
      // Scan the exact copied bytes too, in case the source changed during copy.
      assertAttachmentSafe(storedPath, allowSecret);
      atomicWriteFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`);
      atomicWriteFile(notePath, renderAttachmentNote(metadata, storedPath));
      record = createAttachmentRecord(metadata, memoryKind);
      persistenceStarted = true;
      writeRecord(root, fileForKind(memoryKind), record);
      refreshIndex(root);
    } catch (error) {
      if (persistenceStarted) {
        try {
          restoreMemoryFiles(snapshots);
        } catch (rollbackError) {
          // Keep supporting files if a record may still reference them.
          throw new Error(
            `Attachment failed and memory rollback failed: ${rollbackError.message}. Supporting files remain in ${relativeToProjectRoot(folder)}.`,
            { cause: error },
          );
        }
      }
      fs.rmSync(folder, { recursive: true, force: true });
      throw error;
    }

    // A failed persistence step must leave the original source in place.
    if (opts.move) fs.rmSync(sourcePath);
    console.log(`Attached ${record.id} (${attachmentKind}).`);
    console.log(`Note: ${metadata.note_path}`);
    console.log(`Stored copy: ${metadata.stored_path}`);
  });
}

/**
 * Builds a memory record for an attachment.
 *
 * @param {object} metadata - Attachment metadata.
 * @param {string} memoryKind - Memory kind to store.
 * @returns {object} Memory record ready to persist.
 */
function createAttachmentRecord(metadata, memoryKind) {
  const now = new Date().toISOString();
  const body = [
    `Attached ${metadata.title} as ${metadata.kind}.`,
    `Note: ${metadata.note_path}`,
    `Stored copy: ${metadata.stored_path}`,
  ].join(' ');
  return {
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
}

/**
 * Restores attachment-related memory files while the memory lock is held.
 *
 * @param {{ filePath: string, content?: string }[]} snapshots - Previous files.
 * @returns {void}
 */
function restoreMemoryFiles(snapshots) {
  for (const { filePath, content } of snapshots) {
    if (content === undefined) {
      fs.rmSync(filePath, { force: true });
    } else if (!fs.existsSync(filePath) || fs.readFileSync(filePath, 'utf8') !== content) {
      atomicWriteFile(filePath, content);
    }
  }
}

/**
 * Checks source or copied attachment bytes without exposing possible secrets.
 *
 * @param {string} filePath - Attachment path to inspect.
 * @param {boolean} allowSecret - Whether intentional test data is permitted.
 * @returns {void}
 */
function assertAttachmentSafe(filePath, allowSecret) {
  if (allowSecret) return;
  const secret = detectAttachmentSecret(filePath, TEXT_ATTACHMENT_EXTENSIONS);
  if (secret) {
    throw new Error(
      `Possible ${secret} detected in attachment. Refusing to store it. Remove the secret or pass --allow-secret if this is intentionally non-sensitive.`,
    );
  }
}

/**
 * Renders the Markdown note stored beside an attachment.
 *
 * @param {object} metadata - Attachment metadata.
 * @param {string} sourcePath - Stored attachment path used for the excerpt.
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
