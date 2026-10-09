/**
 * @file file-safety.test.js
 * @description Failure recovery checks for storage locks and atomic writes.
 *
 * @license MIT
 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { atomicWriteFile, withMemoryLock } = require('../src/system/file-safety');

test('storage locks release on failure, permit nesting, and leave foreign locks intact', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'meminisse-lock-'));
  const lockPath = path.join(root, '.write.lock');

  try {
    assert.throws(() => withMemoryLock(root, () => { throw new Error('Operation failed'); }), /Operation failed/);
    assert.equal(fs.existsSync(lockPath), false);
    assert.equal(withMemoryLock(root, () => withMemoryLock(root, () => 42)), 42);
    assert.equal(fs.existsSync(lockPath), false);

    fs.writeFileSync(lockPath, 'foreign lock');
    assert.throws(() => withMemoryLock(root, () => assert.fail('Must not run'), 0), /Memory store is locked/);
    assert.equal(fs.readFileSync(lockPath, 'utf8'), 'foreign lock');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('failed atomic replacement preserves the original file and cleans temporary data', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'meminisse-atomic-'));
  const filePath = path.join(root, 'facts.jsonl');
  const rename = fs.renameSync;

  try {
    fs.writeFileSync(filePath, 'original content');
    fs.renameSync = () => { throw new Error('Injected rename failure'); };
    assert.throws(() => atomicWriteFile(filePath, 'replacement content'), /Injected rename failure/);
    assert.equal(fs.readFileSync(filePath, 'utf8'), 'original content');
    assert.deepEqual(fs.readdirSync(root), ['facts.jsonl']);
  } finally {
    fs.renameSync = rename;
    fs.rmSync(root, { recursive: true, force: true });
  }
});
