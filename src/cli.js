#!/usr/bin/env node
/**
 * @file cli.js
 * @description Entry point for the Meminisse CLI.
 *
 * @license MIT
 */
'use strict';

const commands = require('./commands');
const { VERSION } = require('./constants');

/**
 * Dispatches the CLI command from process arguments.
 *
 * @returns {void}
 */
function main() {
  const args = process.argv.slice(2);
  const command = args.shift();

  try {
    switch (command) {
      case 'init':
        commands.init(args);
        break;
      case 'remember':
        commands.remember(args);
        break;
      case 'recall':
        commands.recall(args);
        break;
      case 'inject':
        commands.inject(args);
        break;
      case 'encryption':
        commands.encryption(args);
        break;
      case 'encrypt':
        commands.encryption(['enable', ...args]);
        break;
      case 'install':
        commands.install(args);
        break;
      case 'doctor':
        commands.doctor(args);
        break;
      case 'review':
        commands.review(args);
        break;
      case 'attach':
        commands.attach(args);
        break;
      case 'compact':
      case 'consolidate':
        commands.compact(args);
        break;
      case 'list':
      case 'ls':
        commands.list(args);
        break;
      case 'forget':
      case 'delete':
      case 'remove':
        commands.forget(args);
        break;
      case 'status':
        commands.status(args);
        break;
      case 'help':
      case '--help':
      case '-h':
      case undefined:
        commands.help();
        break;
      case '--version':
      case '-v':
        console.log(VERSION);
        break;
      default:
        throw new Error(`Unknown command: ${command}`);
    }
  } catch (error) {
    console.error(`meminisse: ${error.message}`);
    process.exit(1);
  }
}

main();
