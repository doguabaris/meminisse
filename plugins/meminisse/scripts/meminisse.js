#!/usr/bin/env node
/**
 * @file meminisse.js
 * @description Persistent memory CLI for Codex sessions.
 *
 * This script stores and retrieves durable Codex memory records from project-local
 * and user-global JSONL stores. It supports memory initialization, recording,
 * cue-based recall, consolidation, and status reporting.
 *
 * The available commands include:
 * - init: creates project and/or global memory directories.
 * - remember: appends a durable memory record.
 * - recall: searches relevant memories using tags, entities, paths, body text, and recency.
 * - compact: writes a consolidated Markdown summary for fast future retrieval.
 * - status: prints active memory counts.
 *
 * Usage:
 *   meminisse init --scope all
 *   meminisse remember --kind decision "Use npm for this workspace."
 *   meminisse recall "recent decisions"
 *
 * @author      Doğu Abaris <abaris@null.net>
 * @license     MIT
 * @see         README.md for usage and publishing details.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const VERSION = '0.1.1';
const PROJECT_DIR = '.meminisse';
const MEMORY_DIR = 'memory';
const GLOBAL_ROOT = path.join(os.homedir(), '.codex', 'memories', 'meminisse');
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
const RECALL_MODES = new Set(['summary', 'full', 'ids']);
const BOOLEAN_FLAGS = new Set(['allow-secret', 'force', 'json']);
const DEFAULT_RECALL_LIMIT = 8;
const DEFAULT_RECALL_MAX_CHARS = 4000;
const SECRET_PATTERNS = [
  { name: 'private key block', pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: 'AWS access key', pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'GitHub token', pattern: /\bgh[pousr]_[A-Za-z0-9_]{30,}\b/ },
  { name: 'OpenAI API key', pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/ },
  {
    name: 'secret assignment',
    pattern: /\b(api[_-]?key|secret|token|password|passwd|pwd)\b\s*[:=]\s*['"]?[^'"\s]{12,}/i,
  },
];
const STOPWORDS = new Set([
  'the',
  'and',
  'for',
  'with',
  'that',
  'this',
  'from',
  'into',
  'what',
  'when',
  'where',
  'which',
  'about',
  'have',
  'has',
  'had',
  'are',
  'was',
  'were',
  'use',
  'uses',
  'using',
  'used',
  'user',
  'task',
  'work',
  'after',
  'before',
  'start',
  'stop',
  'run',
  'runs',
  'ran',
  'will',
  'would',
  'could',
  'should',
]);

/**
 * Dispatches the CLI command from process arguments.
 *
 * @returns {void}
 */
function main() {
  const args = process.argv.slice(2);
  const command = args.shift();

  try {
    switch (command) {
      case 'init':
        initCommand(args);
        break;
      case 'remember':
        rememberCommand(args);
        break;
      case 'recall':
        recallCommand(args);
        break;
      case 'compact':
      case 'consolidate':
        compactCommand(args);
        break;
      case 'status':
        statusCommand(args);
        break;
      case 'help':
      case '--help':
      case '-h':
      case undefined:
        printHelp();
        break;
      case '--version':
      case '-v':
        console.log(VERSION);
        break;
      default:
        fail(`Unknown command: ${command}`);
    }
  } catch (error) {
    fail(error.message);
  }
}

/**
 * Parses long-form CLI flags and positional arguments.
 *
 * Supports both `--key value` and `--key=value` formats. Boolean flags are
 * represented as `true` when no value follows.
 *
 * @param {string[]} args - The raw command arguments after the command name.
 * @returns {{ opts: Record<string, string | boolean>, rest: string[] }} Parsed options and remaining arguments.
 */
function parseOptions(args) {
  const opts = {};
  const rest = [];

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (!arg.startsWith('--')) {
      rest.push(arg);
      continue;
    }

    const eq = arg.indexOf('=');
    if (eq !== -1) {
      opts[arg.slice(2, eq)] = arg.slice(eq + 1);
      continue;
    }

    const key = arg.slice(2);
    if (BOOLEAN_FLAGS.has(key)) {
      opts[key] = true;
      continue;
    }

    const next = args[i + 1];
    if (next && !next.startsWith('--')) {
      opts[key] = next;
      i += 1;
    } else {
      opts[key] = true;
    }
  }

  return { opts, rest };
}

/**
 * Initializes project and/or global memory storage.
 *
 * @param {string[]} args - CLI arguments for the init command.
 * @returns {void}
 */
function initCommand(args) {
  const { opts } = parseOptions(args);
  const scope = normalizeScope(opts.scope || 'all');

  if (scope === 'project' || scope === 'all') {
    ensureDir(projectMemoryPath());
    ensureProjectProfile();
    ensureProjectIgnoreFiles();
  }

  if (scope === 'global' || scope === 'all') {
    ensureDir(globalMemoryPath());
  }

  console.log(`Meminisse initialized (${scope}).`);
}

/**
 * Appends a durable memory record to the selected scope.
 *
 * @param {string[]} args - CLI arguments for the remember command.
 * @returns {void}
 */
function rememberCommand(args) {
  const { opts, rest } = parseOptions(args);
  const body = normalizeText(rest.join(' '));
  if (!body) {
    fail('Usage: meminisse remember [--kind decision] [--scope project] <text>');
  }

  const secret = detectSecret(body);
  if (secret && !opts['allow-secret']) {
    fail(
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

  const memoryType = normalizeMemoryType(opts.type || defaultMemoryTypeForKind(kind));
  const boundary = normalizeBoundary(opts.boundary || defaultBoundaryForKind(kind));
  const summary = normalizeText(opts.summary || summarize(body));
  const source = normalizeText(opts.source || 'user');
  const confidence = normalizeConfidence(opts.confidence || 'high');
  const status = normalizeStatus(opts.status || 'active');
  const supersedes = splitList(opts.supersedes);
  const now = new Date().toISOString();
  const record = {
    id: makeId('mem', `${scope}:${kind}:${body}:${now}`),
    kind,
    memory_type: memoryType,
    event_id: normalizeText(opts.event || makeId('evt', `${process.cwd()}:${dayStamp(now)}`)),
    boundary,
    summary,
    body,
    tags: splitList(opts.tags).concat(extractTags(body)).filter(isUniqueValue),
    entities: splitList(opts.entities).concat(extractEntities(body)).filter(isUniqueValue),
    paths: splitList(opts.paths).concat(extractPaths(body)).filter(isUniqueValue),
    source,
    confidence,
    status,
    supersedes,
    content_hash: hash,
    project: projectIdentity(),
    created_at: now,
    updated_at: now,
  };

  if (supersedes.length > 0) {
    markSuperseded(root, supersedes, record.id, now);
  }

  writeRecord(root, fileForKind(kind), record);
  refreshIndex(root);
  console.log(`Remembered ${record.id} (${scope}/${kind}).`);
}

/**
 * Searches project and global memory records using cue-based scoring.
 *
 * @param {string[]} args - CLI arguments for the recall command.
 * @returns {void}
 */
function recallCommand(args) {
  const { opts, rest } = parseOptions(args);
  const query = normalizeText(rest.join(' '));
  if (!query) {
    fail('Usage: meminisse recall [--scope all] [--limit 8] <query>');
  }

  const scope = normalizeScope(opts.scope || 'all');
  const limit = toPositiveInt(opts.limit, DEFAULT_RECALL_LIMIT);
  const threshold = toPositiveInt(opts.threshold, 1);
  const mode = normalizeRecallMode(opts.mode || 'summary');
  const maxChars = toPositiveInt(opts['max-chars'], DEFAULT_RECALL_MAX_CHARS);
  const records = readRecordsForScope(scope)
    .filter((record) => record.status === 'active')
    .map((record) => ({ record, score: scoreRecord(record, query) }))
    .filter((item) => item.score >= threshold)
    .sort((a, b) => b.score - a.score || compareDateDesc(a.record, b.record))
    .slice(0, limit);

  if (opts.json) {
    console.log(
      JSON.stringify(
        records.map((item) => ({ score: item.score, ...item.record })),
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
 * Consolidates memories for one or all scopes.
 *
 * @param {string[]} args - CLI arguments for the compact command.
 * @returns {void}
 */
function compactCommand(args) {
  const { opts } = parseOptions(args);
  const scope = normalizeScope(opts.scope || 'project');
  if (scope === 'all') {
    compactOneScope('project');
    compactOneScope('global');
    console.log('Consolidated project and global memories.');
    return;
  }

  compactOneScope(scope);
  console.log(`Consolidated ${scope} memories.`);
}

/**
 * Writes a Markdown summary and refreshed index for a single memory scope.
 *
 * @param {'project' | 'global'} scope - The memory scope to consolidate.
 * @returns {void}
 */
function compactOneScope(scope) {
  const root = scopePath(scope);
  ensureDir(root);
  if (scope === 'project') {
    ensureProjectProfile();
    ensureProjectIgnoreFiles();
  }

  const records = readRecords(root).filter((record) => record.status === 'active');
  const byKind = groupBy(records, (record) => record.kind);
  const lines = [];

  lines.push('# Meminisse Consolidated Memory');
  lines.push('');
  lines.push(`Updated: ${new Date().toISOString()}`);
  lines.push(`Scope: ${scope}`);
  lines.push(`Project: ${projectIdentity()}`);
  lines.push('');

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
}

/**
 * Prints active and total memory counts for one or all scopes.
 *
 * @param {string[]} args - CLI arguments for the status command.
 * @returns {void}
 */
function statusCommand(args) {
  const { opts } = parseOptions(args);
  const scope = normalizeScope(opts.scope || 'all');
  const roots =
    scope === 'all'
      ? [
          ['project', projectMemoryPath()],
          ['global', globalMemoryPath()],
        ]
      : [[scope, scopePath(scope)]];

  for (const [name, root] of roots) {
    const records = readRecords(root);
    const active = records.filter((record) => record.status === 'active').length;
    console.log(`${name}: ${active}/${records.length} active memories at ${root}`);
  }
}

/**
 * Reads memory records from the requested scope.
 *
 * @param {'project' | 'global' | 'all'} scope - The scope to load.
 * @returns {object[]} Memory records from the selected stores.
 */
function readRecordsForScope(scope) {
  if (scope === 'all') {
    return readRecords(projectMemoryPath()).concat(readRecords(globalMemoryPath()));
  }

  return readRecords(scopePath(scope));
}

/**
 * Reads JSONL memory records from a memory root directory.
 *
 * Invalid JSONL rows are converted into low-confidence parse-error records so
 * corrupted data does not break recall.
 *
 * @param {string} root - The memory root directory.
 * @returns {object[]} Parsed memory records.
 */
function readRecords(root) {
  const records = [];
  for (const filename of uniqueArray(Object.values(FILES))) {
    const filePath = path.join(root, filename);
    if (!fs.existsSync(filePath)) {
      continue;
    }

    const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }

      try {
        records.push(JSON.parse(trimmed));
      } catch {
        records.push({
          id: makeId('bad', `${filePath}:${trimmed}`),
          kind: 'note',
          memory_type: 'semantic',
          summary: `Unreadable memory line in ${filePath}`,
          body: trimmed,
          tags: ['parse-error'],
          entities: [],
          paths: [filePath],
          source: 'meminisse',
          confidence: 'low',
          status: 'active',
          created_at: new Date(0).toISOString(),
          updated_at: new Date(0).toISOString(),
        });
      }
    }
  }

  return records;
}

/**
 * Appends a record to a JSONL memory file.
 *
 * @param {string} root - The memory root directory.
 * @param {string} filename - The JSONL filename to append to.
 * @param {object} record - The memory record to persist.
 * @returns {void}
 */
function writeRecord(root, filename, record) {
  ensureDir(root);
  const filePath = path.join(root, filename);
  fs.appendFileSync(filePath, `${JSON.stringify(record)}\n`, 'utf8');
}

/**
 * Marks replaced active records as superseded.
 *
 * @param {string} root - Memory root directory.
 * @param {string[]} ids - Memory record IDs to supersede.
 * @param {string} supersededBy - Replacement memory record ID.
 * @param {string} now - ISO timestamp for the lifecycle update.
 * @returns {number} Number of records updated.
 */
function markSuperseded(root, ids, supersededBy, now) {
  const targets = new Set(ids);
  let updated = 0;

  for (const filename of uniqueArray(Object.values(FILES))) {
    const filePath = path.join(root, filename);
    if (!fs.existsSync(filePath)) {
      continue;
    }

    const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/).filter(Boolean);
    const nextLines = [];

    for (const line of lines) {
      try {
        const record = JSON.parse(line);
        if (targets.has(record.id) && record.status === 'active') {
          updated += 1;
          nextLines.push(
            JSON.stringify({
              ...record,
              status: 'superseded',
              superseded_by: supersededBy,
              updated_at: now,
            }),
          );
          continue;
        }
      } catch {
        nextLines.push(line);
        continue;
      }

      nextLines.push(line);
    }

    fs.writeFileSync(filePath, nextLines.length ? `${nextLines.join('\n')}\n` : '', 'utf8');
  }

  return updated;
}

/**
 * Finds an active duplicate memory in a scope.
 *
 * @param {string} root - Memory root directory.
 * @param {string} kind - Memory kind.
 * @param {string} hash - Normalized content hash.
 * @param {string} body - Raw memory body for older records without hashes.
 * @returns {object | undefined} Existing duplicate record.
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
 * Rebuilds the lightweight index for a memory root.
 *
 * @param {string} root - The memory root directory.
 * @returns {void}
 */
function refreshIndex(root) {
  ensureDir(root);
  const records = readRecords(root);
  const index = {
    updated_at: new Date().toISOString(),
    project: projectIdentity(),
    counts: {},
    tags: Object.fromEntries(countTags(records)),
    records: records.length,
  };

  for (const record of records) {
    index.counts[record.kind] = (index.counts[record.kind] || 0) + 1;
  }

  fs.writeFileSync(path.join(root, 'index.json'), `${JSON.stringify(index, null, 2)}\n`, 'utf8');
}

/**
 * Calculates a relevance score for a memory record and query.
 *
 * @param {object} record - The memory record to score.
 * @param {string} query - The recall query.
 * @returns {number} A positive score for relevant records, or zero for no match.
 */
function scoreRecord(record, query) {
  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) {
    return 0;
  }

  const summaryTokens = tokenize(record.summary || '');
  const bodyTokens = tokenize(record.body || '');
  const tagTokens = (record.tags || []).flatMap(tokenize);
  const entityTokens = (record.entities || []).flatMap(tokenize);
  const pathTokens = (record.paths || []).flatMap(tokenize);
  const haystack = new Set(summaryTokens.concat(bodyTokens, tagTokens, entityTokens, pathTokens));
  let score = 0;

  for (const token of queryTokens) {
    if (haystack.has(token)) score += 2;
    if (tagTokens.includes(token)) score += 3;
    if (entityTokens.includes(token)) score += 2;
    if (pathTokens.includes(token)) score += 2;
    if (summaryTokens.includes(token)) score += 2;
  }

  if (record.status === 'active') score += 1;
  if (record.confidence === 'high') score += 1;
  if (record.kind === 'decision') score += 1;
  score += recencyScore(record.updated_at || record.created_at);
  return score;
}

/**
 * Formats recall results with a strict character budget.
 *
 * @param {{ record: object, score: number }[]} items - Scored recall results.
 * @param {string} query - Original recall query.
 * @param {{ maxChars: number, mode: string }} options - Formatting options.
 * @returns {string} Budgeted terminal output.
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
 * @param {{ record: object, score: number }} item - Scored recall result.
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
 * Calculates a small recency boost for recently updated records.
 *
 * @param {string} dateText - ISO-like date string from the record.
 * @returns {number} Recency score between zero and three.
 */
function recencyScore(dateText) {
  const timestamp = Date.parse(dateText);
  if (Number.isNaN(timestamp)) {
    return 0;
  }

  const days = (Date.now() - timestamp) / 86400000;
  if (days < 2) return 3;
  if (days < 14) return 2;
  if (days < 90) return 1;
  return 0;
}

/**
 * Sorts memory records by most recent update or creation date.
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

/**
 * Converts text into normalized retrieval tokens.
 *
 * @param {string} text - Input text to tokenize.
 * @returns {string[]} Retrieval tokens.
 */
function tokenize(text) {
  return normalizeText(text)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .split(/[^a-z0-9_./-]+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 2 && !STOPWORDS.has(token));
}

/**
 * Extracts low-noise tags from memory body text.
 *
 * @param {string} text - Memory body text.
 * @returns {string[]} Derived tags.
 */
function extractTags(text) {
  const tokens = tokenize(text);
  const tags = [];
  for (const token of tokens) {
    if (token.includes('/') || token.includes('.')) continue;
    tags.push(token);
  }
  return uniqueArray(tags).slice(0, 12);
}

/**
 * Extracts simple capitalized entity candidates from memory body text.
 *
 * @param {string} text - Memory body text.
 * @returns {string[]} Derived entity names.
 */
function extractEntities(text) {
  const matches = normalizeText(text).match(/\b[A-Z][A-Za-z0-9_-]{2,}\b/g) || [];
  return uniqueArray(matches).slice(0, 12);
}

/**
 * Extracts filesystem-like path cues from memory body text.
 *
 * @param {string} text - Memory body text.
 * @returns {string[]} Derived path cues.
 */
function extractPaths(text) {
  const matches =
    normalizeText(text).match(/(?:\.?\.?\/|~\/|\/)?[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)+/g) || [];
  return uniqueArray(matches).slice(0, 12);
}

/**
 * Counts tag usage across memory records.
 *
 * @param {object[]} records - Memory records to inspect.
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
 * Groups a list of items by a derived key.
 *
 * @template T
 * @param {T[]} items - Items to group.
 * @param {(item: T) => string} getter - Function that returns the group key.
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
 * Creates a project profile file if one does not exist.
 *
 * @returns {void}
 */
function ensureProjectProfile() {
  const filePath = path.join(projectMemoryPath(), 'project.json');
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
 * Ensures project-local runtime memory is ignored by common project tools.
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
 * Appends an ignore entry when the file exists or creation is requested.
 *
 * @param {string} filePath - Ignore file path.
 * @param {string} entry - Ignore entry to ensure.
 * @param {boolean} create - Whether to create the ignore file when missing.
 * @returns {boolean} Whether the file was changed.
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
 * Checks whether an ignore file already contains an entry or its slash variant.
 *
 * @param {string} content - Ignore file content.
 * @param {string} entry - Ignore entry to find.
 * @returns {boolean} Whether the entry already exists.
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
 * Returns the current workspace memory path.
 *
 * @returns {string} The project-local memory path.
 */
function projectMemoryPath() {
  return path.join(process.cwd(), PROJECT_DIR, MEMORY_DIR);
}

/**
 * Returns the user-global memory path.
 *
 * @returns {string} The global memory path.
 */
function globalMemoryPath() {
  return path.join(GLOBAL_ROOT, MEMORY_DIR);
}

/**
 * Resolves a writable memory root for a concrete scope.
 *
 * @param {'project' | 'global' | 'all'} scope - The memory scope.
 * @returns {string} The memory root path.
 */
function scopePath(scope) {
  if (scope === 'project') return projectMemoryPath();
  if (scope === 'global') return globalMemoryPath();
  fail(`Unsupported scope for write operation: ${scope}`);
}

/**
 * Returns the display identity for the current workspace.
 *
 * @returns {string} The current workspace name.
 */
function projectIdentity() {
  return path.basename(process.cwd()) || process.cwd();
}

/**
 * Maps a memory kind to the JSONL file that stores it.
 *
 * @param {string} kind - The memory kind.
 * @returns {string} JSONL filename for the kind.
 */
function fileForKind(kind) {
  return FILES[kind] || FILES.note;
}

/**
 * Validates and normalizes a memory kind.
 *
 * @param {string} kind - Raw memory kind.
 * @returns {string} Normalized memory kind.
 */
function normalizeKind(kind) {
  const normalized = normalizeText(kind).toLowerCase();
  if (!KINDS.has(normalized)) {
    fail(`Unsupported kind: ${kind}. Use one of: ${[...KINDS].join(', ')}`);
  }
  return normalized;
}

/**
 * Validates and normalizes a memory scope.
 *
 * @param {string} scope - Raw memory scope.
 * @returns {'project' | 'global' | 'all'} Normalized scope.
 */
function normalizeScope(scope) {
  const normalized = normalizeText(scope).toLowerCase();
  if (!['project', 'global', 'all'].includes(normalized)) {
    fail('Scope must be project, global, or all.');
  }
  return normalized;
}

/**
 * Validates and normalizes a memory type.
 *
 * @param {string} type - Raw memory type.
 * @returns {string} Normalized memory type.
 */
function normalizeMemoryType(type) {
  const normalized = normalizeText(type).toLowerCase();
  if (!MEMORY_TYPES.has(normalized)) {
    fail(`Memory type must be one of: ${[...MEMORY_TYPES].join(', ')}`);
  }
  return normalized;
}

/**
 * Validates and normalizes a boundary marker.
 *
 * @param {string} boundary - Raw boundary value.
 * @returns {'soft' | 'hard'} Normalized boundary.
 */
function normalizeBoundary(boundary) {
  const normalized = normalizeText(boundary).toLowerCase();
  if (!['soft', 'hard'].includes(normalized)) {
    fail('Boundary must be soft or hard.');
  }
  return normalized;
}

/**
 * Validates and normalizes confidence metadata.
 *
 * @param {string} confidence - Raw confidence value.
 * @returns {'low' | 'medium' | 'high'} Normalized confidence value.
 */
function normalizeConfidence(confidence) {
  const normalized = normalizeText(confidence).toLowerCase();
  if (!['low', 'medium', 'high'].includes(normalized)) {
    fail('Confidence must be low, medium, or high.');
  }
  return normalized;
}

/**
 * Validates and normalizes record status metadata.
 *
 * @param {string} status - Raw status value.
 * @returns {'active' | 'superseded' | 'deleted'} Normalized status value.
 */
function normalizeStatus(status) {
  const normalized = normalizeText(status).toLowerCase();
  if (!['active', 'superseded', 'deleted'].includes(normalized)) {
    fail('Status must be active, superseded, or deleted.');
  }
  return normalized;
}

/**
 * Validates and normalizes recall output mode.
 *
 * @param {string} mode - Raw recall output mode.
 * @returns {'summary' | 'full' | 'ids'} Normalized recall output mode.
 */
function normalizeRecallMode(mode) {
  const normalized = normalizeText(mode).toLowerCase();
  if (!RECALL_MODES.has(normalized)) {
    fail('Recall mode must be summary, full, or ids.');
  }
  return normalized;
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
 * Produces a short single-line summary from longer memory text.
 *
 * @param {string} text - Full memory text.
 * @returns {string} Summary text.
 */
function summarize(text) {
  const firstSentence = text.split(/(?<=[.!?])\s+/)[0] || text;
  return firstSentence.length > 160 ? `${firstSentence.slice(0, 157)}...` : firstSentence;
}

/**
 * Detects likely secrets before durable memory is written.
 *
 * @param {string} text - Memory body text.
 * @returns {string | undefined} Matched secret type.
 */
function detectSecret(text) {
  const match = SECRET_PATTERNS.find((pattern) => pattern.pattern.test(text));
  return match && match.name;
}

/**
 * Creates a stable content hash for duplicate detection.
 *
 * @param {string} kind - Memory kind.
 * @param {string} body - Memory body text.
 * @returns {string} SHA-1 content hash.
 */
function contentHash(kind, body) {
  return crypto
    .createHash('sha1')
    .update(`${kind}:${normalizeForHash(body)}`)
    .digest('hex');
}

/**
 * Normalizes text for stable duplicate checks.
 *
 * @param {string} text - Raw text.
 * @returns {string} Normalized text.
 */
function normalizeForHash(text) {
  return normalizeText(text).replace(/\s+/g, ' ').toLowerCase();
}

/**
 * Splits a comma-delimited CLI option into a list.
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

/**
 * Normalizes arbitrary input into trimmed text.
 *
 * @param {unknown} value - Value to stringify and trim.
 * @returns {string} Normalized text.
 */
function normalizeText(value) {
  return String(value || '').trim();
}

/**
 * Parses a positive integer option with fallback.
 *
 * @param {unknown} value - Raw numeric value.
 * @param {number} fallback - Fallback number.
 * @returns {number} Parsed positive integer or fallback.
 */
function toPositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Creates a deterministic short ID with a date prefix.
 *
 * @param {string} prefix - ID namespace prefix.
 * @param {string} value - Value to hash.
 * @returns {string} Generated ID.
 */
function makeId(prefix, value) {
  const hash = crypto.createHash('sha1').update(value).digest('hex').slice(0, 10);
  return `${prefix}_${dayStamp(new Date().toISOString())}_${hash}`;
}

/**
 * Converts an ISO date string to YYYYMMDD.
 *
 * @param {string} isoDate - ISO date string.
 * @returns {string} Date stamp.
 */
function dayStamp(isoDate) {
  return isoDate.slice(0, 10).replace(/-/g, '');
}

/**
 * Capitalizes a display label.
 *
 * @param {string} value - Raw label.
 * @returns {string} Title-cased label.
 */
function titleCase(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/**
 * Returns a de-duplicated copy of an array while preserving order.
 *
 * @template T
 * @param {T[]} values - Values to de-duplicate.
 * @returns {T[]} Unique values.
 */
function uniqueArray(values) {
  return [...new Set(values)];
}

/**
 * Array filter callback for keeping the first occurrence of each value.
 *
 * @template T
 * @param {T} value - Current value.
 * @param {number} index - Current array index.
 * @param {T[]} array - Source array.
 * @returns {boolean} Whether this is the first occurrence.
 */
function isUniqueValue(value, index, array) {
  return array.indexOf(value) === index;
}

/**
 * Ensures a directory exists.
 *
 * @param {string} dirPath - Directory path to create.
 * @returns {void}
 */
function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

/**
 * Prints CLI help text.
 *
 * @returns {void}
 */
function printHelp() {
  console.log(`Meminisse ${VERSION}

Persistent memory for Codex.

Usage:
  meminisse init [--scope project|global|all]
  meminisse remember [--kind decision|fact|procedure|preference|event] [--scope project|global] [--supersedes id] <text>
  meminisse recall [--scope project|global|all] [--limit 8] [--mode summary|full|ids] [--max-chars 4000] [--threshold 1] [--json] <query>
  meminisse compact [--scope project|global|all]
  meminisse status [--scope project|global|all]

Examples:
  meminisse remember --kind decision "Use npm for this project."
  meminisse remember --kind decision --supersedes mem_20260412_abcd123456 "Use Node test runner for integration tests."
  meminisse remember --kind preference --scope global "The user prefers concise Turkish updates."
  meminisse recall --mode ids --max-chars 1200 "package manager and project decisions"
`);
}

/**
 * Prints an error and terminates the process.
 *
 * @param {string} message - Error message to print.
 * @returns {never}
 */
function fail(message) {
  console.error(`meminisse: ${message}`);
  process.exit(1);
}

main();
