/**
 * @file encryption-storage.test.js
 * @description Encryption migration rollback, key checks, and bounded key derivation.
 *
 * @license MIT
 */
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  enableEncryptionForScope,
  encryptionStatusForScope,
  readRecords,
  refreshIndex,
  writeRecord,
} = require('../src/memory/storage');
const {
  parseStoredRecord,
  serializeStoredRecord,
  withEncryptionSession,
} = require('../src/security/encryption');

const KEY_ENV = 'MEMINISSE_STORAGE_TEST_KEY';
const OTHER_KEY_ENV = 'MEMINISSE_STORAGE_OTHER_KEY';
const GOOD_KEY = 'synthetic-storage-original-key';
const WRONG_KEY = 'synthetic-storage-different-key';
const MEMORY_FILES = [
  'events.jsonl', 'facts.jsonl', 'decisions.jsonl', 'procedures.jsonl',
  'preferences.jsonl', 'encryption.json', 'index.json', 'consolidated.md',
];

/**
 * Runs a test in a temporary workspace with isolated key variables.
 *
 * @param {(root: string) => void} operation - Test operation.
 * @returns {void}
 */
function inWorkspace(operation) {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'meminisse-encryption-storage-'));
  const root = path.join(workspace, '.meminisse', 'memory');
  const originalCwd = process.cwd();
  const originalKey = process.env[KEY_ENV];
  const originalOtherKey = process.env[OTHER_KEY_ENV];
  fs.mkdirSync(root, { recursive: true });
  process.env[KEY_ENV] = GOOD_KEY;
  process.env[OTHER_KEY_ENV] = WRONG_KEY;
  process.chdir(workspace);
  try {
    operation(root);
  } finally {
    process.chdir(originalCwd);
    if (originalKey === undefined) delete process.env[KEY_ENV];
    else process.env[KEY_ENV] = originalKey;
    if (originalOtherKey === undefined) delete process.env[OTHER_KEY_ENV];
    else process.env[OTHER_KEY_ENV] = originalOtherKey;
    fs.rmSync(workspace, { recursive: true, force: true });
  }
}

/**
 * Captures primary data, encryption state, indexes, summaries, and file modes.
 *
 * @param {string} root - Memory root.
 * @returns {object} Snapshot of user data.
 */
function snapshot(root) {
  return Object.fromEntries(MEMORY_FILES.map((filename) => {
    const filePath = path.join(root, filename);
    return [filename, fs.existsSync(filePath) ? {
      content: fs.readFileSync(filePath, 'utf8'),
      mode: fs.statSync(filePath).mode & 0o777,
    } : null];
  }));
}

/**
 * Creates a synthetic durable record.
 *
 * @param {string} id - Record ID.
 * @param {string} [kind='fact'] - Memory kind.
 * @returns {object} Memory record.
 */
function record(id, kind = 'fact') {
  return {
    schema_version: 1,
    id,
    kind,
    body: `Synthetic private memory ${id}`,
    summary: `Synthetic private summary ${id}`,
    tags: ['private-synthetic-tag'],
    status: 'active',
  };
}

test('changing key-env is rejected without changing encrypted data or configuration', () => {
  inWorkspace((root) => {
    writeRecord(root, 'facts.jsonl', record('original'));
    enableEncryptionForScope('project', KEY_ENV);
    const before = snapshot(root);
    assert.throws(
      () => enableEncryptionForScope('project', OTHER_KEY_ENV),
      /Changing the encryption key environment is not supported/,
    );
    assert.deepEqual(snapshot(root), before);
    assert.equal(readRecords(root)[0].id, 'original');
  });
});

test('malformed migration input preserves every original file and disabled encryption state', () => {
  inWorkspace((root) => {
    writeRecord(root, 'events.jsonl', record('event-original', 'event'));
    writeRecord(root, 'facts.jsonl', record('fact-original'));
    refreshIndex(root);
    fs.writeFileSync(path.join(root, 'consolidated.md'), 'Original private summary\n');
    fs.appendFileSync(path.join(root, 'facts.jsonl'), 'malformed trailing row\n');
    const before = snapshot(root);
    assert.throws(() => enableEncryptionForScope('project', KEY_ENV), /JSON/);
    assert.deepEqual(snapshot(root), before);
    assert.equal(encryptionStatusForScope('project')[0].enabled, false);
  });
});

test('migration failure rolls back data, configuration, index, summary, and modes', () => {
  inWorkspace((root) => {
    writeRecord(root, 'events.jsonl', record('event-original', 'event'));
    writeRecord(root, 'facts.jsonl', record('fact-original'));
    refreshIndex(root);
    fs.writeFileSync(path.join(root, 'consolidated.md'), 'Original private summary\n');
    fs.chmodSync(path.join(root, 'facts.jsonl'), 0o640);
    const before = snapshot(root);
    const rename = fs.renameSync;
    const indexPath = path.join(fs.realpathSync(root), 'index.json');
    let failed = false;
    try {
      fs.renameSync = (source, destination, ...args) => {
        if (!failed && destination === indexPath) {
          failed = true;
          throw new Error('Injected migration publication failure');
        }
        return rename.call(fs, source, destination, ...args);
      };
      assert.throws(() => enableEncryptionForScope('project', KEY_ENV), /Injected migration/);
    } finally {
      fs.renameSync = rename;
    }
    assert.equal(failed, true);
    assert.deepEqual(snapshot(root), before);
    assert.equal(encryptionStatusForScope('project')[0].enabled, false);
    assert.equal(readRecords(root).length, 2);
  });
});

test('wrong-key appends and re-enables preserve current and legacy encrypted stores', () => {
  inWorkspace((root) => {
    writeRecord(root, 'facts.jsonl', record('original'));
    enableEncryptionForScope('project', KEY_ENV);
    for (const legacy of [false, true]) {
      if (legacy) {
        const configPath = path.join(root, 'encryption.json');
        const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        delete config.key_check;
        fs.writeFileSync(configPath, `${JSON.stringify(config)}\n`);
      }
      const before = snapshot(root);
      process.env[KEY_ENV] = WRONG_KEY;
      assert.throws(() => writeRecord(root, 'facts.jsonl', record('wrong-key')), /authenticate/);
      assert.throws(() => enableEncryptionForScope('project', KEY_ENV), /authenticate/);
      assert.deepEqual(snapshot(root), before);
      process.env[KEY_ENV] = GOOD_KEY;
      assert.equal(readRecords(root)[0].id, 'original');
    }
  });
});

test('key verification protects an enabled empty store before its first append', () => {
  inWorkspace((root) => {
    enableEncryptionForScope('project', KEY_ENV);
    const before = snapshot(root);
    process.env[KEY_ENV] = WRONG_KEY;
    assert.throws(() => writeRecord(root, 'facts.jsonl', record('wrong-first-key')), /authenticate/);
    assert.deepEqual(snapshot(root), before);
    process.env[KEY_ENV] = GOOD_KEY;
    writeRecord(root, 'facts.jsonl', record('first-correct-key'));
    assert.equal(readRecords(root)[0].id, 'first-correct-key');
  });
});

test('encrypted bulk reads derive one key per operation regardless of record count', () => {
  inWorkspace((root) => {
    const records = Array.from({ length: 40 }, (_, index) => record(`bulk-${index}`));
    fs.writeFileSync(path.join(root, 'facts.jsonl'), `${records.map(JSON.stringify).join('\n')}\n`);
    const scrypt = crypto.scryptSync;
    let derivations = 0;
    try {
      crypto.scryptSync = (...args) => {
        derivations += 1;
        return scrypt.call(crypto, ...args);
      };
      enableEncryptionForScope('project', KEY_ENV);
      assert.equal(derivations, 1, 'migration should derive one key');
      derivations = 0;
      assert.equal(readRecords(root).length, 40);
      assert.equal(derivations, 1, 'one bulk read should derive one key');
      assert.equal(readRecords(root).length, 40);
      assert.equal(derivations, 2, 'the next operation should derive its own key');
      writeRecord(root, 'facts.jsonl', record('appended'));
      assert.equal(derivations, 3, 'verification and append share one key');
    } finally {
      crypto.scryptSync = scrypt;
    }
  });
});

test('session caching notices an environment key change and never survives the operation', () => {
  inWorkspace((root) => {
    enableEncryptionForScope('project', KEY_ENV);
    const scrypt = crypto.scryptSync;
    let derivations = 0;
    try {
      crypto.scryptSync = (...args) => {
        derivations += 1;
        return scrypt.call(crypto, ...args);
      };
      withEncryptionSession(() => {
        const original = serializeStoredRecord(root, record('correct'));
        process.env[KEY_ENV] = WRONG_KEY;
        const wrong = serializeStoredRecord(root, record('wrong'));
        process.env[KEY_ENV] = GOOD_KEY;
        assert.equal(parseStoredRecord(root, original, (value) => value).id, 'correct');
        assert.throws(() => parseStoredRecord(root, wrong, (value) => value), /authenticate/);
      });
      assert.equal(derivations, 2);
      withEncryptionSession(() => serializeStoredRecord(root, record('next-operation')));
      assert.equal(derivations, 3);
    } finally {
      crypto.scryptSync = scrypt;
    }
  });
});
