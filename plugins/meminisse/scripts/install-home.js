#!/usr/bin/env node
/**
 * @file install-home.js
 * @description Installs Meminisse as a personal Codex plugin.
 *
 * This script copies the local Meminisse plugin into the personal Codex plugin
 * directory, mirrors the bundled skill into the global skills directory, and
 * creates or updates the personal plugin marketplace entry.
 *
 * The installer follows Codex plugin marketplace rules:
 * - Personal plugins live under ~/.codex/plugins/.
 * - The personal marketplace lives at ~/.agents/plugins/marketplace.json.
 * - Marketplace source paths are relative to the home directory.
 *
 * Usage:
 *   meminisse-install-home --force
 *   node plugins/meminisse/scripts/install-home.js --force
 *
 * @author      Doğu Abaris <abaris@null.net>
 * @license     MIT
 * @see         README.md for installation details.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const scriptPath = fs.realpathSync(process.argv[1]);
const scriptDir = path.dirname(scriptPath);
const pluginSource = resolvePluginSource(scriptDir);
const home = os.homedir();
const pluginTarget = path.join(home, '.codex', 'plugins', 'meminisse');
const skillSource = path.join(pluginSource, 'skills', 'meminisse');
const skillTarget = path.join(home, '.codex', 'skills', 'meminisse');
const marketplacePath = path.join(home, '.agents', 'plugins', 'marketplace.json');

/**
 * Resolves the plugin root from the installer script location.
 *
 * @param {string} startDir - Directory that contains this installer script.
 * @returns {string} Plugin source directory.
 */
function resolvePluginSource(startDir) {
  const pluginRoot = path.resolve(startDir, '..');
  const manifestPath = path.join(pluginRoot, '.codex-plugin', 'plugin.json');
  if (fs.existsSync(manifestPath)) {
    return pluginRoot;
  }

  return path.resolve(startDir, '..', '..', '..', 'plugins', 'meminisse');
}

/**
 * Installs the plugin, skill, and marketplace entry.
 *
 * @returns {void}
 */
function main() {
  const force = process.argv.includes('--force');
  ensureExists(pluginSource);
  copyDirectory(pluginSource, pluginTarget, force);
  copyDirectory(skillSource, skillTarget, force);
  updateMarketplace();

  console.log('Meminisse installed for future Codex sessions.');
  console.log(`Plugin: ${pluginTarget}`);
  console.log(`Skill: ${skillTarget}`);
  console.log(`Marketplace: ${marketplacePath}`);
}

/**
 * Copies a directory into the install target.
 *
 * If the target already exists, the copy is skipped unless `force` is true.
 *
 * @param {string} source - Source directory to copy.
 * @param {string} target - Target directory to create.
 * @param {boolean} force - Whether to overwrite an existing target.
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

  fs.mkdirSync(path.dirname(target), { recursive: true });
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
 * @returns {boolean} Whether both paths point at the same location.
 */
function isSamePath(firstPath, secondPath) {
  try {
    return fs.realpathSync(firstPath) === fs.realpathSync(secondPath);
  } catch {
    return path.resolve(firstPath) === path.resolve(secondPath);
  }
}

/**
 * Creates or updates the personal Codex marketplace entry for Meminisse.
 *
 * @returns {void}
 */
function updateMarketplace() {
  fs.mkdirSync(path.dirname(marketplacePath), { recursive: true });
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

  fs.writeFileSync(marketplacePath, `${JSON.stringify(marketplace, null, 2)}\n`, 'utf8');
}

/**
 * Reads the personal marketplace file or returns a default marketplace object.
 *
 * @returns {{ name: string, interface: { displayName: string }, plugins: object[] }} Marketplace metadata.
 */
function readMarketplace() {
  if (!fs.existsSync(marketplacePath)) {
    return {
      name: 'local',
      interface: {
        displayName: 'Local Plugins',
      },
      plugins: [],
    };
  }

  const parsed = JSON.parse(fs.readFileSync(marketplacePath, 'utf8'));
  if (!parsed.interface) parsed.interface = { displayName: 'Local Plugins' };
  if (!Array.isArray(parsed.plugins)) parsed.plugins = [];
  return parsed;
}

/**
 * Ensures a required source path exists.
 *
 * @param {string} filePath - Path that must exist.
 * @returns {void}
 * @throws If the path is missing.
 */
function ensureExists(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing required path: ${filePath}`);
  }
}

main();
