/**
 * @file options.js
 * @description CLI option parsing helpers.
 *
 * @license MIT
 */
'use strict';

const { BOOLEAN_FLAGS } = require('../constants');

/**
 * Parses long-form CLI flags and positional arguments.
 *
 * @param {string[]} args - Raw command arguments after the command name.
 * @returns {{ opts: Record<string, string | boolean>, rest: string[] }} Parsed options and remaining arguments.
 */
function parseOptions(args) {
  const opts = {};
  const rest = [];

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (!arg.startsWith('--')) {
      rest.push(arg);
      continue;
    }

    const eq = arg.indexOf('=');
    if (eq !== -1) {
      opts[arg.slice(2, eq)] = arg.slice(eq + 1);
      continue;
    }

    const key = arg.slice(2);
    if (BOOLEAN_FLAGS.has(key)) {
      opts[key] = true;
      continue;
    }

    const next = args[i + 1];
    if (next && !next.startsWith('--')) {
      opts[key] = next;
      i += 1;
    } else {
      opts[key] = true;
    }
  }

  return { opts, rest };
}

module.exports = {
  parseOptions,
};
