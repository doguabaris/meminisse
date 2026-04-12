/**
 * @file paths.js
 * @description Workspace, global, install, and attachment path helpers.
 *
 * @license MIT
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  ATTACHMENTS_DIR,
  FILES,
  MEMORY_DIR,
  PROJECT_DIR,
  PROJECT_IGNORE_ENTRY,
} = require('../constants');
const { homePath } = require('./platform');
const { dayStamp, normalizeText, uniqueArray } = require('../core/utils');

const GLOBAL_ROOT = homePath('.codex', 'memories', 'meminisse');
const CODEX_PLUGIN_TARGET = homePath('.codex', 'plugins', 'meminisse');
const CODEX_SKILL_TARGET = homePath('.codex', 'skills', 'meminisse');
const MARKETPLACE_PATH = homePath('.agents', 'plugins', 'marketplace.json');

/**
 * Returns the current workspace memory path.
 *
 * @returns {string} Project memory path.
 */
function projectMemoryPath() {
  return path.join(process.cwd(), PROJECT_DIR, MEMORY_DIR);
}

/**
 * Returns the user-global memory path.
 *
 * @returns {string} Global memory path.
 */
function globalMemoryPath() {
  return path.join(GLOBAL_ROOT, MEMORY_DIR);
}

/**
 * Returns the project-local attachment root.
 *
 * @returns {string} Attachment root path.
 */
function projectAttachmentsPath() {
  return path.join(process.cwd(), PROJECT_DIR, ATTACHMENTS_DIR);
}

/**
 * Resolves a concrete memory scope to its root path.
 *
 * @param {'project' | 'global'} scope - Concrete memory scope.
 * @returns {string} Memory root path.
 */
function scopePath(scope) {
  if (scope === 'project') return projectMemoryPath();
  if (scope === 'global') return globalMemoryPath();
  throw new Error(`Unsupported scope for write operation: ${scope}`);
}

/**
 * Runs a callback for each concrete scope selected by a scope option.
 *
 * @template T
 * @param {'project' | 'global' | 'all'} scope - Requested scope.
 * @param {(name: 'project' | 'global', root: string) => T} callback - Scope callback.
 * @returns {T[]} Callback results.
 */
function forEachConcreteScope(scope, callback) {
  const scopes =
    scope === 'all'
      ? [
          ['project', projectMemoryPath()],
          ['global', globalMemoryPath()],
        ]
      : [[scope, scopePath(scope)]];

  return scopes.map(([name, root]) => callback(name, root));
}

/**
 * Returns the display identity for the current workspace.
 *
 * @returns {string} Project identity.
 */
function projectIdentity() {
  return path.basename(process.cwd()) || process.cwd();
}

/**
 * Maps a memory kind to its JSONL file.
 *
 * @param {string} kind - Memory kind.
 * @returns {string} JSONL filename.
 */
function fileForKind(kind) {
  return FILES[kind] || FILES.note;
}

/**
 * Ensures a directory exists.
 *
 * @param {string} dirPath - Directory path.
 * @returns {void}
 */
function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

/**
 * Creates the project profile file when missing.
 *
 * @returns {void}
 */
function ensureProjectProfile() {
  const memoryPath = projectMemoryPath();
  ensureDir(memoryPath);
  const filePath = path.join(memoryPath, 'project.json');
  if (fs.existsSync(filePath)) {
    return;
  }

  const profile = {
    project: projectIdentity(),
    root: process.cwd(),
    created_at: new Date().toISOString(),
  };
  fs.writeFileSync(filePath, `${JSON.stringify(profile, null, 2)}\n`, 'utf8');
}

/**
 * Ensures runtime memory is ignored by common project tools.
 *
 * @returns {void}
 */
function ensureProjectIgnoreFiles() {
  ensureIgnoreEntry(path.join(process.cwd(), '.gitignore'), PROJECT_IGNORE_ENTRY, true);
  ensureIgnoreEntry(path.join(process.cwd(), '.npmignore'), PROJECT_IGNORE_ENTRY, false);
  ensureIgnoreEntry(path.join(process.cwd(), '.dockerignore'), PROJECT_DIR, false);
  ensureIgnoreEntry(path.join(process.cwd(), '.remarkignore'), PROJECT_IGNORE_ENTRY, false);
}

/**
 * Appends an ignore entry when needed.
 *
 * @param {string} filePath - Ignore file path.
 * @param {string} entry - Entry to ensure.
 * @param {boolean} create - Whether to create a missing ignore file.
 * @returns {boolean} Whether the file changed.
 */
function ensureIgnoreEntry(filePath, entry, create) {
  if (!fs.existsSync(filePath) && !create) {
    return false;
  }

  const content = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
  if (hasIgnoreEntry(content, entry)) {
    return false;
  }

  const separator = content && !content.endsWith('\n') ? '\n' : '';
  fs.writeFileSync(filePath, `${content}${separator}${entry}\n`, 'utf8');
  return true;
}

/**
 * Checks whether an ignore file already contains an entry.
 *
 * @param {string} content - Ignore file content.
 * @param {string} entry - Entry to find.
 * @returns {boolean} Whether the entry exists.
 */
function hasIgnoreEntry(content, entry) {
  const normalizedEntry = entry.replace(/\/$/, '');
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .some((line) => line.replace(/\/$/, '') === normalizedEntry);
}

/**
 * Expands a leading home shortcut in a path.
 *
 * @param {string} filePath - Raw file path.
 * @returns {string} Expanded path.
 */
function expandHome(filePath) {
  if (filePath === '~') {
    return os.homedir();
  }

  if (filePath.startsWith('~/')) {
    return path.join(os.homedir(), filePath.slice(2));
  }

  return filePath;
}

/**
 * Converts a path to project-relative display form when possible.
 *
 * @param {string} filePath - Absolute or relative path.
 * @returns {string} Display path.
 */
function relativeToCwd(filePath) {
  const relative = path.relative(process.cwd(), filePath);
  return relative.startsWith('..') ? filePath : relative;
}

/**
 * Resolves a memory path to a filesystem path.
 *
 * @param {string} recordPath - Path stored in memory.
 * @returns {string} Filesystem path.
 */
function resolveMemoryPath(recordPath) {
  const expanded = expandHome(recordPath);
  return path.isAbsolute(expanded) ? expanded : path.join(process.cwd(), expanded);
}

/**
 * Checks whether a memory path should be validated locally.
 *
 * @param {string} recordPath - Path stored in memory.
 * @returns {boolean} Whether the path should be checked.
 */
function shouldCheckPath(recordPath) {
  return (
    recordPath.startsWith('/') ||
    recordPath.startsWith('./') ||
    recordPath.startsWith('../') ||
    recordPath.startsWith('~/') ||
    recordPath.startsWith(`${PROJECT_DIR}/`)
  );
}

/**
 * Creates a unique attachment folder for a title and date.
 *
 * @param {string} title - Attachment title.
 * @param {string} createdAt - ISO creation timestamp.
 * @returns {string} Attachment folder path.
 */
function createAttachmentFolder(title, createdAt) {
  const dateParts = createdAt.slice(0, 10).split('-');
  const base = path.join(projectAttachmentsPath(), dateParts[0], dateParts[1], slugify(title));
  let candidate = base;
  let suffix = 2;

  while (fs.existsSync(candidate)) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }

  ensureDir(candidate);
  return candidate;
}

/**
 * Creates a readable title from a filename.
 *
 * @param {string} filePath - Source path.
 * @returns {string} Human-readable title.
 */
function titleFromFilename(filePath) {
  return path
    .basename(filePath, path.extname(filePath))
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Creates a safe filesystem slug.
 *
 * @param {string} value - Raw slug input.
 * @returns {string} Safe slug.
 */
function slugify(value) {
  const slug = normalizeText(value)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || `attachment-${dayStamp(new Date().toISOString())}`;
}

/**
 * Reads a file or returns an empty string when missing.
 *
 * @param {string} filePath - File path.
 * @returns {string} File content or empty string.
 */
function readFileIfExists(filePath) {
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
}

/**
 * Returns unique primary memory JSONL filenames.
 *
 * @returns {string[]} Memory filenames.
 */
function uniqueMemoryFiles() {
  return uniqueArray(Object.values(FILES));
}

module.exports = {
  CODEX_PLUGIN_TARGET,
  CODEX_SKILL_TARGET,
  GLOBAL_ROOT,
  MARKETPLACE_PATH,
  createAttachmentFolder,
  ensureDir,
  ensureExists(filePath) {
    if (!fs.existsSync(filePath)) {
      throw new Error(`Missing required path: ${filePath}`);
    }
  },
  ensureProjectIgnoreFiles,
  ensureProjectProfile,
  expandHome,
  fileForKind,
  forEachConcreteScope,
  globalMemoryPath,
  hasIgnoreEntry,
  projectAttachmentsPath,
  projectIdentity,
  projectMemoryPath,
  readFileIfExists,
  relativeToCwd,
  resolveMemoryPath,
  scopePath,
  shouldCheckPath,
  titleFromFilename,
  uniqueMemoryFiles,
};
