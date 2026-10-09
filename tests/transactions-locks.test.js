/**
 * @file transactions-locks.test.js
 * @description Consistent read-only snapshots and recoverable multi-file commits.
 *
 * @license MIT
 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const { atomicReplaceFiles, atomicWriteFile, withMemoryLock, withMemoryReadLock } = require('../src/system/file-safety');

/**
 * Runs a fixture inside an automatically removed temporary memory root.
 *
 * @param {(root: string) => void} operation - Fixture operation.
 * @returns {void}
 */
function inMemoryRoot(operation) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'meminisse-transaction-test-'));
  try {
    operation(root);
  } finally {
    fs.chmodSync(root, 0o700);
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('read-only snapshots require no lock-file writes', () => {
  inMemoryRoot((root) => {
    fs.writeFileSync(path.join(root, 'facts.jsonl'), 'original');
    fs.chmodSync(root, 0o555);
    const before = fs.readdirSync(root);
    assert.equal(withMemoryReadLock(root, () => fs.readFileSync(path.join(root, 'facts.jsonl'), 'utf8')), 'original');
    assert.deepEqual(fs.readdirSync(root), before);
    const child = spawnSync(process.execPath, ['-e', `
      process.chdir(${JSON.stringify(root)});
      const {readRecords} = require(${JSON.stringify(path.resolve('src/memory/storage.js'))});
      console.log(readRecords(${JSON.stringify(root)}).length);
    `], { encoding: 'utf8' });
    assert.equal(child.status, 0, child.stderr);
  });
});

test('a snapshot overlapping a completed writer retries before returning', () => {
  inMemoryRoot((root) => {
    const filePath = path.join(root, 'facts.jsonl');
    fs.writeFileSync(filePath, 'before');
    let reads = 0;
    const value = withMemoryReadLock(root, () => {
      const content = fs.readFileSync(filePath, 'utf8');
      if (++reads === 1) withMemoryLock(root, () => atomicWriteFile(filePath, 'after'));
      return content;
    });
    assert.equal(value, 'after');
    assert.equal(reads, 2);
  });
});

test('multi-file commit failure restores original data, deletions, and modes', () => {
  inMemoryRoot((root) => {
    const first = path.join(root, 'facts.jsonl');
    const second = path.join(root, 'encryption.json');
    const summary = path.join(root, 'consolidated.md');
    fs.writeFileSync(first, 'old facts', { mode: 0o640 });
    fs.writeFileSync(summary, 'old summary');
    const rename = fs.renameSync;
    let failed = false;
    try {
      fs.renameSync = function(source, target) {
        if (target === second && String(source).endsWith('.new') && !failed) {
          failed = true;
          throw new Error('Injected config commit failure');
        }
        return rename.call(this, source, target);
      };
      assert.throws(() => withMemoryLock(root, () => atomicReplaceFiles([
        { filePath: first, content: 'new facts' },
        { filePath: summary, content: null },
        { filePath: second, content: 'new config' },
      ])), /Injected config commit failure/);
    } finally {
      fs.renameSync = rename;
    }
    assert.equal(fs.readFileSync(first, 'utf8'), 'old facts');
    assert.equal(fs.statSync(first).mode & 0o777, 0o640);
    assert.equal(fs.readFileSync(summary, 'utf8'), 'old summary');
    assert.equal(fs.existsSync(second), false);
    assert.equal(fs.readdirSync(root).some((name) => name.startsWith('.transaction-') || name === '.write-transaction.json'), false);
  });
});

test('an interrupted prepared transaction is recovered before readers see its data', () => {
  inMemoryRoot((root) => {
    const directory = '.transaction-12345678-1234-1234-1234-123456789abc';
    const staging = path.join(root, directory);
    fs.mkdirSync(staging);
    fs.writeFileSync(path.join(root, 'facts.jsonl'), 'partially committed facts');
    fs.writeFileSync(path.join(staging, '0.old'), 'original facts');
    fs.writeFileSync(path.join(root, '.write-transaction.json'), JSON.stringify({
      directory, prepared: true, committed: false,
      entries: [{ name: 'facts.jsonl', existed: true, mode: 0o600 }],
    }));
    const content = withMemoryReadLock(root, () => fs.readFileSync(path.join(root, 'facts.jsonl'), 'utf8'));
    assert.equal(content, 'original facts');
    assert.equal(fs.existsSync(staging), false);
    assert.equal(fs.existsSync(path.join(root, '.write-transaction.json')), false);
  });
});

test('interrupted preparation is discarded without requiring incomplete backups', () => {
  inMemoryRoot((root) => {
    const directory = '.transaction-12345678-1234-1234-1234-123456789abc';
    const staging = path.join(root, directory);
    fs.mkdirSync(staging);
    fs.writeFileSync(path.join(root, 'facts.jsonl'), 'original facts');
    fs.writeFileSync(path.join(root, '.write-transaction.json'), JSON.stringify({
      directory, prepared: false, committed: false,
      entries: [{ name: 'facts.jsonl', existed: true, mode: 0o600 }],
    }));
    withMemoryLock(root, () => {});
    assert.equal(fs.readFileSync(path.join(root, 'facts.jsonl'), 'utf8'), 'original facts');
    assert.equal(fs.existsSync(staging), false);
  });
});

test('failed committed cleanup keeps a journal until plaintext backups are removed', () => {
  inMemoryRoot((root) => {
    const filePath = path.join(root, 'facts.jsonl');
    fs.writeFileSync(filePath, 'original facts');
    const remove = fs.rmSync;
    try {
      fs.rmSync = function(target, options) {
        if (path.basename(String(target)).startsWith('.transaction-')) throw new Error('Injected cleanup failure');
        return remove.call(this, target, options);
      };
      assert.throws(() => withMemoryLock(root, () => atomicReplaceFiles([
        { filePath, content: 'committed facts' },
      ])), /cleanup failure/);
      assert.equal(fs.existsSync(path.join(root, '.write-transaction.json')), true);
    } finally {
      fs.rmSync = remove;
    }
    withMemoryLock(root, () => {});
    assert.equal(fs.readFileSync(filePath, 'utf8'), 'committed facts');
    assert.equal(fs.readdirSync(root).some((name) => name.startsWith('.transaction-') || name === '.write-transaction.json'), false);
  });
});

test('revision publication failure retains the lock rather than exposing a mixed snapshot', () => {
  inMemoryRoot((root) => {
    const filePath = path.join(root, 'facts.jsonl');
    fs.writeFileSync(filePath, 'old facts');
    const rename = fs.renameSync;
    try {
      fs.renameSync = function(source, target) {
        if (path.basename(String(target)) === '.write-revision') throw new Error('Injected revision failure');
        return rename.call(this, source, target);
      };
      assert.throws(() => withMemoryLock(root, () => atomicWriteFile(filePath, 'new facts')), /store lock retained/);
    } finally {
      fs.renameSync = rename;
    }
    assert.equal(fs.existsSync(path.join(root, '.write.lock')), true);
    assert.throws(() => withMemoryReadLock(root, () => assert.fail('No snapshot may be returned'), 0), /Memory store is locked/);
  });
});
