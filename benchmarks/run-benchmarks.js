#!/usr/bin/env node
/**
 * @file run-benchmarks.js
 * @description Deterministic Meminisse recall and lifecycle benchmark runner.
 *
 * The runner creates isolated temporary workspaces and HOME directories, writes
 * fixture memories through the real CLI, then measures recall and review
 * behavior without network access or external services.
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

const repoRoot = path.resolve(__dirname, '..');
const cliPath = path.join(repoRoot, 'plugins', 'meminisse', 'scripts', 'meminisse.js');
const recallFixturePath = path.join(__dirname, 'fixtures', 'recall-quality.json');
const codexOutputSchemaPath = path.join(__dirname, 'schemas', 'model-answer.schema.json');

/**
 * Runs the benchmark suite.
 *
 * @returns {void}
 */
function main() {
  const options = parseArgs(process.argv.slice(2));
  const report = {
    recall_quality: runRecallQualityBenchmark(),
    lifecycle_safety: runLifecycleSafetyBenchmark(),
    review: runReviewBenchmark(),
  };
  if (options.models.length > 0) {
    report.model_quality = runModelBenchmark(options.models, options);
  }
  report.summary = summarizeReport(report);

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log(formatReport(report));
}

/**
 * Parses benchmark runner arguments.
 *
 * @param {string[]} args - Raw CLI arguments.
 * @returns {{ json: boolean, models: string[], modelLimit: number }} Parsed options.
 */
function parseArgs(args) {
  const options = {
    json: false,
    models: [],
    modelLimit: Number.POSITIVE_INFINITY,
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--json') {
      options.json = true;
      continue;
    }

    if (arg === '--model') {
      options.models.push(args[i + 1]);
      i += 1;
      continue;
    }

    if (arg.startsWith('--model=')) {
      options.models.push(arg.slice('--model='.length));
      continue;
    }

    if (arg === '--models') {
      options.models.push(...splitList(args[i + 1]));
      i += 1;
      continue;
    }

    if (arg.startsWith('--models=')) {
      options.models.push(...splitList(arg.slice('--models='.length)));
      continue;
    }

    if (arg === '--model-limit') {
      options.modelLimit = toPositiveInt(args[i + 1], options.modelLimit);
      i += 1;
      continue;
    }

    if (arg.startsWith('--model-limit=')) {
      options.modelLimit = toPositiveInt(
        arg.slice('--model-limit='.length),
        options.modelLimit,
      );
    }
  }

  options.models = uniqueArray(options.models.filter(Boolean));
  return options;
}

/**
 * Runs recall quality against JSON fixtures.
 *
 * @returns {object} Recall benchmark report.
 */
function runRecallQualityBenchmark() {
  const fixture = JSON.parse(fs.readFileSync(recallFixturePath, 'utf8'));
  const workspace = makeTempDir('bench-recall-workspace-');
  const home = makeTempDir('bench-recall-home-');
  const idMap = new Map();

  try {
    runCli(['init', '--scope', 'all'], { cwd: workspace, home });

    for (const memory of fixture.memories) {
      const result = runCli(
        [
          'remember',
          '--kind',
          memory.kind,
          '--tags',
          memory.tags.join(','),
          memory.text,
        ],
        { cwd: workspace, home },
      );
      idMap.set(memory.logical_id, parseMemoryId(result.stdout));
    }

    const queryReports = fixture.queries.map((query) => {
      const recall = runCli(['recall', '--json', '--limit', String(query.top_k), query.query], {
        cwd: workspace,
        home,
      });
      const records = JSON.parse(recall.stdout);
      const expectedId = idMap.get(query.expected);
      const rank = records.findIndex((record) => record.id === expectedId) + 1;

      return {
        name: query.name,
        query: query.query,
        expected: query.expected,
        expected_id: expectedId,
        top_k: query.top_k,
        rank: rank || null,
        pass_at_1: rank === 1,
        pass_at_k: rank > 0 && rank <= query.top_k,
      };
    });

    return {
      fixture: fixture.name,
      queries: queryReports,
      recall_at_1: ratio(queryReports.filter((item) => item.pass_at_1).length, queryReports.length),
      recall_at_k: ratio(queryReports.filter((item) => item.pass_at_k).length, queryReports.length),
    };
  } finally {
    removeTempDir(workspace);
    removeTempDir(home);
  }
}

/**
 * Runs optional Codex model-backed answer quality benchmarks.
 *
 * @param {string[]} models - Codex model IDs to evaluate.
 * @param {{ modelLimit: number }} options - Benchmark options.
 * @returns {object[]} Per-model reports.
 */
function runModelBenchmark(models, options) {
  return models.map((model) => runOneModelBenchmark(model, options));
}

/**
 * Runs model-backed answer quality for one Codex model.
 *
 * @param {string} model - Codex model ID.
 * @param {{ modelLimit: number }} options - Benchmark options.
 * @returns {object} Model benchmark report.
 */
function runOneModelBenchmark(model, options) {
  const fixture = JSON.parse(fs.readFileSync(recallFixturePath, 'utf8'));
  const workspace = makeTempDir('bench-model-workspace-');
  const home = makeTempDir('bench-model-home-');
  const idMap = new Map();
  const queryLimit = Number.isFinite(options.modelLimit)
    ? Math.min(options.modelLimit, fixture.queries.length)
    : fixture.queries.length;

  try {
    runCli(['init', '--scope', 'all'], { cwd: workspace, home });
    for (const memory of fixture.memories) {
      const result = runCli(
        [
          'remember',
          '--kind',
          memory.kind,
          '--tags',
          memory.tags.join(','),
          memory.text,
        ],
        { cwd: workspace, home },
      );
      idMap.set(memory.logical_id, parseMemoryId(result.stdout));
    }

    const queries = [];
    for (const query of fixture.queries.slice(0, queryLimit)) {
      try {
        const recall = runCli(['recall', '--json', '--limit', String(query.top_k), query.query], {
          cwd: workspace,
          home,
        });
        const records = JSON.parse(recall.stdout);
        const expectedId = idMap.get(query.expected);
        const answer = runCodexAnswer(model, query, records, workspace);
        const answerText = normalizeText(answer.answer);
        const expectedTerms = query.expected_terms || [];
        const matchedTerms = expectedTerms.filter((term) =>
          answerText.toLowerCase().includes(term.toLowerCase()),
        );

        queries.push({
          name: query.name,
          query: query.query,
          expected: query.expected,
          expected_id: expectedId,
          returned_memory_id: answer.memory_id || null,
          answer: answer.answer || '',
          citation_correct: answer.memory_id === expectedId,
          terms_matched: matchedTerms.length,
          terms_expected: expectedTerms.length,
          answer_correct: matchedTerms.length === expectedTerms.length,
        });
      } catch (error) {
        return {
          model,
          status: 'unavailable',
          error: error.message,
          queries,
          answer_accuracy: null,
          citation_accuracy: null,
        };
      }
    }

    return {
      model,
      status:
        queries.every((query) => query.answer_correct && query.citation_correct) ? 'pass' : 'fail',
      queries,
      answer_accuracy: ratio(
        queries.filter((query) => query.answer_correct).length,
        queries.length,
      ),
      citation_accuracy: ratio(
        queries.filter((query) => query.citation_correct).length,
        queries.length,
      ),
    };
  } finally {
    removeTempDir(workspace);
    removeTempDir(home);
  }
}

/**
 * Asks Codex to answer from recalled memories.
 *
 * @param {string} model - Codex model ID.
 * @param {object} query - Query fixture.
 * @param {object[]} records - Recalled memory records.
 * @param {string} workspace - Temporary workspace path.
 * @returns {{ answer?: string, memory_id?: string }} Parsed model answer.
 */
function runCodexAnswer(model, query, records, workspace) {
  const outputPath = path.join(workspace, `codex-answer-${slugify(query.name)}.json`);
  const prompt = buildModelPrompt(query, records);
  const result = spawnSync(
    'codex',
    [
      'exec',
      '--model',
      model,
      '--sandbox',
      'read-only',
      '--skip-git-repo-check',
      '--ephemeral',
      '--output-schema',
      codexOutputSchemaPath,
      '--output-last-message',
      outputPath,
      prompt,
    ],
    {
      cwd: workspace,
      env: process.env,
      encoding: 'utf8',
      timeout: 120000,
    },
  );

  if (result.status !== 0) {
    throw new Error(
      [
        `Codex model benchmark failed for ${model}.`,
        firstMeaningfulLine(result.stderr) || firstMeaningfulLine(result.stdout) || 'No output.',
      ].join(' '),
    );
  }

  return parseModelAnswer(fs.readFileSync(outputPath, 'utf8'));
}

/**
 * Extracts a compact error line from command output.
 *
 * @param {string} output - Command output.
 * @returns {string} First useful line.
 */
function firstMeaningfulLine(output) {
  const lines = String(output || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('WARNING:') && !line.startsWith('Reading additional'));
  return lines.find((line) => line.startsWith('ERROR:')) || lines[0];
}

/**
 * Builds a model benchmark prompt.
 *
 * @param {object} query - Query fixture.
 * @param {object[]} records - Recalled records.
 * @returns {string} Prompt text.
 */
function buildModelPrompt(query, records) {
  const context = records.map((record) => ({
    id: record.id,
    kind: record.kind,
    summary: record.summary,
    body: record.body,
    paths: record.paths || [],
  }));

  return [
    'You are answering a Meminisse memory benchmark question.',
    'Use only the provided memory records.',
    'Return JSON that matches the schema: {"answer": string, "memory_id": string}.',
    'Set memory_id to the one memory record that best supports the answer.',
    '',
    `Question: ${query.query}`,
    '',
    `Memory records:\n${JSON.stringify(context, null, 2)}`,
  ].join('\n');
}

/**
 * Parses a JSON model answer from Codex output.
 *
 * @param {string} output - Codex final answer.
 * @returns {{ answer?: string, memory_id?: string }} Parsed answer.
 */
function parseModelAnswer(output) {
  try {
    return JSON.parse(output);
  } catch {
    const match = output.match(/\{[\s\S]*\}/);
    return match ? JSON.parse(match[0]) : {};
  }
}

/**
 * Runs lifecycle leakage checks for deleted and superseded records.
 *
 * @returns {object} Lifecycle safety report.
 */
function runLifecycleSafetyBenchmark() {
  const workspace = makeTempDir('bench-lifecycle-workspace-');
  const home = makeTempDir('bench-lifecycle-home-');

  try {
    runCli(['init', '--scope', 'all'], { cwd: workspace, home });
    const deleted = runCli(
      ['remember', '--kind', 'fact', '--tags', 'leakage', 'Lifecycle deleted marker memory.'],
      { cwd: workspace, home },
    );
    const deletedId = parseMemoryId(deleted.stdout);
    runCli(['forget', '--scope', 'project', deletedId], { cwd: workspace, home });

    const original = runCli(
      ['remember', '--kind', 'decision', 'Use the old lifecycle benchmark decision.'],
      { cwd: workspace, home },
    );
    const originalId = parseMemoryId(original.stdout);
    const replacement = runCli(
      [
        'remember',
        '--kind',
        'decision',
        '--supersedes',
        originalId,
        'Use the replacement lifecycle benchmark decision.',
      ],
      { cwd: workspace, home },
    );
    const replacementId = parseMemoryId(replacement.stdout);
    const recall = runCli(['recall', '--json', '--limit', '10', 'lifecycle benchmark decision'], {
      cwd: workspace,
      home,
    });
    const records = JSON.parse(recall.stdout);
    const ids = records.map((record) => record.id);

    return {
      deleted_leakage: ids.includes(deletedId) ? 1 : 0,
      superseded_leakage: ids.includes(originalId) ? 1 : 0,
      replacement_found: ids.includes(replacementId),
    };
  } finally {
    removeTempDir(workspace);
    removeTempDir(home);
  }
}

/**
 * Runs review signal checks.
 *
 * @returns {object} Review benchmark report.
 */
function runReviewBenchmark() {
  const workspace = makeTempDir('bench-review-workspace-');
  const home = makeTempDir('bench-review-home-');
  const duplicate = 'Benchmark duplicate memory should be detected by review.';

  try {
    runCli(['init', '--scope', 'all'], { cwd: workspace, home });
    runCli(
      [
        'remember',
        '--kind',
        'fact',
        'Current Meminisse benchmark snapshot incorrectly says version 0.1.0.',
      ],
      { cwd: workspace, home },
    );
    runCli(['remember', '--kind', 'fact', duplicate], { cwd: workspace, home });
    runCli(['remember', '--kind', 'fact', '--force', duplicate], { cwd: workspace, home });
    runCli(
      [
        'remember',
        '--kind',
        'fact',
        '--paths',
        '.meminisse/missing-benchmark-path.md',
        'Benchmark memory points at a missing project path.',
      ],
      { cwd: workspace, home },
    );

    const review = runCli(['review', '--scope', 'project', '--json'], { cwd: workspace, home });
    const report = JSON.parse(review.stdout);

    return {
      stale_detection: report.summary.stale >= 1,
      duplicate_detection: report.summary.duplicates >= 1,
      broken_path_detection: report.summary.broken_paths >= 1,
      counts: report.summary,
    };
  } finally {
    removeTempDir(workspace);
    removeTempDir(home);
  }
}

/**
 * Builds top-level pass/fail summary.
 *
 * @param {object} report - Benchmark report.
 * @returns {object} Summary.
 */
function summarizeReport(report) {
  const passed =
    report.recall_quality.recall_at_k === 1 &&
    report.lifecycle_safety.deleted_leakage === 0 &&
    report.lifecycle_safety.superseded_leakage === 0 &&
    report.lifecycle_safety.replacement_found &&
    report.review.stale_detection &&
    report.review.duplicate_detection &&
    report.review.broken_path_detection &&
    (!report.model_quality || report.model_quality.every((model) => model.status === 'pass'));

  return {
    passed,
    recall_at_1: report.recall_quality.recall_at_1,
    recall_at_k: report.recall_quality.recall_at_k,
  };
}

/**
 * Formats benchmark output.
 *
 * @param {object} report - Benchmark report.
 * @returns {string} Human-readable report.
 */
function formatReport(report) {
  const lines = [
    'Meminisse benchmark',
    '',
    'Recall quality:',
    `  Recall@1: ${formatRatio(report.recall_quality.recall_at_1)}`,
    `  Recall@K: ${formatRatio(report.recall_quality.recall_at_k)}`,
    '',
    'Lifecycle safety:',
    `  Deleted leakage: ${report.lifecycle_safety.deleted_leakage}`,
    `  Superseded leakage: ${report.lifecycle_safety.superseded_leakage}`,
    `  Replacement found: ${formatBoolean(report.lifecycle_safety.replacement_found)}`,
    '',
    'Review:',
    `  Stale detection: ${formatBoolean(report.review.stale_detection)}`,
    `  Duplicate detection: ${formatBoolean(report.review.duplicate_detection)}`,
    `  Broken path detection: ${formatBoolean(report.review.broken_path_detection)}`,
    '',
  ];

  if (report.model_quality) {
    lines.push('Model quality:');
    for (const model of report.model_quality) {
      lines.push(`  ${model.model}:`);
      lines.push(`    Status: ${model.status}`);
      if (model.status === 'unavailable') {
        lines.push(`    Error: ${model.error}`);
        continue;
      }

      lines.push(`    Answer accuracy: ${formatRatio(model.answer_accuracy)}`);
      lines.push(`    Citation accuracy: ${formatRatio(model.citation_accuracy)}`);
      for (const query of model.queries) {
        lines.push(
          `    - ${query.name}: answer=${formatBoolean(query.answer_correct)} citation=${formatBoolean(query.citation_correct)}`,
        );
      }
    }
    lines.push('');
  }

  lines.push(`Overall: ${report.summary.passed ? 'pass' : 'fail'}`);

  for (const query of report.recall_quality.queries) {
    lines.push(
      `  - ${query.name}: rank=${query.rank || 'miss'} top_k=${query.top_k} expected=${query.expected}`,
    );
  }

  return lines.join('\n');
}

/**
 * Runs the Meminisse CLI.
 *
 * @param {string[]} args - CLI arguments.
 * @param {{ cwd: string, home: string }} options - Execution options.
 * @returns {import('node:child_process').SpawnSyncReturns<string>} Completed process.
 */
function runCli(args, options) {
  const result = spawnSync(process.execPath, [cliPath, ...args], {
    cwd: options.cwd,
    env: {
      ...process.env,
      HOME: options.home,
    },
    encoding: 'utf8',
  });

  assert.equal(
    result.status,
    0,
    [
      `Command failed: node ${cliPath} ${args.join(' ')}`,
      `stdout:\n${result.stdout}`,
      `stderr:\n${result.stderr}`,
    ].join('\n'),
  );

  return result;
}

/**
 * Parses a memory ID from CLI output.
 *
 * @param {string} output - CLI stdout.
 * @returns {string} Parsed memory ID.
 */
function parseMemoryId(output) {
  const match = output.match(/\bmem_[0-9]{8}_[a-f0-9]{10}\b/);
  assert.ok(match, `Expected memory ID in output: ${output}`);
  return match[0];
}

/**
 * Creates an isolated temporary directory.
 *
 * @param {string} label - Directory label.
 * @returns {string} Temporary directory.
 */
function makeTempDir(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `meminisse-${label}`));
}

/**
 * Removes an isolated temporary directory.
 *
 * @param {string} dirPath - Directory to remove.
 * @returns {void}
 */
function removeTempDir(dirPath) {
  fs.rmSync(dirPath, { recursive: true, force: true });
}

/**
 * Calculates a ratio.
 *
 * @param {number} numerator - Numerator.
 * @param {number} denominator - Denominator.
 * @returns {number} Ratio.
 */
function ratio(numerator, denominator) {
  return denominator === 0 ? 0 : numerator / denominator;
}

/**
 * Formats a ratio as a fixed decimal.
 *
 * @param {number} value - Ratio value.
 * @returns {string} Fixed decimal value.
 */
function formatRatio(value) {
  return value.toFixed(3);
}

/**
 * Formats a boolean as pass/fail.
 *
 * @param {boolean} value - Boolean value.
 * @returns {string} Pass/fail label.
 */
function formatBoolean(value) {
  return value ? 'pass' : 'fail';
}

/**
 * Splits a comma-delimited argument.
 *
 * @param {string} value - Raw value.
 * @returns {string[]} Split list.
 */
function splitList(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

/**
 * Parses a positive integer.
 *
 * @param {string} value - Raw value.
 * @param {number} fallback - Fallback value.
 * @returns {number} Positive integer or fallback.
 */
function toPositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Removes duplicate strings while preserving order.
 *
 * @param {string[]} values - Values to de-duplicate.
 * @returns {string[]} Unique values.
 */
function uniqueArray(values) {
  return [...new Set(values)];
}

/**
 * Normalizes text for matching.
 *
 * @param {unknown} value - Value to normalize.
 * @returns {string} Normalized text.
 */
function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

/**
 * Creates a safe file slug.
 *
 * @param {string} value - Raw value.
 * @returns {string} Slug.
 */
function slugify(value) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

main();
