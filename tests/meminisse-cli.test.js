/**
 * @file meminisse-cli.test.js
 * @description Integration tests for the Meminisse CLI and personal installer.
 *
 * These tests run the real scripts in isolated temporary workspaces and HOME
 * directories. They verify the behavior users depend on instead of only checking
 * that commands start successfully.
 *
 * @author      Doğu Abaris <abaris@null.net>
 * @license     MIT
 */
'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const repoRoot = process.cwd();
const packageVersion = JSON.parse(
  fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'),
).version;
const cliPath = path.join(repoRoot, 'bin', 'meminisse.js');

/**
 * Creates an isolated temporary directory for a test.
 *
 * @param {string} label - Human-readable directory label.
 * @returns {string} Temporary directory path.
 */
function makeTempDir(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `meminisse-${label}-`));
}

/**
 * Runs a Node script and fails with useful output when it exits non-zero.
 *
 * @param {string} scriptPath - Script to execute with Node.
 * @param {string[]} args - Script arguments.
 * @param {{ cwd?: string, home?: string, env?: Record<string, string> }} options - Execution options.
 * @returns {import('node:child_process').SpawnSyncReturns<string>} Completed process result.
 */
function runNode(scriptPath, args, options = {}) {
  const result = runNodeRaw(scriptPath, args, options);

  assert.equal(
    result.status,
    0,
    [
      `Command failed: node ${scriptPath} ${args.join(' ')}`,
      `stdout:\n${result.stdout}`,
      `stderr:\n${result.stderr}`,
    ].join('\n'),
  );

  return result;
}

/**
 * Runs a Node script without asserting on the exit status.
 *
 * @param {string} scriptPath - Script to execute with Node.
 * @param {string[]} args - Script arguments.
 * @param {{ cwd?: string, home?: string, env?: Record<string, string> }} options - Execution options.
 * @returns {import('node:child_process').SpawnSyncReturns<string>} Completed process result.
 */
function runNodeRaw(scriptPath, args, options = {}) {
  return spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: options.cwd || repoRoot,
    env: {
      ...process.env,
      HOME: options.home || process.env.HOME,
      ...(options.env || {}),
    },
    encoding: 'utf8',
  });
}

/**
 * Runs the Meminisse CLI.
 *
 * @param {string[]} args - CLI arguments.
 * @param {{ cwd?: string, home?: string, env?: Record<string, string> }} options - Execution options.
 * @returns {import('node:child_process').SpawnSyncReturns<string>} Completed process result.
 */
function runCli(args, options = {}) {
  return runNode(cliPath, args, options);
}

/**
 * Runs the Meminisse CLI without asserting on the exit status.
 *
 * @param {string[]} args - CLI arguments.
 * @param {{ cwd?: string, home?: string, env?: Record<string, string> }} options - Execution options.
 * @returns {import('node:child_process').SpawnSyncReturns<string>} Completed process result.
 */
function runCliRaw(args, options = {}) {
  return runNodeRaw(cliPath, args, options);
}

test('CLI initializes, stores, recalls, consolidates, and reports memory', () => {
  const workspace = makeTempDir('workspace-');
  const home = makeTempDir('home-');

  try {
    fs.writeFileSync(path.join(workspace, '.dockerignore'), 'node_modules\n', 'utf8');
    fs.writeFileSync(path.join(workspace, '.npmignore'), 'node_modules\n', 'utf8');
    fs.writeFileSync(path.join(workspace, '.remarkignore'), 'node_modules/\n', 'utf8');

    runCli(['init', '--scope', 'all'], { cwd: workspace, home });
    runCli(['init', '--scope', 'project'], { cwd: workspace, home });

    runCli(
      [
        'remember',
        '--kind',
        'decision',
        '--tags',
        'smoke,recall',
        'Use Meminisse test storage for functional verification.',
      ],
      { cwd: workspace, home },
    );
    runCli(
      [
        'remember',
        '--kind',
        'procedure',
        '--tags',
        'smoke,workflow',
        'Run init, remember, recall, compact, and status to verify behavior.',
      ],
      { cwd: workspace, home },
    );
    runCli(
      [
        'remember',
        '--kind',
        'preference',
        '--scope',
        'global',
        '--tags',
        'smoke,global',
        'Prefer isolated smoke tests for product verification.',
      ],
      { cwd: workspace, home },
    );

    const recall = runCli(
      ['recall', '--json', '--limit', '5', 'smoke functional verification recall workflow'],
      { cwd: workspace, home },
    );
    const records = JSON.parse(recall.stdout);
    const kinds = records.map((record) => record.kind);

    assert.ok(records.length >= 3);
    assert.ok(kinds.includes('decision'));
    assert.ok(kinds.includes('procedure'));
    assert.ok(kinds.includes('preference'));

    runCli(['compact', '--scope', 'all'], { cwd: workspace, home });
    const status = runCli(['status'], { cwd: workspace, home });
    const decisionRecords = fs
      .readFileSync(path.join(workspace, '.meminisse', 'memory', 'decisions.jsonl'), 'utf8')
      .trim()
      .split(/\r?\n/)
      .map((line) => JSON.parse(line));
    const index = JSON.parse(
      fs.readFileSync(path.join(workspace, '.meminisse', 'memory', 'index.json'), 'utf8'),
    );

    assert.match(status.stdout, /project: 2\/2 active memories/);
    assert.match(status.stdout, /global: 1\/1 active memories/);
    assert.equal(decisionRecords[0].schema_version, 1);
    assert.equal(index.schema_version, 1);
    assert.ok(fs.existsSync(path.join(workspace, '.meminisse', 'memory', 'decisions.jsonl')));
    assert.ok(fs.existsSync(path.join(workspace, '.meminisse', 'memory', 'procedures.jsonl')));
    assert.ok(fs.existsSync(path.join(workspace, '.meminisse', 'memory', 'consolidated.md')));
    assert.equal(countIgnoreEntry(path.join(workspace, '.gitignore'), '.meminisse'), 1);
    assert.equal(countIgnoreEntry(path.join(workspace, '.dockerignore'), '.meminisse'), 1);
    assert.equal(countIgnoreEntry(path.join(workspace, '.npmignore'), '.meminisse'), 1);
    assert.equal(countIgnoreEntry(path.join(workspace, '.remarkignore'), '.meminisse'), 1);
    assert.ok(
      fs.existsSync(
        path.join(home, '.codex', 'memories', 'meminisse', 'memory', 'preferences.jsonl'),
      ),
    );
    assert.ok(
      fs.existsSync(
        path.join(home, '.codex', 'memories', 'meminisse', 'memory', 'consolidated.md'),
      ),
    );
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  }
});

/**
 * Counts normalized ignore entries in a file.
 *
 * @param {string} filePath - Ignore file path.
 * @param {string} entry - Entry to count.
 * @returns {number} Number of matching entries.
 */
function countIgnoreEntry(filePath, entry) {
  return fs
    .readFileSync(filePath, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/\/$/, ''))
    .filter((line) => line === entry).length;
}

test('CLI install --local writes plugin, skill, and marketplace into an isolated HOME', () => {
  const workspace = makeTempDir('install-local-workspace-');
  const home = makeTempDir('install-local-home-');

  try {
    runCli(['install', '--local', '--force'], { cwd: workspace, home });

    const pluginTarget = path.join(home, '.codex', 'plugins', 'meminisse');
    const skillTarget = path.join(home, '.codex', 'skills', 'meminisse');
    const marketplacePath = path.join(home, '.agents', 'plugins', 'marketplace.json');

    fs.mkdirSync(pluginTarget, { recursive: true });
    fs.writeFileSync(path.join(pluginTarget, 'STALE.md'), 'stale file\n', 'utf8');
    runCli(['install', '--local', '--force'], { cwd: workspace, home });

    assert.ok(fs.existsSync(path.join(pluginTarget, '.codex-plugin', 'plugin.json')));
    assert.ok(fs.existsSync(path.join(pluginTarget, 'bin', 'meminisse.js')));
    assert.ok(fs.existsSync(path.join(pluginTarget, 'src', 'cli.js')));
    assert.ok(fs.existsSync(path.join(pluginTarget, 'skills', 'meminisse', 'SKILL.md')));
    assert.ok(fs.existsSync(path.join(skillTarget, 'SKILL.md')));
    assert.equal(fs.existsSync(path.join(pluginTarget, 'STALE.md')), false);
    assert.equal(fs.existsSync(path.join(pluginTarget, 'tests')), false);
    assert.equal(fs.existsSync(path.join(pluginTarget, 'benchmarks')), false);

    const marketplace = JSON.parse(fs.readFileSync(marketplacePath, 'utf8'));
    const entry = marketplace.plugins.find((plugin) => plugin.name === 'meminisse');

    assert.equal(marketplace.name, 'local');
    assert.equal(marketplace.interface.displayName, 'Local Plugins');
    assert.equal(entry.source.source, 'local');
    assert.equal(entry.source.path, './.codex/plugins/meminisse');
    assert.equal(entry.policy.installation, 'INSTALLED_BY_DEFAULT');
    assert.equal(entry.policy.authentication, 'ON_USE');

    const installedCli = path.join(pluginTarget, 'bin', 'meminisse.js');
    const version = runNode(installedCli, ['--version'], { home });
    assert.equal(version.stdout.trim(), packageVersion);
    assert.equal(fs.existsSync(path.join(pluginTarget, 'scripts', 'install-home.js')), false);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('CLI install --local installs home plugin and doctor reports healthy paths', () => {
  const workspace = makeTempDir('doctor-workspace-');
  const home = makeTempDir('doctor-home-');

  try {
    runCli(['install', '--local', '--force'], { cwd: workspace, home });
    runCli(['init', '--scope', 'all'], { cwd: workspace, home });

    const pluginTarget = path.join(home, '.codex', 'plugins', 'meminisse');
    const skillTarget = path.join(home, '.codex', 'skills', 'meminisse');
    const doctor = runCli(['doctor', '--json'], { cwd: workspace, home });
    const checks = JSON.parse(doctor.stdout);
    const byName = new Map(checks.map((check) => [check.name, check]));

    assert.ok(fs.existsSync(path.join(pluginTarget, '.codex-plugin', 'plugin.json')));
    assert.ok(fs.existsSync(path.join(skillTarget, 'SKILL.md')));
    assert.equal(byName.get('CLI version').detail, packageVersion);
    assert.equal(byName.get('installed plugin version').status, 'ok');
    assert.equal(byName.get('installed skill').status, 'ok');
    assert.equal(byName.get('marketplace entry').status, 'ok');
    assert.equal(byName.get('project memory').status, 'ok');
    assert.equal(byName.get('.meminisse gitignore entry').status, 'ok');
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('remember blocks likely secrets before writing durable memory', () => {
  const workspace = makeTempDir('secret-workspace-');
  const home = makeTempDir('secret-home-');
  const envFile = path.join(workspace, '.env.test');

  try {
    runCli(['init', '--scope', 'all'], { cwd: workspace, home });
    fs.writeFileSync(envFile, 'DATABASE_URL=postgres://user:pass@example.test/db\n', 'utf8');

    const result = runCliRaw(
      ['remember', '--kind', 'fact', 'api_key=sk-test12345678901234567890'],
      { cwd: workspace, home },
    );
    const attachment = runCliRaw(['attach', envFile, '--kind', 'evidence'], {
      cwd: workspace,
      home,
    });
    const entropy = runCliRaw(
      ['remember', '--kind', 'fact', 'opaque=AbCdEfGhIjKlMnOpQrStUvWxYz123456+/=='],
      { cwd: workspace, home },
    );

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Possible .* detected/);
    assert.notEqual(attachment.status, 0);
    assert.match(attachment.stderr, /Possible dotenv file detected/);
    assert.notEqual(entropy.status, 0);
    assert.match(entropy.stderr, /Possible high-entropy token detected/);
    assert.equal(fs.existsSync(path.join(workspace, '.meminisse', 'memory', 'facts.jsonl')), false);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('remember skips duplicate active memories unless forced', () => {
  const workspace = makeTempDir('duplicate-workspace-');
  const home = makeTempDir('duplicate-home-');

  try {
    runCli(['init', '--scope', 'all'], { cwd: workspace, home });
    const text = 'Use duplicate guard to avoid repeated long-term memory records.';

    runCli(['remember', '--kind', 'decision', text], { cwd: workspace, home });
    const duplicate = runCli(['remember', '--kind', 'decision', text], { cwd: workspace, home });
    const status = runCli(['status', '--scope', 'project'], { cwd: workspace, home });

    assert.match(duplicate.stdout, /Duplicate memory exists/);
    assert.match(status.stdout, /project: 1\/1 active memories/);

    runCli(['remember', '--kind', 'decision', '--force', text], { cwd: workspace, home });
    const forcedStatus = runCli(['status', '--scope', 'project'], { cwd: workspace, home });
    assert.match(forcedStatus.stdout, /project: 2\/2 active memories/);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('remember supersedes older records and recall ignores superseded memories', () => {
  const workspace = makeTempDir('supersedes-workspace-');
  const home = makeTempDir('supersedes-home-');

  try {
    runCli(['init', '--scope', 'all'], { cwd: workspace, home });
    const original = runCli(['remember', '--kind', 'decision', 'Use Mocha for Meminisse tests.'], {
      cwd: workspace,
      home,
    });
    const originalId = original.stdout.match(/Remembered (mem_[a-f0-9_]+)/)[1];

    const replacement = runCli(
      [
        'remember',
        '--kind',
        'decision',
        '--supersedes',
        originalId,
        'Use the Node built-in test runner for Meminisse integration tests.',
      ],
      { cwd: workspace, home },
    );
    const replacementId = replacement.stdout.match(/Remembered (mem_[a-f0-9_]+)/)[1];
    const status = runCli(['status', '--scope', 'project'], { cwd: workspace, home });
    const recall = runCli(['recall', '--json', 'Mocha Node test runner'], { cwd: workspace, home });
    const records = JSON.parse(recall.stdout);
    const decisions = fs
      .readFileSync(path.join(workspace, '.meminisse', 'memory', 'decisions.jsonl'), 'utf8')
      .trim()
      .split(/\r?\n/)
      .map((line) => JSON.parse(line));
    const oldRecord = decisions.find((record) => record.id === originalId);

    assert.match(status.stdout, /project: 1\/2 active memories/);
    assert.equal(oldRecord.status, 'superseded');
    assert.equal(oldRecord.superseded_by, replacementId);
    assert.equal(
      records.some((record) => record.id === originalId),
      false,
    );
    assert.equal(
      records.some((record) => record.id === replacementId),
      true,
    );
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('list inspects memories and forget soft-deletes active records', () => {
  const workspace = makeTempDir('forget-workspace-');
  const home = makeTempDir('forget-home-');

  try {
    runCli(['init', '--scope', 'all'], { cwd: workspace, home });
    const remembered = runCli(
      [
        'remember',
        '--kind',
        'fact',
        '--tags',
        'forget-marker',
        'ForgetMarker records can be inspected and retired by id.',
      ],
      { cwd: workspace, home },
    );
    const id = remembered.stdout.match(/Remembered (mem_[a-f0-9_]+)/)[1];

    const activeList = runCli(['list', '--scope', 'project'], { cwd: workspace, home });
    const jsonList = runCli(['list', '--scope', 'project', '--json'], { cwd: workspace, home });
    const listedRecords = JSON.parse(jsonList.stdout);

    assert.match(activeList.stdout, new RegExp(id));
    assert.equal(listedRecords[0].scope, 'project');
    assert.equal(listedRecords[0].id, id);

    const forgotten = runCli(
      ['forget', '--scope', 'project', '--reason', 'Retired during lifecycle test.', id],
      { cwd: workspace, home },
    );
    const status = runCli(['status', '--scope', 'project'], { cwd: workspace, home });
    const recall = runCli(['recall', 'ForgetMarker'], { cwd: workspace, home });
    const deletedList = runCli(
      ['list', '--scope', 'project', '--status', 'deleted', '--kind', 'fact'],
      { cwd: workspace, home },
    );
    const defaultList = runCli(['list', '--scope', 'project'], { cwd: workspace, home });
    const records = fs
      .readFileSync(path.join(workspace, '.meminisse', 'memory', 'facts.jsonl'), 'utf8')
      .trim()
      .split(/\r?\n/)
      .map((line) => JSON.parse(line));
    const deletedRecord = records.find((record) => record.id === id);

    assert.match(forgotten.stdout, /Forgot 1 memory/);
    assert.match(status.stdout, /project: 0\/1 active memories/);
    assert.match(recall.stdout, /No relevant memories found/);
    assert.match(deletedList.stdout, new RegExp(id));
    assert.match(defaultList.stdout, /No memories found/);
    assert.equal(deletedRecord.status, 'deleted');
    assert.equal(deletedRecord.deleted_reason, 'Retired during lifecycle test.');

    const compacted = runCli(['compact', '--scope', 'project', '--prune'], {
      cwd: workspace,
      home,
    });
    const prunedStatus = runCli(['status', '--scope', 'project'], { cwd: workspace, home });
    const archiveRoot = path.join(workspace, '.meminisse', 'memory', 'archive');
    const archiveDir = path.join(archiveRoot, fs.readdirSync(archiveRoot)[0]);
    const archivedFacts = fs
      .readFileSync(path.join(archiveDir, 'facts.jsonl'), 'utf8')
      .trim()
      .split(/\r?\n/)
      .map((line) => JSON.parse(line));

    assert.match(compacted.stdout, /Pruned 1 inactive project records/);
    assert.match(prunedStatus.stdout, /project: 0\/0 active memories/);
    assert.equal(archivedFacts[0].id, id);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('recall ranks stronger lexical matches with BM25-style scoring', () => {
  const workspace = makeTempDir('bm25-workspace-');
  const home = makeTempDir('bm25-home-');

  try {
    runCli(['init', '--scope', 'all'], { cwd: workspace, home });
    const weak = runCli(
      ['remember', '--kind', 'fact', 'Server inventory is tracked in the platform notes.'],
      { cwd: workspace, home },
    );
    const strong = runCli(
      [
        'remember',
        '--kind',
        'procedure',
        '--tags',
        'performance,latency',
        'Server performance latency fixes use request caching and connection pooling.',
      ],
      { cwd: workspace, home },
    );
    const weakId = weak.stdout.match(/Remembered (mem_[a-f0-9_]+)/)[1];
    const strongId = strong.stdout.match(/Remembered (mem_[a-f0-9_]+)/)[1];

    const recall = runCli(['recall', '--json', '--limit', '2', 'server performance latency'], {
      cwd: workspace,
      home,
    });
    const records = JSON.parse(recall.stdout);

    assert.equal(records[0].id, strongId);
    assert.equal(records.some((record) => record.id === weakId), true);
    assert.equal(typeof records[0].score, 'number');
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('inject prints critical memories for session hooks', () => {
  const workspace = makeTempDir('inject-workspace-');
  const home = makeTempDir('inject-home-');

  try {
    runCli(['init', '--scope', 'all'], { cwd: workspace, home });
    runCli(['remember', '--kind', 'preference', '--scope', 'global', 'Prefer short hook output.'], {
      cwd: workspace,
      home,
    });
    runCli(['remember', '--kind', 'procedure', 'Run npm test before release.'], {
      cwd: workspace,
      home,
    });

    const injected = runCli(['inject', '--scope', 'all'], { cwd: workspace, home });

    assert.match(injected.stdout, /Meminisse injected memory/);
    assert.match(injected.stdout, /Prefer short hook output/);
    assert.match(injected.stdout, /Run npm test before release/);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('encryption stores JSONL records as encrypted envelopes when enabled', () => {
  const workspace = makeTempDir('encryption-workspace-');
  const home = makeTempDir('encryption-home-');
  const env = { MEMINISSE_ENCRYPTION_KEY: 'correct-horse-battery-staple' };

  try {
    runCli(['init', '--scope', 'all'], { cwd: workspace, home, env });
    runCli(['remember', '--kind', 'fact', 'EncryptedMarker should not appear in plaintext.'], {
      cwd: workspace,
      home,
      env,
    });
    const enabled = runCli(['encryption', 'enable', '--scope', 'project'], {
      cwd: workspace,
      home,
      env,
    });
    runCli(['remember', '--kind', 'fact', 'EncryptedMarker after enable is searchable.'], {
      cwd: workspace,
      home,
      env,
    });
    const recall = runCli(['recall', '--json', 'EncryptedMarker searchable'], {
      cwd: workspace,
      home,
      env,
    });
    const raw = fs.readFileSync(
      path.join(workspace, '.meminisse', 'memory', 'facts.jsonl'),
      'utf8',
    );
    const missingKey = runCliRaw(['recall', 'EncryptedMarker'], { cwd: workspace, home });

    assert.match(enabled.stdout, /project: enabled/);
    assert.doesNotMatch(raw, /EncryptedMarker/);
    assert.match(raw, /"encrypted":true/);
    assert.ok(JSON.parse(recall.stdout).length >= 2);
    assert.notEqual(missingKey.status, 0);
    assert.match(missingKey.stderr, /Encryption requires MEMINISSE_ENCRYPTION_KEY/);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('legacy records without schema versions remain readable', () => {
  const workspace = makeTempDir('legacy-schema-workspace-');
  const home = makeTempDir('legacy-schema-home-');

  try {
    runCli(['init', '--scope', 'all'], { cwd: workspace, home });
    const memoryPath = path.join(workspace, '.meminisse', 'memory', 'facts.jsonl');
    fs.writeFileSync(
      memoryPath,
      `${JSON.stringify({
        id: 'mem_20260412_legacy0001',
        kind: 'fact',
        summary: 'Legacy schema records can still be recalled.',
        body: 'Legacy schema compatibility marker.',
        status: 'active',
        confidence: 'high',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })}\n`,
      'utf8',
    );

    const recall = runCli(['recall', '--json', 'Legacy schema compatibility marker'], {
      cwd: workspace,
      home,
    });
    const records = JSON.parse(recall.stdout);

    assert.equal(records[0].id, 'mem_20260412_legacy0001');
    assert.equal(records[0].schema_version, 0);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('recall supports token-efficient modes, thresholds, and max character budgets', () => {
  const workspace = makeTempDir('recall-budget-workspace-');
  const home = makeTempDir('recall-budget-home-');

  try {
    runCli(['init', '--scope', 'all'], { cwd: workspace, home });
    const body = `BudgetMarker ${'long contextual detail '.repeat(80)}`;

    runCli(['remember', '--kind', 'fact', '--summary', 'BudgetMarker compact summary.', body], {
      cwd: workspace,
      home,
    });

    const summary = runCli(['recall', '--mode', 'summary', 'BudgetMarker'], {
      cwd: workspace,
      home,
    });
    const full = runCli(['recall', '--mode', 'full', '--max-chars', '220', 'BudgetMarker'], {
      cwd: workspace,
      home,
    });
    const ids = runCli(['recall', '--mode', 'ids', 'BudgetMarker'], { cwd: workspace, home });
    const threshold = runCli(['recall', '--threshold', '999', 'BudgetMarker'], {
      cwd: workspace,
      home,
    });

    assert.match(summary.stdout, /BudgetMarker compact summary/);
    assert.doesNotMatch(summary.stdout, /long contextual detail long contextual detail/);
    assert.match(full.stdout, /truncated/);
    assert.match(ids.stdout, /mem_[0-9]{8}_[a-f0-9]{10} score=/);
    assert.match(threshold.stdout, /No relevant memories found/);

    const records = fs
      .readFileSync(path.join(workspace, '.meminisse', 'memory', 'facts.jsonl'), 'utf8')
      .trim()
      .split(/\r?\n/)
      .map((line) => JSON.parse(line));
    assert.equal(records[0].recall_count, 3);
    assert.match(records[0].last_recalled_at, /^\d{4}-\d{2}-\d{2}T/);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('status --verbose reports lifecycle and kind breakdowns', () => {
  const workspace = makeTempDir('verbose-status-workspace-');
  const home = makeTempDir('verbose-status-home-');

  try {
    runCli(['init', '--scope', 'all'], { cwd: workspace, home });
    runCli(['remember', '--kind', 'decision', 'Use verbose status for memory audits.'], {
      cwd: workspace,
      home,
    });

    const status = runCli(['status', '--scope', 'project', '--verbose'], { cwd: workspace, home });

    assert.match(status.stdout, /project:/);
    assert.match(status.stdout, /active: 1/);
    assert.match(status.stdout, /superseded: 0/);
    assert.match(status.stdout, /deleted: 0/);
    assert.match(status.stdout, /decision: 1/);
    assert.match(status.stdout, /schema_versions:/);
    assert.match(status.stdout, /1: 1/);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('review reports stale versions, duplicates, and broken local paths', () => {
  const workspace = makeTempDir('review-workspace-');
  const home = makeTempDir('review-home-');

  try {
    runCli(['init', '--scope', 'all'], { cwd: workspace, home });
    const duplicateText = 'Duplicate review marker memory should be detected.';
    runCli(
      [
        'remember',
        '--kind',
        'fact',
        `Current Meminisse package snapshot says version 0.1.0 even though it is stale.`,
      ],
      { cwd: workspace, home },
    );
    runCli(['remember', '--kind', 'fact', duplicateText], { cwd: workspace, home });
    runCli(['remember', '--kind', 'fact', '--force', duplicateText], { cwd: workspace, home });
    runCli(
      [
        'remember',
        '--kind',
        'fact',
        '--paths',
        '.meminisse/missing-review-file.md',
        'Review should report a missing project-local path.',
      ],
      { cwd: workspace, home },
    );

    const review = runCli(['review', '--scope', 'project', '--json'], { cwd: workspace, home });
    const report = JSON.parse(review.stdout);
    const text = runCli(['review', '--scope', 'project'], { cwd: workspace, home });

    assert.equal(report.summary.stale, 1);
    assert.equal(report.summary.duplicates, 1);
    assert.equal(report.summary.broken_paths, 1);
    assert.match(text.stdout, /Stale memories/);
    assert.match(text.stdout, /Duplicate candidates/);
    assert.match(text.stdout, /Broken path references/);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('attach copies a file into project attachments and remembers its paths', () => {
  const workspace = makeTempDir('attach-workspace-');
  const home = makeTempDir('attach-home-');
  const source = path.join(workspace, 'source-note.md');

  try {
    fs.writeFileSync(source, '# Source Note\n\nAttachment body.\n', 'utf8');
    runCli(['init', '--scope', 'all'], { cwd: workspace, home });

    const attached = runCli(
      [
        'attach',
        source,
        '--kind',
        'evidence',
        '--title',
        'Source Note',
        '--tags',
        'attach,test',
      ],
      { cwd: workspace, home },
    );
    const id = attached.stdout.match(/Attached (mem_[a-f0-9_]+)/)[1];
    const notePath = path.join(
      workspace,
      '.meminisse',
      'attachments',
      new Date().toISOString().slice(0, 4),
      new Date().toISOString().slice(5, 7),
      'source-note',
      'note.md',
    );
    const recall = runCli(['recall', '--json', 'Source Note attachment evidence'], {
      cwd: workspace,
      home,
    });
    const records = JSON.parse(recall.stdout);
    const attachedRecord = records.find((record) => record.id === id);

    assert.ok(fs.existsSync(source));
    assert.ok(fs.existsSync(notePath));
    assert.match(fs.readFileSync(notePath, 'utf8'), /# Source Note/);
    assert.ok(attachedRecord);
    assert.ok(attachedRecord.paths.some((recordPath) => recordPath.endsWith('/note.md')));
    assert.ok(attachedRecord.paths.some((recordPath) => recordPath.endsWith('/original.md')));
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  }
});
