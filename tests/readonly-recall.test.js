/**
 * @file readonly-recall.test.js
 * @description Recall remains usable when a memory store cannot accept telemetry writes.
 *
 * @license MIT
 */
'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const cliPath = path.resolve(__dirname, '..', 'bin', 'meminisse.js');

/**
 * Runs the CLI with an isolated HOME directory.
 *
 * @param {string} workspace - Workspace directory.
 * @param {string} home - Isolated HOME directory.
 * @param {string[]} args - CLI arguments.
 * @returns {import('node:child_process').SpawnSyncReturns<string>} Result.
 */
function runCli(workspace, home, args) {
  const script = `
    const home = process.argv[1];
    const cli = process.argv[2];
    require('os').homedir = () => home;
    process.argv = [process.execPath, cli, ...process.argv.slice(3)];
    require(cli);
  `;
  return spawnSync(process.execPath, ['-e', script, home, cliPath, ...args], {
    cwd: workspace,
    encoding: 'utf8',
    env: { ...process.env, HOME: home },
  });
}

test('recall works on a read-only store while telemetry is skipped', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'meminisse-readonly-recall-'));
  const workspace = path.join(base, 'workspace');
  const home = path.join(base, 'home');
  fs.mkdirSync(workspace);
  fs.mkdirSync(home);
  const memoryRoot = path.join(workspace, '.meminisse', 'memory');

  try {
    assert.equal(runCli(workspace, home, ['remember', '--kind', 'fact', 'Read-only recall marker']).status, 0);
    const before = fs.readFileSync(path.join(memoryRoot, 'facts.jsonl'), 'utf8');
    fs.chmodSync(memoryRoot, 0o555);
    const result = runCli(workspace, home, ['recall', '--scope', 'project', '--json', 'Read-only recall marker']);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).length, 1);
    assert.equal(fs.readFileSync(path.join(memoryRoot, 'facts.jsonl'), 'utf8'), before);
  } finally {
    fs.chmodSync(memoryRoot, 0o755);
    fs.rmSync(base, { recursive: true, force: true });
  }
});
