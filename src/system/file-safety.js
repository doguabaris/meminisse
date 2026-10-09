/**
 * @file file-safety.js
 * @description Process-safe memory locks, consistent reads, and atomic writes.
 *
 * @license MIT
 */
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const heldLocks = new Set();
const waitBuffer = new Int32Array(new SharedArrayBuffer(4));
const TRANSACTION_FILE = '.write-transaction.json';
const REVISION_FILE = '.write-revision';

/**
 * Waits for a lock owner or a changing snapshot, with a bounded deadline.
 *
 * @param {string} lockPath - Lock file path.
 * @param {number} deadline - Latest time at which to wait.
 * @returns {void}
 */
function waitForStore(lockPath, deadline) {
  if (Date.now() >= deadline) {
    throw new Error(
      `Memory store is locked: ${lockPath}. Retry when other Meminisse commands finish. If a command crashed, remove this lock only after confirming no process is using the store.`,
    );
  }
  Atomics.wait(waitBuffer, 0, 0, 25);
}

/**
 * Serializes synchronous mutations on a memory root across CLI processes.
 * Nested operations reuse the lock. Pending transactions are recovered before
 * new operations begin; a revision token lets readers detect overlapping writes.
 *
 * @template T
 * @param {string} root - Memory root directory.
 * @param {() => T} operation - Synchronous operation to run under the lock.
 * @param {number} [timeoutMs=10000] - Maximum time to wait for another process.
 * @returns {T} Operation result.
 */
function withMemoryLock(root, operation, timeoutMs = 10000) {
  fs.mkdirSync(root, { recursive: true });
  root = fs.realpathSync(root);
  const lockPath = path.join(root, '.write.lock');
  if (heldLocks.has(lockPath)) return operation();

  const deadline = Date.now() + timeoutMs;
  let descriptor;
  while (descriptor === undefined) {
    try {
      descriptor = fs.openSync(lockPath, 'wx', 0o600);
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      waitForStore(lockPath, deadline);
    }
  }

  heldLocks.add(lockPath);
  let result;
  let operationError;
  try {
    fs.writeFileSync(descriptor, `${JSON.stringify({ pid: process.pid })}\n`, 'utf8');
    recoverTransaction(root);
    result = operation();
  } catch (error) {
    operationError = error;
  }

  let revisionError;
  try {
    // Publish before releasing the lock, including after partial failures.
    atomicWriteFile(path.join(root, REVISION_FILE), crypto.randomUUID());
  } catch (error) {
    revisionError = new Error(
      `Cannot publish memory revision; store lock retained at ${lockPath}: ${error.message}`,
      { cause: error },
    );
  }

  let closeError;
  try {
    fs.closeSync(descriptor);
  } catch (error) {
    closeError = error;
  }
  heldLocks.delete(lockPath);

  // Without a new revision, unlocking could expose a mixed read snapshot.
  if (!revisionError && !closeError) {
    try {
      fs.unlinkSync(lockPath);
    } catch (error) {
      closeError = error;
    }
  }

  if (revisionError) throw revisionError;
  if (closeError) {
    throw new Error(`Cannot release memory store lock at ${lockPath}: ${closeError.message}`, {
      cause: closeError,
    });
  }
  if (operationError) throw operationError;
  return result;
}

/**
 * Reads a consistent snapshot without creating files or requiring write access.
 * A snapshot overlapping a writer is discarded and retried. Callbacks must have
 * no persistent side effects. An interrupted transaction requires recovery.
 *
 * @template T
 * @param {string} root - Existing memory root directory.
 * @param {() => T} operation - Synchronous, read-only operation.
 * @param {number} [timeoutMs=10000] - Maximum time to wait for a stable snapshot.
 * @returns {T} Operation result.
 */
function withMemoryReadLock(root, operation, timeoutMs = 10000) {
  if (!fs.existsSync(root)) return operation();
  root = fs.realpathSync(root);
  const lockPath = path.join(root, '.write.lock');
  if (heldLocks.has(lockPath)) return operation();
  const revisionPath = path.join(root, REVISION_FILE);
  const deadline = Date.now() + timeoutMs;

  while (true) {
    if (fs.existsSync(lockPath)) {
      waitForStore(lockPath, deadline);
      continue;
    }
    if (fs.existsSync(path.join(root, TRANSACTION_FILE))) {
      return withMemoryLock(root, operation, Math.max(0, deadline - Date.now()));
    }
    const before = readRevision(revisionPath);
    let result;
    let failure;
    try {
      result = operation();
    } catch (error) {
      failure = error;
    }
    if (!fs.existsSync(lockPath) && before === readRevision(revisionPath) &&
        !fs.existsSync(path.join(root, TRANSACTION_FILE))) {
      if (failure) throw failure;
      return result;
    }
    waitForStore(lockPath, deadline);
  }
}

/**
 * Reads the revision token, treating an untouched store as the initial revision.
 *
 * @param {string} revisionPath - Revision file path.
 * @returns {string} Revision token.
 */
function readRevision(revisionPath) {
  try {
    return fs.readFileSync(revisionPath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return '';
    throw error;
  }
}

/**
 * Replaces a file with a complete, flushed sibling file using atomic rename.
 * The caller holds the memory lock when updating shared memory state.
 *
 * @param {string} filePath - Destination file path.
 * @param {string | Buffer} content - Content to write.
 * @returns {void}
 */
function atomicWriteFile(filePath, content) {
  const temporaryPath = `${filePath}.${process.pid}.${crypto.randomBytes(8).toString('hex')}.tmp`;
  let descriptor;
  try {
    descriptor = fs.openSync(temporaryPath, 'wx', 0o600);
    fs.writeFileSync(descriptor, content, 'utf8');
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    fs.renameSync(temporaryPath, filePath);
  } finally {
    try {
      if (descriptor !== undefined) fs.closeSync(descriptor);
    } finally {
      fs.rmSync(temporaryPath, { force: true });
    }
  }
}

/**
 * Stages a group of files in the same directory and commits them with a recovery
 * journal. Failed commits restore original bytes and permissions; interruptions
 * roll back on the next lock acquisition. The caller holds the memory lock.
 *
 * @param {{ filePath: string, content: string | null }[]} changes - File replacements/deletions.
 * @returns {void}
 */
function atomicReplaceFiles(changes) {
  if (changes.length === 0) return;
  const root = path.dirname(path.resolve(changes[0].filePath));
  if (changes.some((change) => path.dirname(path.resolve(change.filePath)) !== root)) {
    throw new Error('A memory transaction must update files in one directory.');
  }
  if (new Set(changes.map((change) => path.basename(change.filePath))).size !== changes.length) {
    throw new Error('A memory transaction cannot update the same file twice.');
  }
  const directory = `.transaction-${crypto.randomUUID()}`;
  const stagingRoot = path.join(root, directory);
  const journalPath = path.join(root, TRANSACTION_FILE);
  if (fs.existsSync(journalPath)) throw new Error('An interrupted memory transaction requires recovery.');
  fs.mkdirSync(stagingRoot, { mode: 0o700 });
  let journalPublished = false;
  try {
    const entries = changes.map((change) => {
      const name = path.basename(change.filePath);
      const filePath = path.join(root, name);
      const existed = fs.existsSync(filePath);
      const mode = existed ? fs.statSync(filePath).mode & 0o777 : 0o600;
      return { name, existed, mode };
    });
    // Record ownership before staging so interrupted preparation is recoverable.
    atomicWriteFile(journalPath, JSON.stringify({ directory, entries, prepared: false, committed: false }));
    journalPublished = true;
    for (const [index, change] of changes.entries()) {
      if (entries[index].existed) {
        atomicWriteFile(path.join(stagingRoot, `${index}.old`), fs.readFileSync(change.filePath));
      }
      if (change.content !== null) atomicWriteFile(path.join(stagingRoot, `${index}.new`), change.content);
    }
    atomicWriteFile(journalPath, JSON.stringify({ directory, entries, prepared: true, committed: false }));
    for (const [index, change] of changes.entries()) {
      const filePath = path.join(root, entries[index].name);
      if (change.content === null) fs.rmSync(filePath, { force: true });
      else fs.renameSync(path.join(stagingRoot, `${index}.new`), filePath);
    }
    atomicWriteFile(journalPath, JSON.stringify({ directory, entries, prepared: true, committed: true }));
    recoverTransaction(root);
  } catch (error) {
    if (journalPublished) {
      try {
        recoverTransaction(root);
      } catch (recoveryError) {
        throw new Error(`Memory transaction failed: ${error.message}. Recovery pending: ${recoveryError.message}`);
      }
    } else {
      fs.rmSync(stagingRoot, { recursive: true, force: true });
    }
    throw error;
  }
}

/**
 * Restores an interrupted transaction or removes backups of a committed one.
 * Backup copies remain until all originals are restored, allowing safe retries.
 *
 * @param {string} root - Memory root directory under the writer lock.
 * @returns {void}
 */
function recoverTransaction(root) {
  const journalPath = path.join(root, TRANSACTION_FILE);
  if (!fs.existsSync(journalPath)) return;
  const journal = JSON.parse(fs.readFileSync(journalPath, 'utf8'));
  if (!/^\.transaction-[a-f0-9-]+$/.test(journal.directory) || !Array.isArray(journal.entries)) {
    throw new Error(`Invalid memory transaction journal: ${journalPath}`);
  }
  const stagingRoot = path.join(root, journal.directory);
  if (journal.prepared && !journal.committed) {
    for (const [index, entry] of journal.entries.entries()) {
      if (!entry.name || path.basename(entry.name) !== entry.name || ['.', '..'].includes(entry.name)) {
        throw new Error(`Invalid transaction destination: ${journalPath}`);
      }
      const filePath = path.join(root, entry.name);
      if (entry.existed) {
        atomicWriteFile(filePath, fs.readFileSync(path.join(stagingRoot, `${index}.old`)));
        fs.chmodSync(filePath, entry.mode);
      } else {
        fs.rmSync(filePath, { force: true });
      }
    }
    // After restoration, later cleanup must no longer depend on backup copies.
    atomicWriteFile(journalPath, JSON.stringify({ ...journal, committed: true }));
  }
  // Once rollback has succeeded, cleanup is idempotent even if interrupted.
  fs.rmSync(stagingRoot, { recursive: true, force: true });
  fs.rmSync(journalPath, { force: true });
}

module.exports = { atomicReplaceFiles, atomicWriteFile, withMemoryLock, withMemoryReadLock };
