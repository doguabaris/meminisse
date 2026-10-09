/**
 * @file doctor.js
 * @description Checks local installation and storage health.
 *
 * @license MIT
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { VERSION } = require('../constants');
const { formatDoctor } = require('../core/formatters');
const { parseOptions } = require('../core/options');
const {
  CODEX_PLUGIN_TARGET,
  CODEX_SKILL_TARGET,
  MARKETPLACE_PATH,
  hasIgnoreEntry,
  projectMemoryPath,
  projectRootPath,
  readFileIfExists,
} = require('../system/paths');
const { globalMemoryPath } = require('../system/paths');
const { platformLabel } = require('../system/platform');
const { resolvePluginSource } = require('./install');

/**
 * Runs local installation and storage health checks.
 *
 * @param {string[]} args - CLI arguments.
 * @returns {void}
 */
function doctorCommand(args) {
  const { opts } = parseOptions(args);
  const checks = runDoctorChecks();

  if (opts.json) {
    console.log(JSON.stringify(checks, null, 2));
  } else {
    console.log(formatDoctor(checks));
  }

  if (opts.strict && checks.some((check) => check.status !== 'ok')) {
    process.exit(1);
  }
}

/**
 * Builds doctor check results.
 *
 * @returns {{ status: string, name: string, detail: string }[]} Doctor checks.
 */
function runDoctorChecks() {
  const pluginSource = resolvePluginSource(path.dirname(fs.realpathSync(process.argv[1])));
  const localManifestRead = readJsonSafe(path.join(pluginSource, '.codex-plugin', 'plugin.json'));
  const packageRead = readJsonSafe(path.join(pluginSource, 'package.json'));
  const installedManifestRead = readJsonSafe(
    path.join(CODEX_PLUGIN_TARGET, '.codex-plugin', 'plugin.json'),
  );
  const marketplaceRead = readJsonSafe(MARKETPLACE_PATH);
  const localManifest = localManifestRead.value;
  const packageJson = packageRead.value;
  const installedManifest = installedManifestRead.value;
  const marketplace = marketplaceRead.value;
  const marketplaceEntry =
    marketplace &&
    Array.isArray(marketplace.plugins) &&
    marketplace.plugins.find((plugin) => plugin && plugin.name === 'meminisse');
  const checks = [];

  checks.push(okCheck('platform', platformLabel()));
  checks.push(okCheck('CLI version', VERSION));
  checks.push(
    packageRead.error
      ? failCheck('package.json version', packageRead.error)
      : packageJson
      ? statusCheck(
          packageJson.version === VERSION,
          'package.json version',
          packageJson.version,
          `expected ${VERSION}`,
        )
      : warnCheck('package.json version', 'package.json not found from this install location'),
  );
  checks.push(
    localManifestRead.error
      ? failCheck('bundled plugin manifest', localManifestRead.error)
      : localManifest
      ? statusCheck(
          localManifest.version === VERSION,
          'bundled plugin manifest version',
          localManifest.version,
          `expected ${VERSION}`,
        )
      : failCheck('bundled plugin manifest', path.join(pluginSource, '.codex-plugin', 'plugin.json')),
  );
  checks.push(
    installedManifestRead.error
      ? failCheck('installed plugin version', installedManifestRead.error)
      : installedManifest
      ? statusCheck(
          installedManifest.version === VERSION,
          'installed plugin version',
          installedManifest.version,
          `expected ${VERSION}`,
        )
      : warnCheck('installed plugin', `${CODEX_PLUGIN_TARGET} not installed`),
  );
  checks.push(pathCheck('installed skill', path.join(CODEX_SKILL_TARGET, 'SKILL.md')));
  checks.push(
    marketplaceRead.error
      ? failCheck('marketplace entry', marketplaceRead.error)
      : marketplaceEntry
      ? statusCheck(
          marketplaceEntry.source && marketplaceEntry.source.path === './.codex/plugins/meminisse',
          'marketplace entry',
          MARKETPLACE_PATH,
          'entry path should be ./.codex/plugins/meminisse',
        )
      : warnCheck('marketplace entry', `${MARKETPLACE_PATH} missing meminisse entry`),
  );
  checks.push(pathCheck('project memory', projectMemoryPath()));
  checks.push(pathCheck('global memory parent', path.dirname(globalMemoryPath())));
  const ignorePath = path.join(projectRootPath(), '.gitignore');
  checks.push(
    statusCheck(
      hasIgnoreEntry(readFileIfExists(ignorePath), '.meminisse/'),
      '.meminisse gitignore entry',
      ignorePath,
      '.meminisse/ missing',
    ),
  );

  return checks;
}

/**
 * Reads JSON without aborting the remaining health checks on malformed files.
 *
 * @param {string} filePath - JSON file path.
 * @returns {{ value?: object, error?: string }} Parsed JSON or diagnostic.
 */
function readJsonSafe(filePath) {
  if (!fs.existsSync(filePath)) {
    return {};
  }
  try {
    const value = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('Expected a JSON object');
    }
    return { value };
  } catch (error) {
    return { error: `${filePath}: ${error.message}` };
  }
}

/**
 * Creates an OK doctor check.
 *
 * @param {string} name - Check name.
 * @param {string} detail - Check detail.
 * @returns {{ status: string, name: string, detail: string }} Check object.
 */
function okCheck(name, detail) {
  return { status: 'ok', name, detail };
}

/**
 * Creates a warning doctor check.
 *
 * @param {string} name - Check name.
 * @param {string} detail - Check detail.
 * @returns {{ status: string, name: string, detail: string }} Check object.
 */
function warnCheck(name, detail) {
  return { status: 'warn', name, detail };
}

/**
 * Creates a failed doctor check.
 *
 * @param {string} name - Check name.
 * @param {string} detail - Check detail.
 * @returns {{ status: string, name: string, detail: string }} Check object.
 */
function failCheck(name, detail) {
  return { status: 'fail', name, detail };
}

/**
 * Creates an OK or warning check from a boolean condition.
 *
 * @param {boolean} condition - Passing condition.
 * @param {string} name - Check name.
 * @param {string} detail - Passing detail.
 * @param {string} failure - Failing detail.
 * @returns {{ status: string, name: string, detail: string }} Check object.
 */
function statusCheck(condition, name, detail, failure) {
  return condition ? okCheck(name, detail) : warnCheck(name, failure);
}

/**
 * Checks whether a path exists.
 *
 * @param {string} name - Check name.
 * @param {string} filePath - Path to check.
 * @returns {{ status: string, name: string, detail: string }} Check object.
 */
function pathCheck(name, filePath) {
  return fs.existsSync(filePath) ? okCheck(name, filePath) : warnCheck(name, `${filePath} missing`);
}

module.exports = doctorCommand;
