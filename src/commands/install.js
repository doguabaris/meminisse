/**
 * @file install.js
 * @description Installs Meminisse into the user's Codex home.
 *
 * @license MIT
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { parseOptions } = require('../core/options');
const {
  CODEX_PLUGIN_TARGET,
  CODEX_SKILL_TARGET,
  MARKETPLACE_PATH,
  ensureDir,
  ensureExists,
} = require('../system/paths');

/**
 * Installs the plugin, skill, and marketplace entry into the local Codex home.
 *
 * @param {string[]} args - CLI arguments.
 * @returns {void}
 */
function installCommand(args) {
  const { opts } = parseOptions(args);
  if (!opts.local) {
    throw new Error('Usage: meminisse install --local [--force]');
  }

  const pluginSource = resolvePluginSource(path.dirname(fs.realpathSync(process.argv[1])));
  const skillSource = path.join(pluginSource, 'skills', 'meminisse');
  ensureExists(pluginSource);
  ensureExists(skillSource);
  copyPluginRuntime(pluginSource, CODEX_PLUGIN_TARGET, Boolean(opts.force));
  copyDirectory(skillSource, CODEX_SKILL_TARGET, Boolean(opts.force));
  updateMarketplace();

  console.log('Meminisse installed for local Codex sessions.');
  console.log(`Plugin: ${CODEX_PLUGIN_TARGET}`);
  console.log(`Skill: ${CODEX_SKILL_TARGET}`);
  console.log(`Marketplace: ${MARKETPLACE_PATH}`);
}

/**
 * Resolves the plugin source directory from a script directory.
 *
 * @param {string} startDir - Directory containing a Meminisse script.
 * @returns {string} Plugin source directory.
 */
function resolvePluginSource(startDir) {
  const pluginRoot = path.resolve(startDir, '..');
  const manifestPath = path.join(pluginRoot, '.codex-plugin', 'plugin.json');
  if (fs.existsSync(manifestPath)) {
    return pluginRoot;
  }

  return path.resolve(startDir, '..');
}

/**
 * Copies only runtime plugin files into the Codex plugin target.
 *
 * @param {string} source - Plugin source root.
 * @param {string} target - Plugin install target.
 * @param {boolean} force - Whether to overwrite an existing target.
 * @returns {void}
 */
function copyPluginRuntime(source, target, force) {
  if (isSamePath(source, target)) {
    console.log(`Already installed: ${target}`);
    return;
  }

  if (fs.existsSync(target) && !force) {
    console.log(`Already installed: ${target}`);
    return;
  }

  ensureDir(path.dirname(target));
  if (force) {
    fs.rmSync(target, { recursive: true, force: true });
  }

  ensureDir(target);
  for (const entry of ['.codex-plugin', 'bin', 'src', 'skills', 'package.json']) {
    copyRuntimeEntry(path.join(source, entry), path.join(target, entry));
  }
}

/**
 * Copies one runtime file or directory when it exists.
 *
 * @param {string} source - Source file or directory.
 * @param {string} target - Target file or directory.
 * @returns {void}
 */
function copyRuntimeEntry(source, target) {
  if (!fs.existsSync(source)) {
    return;
  }

  fs.cpSync(source, target, { recursive: true, force: true });
}

/**
 * Copies a directory into an installation target.
 *
 * @param {string} source - Source directory.
 * @param {string} target - Target directory.
 * @param {boolean} force - Whether to overwrite existing files.
 * @returns {void}
 */
function copyDirectory(source, target, force) {
  if (isSamePath(source, target)) {
    console.log(`Already installed: ${target}`);
    return;
  }

  if (fs.existsSync(target) && !force) {
    console.log(`Already installed: ${target}`);
    return;
  }

  ensureDir(path.dirname(target));
  if (force) {
    fs.rmSync(target, { recursive: true, force: true });
  }

  fs.cpSync(source, target, { recursive: true, force: true });
}

/**
 * Checks whether two paths resolve to the same filesystem location.
 *
 * @param {string} firstPath - First path.
 * @param {string} secondPath - Second path.
 * @returns {boolean} Whether the paths are equivalent.
 */
function isSamePath(firstPath, secondPath) {
  try {
    return fs.realpathSync(firstPath) === fs.realpathSync(secondPath);
  } catch {
    return path.resolve(firstPath) === path.resolve(secondPath);
  }
}

/**
 * Creates or updates the personal Codex marketplace entry.
 *
 * @returns {void}
 */
function updateMarketplace() {
  ensureDir(path.dirname(MARKETPLACE_PATH));
  const marketplace = readMarketplace();
  const entry = {
    name: 'meminisse',
    source: {
      source: 'local',
      path: './.codex/plugins/meminisse',
    },
    policy: {
      installation: 'INSTALLED_BY_DEFAULT',
      authentication: 'ON_USE',
    },
    category: 'Productivity',
  };
  const index = marketplace.plugins.findIndex((plugin) => plugin.name === 'meminisse');

  if (index === -1) {
    marketplace.plugins.push(entry);
  } else {
    marketplace.plugins[index] = entry;
  }

  fs.writeFileSync(MARKETPLACE_PATH, `${JSON.stringify(marketplace, null, 2)}\n`, 'utf8');
}

/**
 * Reads the personal marketplace file or returns a default object.
 *
 * @returns {{ name: string, interface: object, plugins: object[] }} Marketplace metadata.
 */
function readMarketplace() {
  if (!fs.existsSync(MARKETPLACE_PATH)) {
    return {
      name: 'local',
      interface: {
        displayName: 'Local Plugins',
      },
      plugins: [],
    };
  }

  const parsed = JSON.parse(fs.readFileSync(MARKETPLACE_PATH, 'utf8'));
  if (!parsed.interface) parsed.interface = { displayName: 'Local Plugins' };
  if (!Array.isArray(parsed.plugins)) parsed.plugins = [];
  return parsed;
}

module.exports = installCommand;
module.exports.resolvePluginSource = resolvePluginSource;
