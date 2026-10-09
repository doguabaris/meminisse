/**
 * @file retrieval-health.test.js
 * @description Isolated regressions for retrieval, startup output, and diagnostics.
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
const { formatInjection, formatRecall } = require('../src/core/formatters');
const { extractPaths } = require('../src/memory/recall');

const cliPath = path.resolve(__dirname, '..', 'bin', 'meminisse.js');

/**
 * Runs a scenario without reading or writing the user's memory or installation.
 *
 * @param {(context: object) => void} scenario - Isolated scenario.
 * @returns {void}
 */
function isolatedScenario(scenario) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'meminisse-retrieval-health-'));
  const workspace = path.join(root, 'workspace');
  const isolatedHome = path.join(root, 'home');
  fs.mkdirSync(workspace);
  fs.mkdirSync(isolatedHome);
  const run = (args, script = cliPath) => spawnSync(process.execPath, [script, ...args], {
    cwd: workspace,
    env: { ...process.env, HOME: isolatedHome },
    encoding: 'utf8',
  });
  const cli = (args, script = cliPath) => {
    const result = run(args, script);
    assert.equal(result.status, 0, `${args.join(' ')}: ${result.stderr}`);
    return result;
  };
  try {
    scenario({ workspace, isolatedHome, run, cli });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('recall phrase boosts require exact adjacent tokens', () => {
  isolatedScenario(({ cli }) => {
    cli(['remember', '--kind', 'fact', 'xalpha betax']);
    assert.deepEqual(JSON.parse(cli(['recall', '--scope', 'project', '--json', 'alpha beta']).stdout), []);
    cli(['remember', '--kind', 'fact', 'alpha beta are exact adjacent cues.']);
    const matches = JSON.parse(cli(['recall', '--scope', 'project', '--json', 'alpha beta']).stdout);
    assert.equal(matches.length, 1);
    assert.match(matches[0].body, /^alpha beta/);
  });
});

test('recall finds filenames and directory cues despite sentence punctuation', () => {
  isolatedScenario(({ cli }) => {
    cli(['remember', '--kind', 'fact', 'Source src/payment/service.js.']);
    for (const query of ['service.js', 'service', 'payment', 'src/payment/service.js']) {
      const records = JSON.parse(cli(['recall', '--scope', 'project', '--json', query]).stdout);
      assert.equal(records.length, 1, query);
    }
    cli(['remember', '--kind', 'fact', '--paths', 'src/runtime/parser.js', 'Explicit path memory.']);
    assert.equal(JSON.parse(cli(['recall', '--scope', 'project', '--json', 'parser.js']).stdout).length, 1);
  });
});

test('path extraction preserves Unicode files and excludes URLs from local review', () => {
  isolatedScenario(({ workspace, cli }) => {
    fs.mkdirSync(path.join(workspace, 'src'));
    fs.writeFileSync(path.join(workspace, 'src', 'iş-akışı.js'), '// file\n');
    const body = 'Read ./src/iş-akışı.js. See https://github.com/doguabaris/meminisse for details.';
    assert.deepEqual(extractPaths(body), ['./src/iş-akışı.js']);
    cli(['remember', '--kind', 'fact', body]);
    const matches = JSON.parse(cli(['recall', '--scope', 'project', '--json', 'iş-akışı.js']).stdout);
    assert.equal(matches.length, 1);
    assert.deepEqual(JSON.parse(cli(['review', '--scope', 'project', '--json']).stdout).broken_paths, []);
  });
});

test('terminal character budgets include long queries, headers, and the final newline', () => {
  const record = {
    id: 'memory-test', kind: 'fact', memory_type: 'semantic', confidence: 'high',
    summary: 'BudgetMarker summary', body: 'Long details '.repeat(50),
  };
  for (const budget of [1, 2, 10, 27, 40, 220]) {
    const recalled = formatRecall([{ record, score: 1 }], 'BudgetMarker '.repeat(200), {
      maxChars: budget, mode: 'full',
    });
    const injected = formatInjection([{ record, scope: 'project' }], { maxChars: budget });
    assert.ok(`${recalled}\n`.length <= budget, `recall budget ${budget}`);
    assert.ok(`${injected}\n`.length <= budget, `inject budget ${budget}`);
  }
  isolatedScenario(({ cli }) => {
    cli(['remember', '--kind', 'preference', '--scope', 'project', 'BudgetMarker summary']);
    assert.match(cli(['recall', '--scope', 'project', 'BudgetMarker '.repeat(500)]).stdout, /BudgetMarker summary/);
    for (const budget of [1, 40, 220]) {
      const output = cli(['recall', '--scope', 'project', '--max-chars', String(budget), 'BudgetMarker '.repeat(200)]);
      assert.ok(output.stdout.length <= budget);
      const injected = cli(['inject', '--scope', 'project', '--max-chars', String(budget)]);
      assert.ok(injected.stdout.length <= budget);
    }
    assert.ok(cli(['inject', '--scope', 'global', '--max-chars', '1']).stdout.length <= 1);
    assert.ok(cli(['recall', '--scope', 'global', '--max-chars', '1', 'UnmatchedMarker']).stdout.length <= 1);
  });
});

test('startup injection shares slots across global preferences and project decisions', () => {
  isolatedScenario(({ cli }) => {
    for (let index = 0; index < 9; index += 1) {
      cli(['remember', '--kind', 'preference', '--scope', 'global', `Global preference number ${index}.`]);
    }
    cli(['remember', '--kind', 'decision', 'Project decision must appear at startup.']);
    const injected = JSON.parse(cli(['inject', '--scope', 'all', '--json']).stdout);
    assert.equal(injected.length, 8);
    assert.ok(injected.some((item) => item.scope === 'project' && item.kind === 'decision'));
    assert.ok(injected.some((item) => item.scope === 'global' && item.kind === 'preference'));
    assert.deepEqual(JSON.parse(cli(['inject', '--scope', 'all', '--json']).stdout), injected);
    assert.match(cli(['inject', '--scope', 'all']).stdout, /Project decision must appear/);
  });
});

test('doctor strict succeeds for healthy source and installed CLI metadata', () => {
  isolatedScenario(({ isolatedHome, cli }) => {
    cli(['install', '--local', '--force']);
    cli(['init', '--scope', 'all']);
    const installedCli = path.join(isolatedHome, '.codex', 'plugins', 'meminisse', 'bin', 'meminisse.js');
    for (const script of [cliPath, installedCli]) {
      const checks = JSON.parse(cli(['doctor', '--strict', '--json'], script).stdout);
      assert.ok(checks.every((check) => check.status === 'ok'));
      assert.equal(checks.find((check) => check.name === 'package.json version').status, 'ok');
    }
  });
});

test('doctor reports malformed metadata while continuing independent health checks', () => {
  isolatedScenario(({ isolatedHome, cli, run }) => {
    cli(['install', '--local', '--force']);
    cli(['init', '--scope', 'all']);
    const marketplacePath = path.join(isolatedHome, '.agents', 'plugins', 'marketplace.json');
    fs.writeFileSync(marketplacePath, '{ broken');
    const result = run(['doctor', '--strict', '--json']);
    assert.equal(result.status, 1);
    const checks = JSON.parse(result.stdout);
    const byName = new Map(checks.map((check) => [check.name, check]));
    assert.equal(byName.get('marketplace entry').status, 'fail');
    assert.match(byName.get('marketplace entry').detail, /marketplace\.json/);
    assert.equal(byName.get('project memory').status, 'ok');
    assert.equal(byName.get('package.json version').status, 'ok');
  });
});

test('review compares only explicit Meminisse versions with the CLI version', () => {
  isolatedScenario(({ cli }) => {
    cli(['remember', '--kind', 'fact', 'Current Node version is 22.17.0.']);
    cli(['remember', '--kind', 'fact', 'Meminisse requires Node version 20.18.1.']);
    cli(['remember', '--kind', 'fact', 'Current Meminisse package snapshot says version 0.1.0. Node version is 22.17.0.']);
    const report = JSON.parse(cli(['review', '--scope', 'project', '--json']).stdout);
    assert.equal(report.stale.length, 1);
    assert.deepEqual(report.stale[0].versions, ['0.1.0']);
  });
});
