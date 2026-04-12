/**
 * @file help.js
 * @description CLI help output.
 *
 * @license MIT
 */
'use strict';

const { VERSION } = require('../constants');

/**
 * Prints CLI help text.
 *
 * @returns {void}
 */
function printHelp() {
  console.log(`Meminisse ${VERSION}

Persistent memory for Codex.

Usage:
  meminisse init [--scope project|global|all]
  meminisse install --local [--force]
  meminisse remember [--kind decision|fact|procedure|preference|event] [--scope project|global] [--supersedes id] [--allow-secret] <text>
  meminisse recall [--scope project|global|all] [--limit 8] [--mode summary|full|ids] [--max-chars 4000] [--threshold 1] [--json] <query>
  meminisse inject [--scope project|global|all] [--kinds preference,procedure,decision] [--limit 8] [--max-chars 4000] [--json]
  meminisse encryption enable|status [--scope project|global|all] [--key-env MEMINISSE_ENCRYPTION_KEY]
  meminisse list [--scope project|global|all] [--status active|superseded|deleted|all] [--kind decision] [--limit 20] [--json]
  meminisse forget [--scope project|global|all] [--reason text] <memory-id> [memory-id...]
  meminisse doctor [--json] [--strict]
  meminisse review [--scope project|global|all] [--json]
  meminisse attach <file> [--kind reference|evidence|brief|asset|note] [--title text] [--tags a,b] [--move] [--allow-secret]
  meminisse compact [--scope project|global|all] [--prune]
  meminisse status [--scope project|global|all] [--verbose]

Examples:
  meminisse install --local --force
  meminisse remember --kind decision "Use npm for this project."
  meminisse remember --kind decision --supersedes mem_20260412_abcd123456 "Use Node test runner for integration tests."
  meminisse remember --kind preference --scope global "Prefer concise status updates."
  meminisse inject --scope all
  meminisse encryption enable --scope all --key-env MEMINISSE_ENCRYPTION_KEY
  meminisse list --status all --limit 5
  meminisse forget mem_20260412_abcd123456 --reason "Outdated project decision."
  meminisse doctor
  meminisse review
  meminisse attach ~/Downloads/screenshot.png --kind evidence --tags bug,ui
  meminisse recall --mode ids --max-chars 1200 "package manager and project decisions"
`);
}

module.exports = printHelp;
