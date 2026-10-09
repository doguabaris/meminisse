/**
 * @file attachments-security.test.js
 * @description Attachment transaction and secret guard integration regressions.
 *
 * @license MIT
 */
'use strict';

const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { detectSecret } = require('../src/security/secrets');

const repoRoot = path.resolve(__dirname, '..');
const cliPath = path.join(repoRoot, 'bin', 'meminisse.js');
const fakeKey = 'attachment-test-key-never-use-123456';

function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'meminisse-attachment-test-')));
  const home = path.join(root, 'home');
  fs.mkdirSync(home);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, env: { ...process.env, HOME: home, MEMINISSE_ENCRYPTION_KEY: '' } };
}

function runCli(context, args, extraEnv = {}) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd: context.root,
    env: { ...context.env, ...extraEnv },
    encoding: 'utf8',
  });
}

function succeeds(result) {
  assert.equal(result.status, 0, result.stderr);
  return result;
}

function filesWithin(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const filePath = path.join(directory, entry.name);
    return entry.isDirectory() ? filesWithin(filePath) : [filePath];
  });
}

test('explicit false does not move sources or replace an existing installation', (t) => {
  const context = fixture(t);
  const source = path.join(context.root, 'source.txt');
  fs.writeFileSync(source, 'Safe original.');
  succeeds(runCli(context, ['attach', source, '--move=false']));
  assert.equal(fs.readFileSync(source, 'utf8'), 'Safe original.');

  succeeds(runCli(context, ['install', '--local']));
  const custom = path.join(context.env.HOME, '.codex', 'plugins', 'meminisse', 'custom.txt');
  fs.writeFileSync(custom, 'Preserve this installation file.');
  succeeds(runCli(context, ['install', '--local', '--force=false']));
  assert.equal(fs.readFileSync(custom, 'utf8'), 'Preserve this installation file.');
});

test('missing or wrong encryption keys leave attachment sources and memory untouched', (t) => {
  const context = fixture(t);
  const encryptedEnv = { MEMINISSE_ENCRYPTION_KEY: fakeKey };
  succeeds(runCli(context, ['encryption', 'enable', '--scope', 'project'], encryptedEnv));
  const source = path.join(context.root, 'source.txt');
  fs.writeFileSync(source, 'Safe encrypted attachment source.');
  const missing = runCli(context, ['attach', source, '--move']);
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /Encryption requires/);
  assert.ok(fs.existsSync(source));
  assert.deepEqual(filesWithin(path.join(context.root, '.meminisse', 'attachments')), []);

  succeeds(runCli(context, ['remember', '--kind', 'fact', 'Original encrypted memory.'], encryptedEnv));
  const facts = path.join(context.root, '.meminisse', 'memory', 'facts.jsonl');
  const previous = fs.readFileSync(facts, 'utf8');
  const wrong = runCli(context, ['attach', source, '--move'], {
    MEMINISSE_ENCRYPTION_KEY: 'wrong-test-key-never-use-654321',
  });
  assert.notEqual(wrong.status, 0);
  assert.ok(fs.existsSync(source));
  assert.equal(fs.readFileSync(facts, 'utf8'), previous);
  assert.deepEqual(filesWithin(path.join(context.root, '.meminisse', 'attachments')), []);
  const records = JSON.parse(succeeds(runCli(context, ['list', '--scope', 'project', '--json'], encryptedEnv)).stdout);
  assert.equal(records.length, 1);
});

test('index failure rolls back the record and staged files before moving the source', (t) => {
  const context = fixture(t);
  succeeds(runCli(context, ['remember', '--kind', 'fact', 'Existing memory survives attachment failure.']));
  const memoryRoot = path.join(context.root, '.meminisse', 'memory');
  const snapshots = ['facts.jsonl', 'index.json'].map((name) => [name, fs.readFileSync(path.join(memoryRoot, name), 'utf8')]);
  const source = path.join(context.root, 'source.txt');
  fs.writeFileSync(source, 'Safe source remains after rollback.');
  const code = `
    const fs = require('node:fs');
    const rename = fs.renameSync;
    fs.renameSync = function(from, to) {
      if (to === ${JSON.stringify(path.join(memoryRoot, 'index.json'))}) throw new Error('Injected index failure');
      return rename.apply(this, arguments);
    };
    process.argv = [process.execPath, ${JSON.stringify(cliPath)}, 'attach', ${JSON.stringify(source)}, '--move'];
    require(${JSON.stringify(cliPath)});
  `;
  const result = spawnSync(process.execPath, ['-e', code], {
    cwd: context.root,
    env: context.env,
    encoding: 'utf8',
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Injected index failure/);
  assert.ok(fs.existsSync(source));
  for (const [name, previous] of snapshots) {
    assert.equal(fs.readFileSync(path.join(memoryRoot, name), 'utf8'), previous);
  }
  assert.deepEqual(filesWithin(path.join(context.root, '.meminisse', 'attachments')), []);
});

test('concurrent same-title moves preserve every original in distinct attachment folders', async (t) => {
  const context = fixture(t);
  const inputs = Array.from({ length: 8 }, (_, index) => `Safe distinct original number ${index}.`);
  const results = await Promise.all(inputs.map((content, index) => {
    const source = path.join(context.root, `source-${index}.txt`);
    fs.writeFileSync(source, content);
    const child = spawn(process.execPath, [cliPath, 'attach', source, '--title', 'Same title', '--move'], {
      cwd: context.root,
      env: context.env,
    });
    let stderr = '';
    child.stderr.on('data', (data) => { stderr += data; });
    return new Promise((resolve, reject) => {
      child.on('error', reject);
      child.on('close', (status) => resolve({ status, stderr, source }));
    });
  }));
  for (const result of results) {
    assert.equal(result.status, 0, result.stderr);
    assert.equal(fs.existsSync(result.source), false);
  }
  const records = JSON.parse(succeeds(runCli(context, ['list', '--scope', 'project', '--json'])).stdout);
  const originals = records.map((record) => record.paths.find((recordPath) => recordPath.endsWith('/original.txt')));
  assert.equal(records.length, inputs.length);
  assert.equal(new Set(originals).size, inputs.length);
  assert.deepEqual(
    originals.map((recordPath) => fs.readFileSync(path.join(context.root, recordPath), 'utf8')).sort(),
    inputs.sort(),
  );
});

test('attachments created in a project subdirectory use canonical project-relative paths', (t) => {
  const context = fixture(t);
  fs.mkdirSync(path.join(context.root, '.git'));
  const nested = path.join(context.root, 'src');
  fs.mkdirSync(nested);
  succeeds(runCli(context, ['init', '--scope', 'project']));
  fs.writeFileSync(path.join(nested, 'source.md'), 'Supporting nested project attachment.');
  const attached = spawnSync(process.execPath, [cliPath, 'attach', 'source.md', '--title', 'NestedAttachmentMarker'], {
    cwd: nested,
    env: context.env,
    encoding: 'utf8',
  });
  succeeds(attached);
  const records = JSON.parse(succeeds(runCli(context, ['recall', '--scope', 'project', '--json', 'NestedAttachmentMarker'])).stdout);
  assert.equal(records.length, 1);
  for (const recordPath of records[0].paths) {
    assert.match(recordPath, /^\.meminisse\/attachments\//);
    assert.ok(fs.existsSync(path.join(context.root, recordPath)));
  }
  const metadataPath = records[0].paths.find((recordPath) => recordPath.endsWith('/metadata.json'));
  const metadata = JSON.parse(fs.readFileSync(path.join(context.root, metadataPath), 'utf8'));
  for (const recordPath of [metadata.stored_path, metadata.note_path, metadata.metadata_path]) {
    assert.match(recordPath, /^\.meminisse\/attachments\//);
  }
  const reviewed = JSON.parse(succeeds(runCli(context, ['review', '--scope', 'project', '--json'])).stdout);
  assert.deepEqual(reviewed.broken_paths, []);
  assert.equal(fs.existsSync(path.join(nested, '.meminisse')), false);
});

test('quoted credential properties and text attachments of unfamiliar extensions are rejected', (t) => {
  const context = fixture(t);
  for (const text of [
    '{"password":"abcdefghijklmnop"}',
    '{"api_key":"abcdefghijklm123456"}',
    "'database_url': 'postgresql://fixture-host/database'",
  ]) {
    assert.ok(detectSecret(text));
    const result = runCli(context, ['remember', text]);
    assert.notEqual(result.status, 0);
  }
  const privateKey = '-----BEGIN PRIVATE KEY-----\nFAKE TEST FIXTURE ONLY\n-----END PRIVATE KEY-----\n';
  for (const filename of ['fixture.pem', 'fixture.key', 'fixture.ini', 'id_rsa', 'fixture.dat']) {
    const source = path.join(context.root, filename);
    fs.writeFileSync(source, privateKey);
    const result = runCli(context, ['attach', source, '--move']);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Possible private key block detected/);
    assert.ok(fs.existsSync(source));
  }
  const json = path.join(context.root, 'credentials.json');
  fs.writeFileSync(json, '{"password":"abcdefghijklmnop"}');
  const result = runCli(context, ['attach', json]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Possible secret assignment detected/);
  assert.deepEqual(filesWithin(path.join(context.root, '.meminisse', 'attachments')), []);
});

test('binary attachments remain supported and the explicit secret override still works', (t) => {
  const context = fixture(t);
  const image = path.join(context.root, 'fixture.png');
  const bytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 255, 0, 8]);
  fs.writeFileSync(image, bytes);
  const attached = succeeds(runCli(context, ['attach', image]));
  const stored = attached.stdout.match(/Stored copy: (.*)/)[1];
  assert.deepEqual(fs.readFileSync(path.join(context.root, stored)), bytes);
  const key = path.join(context.root, 'fixture.pem');
  fs.writeFileSync(key, '-----BEGIN PRIVATE KEY-----\nFAKE TEST FIXTURE ONLY\n-----END PRIVATE KEY-----');
  succeeds(runCli(context, ['attach', key, '--allow-secret=true']));
});
